/// <reference lib="webworker" />
import { normalize } from './normalize';
import { convertClaudeCode, looksLikeClaudeCodeLine } from './claudeCode';
import type { RawEvent, Trace } from '../types';

export type WorkerRequest = { kind: 'file'; file: File } | { kind: 'text'; text: string };

export type WorkerResponse =
  | { kind: 'progress'; count: number }
  | { kind: 'done'; trace: Trace }
  | { kind: 'error'; message: string };

const post = (message: WorkerResponse) => {
  (self as unknown as Worker).postMessage(message);
};

const PROGRESS_EVERY = 5000;

const AGENTLENS_TYPES = new Set([
  'trace_meta',
  'user_message',
  'message_start',
  'text_delta',
  'thinking_delta',
  'tool_use_start',
  'tool_input_delta',
  'tool_use_stop',
  'tool_result',
  'message_stop',
  'error',
  'retry',
]);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  try {
    const objects: Array<Record<string, unknown>> = [];
    let malformed = 0;
    let agentlensLines = 0;
    let claudeCodeLines = 0;
    let buffer = '';

    const consumeLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && 'type' in parsed) {
          objects.push(parsed);
          if (AGENTLENS_TYPES.has(String(parsed.type))) agentlensLines += 1;
          else if (looksLikeClaudeCodeLine(parsed)) claudeCodeLines += 1;
          if (objects.length % PROGRESS_EVERY === 0) {
            post({ kind: 'progress', count: objects.length });
          }
        } else {
          malformed += 1;
        }
      } catch {
        malformed += 1;
      }
    };

    const feed = (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    };

    if (ev.data.kind === 'file') {
      const reader = ev.data.file.stream().pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (value) feed(value);
        if (done) break;
      }
    } else {
      feed(ev.data.text);
    }
    consumeLine(buffer);

    // A raw Claude Code session transcript? Convert it on the fly.
    const events: RawEvent[] =
      agentlensLines === 0 && claudeCodeLines > 0
        ? convertClaudeCode(objects)
        : (objects as unknown as RawEvent[]);

    post({ kind: 'done', trace: normalize(events, malformed) });
  } catch (err) {
    post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
