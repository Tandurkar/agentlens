import { useCallback, useEffect, useRef, useState } from 'react';
import type { Trace } from '../types';
import type { WorkerRequest, WorkerResponse } from './worker';

export interface ParseState {
  status: 'idle' | 'parsing' | 'ready' | 'error';
  count: number;
  name?: string;
  error?: string;
}

export function useTrace() {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [state, setState] = useState<ParseState>({ status: 'idle', count: 0 });
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const start = useCallback((request: WorkerRequest, name: string) => {
    workerRef.current?.terminate();
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setTrace(null);
    setState({ status: 'parsing', count: 0, name });
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.kind === 'progress') {
        setState((s) => ({ ...s, count: msg.count }));
      } else if (msg.kind === 'done') {
        setTrace(msg.trace);
        setState({ status: 'ready', count: msg.trace.eventCount, name });
        worker.terminate();
      } else {
        setState({ status: 'error', count: 0, error: msg.message, name });
        worker.terminate();
      }
    };
    worker.onerror = (ev) => {
      setState({ status: 'error', count: 0, error: ev.message || 'Worker failed', name });
      worker.terminate();
    };
    worker.postMessage(request);
  }, []);

  const openFile = useCallback((file: File) => start({ kind: 'file', file }, file.name), [start]);

  const openSample = useCallback(
    async (path: string, name: string) => {
      setState({ status: 'parsing', count: 0, name });
      try {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`Failed to fetch sample (HTTP ${res.status})`);
        start({ kind: 'text', text: await res.text() }, name);
      } catch (err) {
        setState({
          status: 'error',
          count: 0,
          error: err instanceof Error ? err.message : String(err),
          name,
        });
      }
    },
    [start],
  );

  return { trace, state, openFile, openSample };
}
