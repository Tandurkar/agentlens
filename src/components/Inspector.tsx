import { useState } from 'react';
import type { Trace, TraceItem } from '../types';
import { fmtCost, fmtDuration, fmtOffset, fmtTokens } from '../state/replay';

interface InspectorProps {
  trace: Trace;
  item: TraceItem | null;
}

const CLAMP = 4000;

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function ClampedPre({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const clamped = !open && text.length > CLAMP;
  return (
    <>
      <pre className={className}>{clamped ? `${text.slice(0, CLAMP)}…` : text}</pre>
      {text.length > CLAMP && (
        <button type="button" className="link-btn" onClick={() => setOpen(!open)}>
          {open ? 'show less' : `show all ${fmtTokens(text.length)} chars`}
        </button>
      )}
    </>
  );
}

function Summary({ trace }: { trace: Trace }) {
  const { totals, meta } = trace;
  return (
    <div className="inspector">
      <h2 className="panel-title">{meta.title ?? 'Trace summary'}</h2>
      {(meta.agent || meta.model) && (
        <p className="panel-note">
          {meta.agent ?? 'unknown agent'}
          {meta.model ? ` · ${meta.model}` : ''}
        </p>
      )}
      <dl className="facts">
        <div>
          <dt>duration</dt>
          <dd>{fmtDuration(totals.durationMs)}</dd>
        </div>
        <div>
          <dt>events</dt>
          <dd>{fmtTokens(trace.eventCount)}</dd>
        </div>
        <div>
          <dt>turns</dt>
          <dd>{trace.turns}</dd>
        </div>
        <div>
          <dt>tool calls</dt>
          <dd>{totals.toolCalls}</dd>
        </div>
        <div>
          <dt>tokens in / out</dt>
          <dd>
            {fmtTokens(totals.inputTokens)} / {fmtTokens(totals.outputTokens)}
          </dd>
        </div>
        <div>
          <dt>cost</dt>
          <dd>{fmtCost(totals.costUsd)}</dd>
        </div>
        <div>
          <dt>errors</dt>
          <dd className={totals.errors > 0 ? 'bad' : ''}>{totals.errors}</dd>
        </div>
        {trace.malformedLines > 0 && (
          <div>
            <dt>malformed lines</dt>
            <dd className="bad">{trace.malformedLines}</dd>
          </div>
        )}
      </dl>
      <p className="panel-hint">
        Click a tool call in the transcript or a span on the timeline to inspect it. Drag the slider — or press
        play — to travel through the run.
      </p>
    </div>
  );
}

export function Inspector({ trace, item }: InspectorProps) {
  if (!item) return <Summary trace={trace} />;

  const startOffset = fmtOffset(item.startTs - trace.tsStart);

  return (
    <div className="inspector">
      <h2 className="panel-title">
        {item.kind === 'tool' ? `⚙ ${item.toolName}` : item.kind}
        {item.kind === 'tool' && item.result && (
          <span className={`badge badge-${item.result.ok ? 'ok' : 'fail'}`}>
            {item.result.ok ? 'ok' : 'failed'}
          </span>
        )}
      </h2>
      <dl className="facts">
        <div>
          <dt>started at</dt>
          <dd>+{startOffset}</dd>
        </div>
        <div>
          <dt>duration</dt>
          <dd>
            {item.kind === 'tool' && item.result
              ? fmtDuration(item.result.durationMs)
              : fmtDuration(item.endTs - item.startTs)}
          </dd>
        </div>
        <div>
          <dt>turn</dt>
          <dd>{item.turn}</dd>
        </div>
        <div>
          <dt>events</dt>
          <dd>
            {item.startIndex}–{item.endIndex}
          </dd>
        </div>
      </dl>
      {item.kind === 'tool' ? (
        <>
          <h3 className="panel-sub">input</h3>
          <ClampedPre className="code" text={prettyJson(item.text)} />
          {item.result && (
            <>
              <h3 className="panel-sub">result</h3>
              <ClampedPre className="code" text={item.result.content} />
            </>
          )}
        </>
      ) : (
        <>
          <h3 className="panel-sub">content</h3>
          <ClampedPre className="code code-prose" text={item.text} />
        </>
      )}
    </div>
  );
}
