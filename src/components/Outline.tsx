import type { TraceItem } from '../types';
import { fmtOffset } from '../state/replay';

interface OutlineProps {
  chapters: TraceItem[];
  tsStart: number;
  currentId: string | null;
  onJump: (item: TraceItem) => void;
}

/**
 * Table of contents for a session: every user message is a chapter.
 * Clicking one scrubs the whole UI to that point in the run.
 */
export function Outline({ chapters, tsStart, currentId, onJump }: OutlineProps) {
  return (
    <nav className="outline" aria-label="Session outline">
      <p className="outline-title">Your messages</p>
      <ol className="outline-list">
        {chapters.map((chapter, i) => (
          <li key={chapter.id}>
            <button
              type="button"
              className={`outline-row${chapter.id === currentId ? ' active' : ''}`}
              onClick={() => onJump(chapter)}
            >
              <span className="outline-num">{i + 1}</span>
              <span className="outline-body">
                <span className="outline-text">{chapter.text}</span>
                <span className="outline-time">+{fmtOffset(chapter.startTs - tsStart)}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
