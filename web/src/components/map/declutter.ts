import { useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "react-map-gl/maplibre";
import type { LiveReading, Spot } from "../../lib/wind";
import type { Padding } from "./Camera";

type Rect = { x0: number; y0: number; x1: number; y1: number };
type Size = { w: number; h: number };

const TIP = 7; // the spot marker's pointer under its pill
const LABEL_GAP = 4; // mt-1 between the point and the name label
const PAD = 3; // breathing room (and the verdict glyph's overhang)
const GAP = 6; // between two spot pills nudged apart
const MAX_LIFT = 96; // how high a pill may rise above a busier neighbour on its stem
const hits = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const grow = (r: Rect, d: number): Rect => ({ x0: r.x0 - d, x1: r.x1 + d, y0: r.y0 - d, y1: r.y1 + d });
const toSet = (s: string) => new Set(s ? s.split(",") : []);

export type Declutter = {
  /** Station ids hidden because a spot marker (pill, pointer or name) or a busier station covers them. */
  hidden: ReadonlySet<string>;
  /** Spot ids whose name label is shown: wherever it fits, and always for the selected and highlighted spots. */
  labelled: ReadonlySet<string>;
};

/**
 * Keeps the map's markers legible, on every camera frame, from projected points and element sizes measured by a
 * ResizeObserver (so it never forces a layout). Spots go in priority order: the selected one, a highlighted one, then
 * the board's ranking (`rank`, best first), so the spot the board calls Best today keeps its pill whole and its name.
 * - Spot pills that would overlap are nudged sideways, apart, while their pointers stay on the exact points (the
 *   shift is capped so a pointer is always under its pill). Where that can't part them, the lower-priority pill rises
 *   above the other on a stem down to its point. Written straight to the pill's `translate` and the stem's `scale`
 *   (no layout); the pill carries the marker's hit area, so a tap lands on the pill you see.
 * - Spot names are placed where they fit: under the point (below its pill, else slid along so the point still sits
 *   under the name), else beside the pill; each clear of every pill and name already placed and on the map. Selected
 *   and highlighted spots are always named. Offsets are written to the label's margins.
 * - Station chips fade out where a spot marker (pill, pointer or shown name) covers them, then where they overlap a
 *   station already shown (NOAA sensors before airports, fresher first).
 * Only a change in the hidden or labelled sets re-renders.
 */
export function useDeclutter(spots: Spot[], readings: LiveReading[], o: { selectedId: string | null; highlightId: string | null; rank: readonly string[] }): Declutter {
  const { current } = useMap();
  const [key, setKey] = useState("|");
  const sizes = useRef(new Map<string, Size>());
  const { selectedId, highlightId, rank } = o;

  useEffect(() => {
    const map = current?.getMap();
    if (!map) return;
    const root = map.getContainer();
    const ordered = [...readings].sort((a, b) => (a.source === b.source ? b.t - a.t : a.source === "noaa" ? -1 : 1));
    const pills = new Map<string, HTMLElement>(), tags = new Map<string, HTMLElement>(), stems = new Map<string, HTMLElement>();
    root.querySelectorAll<HTMLElement>("[data-marker-pill], [data-marker-label], [data-marker-stem]").forEach((el) => {
      const id = el.closest("[data-spot-marker]")?.getAttribute("data-spot-marker");
      if (id) (el.hasAttribute("data-marker-pill") ? pills : el.hasAttribute("data-marker-label") ? tags : stems).set(id, el);
    });
    const written = new Map<string, string>();
    const write = (id: string, el: HTMLElement | undefined, prop: "translate" | "scale" | "rotate" | "marginLeft" | "marginTop", v: string) => {
      const k = `${prop}:${id}`;
      if (!el || written.get(k) === v) return;
      written.set(k, v);
      el.style[prop] = v;
    };
    // The selected, then the highlighted, then the board's order (spots it hasn't ranked yet last, in list order).
    const order = new Map(rank.map((id, i) => [id, i]));
    const prio = (s: Spot, i: number) => (s.id === selectedId ? -2 : s.id === highlightId ? -1 : order.get(s.id) ?? rank.length + i);
    const byPriority = spots.map((s, i) => ({ s, p: prio(s, i) })).sort((a, b) => a.p - b.p).map((x) => x.s);
    let raf = 0;
    // The app's chrome over the map (the status pill and the control rail on phones, the Add / Stations group on
    // desktop, all [data-map-chrome]): names and moved pills keep out from under it. Read when it changes size.
    let chrome: Rect[] | null = null;
    const readChrome = () => {
      const c = root.getBoundingClientRect();
      chrome = [...document.querySelectorAll<HTMLElement>("[data-map-chrome]")].map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0).map((r) => ({ x0: r.left - c.left, x1: r.right - c.left, y0: r.top - c.top, y1: r.bottom - c.top }));
      return chrome;
    };

    const compute = () => {
      raf = 0;
      const m = sizes.current;
      const W = root.clientWidth, H = root.clientHeight;
      const ui = chrome ?? readChrome();
      // Spot pills: where each one is, then push overlapping neighbours apart.
      const P = spots.map((s) => {
        const p = map.project([s.lon, s.lat]);
        const sel = s.id === selectedId;
        const k = sel ? 1.1 : 1; // the selected pill is scaled up …
        const pill = m.get(`p:${s.id}`) ?? { w: 48, h: 28 };
        return { s, x: p.x, y: p.y, w: pill.w * k, h: pill.h * k, pad: PAD + (sel ? 6 : 0) /* … and ringed 4px out */, dx: 0, lift: 0 };
      }).sort((a, b) => a.x - b.x);
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        const a = P[i], b = P[j];
        if (Math.abs(a.y - b.y) >= (a.h + b.h) / 2 + TIP) continue;
        const need = (a.w + b.w) / 2 + GAP - (b.x + b.dx - (a.x + a.dx));
        if (need <= 0) continue;
        a.dx = Math.max(-(a.w / 2 - 12), a.dx - need / 2);
        b.dx = Math.min(b.w / 2 - 12, b.dx + need / 2);
      }
      for (const q of P) q.dx = Math.round(q.dx);
      const at = new Map(P.map((q) => [q.s.id, q]));
      type Q = (typeof P)[number];
      const pillBox = (q: Q): Rect => ({ x0: q.x + q.dx - q.w / 2, x1: q.x + q.dx + q.w / 2, y0: q.y - TIP - q.lift - q.h, y1: q.y - TIP - q.lift });
      // Pills the capped nudge couldn't part. In priority order each takes the first place clear of the pills placed
      // before it: where the nudge left it, else just above the pill in its way, or beside it a little raised, on a stem
      // from its point. A place that would cover another spot's point or sit on a pill still to come is a last resort,
      // so one move doesn't start a tower.
      const tipBox = (q: Q): Rect => ({ x0: q.x - 6 - PAD, x1: q.x + 6 + PAD, y0: q.y - TIP, y1: q.y + PAD });
      const inMap = (r: Rect) => r.x0 >= 0 && r.x1 <= W && r.y0 >= 0 && !ui.some((c) => hits(c, r));
      const placed: Q[] = [];
      for (const s of byPriority) {
        const q = at.get(s.id)!;
        const box = (dx: number, lift: number) => grow(pillBox({ ...q, dx, lift }), q.pad);
        const blocker = (r: Rect) => placed.find((o) => hits(r, grow(pillBox(o), o.pad)));
        const hit = blocker(box(q.dx, 0));
        if (hit) {
          const hb = grow(pillBox(hit), hit.pad);
          const up = Math.ceil(q.y - TIP - (hb.y0 - q.pad));
          const right = Math.ceil(hb.x1 + q.pad + q.w / 2 - q.x), left = Math.floor(hb.x0 - q.pad - q.w / 2 - q.x);
          const tries: [number, number][] = [[q.dx, up], [right, 10], [left, 10], [right, up], [left, up]];
          const cost = ([dx, lift]: [number, number]) => {
            const r = box(dx, lift);
            if (lift > MAX_LIFT || Math.abs(dx) > q.w || blocker(r) || !inMap(r)) return Infinity;
            return P.filter((o) => o !== q && (hits(r, tipBox(o)) || (!placed.includes(o) && hits(r, grow(pillBox(o), o.pad))))).length;
          };
          let best = tries[0], bestCost = cost(best);
          for (const t of tries.slice(1)) { const c = cost(t); if (c < bestCost) { best = t; bestCost = c; } }
          if (bestCost < Infinity) [q.dx, q.lift] = best;
          else q.lift = Math.min(MAX_LIFT, up); // nowhere clear: rise over it (the better spot stays on top, see SpotMarker)
        }
        placed.push(q);
      }
      // What a name or a station chip must not cover: each pill, and its pointer.
      const covers: { id: string; r: Rect }[] = [];
      for (const q of P) {
        const id = q.s.id;
        write(id, pills.get(id), "translate", q.dx || q.lift ? `${q.dx}px ${-q.lift}px` : "");
        // The stem: from the pointer up to the nearest point along the pill's foot (straight up when that is over the point).
        const reach = q.w / 2 - 12, foot = Math.min(Math.max(0, q.dx - reach), q.dx + reach);
        const len = q.lift ? Math.round(Math.hypot(foot, q.lift)) : 0;
        write(id, stems.get(id), "scale", len ? `1 ${len}` : "");
        write(id, stems.get(id), "rotate", len && foot ? `${Math.atan2(foot, q.lift).toFixed(3)}rad` : "");
        covers.push({ id, r: grow(pillBox(q), q.pad) }, { id, r: tipBox(q) });
      }
      // Names, in priority order, at the first place that clears the pills, the names already placed and the map's edges.
      const labelled: string[] = [];
      const names: Rect[] = [];
      for (const s of byPriority) {
        const q = at.get(s.id)!;
        const size = m.get(`l:${s.id}`);
        const must = s.id === selectedId || s.id === highlightId;
        if (!size) { if (must) labelled.push(s.id); continue; }
        const { w, h } = size, cx = q.x + q.dx, slide = Math.max(0, w / 2 - 12);
        const under = (c: number): Rect => ({ x0: c - w / 2, x1: c + w / 2, y0: q.y + LABEL_GAP, y1: q.y + LABEL_GAP + h });
        const midY = q.y - TIP - q.lift - q.h / 2;
        const beside = (x0: number): Rect => ({ x0, x1: x0 + w, y0: midY - h / 2, y1: midY + h / 2 });
        const tries = [
          under(Math.min(Math.max(cx, q.x - slide), q.x + slide)), under(q.x), under(q.x - slide), under(q.x + slide),
          beside(cx + q.w / 2 + 4), beside(cx - q.w / 2 - 4 - w),
        ];
        const fits = (r: Rect) => {
          const g = grow(r, PAD);
          return g.x0 >= 0 && g.x1 <= W && g.y0 >= 0 && g.y1 <= H && !ui.some((c) => hits(c, g))
            && !covers.some((c) => c.id !== s.id && hits(c.r, g)) && !names.some((n) => hits(n, g));
        };
        const spot = tries.find(fits);
        const r = spot ?? tries[0];
        write(s.id, tags.get(s.id), "marginLeft", `${Math.round(r.x0 + w / 2 - q.x)}px`);
        write(s.id, tags.get(s.id), "marginTop", `${Math.round(r.y0 - q.y)}px`);
        if (spot || must) { labelled.push(s.id); names.push(grow(r, PAD)); }
      }
      // Station chips: hide what's covered, or crowded by a station already shown.
      const shown: Rect[] = [];
      const hidden: string[] = [];
      const cover = [...covers.map((c) => c.r), ...names];
      for (const r of ordered) {
        const q = map.project([r.lon, r.lat]);
        const c = m.get(`s:${r.id}`) ?? { w: 30, h: 20 };
        const rect = { x0: q.x - c.w / 2, x1: q.x + c.w / 2, y0: q.y - c.h / 2, y1: q.y + c.h / 2 };
        if (cover.some((x) => hits(x, rect)) || shown.some((x) => hits(x, rect))) hidden.push(r.id);
        else shown.push(rect);
      }
      setKey(`${hidden.sort().join(",")}|${labelled.sort().join(",")}`);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(compute); };

    // Element sizes, without forcing layout: border boxes from a ResizeObserver (transforms don't count; a hidden
    // name label is visibility:hidden, so it still has its size).
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        const box = e.borderBoxSize?.[0];
        const size = box ? { w: box.inlineSize, h: box.blockSize } : { w: el.offsetWidth, h: el.offsetHeight };
        const spot = el.closest("[data-spot-marker]")?.getAttribute("data-spot-marker");
        const station = el.closest("[data-station]")?.getAttribute("data-station");
        if (el.hasAttribute("data-map-chrome")) chrome = null;
        else if (el.hasAttribute("data-marker-pill") && spot) sizes.current.set(`p:${spot}`, size);
        else if (el.hasAttribute("data-marker-label") && spot) sizes.current.set(`l:${spot}`, size);
        else if (station) sizes.current.set(`s:${station}`, size);
      }
      schedule();
    });
    root.querySelectorAll("[data-marker-pill], [data-marker-label], [data-station-chip]").forEach((el) => ro.observe(el));
    document.querySelectorAll("[data-map-chrome]").forEach((el) => ro.observe(el));
    const onResize = () => { chrome = null; schedule(); };

    schedule();
    map.on("move", schedule);
    map.on("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      map.off("move", schedule);
      map.off("resize", onResize);
    };
  }, [current, spots, readings, selectedId, highlightId, rank]);

  const [h, l] = key.split("|");
  const hidden = useMemo(() => toSet(h), [h]);
  const labelled = useMemo(() => toSet(l), [l]);
  return { hidden, labelled };
}

