import { useEffect, useRef, useState } from "react";

/**
 * Size a chart to its container so it's drawn 1:1 in CSS pixels (crisp text, and it can be
 * tall) rather than a fixed drawing shrunk to fit. Height follows width by `ratio`, within [minH, maxH].
 */
export function useChartSize(minH: number, ratio: number, maxH = 560) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: Math.max(minH, Math.round(640 * ratio)) });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      if (w > 0) setSize((s) => { const h = Math.round(Math.min(maxH, Math.max(minH, w * ratio))); return s.w === w && s.h === h ? s : { w, h }; });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [minH, ratio, maxH]);
  return [ref, size] as const;
}
