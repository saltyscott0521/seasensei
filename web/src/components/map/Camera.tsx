import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import type { Spot } from "../../lib/wind";
import { prefersReducedMotion } from "./reducedMotion";

export type Padding = { top: number; bottom: number; left: number; right: number };

/** Zoom a selected spot is shown at (at least): its shoreline and the nearby sensors are readable. */
export const FOCUS_ZOOM = 11.2;
const FLY_MS = 800;
const SETTLE_MS = 360;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

const samePadding = (a: Padding | null, b: Padding) =>
  !!a && a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right;

/**
 * Moves the camera for the selected spot.
 * - Selecting a spot centres it in the visible map band (the area `padding` leaves clear of the panel, sheet and
 *   timeline), at FOCUS_ZOOM or closer: a short ease for a hop within the view, a flight for a far one, a cut under
 *   reduced motion. Re-opening the spot you just had open, while it is still in the band, doesn't move the camera.
 * - While a spot is open and the padding changes (the phone sheet snaps), the spot follows the band, unless you
 *   have moved the map yourself since.
 * - On the list, while the map still frames all the spots (you haven't moved it or opened one since it opened), a
 *   change in the band (the sheet snapping, the timeline arriving) re-frames them in what's visible, so no spot is
 *   left under the sheet or the timeline.
 */
export function Camera({ spots, selectedId, padding, reframe = true }: {
  spots: Spot[]; selectedId: string | null; padding: Padding;
  /** Re-frame the spots on the list when the band changes (not while adding: the map is where the pin goes). */
  reframe?: boolean;
}) {
  const { current } = useMap();
  // `selected` follows the prop (null on the list); `last` remembers the last spot that was open.
  const st = useRef({ selected: null as string | null, last: null as string | null, padding: null as Padding | null, userMoved: false, framed: true });

  useEffect(() => {
    const map = current?.getMap();
    if (!map) return;
    // Camera moves we start have no originalEvent; drags, wheels and pinches do.
    const onStart = (e: { originalEvent?: unknown }) => { if (e.originalEvent) { st.current.userMoved = true; st.current.framed = false; } };
    map.on("movestart", onStart);
    return () => { map.off("movestart", onStart); };
  }, [current]);

  useEffect(() => {
    const map = current?.getMap();
    if (!map) return;
    const s = st.current;
    const spot = selectedId ? spots.find((x) => x.id === selectedId) : undefined;
    const reduced = prefersReducedMotion();
    const center: [number, number] | null = spot ? [spot.lon, spot.lat] : null;

    if (selectedId !== s.selected) {
      s.selected = selectedId;
      s.padding = padding;
      if (!center) return; // back to the list: leave the camera where it is
      s.framed = false;
      const again = selectedId === s.last;
      s.last = selectedId;
      s.userMoved = false;
      const el = map.getContainer();
      const w = el.clientWidth, h = el.clientHeight;
      const p = map.project(center);
      const zoom = map.getZoom();
      // Re-opening the spot you just had open, with it still in view: no camera move at all. (The marker's pill
      // stands ~40px above its point; keep that clear of the top chrome too.)
      const inBand = p.x >= padding.left && p.x <= w - padding.right && p.y >= padding.top + 40 && p.y <= h - padding.bottom;
      if (again && inBand && zoom >= FOCUS_ZOOM - 0.4) return;
      const opts = { center, zoom: Math.max(zoom, FOCUS_ZOOM), padding };
      if (reduced) { map.jumpTo(opts); return; }
      const c = map.project(map.getCenter());
      const dist = Math.hypot(p.x - c.x, p.y - c.y);
      // A hop within the view eases (shorter for shorter hops); a far one flies out and back in.
      if (dist < 1.5 * Math.max(w, h)) map.easeTo({ ...opts, duration: Math.min(FLY_MS, 420 + dist * 0.6), easing: easeOut });
      else map.flyTo({ ...opts, duration: FLY_MS + 200 });
      return;
    }

    if (!center && reframe && s.framed && spots.length && s.padding && !samePadding(s.padding, padding)) {
      const el = map.getContainer();
      if (el.clientHeight - padding.top - padding.bottom >= 120 && el.clientWidth - padding.left - padding.right >= 120) {
        const lats = spots.map((x) => x.lat), lons = spots.map((x) => x.lon), pad = 0.12; // as the first fit (WindMap)
        const bounds: [[number, number], [number, number]] = [[Math.min(...lons) - pad, Math.min(...lats) - pad], [Math.max(...lons) + pad, Math.max(...lats) + pad]];
        map.fitBounds(bounds, { padding, ...(reduced ? { animate: false } : { duration: SETTLE_MS, easing: easeOut }) });
      }
    } else if (center && !s.userMoved && !samePadding(s.padding, padding)) {
      // The band moved under the open spot (the sheet snapped): keep the spot in the middle of what's visible.
      const opts = { center, padding };
      if (reduced) map.jumpTo(opts);
      else map.easeTo({ ...opts, duration: SETTLE_MS, easing: easeOut });
    }
    s.padding = padding;
  }, [current, selectedId, spots, padding, reframe]);

  return null;
}
