import { useCallback, useEffect, useRef, useState } from "react";

// What's open, kept in the URL and the browser history so the phone's back gesture (and the browser's back
// button) closes the top layer instead of leaving the app, and a reload or a link restores it:
//   ?spot=<id>               a spot's detail
//   ?add=1                   adding a spot
//   ?discussion=YYYY-MM-DD   the wind discussion dialog (also the RSS feed's permalink)
// Opening a layer pushes an entry; closing one goes back through it when we pushed it, or rewrites the URL when
// the page was opened on it (a deep link), so history never fills with dead entries.
// A spot's own layers (its settings, the full-screen charts; spot/useSubLayer) are entries at the same URL marked
// `history.state.sub`. Navigating away while one is on top first goes back through it, so Back never returns to a
// spot you have left.

export type View = { kind: "list" } | { kind: "spot"; id: string } | { kind: "add" };
export type Layers = { view: View; discussion: string | null };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LIST: View = { kind: "list" };

function parse(href = location.href): Layers {
  const q = new URL(href).searchParams;
  const spot = q.get("spot"), d = q.get("discussion");
  const view: View = spot ? { kind: "spot", id: spot } : q.get("add") === "1" ? { kind: "add" } : LIST;
  return { view, discussion: d && DATE.test(d) ? d : null };
}

function urlFor({ view, discussion }: Layers) {
  const u = new URL(location.href);
  for (const k of ["spot", "add", "discussion"]) u.searchParams.delete(k);
  if (view.kind === "spot") u.searchParams.set("spot", view.id);
  if (view.kind === "add") u.searchParams.set("add", "1");
  if (discussion) u.searchParams.set("discussion", discussion);
  return u.pathname + u.search + u.hash;
}

/** How many entries above the app's first one we pushed (kept in history.state, so it survives a reload). */
const depth = (): number => (typeof history.state?.ss === "number" ? history.state.ss : 0);

/** A spot's sub-layer (settings, full-screen charts) is the current entry. */
const onSub = () => !!history.state?.sub;

export function useLayers() {
  const [layers, setLayers] = useState<Layers>(() => parse());
  const ref = useRef(layers);
  ref.current = layers;
  const backPending = useRef(false);
  /** What to do once the back we started lands (a navigation waiting for a sub-layer's entry to be popped). */
  const then = useRef<(() => void) | null>(null);
  const backs = useRef(0);

  useEffect(() => {
    if (typeof history.state?.ss !== "number") history.replaceState({ ...history.state, ss: 0 }, "");
    const onPop = () => {
      backPending.current = false;
      const next = then.current;
      then.current = null;
      setLayers(parse());
      next?.();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** Go back one entry, then run `after` (if given) on the entry it lands on. */
  const goBack = useCallback((after?: () => void) => {
    backPending.current = true;
    then.current = after ?? null;
    const n = ++backs.current;
    history.back();
    // in case popstate never comes
    setTimeout(() => { if (backs.current === n && backPending.current) { backPending.current = false; then.current = null; } }, 800);
  }, []);

  /** Open a new layer on top: a new history entry. */
  const push: (next: Layers) => void = useCallback((next: Layers) => {
    if (backPending.current) return;
    if (onSub()) { goBack(() => push(next)); return; }
    history.pushState({ ss: depth() + 1 }, "", urlFor(next));
    setLayers(next);
  }, [goBack]);

  /**
   * Swap the current layer (another spot, another day's discussion, add → the saved spot): same entry. `inPlace`
   * rewrites whatever entry is current, sub-layer or not (a spot that no longer exists: whoever deleted it is already
   * on the way back).
   */
  const replace: (next: Layers, inPlace?: boolean) => void = useCallback((next: Layers, inPlace = false) => {
    if (onSub() && !inPlace) {
      if (!backPending.current) goBack(() => replace(next));
      return;
    }
    history.replaceState({ ss: depth() }, "", urlFor(next));
    setLayers(next);
  }, [goBack]);

  /** Close the top layer: the discussion first, then a spot or the add form. */
  const close: () => void = useCallback(() => {
    const cur = ref.current;
    if (!cur.discussion && cur.view.kind === "list") return;
    if (backPending.current) return;
    if (onSub()) { goBack(() => close()); return; }
    if (depth() > 0) { goBack(); return; }
    // Opened straight on this layer (a link or a reload): rewrite the URL rather than leave the app.
    replace(cur.discussion ? { ...cur, discussion: null } : { ...cur, view: LIST });
  }, [goBack, replace]);

  /** The current layers, for callbacks that must not change identity. */
  const get = useCallback(() => ref.current, []);

  return { layers, get, push, replace, close };
}
