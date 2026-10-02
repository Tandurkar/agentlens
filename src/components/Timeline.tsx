import { useCallback, useEffect, useRef } from 'react';
import type { ItemKind, Trace, TraceItem } from '../types';
import { tsAt } from '../state/replay';

interface TimelineProps {
  trace: Trace;
  scrub: number;
  selectedId: string | null;
  onPickItem: (item: TraceItem) => void;
  onScrubTs: (ts: number) => void;
}

const LANES: Record<ItemKind, number> = {
  user: 0,
  text: 1,
  thinking: 2,
  tool: 3,
  error: 4,
  retry: 4,
};
const LANE_LABELS = ['user', 'reply', 'thinking', 'tools', 'errors'];
const COLORS: Record<ItemKind, string> = {
  user: '#6EA8E0',
  text: '#7FBF9E',
  thinking: '#A78BFA',
  tool: '#4CC9C0',
  error: '#E5635C',
  retry: '#E8B45A',
};

const PAD_LEFT = 64;
const PAD_RIGHT = 12;
const LANE_COUNT = 5;

export function Timeline({ trace, scrub, selectedId, onPickItem, onScrubTs }: TimelineProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const span = Math.max(1, trace.tsEnd - trace.tsStart);

  const xFor = useCallback(
    (ts: number, width: number) =>
      PAD_LEFT + ((ts - trace.tsStart) / span) * (width - PAD_LEFT - PAD_RIGHT),
    [trace.tsStart, span],
  );

  const tsForX = useCallback(
    (x: number, width: number) =>
      trace.tsStart + ((x - PAD_LEFT) / Math.max(1, width - PAD_LEFT - PAD_RIGHT)) * span,
    [trace.tsStart, span],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const laneHeight = height / LANE_COUNT;

    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      const y = lane * laneHeight;
      ctx.fillStyle = 'rgba(126, 147, 140, 0.9)';
      ctx.fillText(LANE_LABELS[lane], 10, y + laneHeight / 2);
      ctx.strokeStyle = 'rgba(34, 48, 43, 0.9)';
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }

    // Coalesce items into per-pixel coverage runs so draw cost stays flat
    // no matter how many items the trace has (100k+ spans draw as at most
    // one run per pixel column per kind).
    const track = Math.max(1, Math.ceil(width - PAD_LEFT - PAD_RIGHT));
    const coverage = new Map<ItemKind, { past: Uint8Array; future: Uint8Array }>();
    let selected: TraceItem | null = null;
    for (const item of trace.items) {
      if (item.id === selectedId) selected = item;
      let cov = coverage.get(item.kind);
      if (!cov) {
        cov = { past: new Uint8Array(track + 1), future: new Uint8Array(track + 1) };
        coverage.set(item.kind, cov);
      }
      const x0 = Math.max(0, Math.floor(xFor(item.startTs, width) - PAD_LEFT));
      const x1 = Math.min(track, Math.max(x0 + 2, Math.ceil(xFor(item.endTs, width) - PAD_LEFT)));
      const target = item.startIndex < scrub ? cov.past : cov.future;
      for (let x = x0; x < x1; x++) target[x] = 1;
    }

    const drawRuns = (kind: ItemKind, cells: Uint8Array, alpha: number) => {
      const lane = LANES[kind];
      const y = lane * laneHeight + 4;
      const h = laneHeight - 8;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = COLORS[kind];
      let runStart = -1;
      for (let x = 0; x <= track; x++) {
        if (cells[x] && runStart < 0) runStart = x;
        else if (!cells[x] && runStart >= 0) {
          ctx.fillRect(PAD_LEFT + runStart, y, x - runStart, h);
          runStart = -1;
        }
      }
    };
    for (const [kind, cov] of coverage) {
      drawRuns(kind, cov.future, 0.22);
      drawRuns(kind, cov.past, 0.92);
    }
    ctx.globalAlpha = 1;

    if (selected) {
      const lane = LANES[selected.kind];
      const x0 = xFor(selected.startTs, width);
      const x1 = Math.max(x0 + 2, xFor(selected.endTs, width));
      const y = lane * laneHeight + 4;
      const h = laneHeight - 8;
      ctx.fillStyle = COLORS[selected.kind];
      ctx.fillRect(x0, y, x1 - x0, h);
      ctx.strokeStyle = '#E9F2EE';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 - 1, y - 1, x1 - x0 + 2, h + 2);
      ctx.lineWidth = 1;
    }

    // playhead
    const playheadX = xFor(tsAt(trace, scrub), width);
    ctx.strokeStyle = '#E8B45A';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();
    ctx.fillStyle = '#E8B45A';
    ctx.beginPath();
    ctx.moveTo(playheadX - 5, 0);
    ctx.lineTo(playheadX + 5, 0);
    ctx.lineTo(playheadX, 7);
    ctx.closePath();
    ctx.fill();
  }, [trace, scrub, selectedId, xFor]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [draw]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const width = wrap.clientWidth;
    const lane = Math.floor((y / wrap.clientHeight) * LANE_COUNT);
    const ts = tsForX(x, width);
    const slackTs = (3 / Math.max(1, width - PAD_LEFT - PAD_RIGHT)) * span;

    let best: TraceItem | null = null;
    let bestSpan = Number.POSITIVE_INFINITY;
    for (const item of trace.items) {
      if (LANES[item.kind] !== lane) continue;
      if (ts < item.startTs - slackTs || ts > item.endTs + slackTs) continue;
      const itemSpan = item.endTs - item.startTs;
      if (itemSpan < bestSpan) {
        best = item;
        bestSpan = itemSpan;
      }
    }
    if (best) onPickItem(best);
    else onScrubTs(ts);
  };

  return (
    <div ref={wrapRef} className="timeline">
      <canvas ref={canvasRef} onClick={handleClick} />
    </div>
  );
}
