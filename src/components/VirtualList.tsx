import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface VirtualListHandle {
  scrollToIndex: (index: number, align?: 'start' | 'end') => void;
}

interface VirtualListProps {
  count: number;
  estimate: (index: number) => number;
  renderRow: (index: number) => ReactNode;
  itemKey: (index: number) => string;
  overscan?: number;
  className?: string;
}

interface RowProps {
  index: number;
  top: number;
  measure: (index: number, height: number) => void;
  children: ReactNode;
}

function Row({ index, top, measure, children }: RowProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Re-measure on every render: scrubbing changes row content and height.
  useLayoutEffect(() => {
    if (ref.current) measure(index, ref.current.offsetHeight);
  });
  return (
    <div ref={ref} style={{ position: 'absolute', top, left: 0, right: 0 }}>
      {children}
    </div>
  );
}

/**
 * Minimal variable-height windowing: estimated heights corrected by
 * post-render measurement, prefix-sum offsets, binary-searched ranges.
 * Zero dependencies by design.
 */
export const VirtualList = forwardRef<VirtualListHandle, VirtualListProps>(function VirtualList(
  { count, estimate, renderRow, itemKey, overscan = 6, className },
  ref,
) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const heights = useRef<Map<number, number>>(new Map());
  const bumpScheduled = useRef(false);
  const [version, setVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const offsets = useMemo(() => {
    const arr = new Float64Array(count + 1);
    let acc = 0;
    for (let i = 0; i < count; i++) {
      arr[i] = acc;
      acc += heights.current.get(i) ?? estimate(i);
    }
    arr[count] = acc;
    return arr;
    // `version` invalidates the memo when measured heights change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, estimate, version]);

  const indexAt = useCallback(
    (y: number) => {
      let lo = 0;
      let hi = count;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid + 1] <= y) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
    [count, offsets],
  );

  const measure = useCallback((index: number, height: number) => {
    const prev = heights.current.get(index);
    if (prev === undefined || Math.abs(prev - height) > 0.5) {
      heights.current.set(index, height);
      if (!bumpScheduled.current) {
        bumpScheduled.current = true;
        requestAnimationFrame(() => {
          bumpScheduled.current = false;
          setVersion((v) => v + 1);
        });
      }
    }
  }, []);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    observer.observe(el);
    setViewportHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const stickBottom = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(index, align = 'end') {
        const el = scrollerRef.current;
        if (!el || count === 0) return;
        const i = Math.max(0, Math.min(index, count - 1));
        const top = offsets[i];
        const height = heights.current.get(i) ?? estimate(i);
        el.scrollTop = align === 'end' ? Math.max(0, top + height - el.clientHeight) : top;
        // Stick to the bottom through later height corrections when the
        // target is the last row — scrubbing and live-follow both want this.
        stickBottom.current = align === 'end' && i >= count - 1;
      },
    }),
    [count, estimate, offsets],
  );

  // Re-pin after measured heights shift the layout under us.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el && stickBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [offsets]);

  const start = Math.max(0, indexAt(scrollTop) - overscan);
  const end = Math.min(count, indexAt(scrollTop + viewportHeight) + overscan + 1);

  const rows: ReactNode[] = [];
  for (let i = start; i < end; i++) {
    rows.push(
      <Row key={itemKey(i)} index={i} top={offsets[i]} measure={measure}>
        {renderRow(i)}
      </Row>,
    );
  }

  return (
    <div
      ref={scrollerRef}
      className={className}
      onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollTop + el.clientHeight < el.scrollHeight - 48) stickBottom.current = false;
        setScrollTop(el.scrollTop);
      }}
      style={{ overflowY: 'auto', position: 'relative' }}
    >
      <div style={{ height: offsets[count], position: 'relative' }}>{rows}</div>
    </div>
  );
});
