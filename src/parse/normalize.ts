import type { RawEvent, Trace, TraceItem, TraceMeta } from '../types';

/**
 * Single pass over the raw event stream, producing transcript items with
 * time-travel breakpoints. Runs inside the parser worker so the main
 * thread never touches the raw file.
 */
export function normalize(events: RawEvent[], malformedLines: number): Trace {
  const items: TraceItem[] = [];
  const openTools = new Map<string, TraceItem>();
  let current: TraceItem | null = null;
  let meta: TraceMeta = {};
  let turn = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let toolCalls = 0;
  let errors = 0;
  let tsStart = Number.POSITIVE_INFINITY;
  let tsEnd = Number.NEGATIVE_INFINITY;

  const closeCurrent = (index: number, ts: number) => {
    if (current) {
      current.endIndex = index;
      current.endTs = ts;
      current = null;
    }
  };

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (typeof e.ts === 'number') {
      if (e.ts < tsStart) tsStart = e.ts;
      if (e.ts > tsEnd) tsEnd = e.ts;
    }
    switch (e.type) {
      case 'trace_meta':
        meta = { agent: e.agent, model: e.model, title: e.title };
        break;
      case 'user_message':
        closeCurrent(i, e.ts);
        items.push({
          id: `u${i}`,
          kind: 'user',
          turn,
          startIndex: i,
          endIndex: i,
          startTs: e.ts,
          endTs: e.ts,
          text: e.text,
          breakpoints: null,
        });
        break;
      case 'message_start':
        closeCurrent(i, e.ts);
        turn += 1;
        break;
      case 'text_delta':
      case 'thinking_delta': {
        const kind = e.type === 'text_delta' ? 'text' : 'thinking';
        if (!current || current.kind !== kind) {
          closeCurrent(i, e.ts);
          current = {
            id: `${kind === 'text' ? 't' : 'k'}${i}`,
            kind,
            turn,
            startIndex: i,
            endIndex: i,
            startTs: e.ts,
            endTs: e.ts,
            text: '',
            breakpoints: [],
          };
          items.push(current);
        }
        current.text += e.text;
        current.breakpoints!.push([i, current.text.length]);
        current.endIndex = i;
        current.endTs = e.ts;
        break;
      }
      case 'tool_use_start': {
        closeCurrent(i, e.ts);
        const tool: TraceItem = {
          id: e.id,
          kind: 'tool',
          turn,
          startIndex: i,
          endIndex: i,
          startTs: e.ts,
          endTs: e.ts,
          text: '',
          breakpoints: [],
          toolName: e.name,
        };
        openTools.set(e.id, tool);
        items.push(tool);
        toolCalls += 1;
        break;
      }
      case 'tool_input_delta': {
        const tool = openTools.get(e.id);
        if (!tool) break;
        tool.text += e.partial_json;
        tool.breakpoints!.push([i, tool.text.length]);
        tool.endIndex = i;
        tool.endTs = e.ts;
        break;
      }
      case 'tool_use_stop': {
        const tool = openTools.get(e.id);
        if (tool) {
          tool.endIndex = i;
          tool.endTs = e.ts;
        }
        break;
      }
      case 'tool_result': {
        const tool = openTools.get(e.id);
        if (!tool) break;
        tool.result = {
          ok: e.ok,
          content: e.content,
          durationMs: e.duration_ms ?? Math.max(0, e.ts - tool.endTs),
        };
        tool.resultIndex = i;
        tool.endIndex = i;
        tool.endTs = e.ts;
        if (!e.ok) errors += 1;
        openTools.delete(e.id);
        break;
      }
      case 'message_stop':
        closeCurrent(i, e.ts);
        if (e.usage) {
          inputTokens += e.usage.input_tokens;
          outputTokens += e.usage.output_tokens;
        }
        if (typeof e.cost_usd === 'number') costUsd += e.cost_usd;
        break;
      case 'error':
        closeCurrent(i, e.ts);
        errors += 1;
        items.push({
          id: `e${i}`,
          kind: 'error',
          turn,
          startIndex: i,
          endIndex: i,
          startTs: e.ts,
          endTs: e.ts,
          text: e.message,
          breakpoints: null,
        });
        break;
      case 'retry':
        items.push({
          id: `r${i}`,
          kind: 'retry',
          turn,
          startIndex: i,
          endIndex: i,
          startTs: e.ts,
          endTs: e.ts,
          text: `retry #${e.attempt}${e.reason ? ` — ${e.reason}` : ''}`,
          breakpoints: null,
        });
        break;
    }
  }

  if (!Number.isFinite(tsStart)) {
    tsStart = 0;
    tsEnd = 0;
  }

  return {
    meta,
    events,
    items,
    eventCount: events.length,
    turns: turn,
    totals: {
      durationMs: Math.max(0, tsEnd - tsStart),
      inputTokens,
      outputTokens,
      costUsd,
      toolCalls,
      errors,
    },
    tsStart,
    tsEnd,
    malformedLines,
  };
}
