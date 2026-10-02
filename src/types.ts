/**
 * AgentLens trace format v0.
 *
 * A trace is a JSONL file: one JSON event per line, in chronological order.
 * The schema mirrors the shape of a streamed Claude API agent session
 * (message/content-block deltas, tool use, tool results) flattened into
 * timestamped events, so a thin recorder shim can produce it from any
 * agent loop. All timestamps are epoch milliseconds.
 */

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export type RawEvent =
  | { type: 'trace_meta'; ts: number; agent?: string; model?: string; title?: string }
  | { type: 'user_message'; ts: number; text: string }
  | { type: 'message_start'; ts: number; model?: string }
  | { type: 'text_delta'; ts: number; text: string }
  | { type: 'thinking_delta'; ts: number; text: string }
  | { type: 'tool_use_start'; ts: number; id: string; name: string }
  | { type: 'tool_input_delta'; ts: number; id: string; partial_json: string }
  | { type: 'tool_use_stop'; ts: number; id: string }
  | { type: 'tool_result'; ts: number; id: string; ok: boolean; content: string; duration_ms?: number }
  | { type: 'message_stop'; ts: number; usage?: Usage; cost_usd?: number; stop_reason?: string }
  | { type: 'error'; ts: number; message: string }
  | { type: 'retry'; ts: number; attempt: number; reason?: string };

export type ItemKind = 'user' | 'text' | 'thinking' | 'tool' | 'error' | 'retry';

export interface ToolResult {
  ok: boolean;
  content: string;
  durationMs: number;
}

/**
 * One visual block in the transcript: a user message, a run of assistant
 * text or thinking, a tool call, or an error/retry marker.
 *
 * `text` holds the full final content (for tools: the input JSON).
 * `breakpoints` maps event indices to cumulative text lengths, so the
 * scrubber can reconstruct the exact partial text at any moment with a
 * binary search instead of replaying events.
 */
export interface TraceItem {
  id: string;
  kind: ItemKind;
  turn: number;
  startIndex: number;
  endIndex: number;
  startTs: number;
  endTs: number;
  text: string;
  breakpoints: Array<[eventIndex: number, textLength: number]> | null;
  toolName?: string;
  resultIndex?: number;
  result?: ToolResult;
}

export interface TraceTotals {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolCalls: number;
  errors: number;
}

export interface TraceMeta {
  agent?: string;
  model?: string;
  title?: string;
}

export interface Trace {
  meta: TraceMeta;
  events: RawEvent[];
  items: TraceItem[];
  eventCount: number;
  turns: number;
  totals: TraceTotals;
  tsStart: number;
  tsEnd: number;
  malformedLines: number;
}
