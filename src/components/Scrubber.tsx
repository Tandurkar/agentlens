import type { Trace } from '../types';
import { fmtOffset, tsAt } from '../state/replay';

interface ScrubberProps {
  trace: Trace;
  scrub: number;
  playing: boolean;
  speed: number;
  onScrub: (value: number) => void;
  onTogglePlay: () => void;
  onSpeed: (value: number) => void;
}

const SPEEDS = [
  { value: 60, label: '×1' },
  { value: 300, label: '×5' },
  { value: 1200, label: '×20' },
  { value: 6000, label: '×100' },
];

export function Scrubber({ trace, scrub, playing, speed, onScrub, onTogglePlay, onSpeed }: ScrubberProps) {
  const atEnd = scrub >= trace.eventCount;
  const offset = tsAt(trace, scrub) - trace.tsStart;

  return (
    <div className="scrubber">
      <button type="button" className="ctl" title="Jump to start" onClick={() => onScrub(0)}>
        ⏮
      </button>
      <button type="button" className="ctl ctl-play" title={playing ? 'Pause' : 'Replay'} onClick={onTogglePlay}>
        {playing ? '⏸' : '▶'}
      </button>
      <button type="button" className="ctl" title="Jump to end" onClick={() => onScrub(trace.eventCount)}>
        ⏭
      </button>
      <select
        className="speed"
        value={speed}
        onChange={(e) => onSpeed(Number(e.target.value))}
        title="Replay speed (events per second)"
      >
        {SPEEDS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <input
        type="range"
        className="slider"
        min={0}
        max={trace.eventCount}
        step={1}
        value={scrub}
        onChange={(e) => onScrub(Number(e.target.value))}
        aria-label="Scrub through the trace"
      />
      <span className="readout">
        +{fmtOffset(offset)} · event {scrub.toLocaleString()}/{trace.eventCount.toLocaleString()}
        {atEnd && <span className="live">END</span>}
      </span>
    </div>
  );
}
