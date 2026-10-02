import { useMemo } from 'react';
import type { Trace, TraceItem } from '../types';
import { fmtDuration } from '../state/replay';
import { prettyToolName, toolSummary } from '../parse/toolSummary';

interface WaterfallProps {
  trace: Trace;
  selectedId: string | null;
  onSelect: (item: TraceItem) => void;
}

const MAX_ROWS = 40;

export function Waterfall({ trace, selectedId, onSelect }: WaterfallProps) {
  const tools = useMemo(
    () =>
      trace.items
        .filter((item) => item.kind === 'tool' && item.result)
        .sort((a, b) => b.result!.durationMs - a.result!.durationMs)
        .slice(0, MAX_ROWS),
    [trace],
  );

  if (tools.length === 0) {
    return <div className="panel-empty">No completed tool calls in this trace.</div>;
  }

  const max = tools[0].result!.durationMs || 1;
  const totalToolMs = trace.items.reduce(
    (acc, item) => acc + (item.kind === 'tool' && item.result ? item.result.durationMs : 0),
    0,
  );
  const share = trace.totals.durationMs > 0 ? Math.round((totalToolMs / trace.totals.durationMs) * 100) : 0;

  return (
    <div className="waterfall">
      <p className="panel-note">
        Tool latency — {fmtDuration(totalToolMs)} waiting on tools, {share}% of the run. Click a bar to inspect.
      </p>
      {tools.map((item) => {
        const dur = item.result!.durationMs;
        return (
          <button
            type="button"
            key={item.id}
            className={`wf-row${item.id === selectedId ? ' selected' : ''}`}
            onClick={() => onSelect(item)}
            title={toolSummary(item.toolName ?? '', item.text) ?? undefined}
          >
            <span className="wf-name">{prettyToolName(item.toolName ?? '')}</span>
            <span className="wf-bar-track">
              <span
                className={`wf-bar${item.result!.ok ? '' : ' wf-bar-fail'}`}
                style={{ width: `${Math.max(1.5, (dur / max) * 100)}%` }}
              />
            </span>
            <span className="wf-dur">{fmtDuration(dur)}</span>
          </button>
        );
      })}
    </div>
  );
}
