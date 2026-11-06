import { useSyncExternalStore } from "react";

// Layout geometry shared by the shell (App, the sheet, the desktop panel, ViewTarget) and the map padding.
// One source of truth: the visible map band is computed here, and both the map's padding (initial fit and
// fly-to) and the view-target cross-hair derive from it, so a selected spot lands on the cross.
//
// Coupled constants (change them together):
//   DRAWER_H ↔ the sheet's h-[96dvh] class (shell/Sheet.tsx).
//   CHROME_TOP, PILL_H, ACTIONS_H, RAIL_GAP, NAV_H ↔ styles/map.css (MapLibre's Find my location slots into the rail
//   under the Add / Stations group) and the size-11 buttons in shell/MapActions.tsx.

const mq = window.matchMedia("(min-width: 768px)");
/** Desktop layout (docked panel) at ≥ 768px; keep in step with Tailwind's md: breakpoint. */
export const useDesktop = () => useSyncExternalStore((l) => (mq.addEventListener("change", l), () => mq.removeEventListener("change", l)), () => mq.matches);

// ── Phone: the bottom sheet ────────────────────────────────────────────────────────────────────────────────
/** The drawer is h-[96dvh] and vaul translates it by (viewport − snap). Keep in step with that class. */
export const DRAWER_H = 0.96;
/**
 * Visible height of the resting sheet above the bottom safe area: the grabber, the Today board's header (≤ 52px on
 * phones) and the top two spot cards (≤ 104px each), names and verdicts in view.
 */
export const REST_VISIBLE = 320;
/** The mid snap's height on a tall screen, and the full snap, as fractions of the viewport. */
export const MID = 0.56;
export const FULL = 0.94;
/** On a short phone, where MID of the screen would sit at or barely above rest: how far mid rises over rest (at most halfway to full). */
export const MID_STEP = 120;
export type SnapIndex = 0 | 1 | 2;
export const SNAP_REST = 0, SNAP_MID = 1, SNAP_FULL = 2;

/**
 * The sheet's snap points for this viewport, strictly rising: a px rest snap sized so REST_VISIBLE px show above the
 * bottom safe area; a px mid snap at MID of the screen, but always above rest (halfway to full, up to MID_STEP more,
 * on a short phone, where MID of the screen would sit at or under rest); then FULL. The px values follow vh, so App
 * keeps the active snap as an index.
 */
export function sheetSnaps(vh: number, sab: number): [string, string, number] {
  const rest = Math.round(REST_VISIBLE + sab + (1 - DRAWER_H) * vh);
  const full = FULL * vh;
  const mid = Math.round(Math.max(MID * vh, rest + Math.min(MID_STEP, (full - rest) / 2)));
  return [`${rest}px`, `${mid}px`, FULL];
}

/** Page y of the sheet's top edge at a vaul snap point. */
export function sheetTopPx(snap: number | string | null, vh: number) {
  const snapPx = typeof snap === "string" ? parseInt(snap, 10) : snap == null ? REST_VISIBLE : snap * vh;
  return (1 - DRAWER_H) * vh + (vh - snapPx);
}

// ── Phone: the top chrome (status pill on the left, control rail on the right) ──────────────────────────────
/** Gap between the top safe area and the status pill / rail. */
export const CHROME_TOP = 12;
/** Status pill height: a 32px mark, 6px padding and the hairline. */
export const PILL_H = 46;
/**
 * The rail: 44px buttons in two glass groups — Add a spot + Show live stations, then Find my location. No zoom
 * buttons on phones (pinch zooms), so the rail is short and the timeline can float on small phones too.
 */
export const ACTIONS_H = 2 * 44 + 2;
export const RAIL_GAP = 8;
export const NAV_H = 44 + 2;
export const RAIL_H = ACTIONS_H + RAIL_GAP + NAV_H;
/**
 * How far the top chrome reaches below the safe area (the rail is the tallest piece), plus an 8px gap.
 * The floating timeline stays below it.
 */
export const LEGEND_CLEAR = CHROME_TOP + RAIL_H + 8;
/** Room the floating timeline takes above the sheet: the card (≤ 132px on phones) and an 8px gap. */
export const TIMELINE_LIFT = 140;

