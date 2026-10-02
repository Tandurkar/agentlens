/// <reference lib="webworker" />
import { normalize } from './normalize';
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

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  try {
    const events: RawEvent[] = [];
    let malformed = 0;
    let buffer = '';

    const consumeLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed) as RawEvent;
        if (parsed && typeof parsed === 'object' && 'type' in parsed) {
          events.push(parsed);
          if (events.length % PROGRESS_EVERY === 0) {
            post({ kind: 'progress', count: events.length });
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

    post({ kind: 'done', trace: normalize(events, malformed) });
  } catch (err) {
    post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
