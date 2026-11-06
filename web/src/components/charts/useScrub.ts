import { startTransition, useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const HOLD_MS = 4000; // a touch scrub stays on screen this long after the finger lifts

/**
 * Pointer and keyboard scrubbing over a time series. The chart under the pointer draws its own cursor from `t`
 * straight away; the parent (`emit`) hears about it as a transition, so the rest of the screen (hero, the other
 * chart) follows without holding up the finger.
 *
 * Mouse: hover scrubs, leaving clears. Touch: a tap picks an hour; a drag scrubs only once it is clearly sideways
 * (vertical swipes scroll the page or the sheet as usual), and the cursor stays for a few seconds after lifting.
 * Keyboard (when the chart is focusable): ← → step an hour, Shift+← → six, Home / End, Escape clears.
 *
 * @param times   the series' hour times, ascending
 * @param tAtX    maps a pointer's x (CSS px from the svg's left edge, in chart units) to a time
 * @param emit    the parent's scrub handler: an index into `times`, or null when cleared
 * @param startT  where keyboard stepping starts when nothing is selected yet (the timeline hour, or now)
 */
export function useScrub(times: number[], tAtX: (x: number) => number, emit: (i: number | null) => void, startT?: number) {
  const [t, setT] = useState<number | null>(null);
  const s = useRef({ pid: -1, x0: 0, y0: 0, live: false, timer: 0 as ReturnType<typeof setTimeout> | 0, last: NaN as number });
  const latest = useRef({ times, tAtX, emit, startT });
  latest.current = { times, tAtX, emit, startT };

  const nearest = (time: number) => {
    const ts = latest.current.times;
    let b = 0;
    for (let i = 1; i < ts.length; i++) if (Math.abs(ts[i] - time) < Math.abs(ts[b] - time)) b = i;
    return b;
  };
  const pick = useCallback((i: number | null, urgent = false) => {
    const st = s.current;
    const time = i == null ? null : latest.current.times[i];
    if ((time ?? NaN) === st.last || (time == null && Number.isNaN(st.last))) return;
    st.last = time ?? NaN;
    setT(time);
    if (urgent) latest.current.emit(i);
    else startTransition(() => latest.current.emit(i));
  }, []);
  const clear = useCallback(() => { clearTimeout(s.current.timer); pick(null, true); }, [pick]);
  useEffect(() => () => clearTimeout(s.current.timer), []);

  const at = (e: PointerEvent<Element>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const svg = e.currentTarget as SVGSVGElement;
    const w = svg.viewBox?.baseVal?.width || r.width;
    return nearest(latest.current.tAtX(((e.clientX - r.left) / r.width) * w));
  };

  const handlers = {
    onPointerDown(e: PointerEvent<Element>) {
      const st = s.current;
      clearTimeout(st.timer);
      if (e.pointerType === "mouse") return pick(at(e));
      st.pid = e.pointerId; st.x0 = e.clientX; st.y0 = e.clientY; st.live = false;
    },
    onPointerMove(e: PointerEvent<Element>) {
      const st = s.current;
      if (e.pointerType === "mouse") return pick(at(e));
      if (e.pointerId !== st.pid) return;
      if (!st.live) {
        const dx = Math.abs(e.clientX - st.x0), dy = Math.abs(e.clientY - st.y0);
        if (dx >= 6 && dx > dy * 1.2) {
          st.live = true;
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* already released */ }
        } else {
          if (dy > 10) st.pid = -1; // a vertical swipe: let it scroll
          return;
        }
      }
      pick(at(e));
    },
    onPointerUp(e: PointerEvent<Element>) {
      const st = s.current;
      if (e.pointerType === "mouse" || e.pointerId !== st.pid) return;
      if (!st.live) pick(at(e)); // a tap reads that hour
      st.pid = -1; st.live = false;
      st.timer = setTimeout(clear, HOLD_MS);
    },
    onPointerCancel(e: PointerEvent<Element>) {
      const st = s.current;
      if (e.pointerId !== st.pid) return;
      st.pid = -1;
      if (st.live) clear();
      st.live = false;
    },
    onPointerLeave(e: PointerEvent<Element>) {
      if (e.pointerType === "mouse") clear();
    },
  };

  const keys = {
    onKeyDown(e: KeyboardEvent<Element>) {
      const ts = latest.current.times;
      if (!ts.length) return;
      const cur = t ?? latest.current.startT ?? Date.now();
      const i = nearest(cur);
      const step = e.shiftKey ? 6 : 1;
      let next: number | null;
      if (e.key === "ArrowRight") next = Math.min(ts.length - 1, t == null ? i : i + step);
      else if (e.key === "ArrowLeft") next = Math.max(0, t == null ? i : i - step);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = ts.length - 1;
      else if (e.key === "Escape" && t != null) { e.stopPropagation(); clear(); return; }
      else return;
      e.preventDefault();
      pick(next, true);
    },
    onBlur: clear,
  };

  return { t, handlers, keys, clear };
}