/** Whether the timeline can float above the sheet without running into the control rail. */
export const timelineFloatsAt = (sheetTop: number, sat: number, lift = TIMELINE_LIFT) => sheetTop >= LEGEND_CLEAR + sat + lift;

// ── Desktop: the docked panel and the timeline dock ─────────────────────────────────────────────────────────
/** Margin around the docked panel and the floating desktop chrome. */
export const EDGE = 16;
/** The docked panel's width (keep in step with w-[420px] min-[1440px]:w-[440px]). */
export const panelWidth = (vw: number) => (vw >= 1440 ? 440 : 420);
/** The MapLibre locate / zoom column at the bottom right (36px buttons and a gap); the timeline dock stays clear of it. */
export const DESKTOP_NAV_W = 36 + 16;
/** Height the desktop timeline is assumed to take until it has been measured. */
export const DOCK_EST = 132;

// ── The visible map band ─────────────────────────────────────────────────────────────────────────────────
/** A rectangle in page px: the part of the map that chrome doesn't cover. */
export type Band = { top: number; right: number; bottom: number; left: number };
export type Padding = { top: number; right: number; bottom: number; left: number };

/** Phone: between the status pill and the sheet, or the floating timeline above it. */
export function phoneBand({ vw, sat, sheetTop, timelineTop }: { vw: number; sat: number; sheetTop: number; timelineTop: number | null }): Band {
  return { top: sat + CHROME_TOP + PILL_H + 8, left: 0, right: vw, bottom: Math.min(sheetTop, timelineTop ?? sheetTop) };
}

/** Desktop: right of the docked panel, above the timeline dock. */
export function desktopBand({ vw, vh, dockH }: { vw: number; vh: number; dockH: number }): Band {
  return { top: 0, left: EDGE + panelWidth(vw), right: vw, bottom: dockH > 0 ? vh - EDGE - dockH : vh };
}

/**
 * Map padding that centres the camera on the band, with a margin inside it. Used for the first fit and for
 * flying to a spot. The band's centre is also where the view-target cross sits.
 */
export function bandPadding(band: Band, vw: number, vh: number, margin = 16): Padding {
  const r = (n: number) => Math.max(0, Math.round(n));
  // On a very short screen (a phone on its side) the chrome can cover the whole map: shrink the padding so
  // at least MIN px stay for the camera, keeping its proportions.
  const MIN = 64;
  const fit = (a: number, b: number, total: number): [number, number] => {
    a = r(a); b = r(b);
    if (total - a - b >= MIN || a + b === 0) return [a, b];
    const k = Math.max(0, total - MIN) / (a + b);
    return [r(a * k), r(b * k)];
  };
  const [top, bottom] = fit(band.top + margin, vh - band.bottom + margin, vh);
  const [left, right] = fit(band.left + margin, vw - band.right + margin, vw);
  return { top, right, bottom, left };
}

// ── Viewport ───────────────────────────────────────────────────────────────────────────────────────────────
// Read on resize only, never per render: getComputedStyle for the safe-area insets forces a style recalc, and
// useSyncExternalStore calls the snapshot on every render. The snapshot stays referentially stable between changes.
let viewportBox: { vh: number; vw: number; sat: number; sab: number } | null = null;
const measureViewport = () => {
  const vh = window.innerHeight, vw = window.innerWidth;
  const css = getComputedStyle(document.documentElement);
  const sat = parseFloat(css.getPropertyValue("--sat")) || 0;
  const sab = parseFloat(css.getPropertyValue("--sab")) || 0;
  const b = viewportBox;
  if (!b || b.vh !== vh || b.vw !== vw || b.sat !== sat || b.sab !== sab) viewportBox = { vh, vw, sat, sab };
  return viewportBox!;
};
const subscribeViewport = (l: () => void) => {
  const on = () => { measureViewport(); l(); };
  window.addEventListener("resize", on);
  return () => window.removeEventListener("resize", on);
};
/** Viewport height and width, and the top / bottom safe-area insets (--sat / --sab), in CSS px. */
export const useViewport = () => useSyncExternalStore(subscribeViewport, () => viewportBox ?? measureViewport());