/**
 * Markers whose point lies outside the open map (under the docked panel, the sheet or the timeline, or off screen),
 * as "s:<spot id>" / "t:<station id>". They leave the Tab order (a focus ring there can't be seen) and come back once
 * the map moves them into view. Rebuilt when the camera settles, not on every frame.
 */
export function useOffBand(spots: Spot[], readings: LiveReading[], padding: Padding): ReadonlySet<string> {
  const { current } = useMap();
  const [key, setKey] = useState("");
  const pad = useRef(padding);
  pad.current = padding;
  useEffect(() => {
    const map = current?.getMap();
    if (!map) return;
    const SLACK = 16; // the padding's own margin inside the band
    const update = () => {
      const el = map.getContainer(), w = el.clientWidth, h = el.clientHeight, p = pad.current;
      const out: string[] = [];
      const test = (id: string, lon: number, lat: number) => {
        const q = map.project([lon, lat]);
        if (q.x < p.left - SLACK || q.x > w - p.right + SLACK || q.y < p.top - SLACK || q.y > h - p.bottom + SLACK) out.push(id);
      };
      for (const s of spots) test(`s:${s.id}`, s.lon, s.lat);
      for (const r of readings) test(`t:${r.id}`, r.lon, r.lat);
      setKey(out.sort().join(","));
    };
    update();
    map.on("moveend", update);
    map.on("load", update);
    map.on("resize", update);
    return () => { map.off("moveend", update); map.off("load", update); map.off("resize", update); };
  }, [current, spots, readings, padding]);
  return useMemo(() => toSet(key), [key]);
}
