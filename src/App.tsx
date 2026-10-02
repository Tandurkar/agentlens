import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTrace } from './parse/useTrace';
import type { TraceItem } from './types';
import { fmtCost, fmtDuration, fmtTokens, indexForTs } from './state/replay';
import { Transcript } from './components/Transcript';
import { Timeline } from './components/Timeline';
import { Inspector } from './components/Inspector';
import { Waterfall } from './components/Waterfall';
import { Scrubber } from './components/Scrubber';

const SAMPLES = [
  { path: '/samples/bugfix-session.jsonl', name: 'bugfix session (sample)' },
];

type Tab = 'inspector' | 'waterfall';

export default function App() {
  const { trace, state, openFile, openSample } = useTrace();
  const [scrub, setScrub] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('inspector');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(300);
  const [followSignal, setFollowSignal] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const itemsById = useMemo(() => {
    const map = new Map<string, TraceItem>();
    for (const item of trace?.items ?? []) map.set(item.id, item);
    return map;
  }, [trace]);
  const selected = (selectedId && itemsById.get(selectedId)) || null;

  const moveScrub = useCallback((value: number) => {
    setScrub(value);
    setFollowSignal((n) => n + 1);
  }, []);

  // when a new trace arrives, jump to the end
  useEffect(() => {
    if (trace) {
      setSelectedId(null);
      setPlaying(false);
      setTab('inspector');
      moveScrub(trace.eventCount);
    }
  }, [trace, moveScrub]);

  // replay loop
  useEffect(() => {
    if (!playing || !trace) return;
    const tick = window.setInterval(() => {
      setScrub((s) => {
        const next = Math.min(trace.eventCount, s + Math.max(1, Math.round(speed / 20)));
        if (next >= trace.eventCount) setPlaying(false);
        return next;
      });
      setFollowSignal((n) => n + 1);
    }, 50);
    return () => window.clearInterval(tick);
  }, [playing, speed, trace]);

  // keyboard scrubbing
  useEffect(() => {
    if (!trace) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowLeft') moveScrub(Math.max(0, scrub - 25));
      else if (e.key === 'ArrowRight') moveScrub(Math.min(trace.eventCount, scrub + 25));
      else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const togglePlay = () => {
    if (!trace) return;
    if (!playing && scrub >= trace.eventCount) {
      // replay from the start
      moveScrub(0);
    }
    setPlaying((p) => !p);
  };

  const handleSelect = useCallback(
    (item: TraceItem) => {
      setSelectedId(item.id);
      setTab('inspector');
      if (trace && item.startIndex >= scrub) {
        moveScrub(Math.min(trace.eventCount, item.endIndex + 1));
      }
    },
    [trace, scrub, moveScrub],
  );

  const handleScrubTs = useCallback(
    (ts: number) => {
      if (trace) moveScrub(indexForTs(trace, ts));
    },
    [trace, moveScrub],
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) openFile(file);
  };

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={handleDrop}
    >
      <header className="topbar">
        <span className="wordmark">
          <span className="wordmark-icon">◉</span> AgentLens
        </span>
        {trace && (
          <span className="trace-stats">
            {state.name && <span className="trace-name">{state.name}</span>}
            <span>{fmtTokens(trace.eventCount)} events</span>
            <span>{fmtDuration(trace.totals.durationMs)}</span>
            <span>
              {fmtTokens(trace.totals.inputTokens)}→{fmtTokens(trace.totals.outputTokens)} tok
            </span>
            <span>{fmtCost(trace.totals.costUsd)}</span>
            {trace.totals.errors > 0 && <span className="bad">{trace.totals.errors} errors</span>}
          </span>
        )}
        <span className="topbar-actions">
          <select
            className="sample-select"
            value=""
            onChange={(e) => {
              const sample = SAMPLES.find((s) => s.path === e.target.value);
              if (sample) openSample(sample.path, sample.name);
            }}
          >
            <option value="" disabled>
              Load sample…
            </option>
            {SAMPLES.map((s) => (
              <option key={s.path} value={s.path}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
            Open trace
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".jsonl,.json,.txt"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) openFile(file);
              e.target.value = '';
            }}
          />
        </span>
      </header>

      {!trace && (
        <main className="landing">
          <div className="landing-card">
            <div className="landing-logo">◉</div>
            <h1>AgentLens</h1>
            <p className="tagline">
              A flight recorder for AI agents. Drop in a trace and scrub through the run like a video —
              every thought, tool call, and token, with the cost of each step.
            </p>
            <p className="privacy">
              100% client-side. Your trace is parsed in your browser and never leaves your machine.
            </p>
            {state.status === 'parsing' ? (
              <p className="parsing">parsing… {state.count.toLocaleString()} events</p>
            ) : (
              <div className="landing-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => openSample(SAMPLES[0].path, SAMPLES[0].name)}
                >
                  Load the sample trace
                </button>
                <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
                  Open a .jsonl trace
                </button>
              </div>
            )}
            {state.status === 'error' && <p className="error-text">Could not load trace: {state.error}</p>}
          </div>
        </main>
      )}

      {trace && trace.items.length === 0 && (
        <main className="landing">
          <div className="landing-card">
            <h1>Nothing to replay</h1>
            <p className="tagline">
              Parsed {trace.eventCount.toLocaleString()} JSON lines, but none matched the AgentLens trace
              format — this file speaks a different dialect.
            </p>
            {state.name?.match(/^[0-9a-f-]{36}\.jsonl$/) ? (
              <p className="privacy">
                This looks like a Claude Code session file. Convert it first, then open the converted copy:
              </p>
            ) : (
              <p className="privacy">
                If this is a Claude Code session file, convert it first, then open the converted copy:
              </p>
            )}
            <pre className="code" style={{ textAlign: 'left' }}>
              node scripts/convert-claude-code.mjs{' '}
              {state.name?.match(/^[0-9a-f-]{36}\.jsonl$/) ? `~/.claude/projects/*/${state.name}` : '<that-file>'}
            </pre>
            <div className="landing-actions" style={{ marginTop: 20 }}>
              <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
                Open another file
              </button>
            </div>
          </div>
        </main>
      )}

      {trace && trace.items.length > 0 && (
        <>
          <main className="main">
            <Transcript
              trace={trace}
              scrub={scrub}
              selectedId={selectedId}
              onSelect={handleSelect}
              followSignal={followSignal}
            />
            <aside className="side">
              <nav className="tabs">
                <button
                  type="button"
                  className={tab === 'inspector' ? 'tab active' : 'tab'}
                  onClick={() => setTab('inspector')}
                >
                  Inspector
                </button>
                <button
                  type="button"
                  className={tab === 'waterfall' ? 'tab active' : 'tab'}
                  onClick={() => setTab('waterfall')}
                >
                  Waterfall
                </button>
              </nav>
              <div className="side-body">
                {tab === 'inspector' ? (
                  <Inspector trace={trace} item={selected} />
                ) : (
                  <Waterfall trace={trace} selectedId={selectedId} onSelect={handleSelect} />
                )}
              </div>
            </aside>
          </main>
          <footer className="bottom">
            <Timeline
              trace={trace}
              scrub={scrub}
              selectedId={selectedId}
              onPickItem={handleSelect}
              onScrubTs={handleScrubTs}
            />
            <Scrubber
              trace={trace}
              scrub={scrub}
              playing={playing}
              speed={speed}
              onScrub={moveScrub}
              onTogglePlay={togglePlay}
              onSpeed={setSpeed}
            />
          </footer>
        </>
      )}

      {state.status === 'parsing' && trace === null && !dragging && null}
      {dragging && (
        <div className="drop-overlay">
          <span>Drop your .jsonl trace</span>
        </div>
      )}
    </div>
  );
}
