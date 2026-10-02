import { useCallback, useEffect, useRef, useState } from 'react';
import type { Trace, TraceItem } from '../types';
import { fmtDuration, textAt, visibleItemCount } from '../state/replay';
import { VirtualList, type VirtualListHandle } from './VirtualList';

interface TranscriptProps {
  trace: Trace;
  scrub: number;
  selectedId: string | null;
  onSelect: (item: TraceItem) => void;
  /** increments every time the scrub position is moved by slider/play/timeline */
  followSignal: number;
}

const THINKING_PREVIEW = 220;

export function Transcript({ trace, scrub, selectedId, onSelect, followSignal }: TranscriptProps) {
  const listRef = useRef<VirtualListHandle | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const count = visibleItemCount(trace, scrub);
  const items = trace.items;

  useEffect(() => {
    if (count > 0) listRef.current?.scrollToIndex(count - 1, 'end');
  }, [followSignal, count]);

  const estimate = useCallback(
    (index: number) => {
      const item = items[index];
      switch (item.kind) {
        case 'user':
          return 64 + Math.min(240, Math.ceil(item.text.length / 70) * 22);
        case 'text':
          return 48 + Math.min(600, Math.ceil(item.text.length / 80) * 21);
        case 'thinking':
          return 92;
        case 'tool':
          return item.result ? 132 : 100;
        default:
          return 44;
      }
    },
    [items],
  );

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderRow = (index: number) => {
    const item = items[index];
    const streaming = scrub <= item.endIndex;
    const selected = item.id === selectedId;

    switch (item.kind) {
      case 'user':
        return (
          <div className="row">
            <div className="msg user">
              <span className="chip chip-user">user</span>
              <div className="msg-text">{item.text}</div>
            </div>
          </div>
        );
      case 'text': {
        const text = textAt(item, scrub);
        return (
          <div className="row">
            <div className={`msg assistant${selected ? ' selected' : ''}`}>
              <div className="msg-text">
                {text}
                {streaming && <span className="caret">▍</span>}
              </div>
            </div>
          </div>
        );
      }
      case 'thinking': {
        const text = textAt(item, scrub);
        const isOpen = expanded.has(item.id);
        const preview = isOpen || text.length <= THINKING_PREVIEW ? text : `${text.slice(0, THINKING_PREVIEW)}…`;
        return (
          <div className="row">
            <button type="button" className="thinking" onClick={() => toggleExpanded(item.id)}>
              <span className="thinking-head">
                ✳ thinking · {fmtDuration(item.endTs - item.startTs)}
                <span className="thinking-toggle">{isOpen ? 'collapse' : 'expand'}</span>
              </span>
              <span className="thinking-body">
                {preview}
                {streaming && <span className="caret">▍</span>}
              </span>
            </button>
          </div>
        );
      }
      case 'tool': {
        const input = textAt(item, scrub);
        const resultVisible = item.resultIndex !== undefined && item.resultIndex < scrub;
        const status = resultVisible ? (item.result!.ok ? 'ok' : 'fail') : 'running';
        return (
          <div className="row">
            <button
              type="button"
              className={`tool tool-${status}${selected ? ' selected' : ''}`}
              onClick={() => onSelect(item)}
            >
              <span className="tool-head">
                <span className="tool-name">⚙ {item.toolName}</span>
                <span className={`badge badge-${status}`}>
                  {status === 'running' ? 'running…' : status === 'ok' ? 'ok' : 'failed'}
                </span>
                {resultVisible && <span className="tool-dur">{fmtDuration(item.result!.durationMs)}</span>}
              </span>
              {input && <span className="tool-input">{input.length > 180 ? `${input.slice(0, 180)}…` : input}</span>}
              {resultVisible && (
                <span className="tool-result">
                  {item.result!.content.length > 220
                    ? `${item.result!.content.slice(0, 220)}…`
                    : item.result!.content}
                </span>
              )}
            </button>
          </div>
        );
      }
      case 'error':
        return (
          <div className="row">
            <div className="marker marker-error">✕ {item.text}</div>
          </div>
        );
      case 'retry':
        return (
          <div className="row">
            <div className="marker marker-retry">↻ {item.text}</div>
          </div>
        );
    }
  };

  return (
    <VirtualList
      ref={listRef}
      className="transcript"
      count={count}
      estimate={estimate}
      itemKey={(i) => items[i].id}
      renderRow={renderRow}
    />
  );
}
