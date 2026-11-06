import { useCallback, useRef, useState } from "react";

/**
 * A callback ref plus the element's rounded border-box height, kept current with a ResizeObserver.
 * It keeps the last height while the element is unmounted: a layout that depends on the height (the timeline
 * floating or riding inside the sheet) would otherwise flip back and forth.
 */
export function useHeight<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [h, setH] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    const read = () => { const v = Math.round(el.getBoundingClientRect().height); if (v > 0) setH(v); };
    read();
    ro.current = new ResizeObserver(read);
    ro.current.observe(el);
  }, []);
  return [ref, h];
}
