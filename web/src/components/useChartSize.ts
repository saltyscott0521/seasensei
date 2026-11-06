import { useLayoutEffect, useRef, useState } from "react";

/**
 * Size a chart to its container so it's drawn 1:1 in CSS pixels (crisp text, and it can be
 * tall) rather than a fixed drawing shrunk to fit. Height follows width by `ratio`, within [minH, maxH].
 *
 * The width is measured before the first paint (layout effect), so a chart never flashes at a guessed size.
 * Until then `w` is 0 and `h` is minH: render a placeholder of that height. A ResizeObserver follows later changes.
 */
export function useChartSize(minH: number, ratio: number, maxH = 560) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: minH });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = (width: number) => {
      const w = Math.round(width);
      if (w <= 0) return;
      const h = Math.round(Math.min(maxH, Math.max(minH, w * ratio)));
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    fit(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => fit(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [minH, ratio, maxH]);
  return [ref, size] as const;
}
