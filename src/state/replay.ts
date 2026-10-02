import type { Trace, TraceItem } from '../types';

/**
 * Time travel is cheap because items carry breakpoints: the state at any
 * scrub position is found with binary searches, never by replaying events.
 * `scrub` counts consumed events: event i has happened iff i < scrub.
 */

/** Number of items that exist once `scrub` events have been consumed. */
export function visibleItemCount(trace: Trace, scrub: number): number {
  const { items } = trace;
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].startIndex < scrub) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The item's text as it had streamed in at the given scrub position. */
export function textAt(item: TraceItem, scrub: number): string {
  if (scrub > item.endIndex) return item.text;
  const bps = item.breakpoints;
  if (!bps || bps.length === 0) return item.startIndex < scrub ? item.text : '';
  let lo = 0;
  let hi = bps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bps[mid][0] < scrub) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? '' : item.text.slice(0, bps[lo - 1][1]);
}

/** Wall-clock timestamp at a scrub position. */
export function tsAt(trace: Trace, scrub: number): number {
  if (trace.events.length === 0) return trace.tsStart;
  const i = Math.max(0, Math.min(scrub - 1, trace.events.length - 1));
  return trace.events[i].ts;
}

/** Scrub position (consumed-event count) for a wall-clock timestamp. */
export function indexForTs(trace: Trace, ts: number): number {
  const { events } = trace;
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].ts <= ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function fmtOffset(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(ms % 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function fmtCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
