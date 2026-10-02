import type { RawEvent, Usage } from '../types';

/**
 * In-browser converter for Claude Code session transcripts
 * (~/.claude/projects/<project>/<session-id>.jsonl), so raw session files
 * open directly in the viewer. Mirrors scripts/convert-claude-code.mjs.
 */

const MAX_RESULT_CHARS = 20_000;
/** Sessions pause — overnight, across days. Idle gaps longer than this are
 * collapsed to exactly this length so the timeline shows work, not waiting. */
const MAX_GAP_MS = 60_000;

type Obj = Record<string, unknown>;

export function looksLikeClaudeCodeLine(o: Obj): boolean {
  return (o.type === 'user' || o.type === 'assistant') && typeof o.timestamp === 'string';
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

const clamp = (s: string): string =>
  s.length > MAX_RESULT_CHARS
    ? `${s.slice(0, MAX_RESULT_CHARS)}\n…[truncated ${s.length - MAX_RESULT_CHARS} chars]`
    : s;

// tool_result content is a string or an array of blocks
const blockText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && (b as Obj).type === 'text' ? String((b as Obj).text ?? '') : ''))
      .filter(Boolean)
      .join('\n');
  }
  return JSON.stringify(content ?? '');
};

export function convertClaudeCode(lines: Obj[]): RawEvent[] {
  const events: RawEvent[] = [];
  let title: string | undefined;
  let model: string | undefined;
  let open: { requestId: unknown; usage: Obj | undefined; ts: number } | null = null;

  const closeTurn = () => {
    if (!open) return;
    const u = open.usage;
    const usage: Usage | undefined = u
      ? {
          input_tokens: num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens),
          output_tokens: num(u.output_tokens),
        }
      : undefined;
    events.push({ type: 'message_stop', ts: open.ts, ...(usage ? { usage } : {}) });
    open = null;
  };

  for (const rec of lines) {
    // Sidechains are interleaved subagent transcripts — traces of their own.
    if (rec.isSidechain || rec.isMeta) continue;
    const ts = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;

    if (rec.type === 'summary' && typeof rec.summary === 'string') {
      title ??= rec.summary;
      continue;
    }
    if ((rec.type === 'ai-title' || rec.type === 'custom-title') && typeof rec.title === 'string') {
      title = rec.title;
      continue;
    }

    const message = rec.message as Obj | undefined;

    if (rec.type === 'user' && message && Number.isFinite(ts)) {
      const content = message.content;
      if (Array.isArray(content)) {
        let userText = '';
        for (const b of content as Obj[]) {
          if (!b) continue;
          if (b.type === 'tool_result') {
            closeTurn();
            events.push({
              type: 'tool_result',
              ts,
              id: String(b.tool_use_id ?? ''),
              ok: !b.is_error,
              content: clamp(blockText(b.content)),
            });
          } else if (b.type === 'text' && typeof b.text === 'string') {
            userText += (userText ? '\n' : '') + b.text;
          }
        }
        if (userText.trim()) {
          closeTurn();
          events.push({ type: 'user_message', ts, text: userText });
        }
      } else if (typeof content === 'string' && content.trim()) {
        closeTurn();
        events.push({ type: 'user_message', ts, text: content });
      }
      continue;
    }

    if (rec.type === 'assistant' && message && Number.isFinite(ts)) {
      if (typeof message.model === 'string') model ??= message.model;
      if (!open || open.requestId !== rec.requestId) {
        closeTurn();
        events.push({
          type: 'message_start',
          ts,
          ...(typeof message.model === 'string' ? { model: message.model } : {}),
        });
        open = { requestId: rec.requestId, usage: message.usage as Obj | undefined, ts };
      } else {
        open.usage = (message.usage as Obj | undefined) ?? open.usage;
        open.ts = ts;
      }
      const content = Array.isArray(message.content) ? (message.content as Obj[]) : [];
      for (const b of content) {
        if (!b) continue;
        if (b.type === 'text' && typeof b.text === 'string' && b.text) {
          events.push({ type: 'text_delta', ts, text: b.text });
        } else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking) {
          events.push({ type: 'thinking_delta', ts, text: b.thinking });
        } else if (b.type === 'tool_use') {
          const id = String(b.id ?? '');
          events.push({ type: 'tool_use_start', ts, id, name: String(b.name ?? 'tool') });
          events.push({ type: 'tool_input_delta', ts, id, partial_json: JSON.stringify(b.input ?? {}) });
          events.push({ type: 'tool_use_stop', ts, id });
        }
      }
    }
  }
  closeTurn();
  if (events.length === 0) return events;

  let offset = 0;
  let prev = events[0].ts;
  for (const e of events) {
    const original = e.ts;
    if (original - prev > MAX_GAP_MS) offset += original - prev - MAX_GAP_MS;
    prev = original;
    e.ts = original - offset;
  }

  events.unshift({
    type: 'trace_meta',
    ts: events[0].ts,
    agent: 'claude-code',
    ...(model ? { model } : {}),
    ...(title ? { title } : {}),
  });
  return events;
}
