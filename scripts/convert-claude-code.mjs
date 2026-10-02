#!/usr/bin/env node
// Convert a Claude Code session transcript (~/.claude/projects/**/<session>.jsonl)
// into an AgentLens trace.
//
// Usage:
//   node scripts/convert-claude-code.mjs <session.jsonl> [--out file]
//   node scripts/convert-claude-code.mjs --latest        # newest session on this machine
//
// Output defaults to local/<session>.agentlens.jsonl — local/ is gitignored on
// purpose: real sessions contain your private data and never belong in the repo.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const MAX_RESULT_CHARS = 20_000;

function findLatest() {
  const root = join(homedir(), '.claude', 'projects');
  let best = null;
  for (const dir of readdirSync(root)) {
    let entries;
    try {
      entries = readdirSync(join(root, dir));
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const path = join(root, dir, f);
      const mtime = statSync(path).mtimeMs;
      if (!best || mtime > best.mtime) best = { path, mtime };
    }
  }
  if (!best) {
    console.error('No Claude Code sessions found under ~/.claude/projects');
    process.exit(1);
  }
  return best.path;
}

const argv = process.argv.slice(2);
const outFlagIndex = argv.indexOf('--out');
const outFlag = outFlagIndex > -1 ? argv[outFlagIndex + 1] : undefined;
const input = argv.includes('--latest')
  ? findLatest()
  : argv.find((a, i) => !a.startsWith('--') && i !== outFlagIndex + 1);

if (!input) {
  console.error('usage: node scripts/convert-claude-code.mjs <session.jsonl> [--out file] | --latest');
  process.exit(1);
}

const outPath = outFlag ?? join('local', basename(input).replace(/\.jsonl$/, '') + '.agentlens.jsonl');

const events = [];
const push = (e) => events.push(e);
const clamp = (s) =>
  s.length > MAX_RESULT_CHARS
    ? `${s.slice(0, MAX_RESULT_CHARS)}\n…[truncated ${s.length - MAX_RESULT_CHARS} chars]`
    : s;

// tool_result content is a string or an array of blocks
const blockText = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && b.type === 'text' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return JSON.stringify(content ?? '');
};

let title;
let model;
let openRequest = null;
let skipped = 0;
let toolCalls = 0;
let userMessages = 0;

const closeTurn = () => {
  if (!openRequest) return;
  const u = openRequest.usage;
  push({
    type: 'message_stop',
    ts: openRequest.ts,
    ...(u
      ? {
          usage: {
            input_tokens:
              (u.input_tokens ?? 0) +
              (u.cache_read_input_tokens ?? 0) +
              (u.cache_creation_input_tokens ?? 0),
            output_tokens: u.output_tokens ?? 0,
          },
        }
      : {}),
  });
  openRequest = null;
};

for (const raw of readFileSync(input, 'utf8').split('\n')) {
  const line = raw.trim();
  if (!line) continue;
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    skipped += 1;
    continue;
  }
  // Sidechains are subagent transcripts interleaved into the same file —
  // a trace of their own; out of scope for v0.
  if (rec.isSidechain || rec.isMeta) {
    skipped += 1;
    continue;
  }
  const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;

  if (rec.type === 'summary' && typeof rec.summary === 'string') {
    title ??= rec.summary;
    continue;
  }
  if ((rec.type === 'ai-title' || rec.type === 'custom-title') && typeof rec.title === 'string') {
    title = rec.title;
    continue;
  }

  if (rec.type === 'user' && rec.message && Number.isFinite(ts)) {
    const content = rec.message.content;
    if (Array.isArray(content)) {
      let userText = '';
      for (const block of content) {
        if (!block) continue;
        if (block.type === 'tool_result') {
          closeTurn();
          push({
            type: 'tool_result',
            ts,
            id: block.tool_use_id,
            ok: !block.is_error,
            content: clamp(blockText(block.content)),
          });
        } else if (block.type === 'text' && block.text) {
          userText += (userText ? '\n' : '') + block.text;
        }
      }
      if (userText.trim()) {
        closeTurn();
        userMessages += 1;
        push({ type: 'user_message', ts, text: userText });
      }
    } else if (typeof content === 'string' && content.trim()) {
      closeTurn();
      userMessages += 1;
      push({ type: 'user_message', ts, text: content });
    }
    continue;
  }

  if (rec.type === 'assistant' && rec.message && Number.isFinite(ts)) {
    const m = rec.message;
    model ??= m.model;
    if (!openRequest || openRequest.requestId !== rec.requestId) {
      closeTurn();
      push({ type: 'message_start', ts, ...(m.model ? { model: m.model } : {}) });
      openRequest = { requestId: rec.requestId, usage: m.usage, ts };
    } else {
      openRequest.usage = m.usage ?? openRequest.usage;
      openRequest.ts = ts;
    }
    for (const block of m.content ?? []) {
      if (!block) continue;
      if (block.type === 'text' && block.text) {
        push({ type: 'text_delta', ts, text: block.text });
      } else if (block.type === 'thinking' && block.thinking) {
        push({ type: 'thinking_delta', ts, text: block.thinking });
      } else if (block.type === 'tool_use') {
        toolCalls += 1;
        push({ type: 'tool_use_start', ts, id: block.id, name: block.name });
        push({ type: 'tool_input_delta', ts, id: block.id, partial_json: JSON.stringify(block.input ?? {}) });
        push({ type: 'tool_use_stop', ts, id: block.id });
      }
    }
    continue;
  }

  skipped += 1;
}
closeTurn();

if (events.length === 0) {
  console.error('No convertible events found — is this a Claude Code session file?');
  process.exit(1);
}

// Sessions pause — overnight, across days. Collapse idle gaps longer than
// --max-gap (default 60s) down to exactly that length, so the timeline shows
// the work, not the waiting. Pass --max-gap off to keep real wall-clock gaps.
const gapFlagIndex = argv.indexOf('--max-gap');
const gapArg = gapFlagIndex > -1 ? argv[gapFlagIndex + 1] : '60';
let gapsCollapsed = 0;
if (gapArg !== 'off') {
  const maxGapMs = Math.max(1, Number(gapArg)) * 1000;
  let offset = 0;
  let prevTs = events[0].ts;
  for (const e of events) {
    const original = e.ts;
    if (original - prevTs > maxGapMs) {
      offset += original - prevTs - maxGapMs;
      gapsCollapsed += 1;
    }
    prevTs = original;
    e.ts = original - offset;
  }
}

events.unshift({
  type: 'trace_meta',
  ts: events[0].ts,
  agent: 'claude-code',
  ...(model ? { model } : {}),
  title: title ?? basename(input),
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n');

const durationMin = ((events[events.length - 1].ts - events[0].ts) / 1000 / 60).toFixed(1);
console.log(
  `wrote ${outPath}: ${events.length} events — ${userMessages} user messages, ${toolCalls} tool calls, ` +
    `${durationMin} min of active session time (${skipped} lines skipped, ${gapsCollapsed} idle gaps collapsed)`,
);
console.log('Note: converted sessions contain your real data. local/ is gitignored — keep it that way.');
