import { useCallback, useEffect, useRef, useState } from "react";

export type Sub = "charts" | "settings";

/** The sub-layer the current history entry is about, if it belongs to this spot. */
const current = (spotId: string): Sub | null => {
  const st = history.state as { sub?: Sub; subSpot?: string } | null;
  return st?.sub && st.subSpot === spotId ? st.sub : null;
};

/**
 * A layer inside a spot (the full-screen charts, the settings) as a history entry of its own, at the same URL, so
 * the phone's back gesture and the browser's back button close it and leave the spot open underneath. Opening pushes
 * `{ ...history.state, sub, subSpot }`; the shell's useLayers re-reads the URL on popstate, which still says this
 * spot. Closing from the UI goes back through the entry we pushed, so history holds no dead entries. A reload on such
 * an entry opens the layer again. `back(leave)` closes the spot itself from inside a layer: it pops the layer's entry
 * first, then calls `leave` (the spot's own back) once that has landed.
 */
export function useSubLayer(name: Sub, spotId: string) {
  const [open, setOpen] = useState(() => current(spotId) === name);
  const pushed = useRef(open); // a restored entry is ours to go back through
  const then = useRef<(() => void) | null>(null);

  useEffect(() => {
    const onPop = () => {
      const on = current(spotId) === name;
      if (!on) pushed.current = false;
      setOpen(on);
      const next = then.current;
      then.current = null;
      next?.();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [name, spotId]);

  const show = useCallback(() => {
    if (current(spotId) !== name) {
      history.pushState({ ...history.state, sub: name, subSpot: spotId }, "");
      pushed.current = true;
    }
    setOpen(true);
  }, [name, spotId]);

  const hide = useCallback(() => {
    setOpen(false);
    if (pushed.current && current(spotId) === name) { pushed.current = false; history.back(); }
  }, [name, spotId]);

  /** Leave the spot from inside this layer: pop the layer's entry, then run `leave` (else run it straight away). */
  const back = useCallback((leave: () => void) => {
    if (pushed.current && current(spotId) === name) {
      pushed.current = false;
      then.current = leave;
      history.back();
      return true;
    }
    return false;
  }, [name, spotId]);

  return { open, show, hide, back };
}
