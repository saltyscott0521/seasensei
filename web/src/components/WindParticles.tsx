import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import { windColor, type WindGrid } from "../lib/wind";
import { useReducedMotion } from "./map/reducedMotion";

/** The part of the map that chrome leaves visible (the map padding). Particles are spawned there. */
export type Inset = { top: number; right: number; bottom: number; left: number };

const MAX_DPR = 1.5;
const MAX_PARTICLES = 1600;
// px² of visible map per particle. Sparse on purpose: a few long ribbons read as wind, a dense field of short
// streaks reads as rain. Phones get fewer still (smaller map, weaker GPU, battery).
const AREA_PER_PARTICLE = 1500;
const AREA_PER_PARTICLE_PHONE = 2400;
const SPEED_K = 0.15; // px per knot per 60 Hz frame
// Share of the trail that fades per 60 Hz frame. A trail is about 1 / FADE frames long, so its length follows the
// speed: ~20 px at 5 kn, ~85 px at 20 kn. The fade is painted every other frame (see step) so that an 8-bit canvas
// can still round faint trails down to nothing instead of leaving a haze.
const FADE = 0.035;
const LIFE_MIN = 110, LIFE_MAX = 250; // 60 Hz frames: about 2–4 s, long enough to follow a bend in the flow
const BUCKET_KN = 2; // colour buckets: one stroke() per bucket per frame instead of one per particle
const BUCKETS = 25; // 0–50 kn
/** How bright the wind is drawn, 0–1 by speed: a light breeze is a whisper, 20 kn and up is plain to see. */
const bright = (kn: number) => Math.max(0, Math.min(1, (kn - 3) / 19));
/** Stroke alpha: the wind scale's colour at low opacity, so markers and labels stay legible over the field. */
const alphaFor = (kn: number) => 0.1 + 0.46 * bright(kn);
const widthFor = (kn: number) => 1 + 0.55 * Math.max(0, Math.min(1, (kn - 12) / 12));
/** Share of particles drawn at a speed: light air is nearly empty, from 14 kn up every particle shows. */
const shown = (kn: number) => Math.max(0.12, Math.min(1, kn / 14));
// Reduced motion: a still field of short streamlines, redrawn only when the view or the hour changes.
const STATIC_CELL = 52; // px between streamline seeds
const STATIC_STEPS = 12; // at most; each line gets 7–12 steps, so they don't line up like hatching
const STATIC_K = 0.17; // px per knot per step
const STATIC_ALPHA = 0.42;

/**
 * Wind streamlines over the map (the "earth.nullschool" look), drawn on a canvas that sits between the basemap and
 * the markers. Particles live in screen space in typed arrays and are advected by the bilinearly sampled field,
 * leaving long fading trails. Speed is legible three ways: a faster wind draws a longer trail, a brighter and
 * slightly thicker one, and more of them (light air is left nearly empty); the colour is the wind scale's.
 * When the camera moves the trails move with it (shifted and scaled, never wiped). Their
 * number follows the visible map area, the canvas is capped at 1.5× DPR, and the loop stops while the tab is hidden
 * or the map is covered (`paused`: the last frame stays on the canvas, so nothing flashes when it is uncovered).
 * Under prefers-reduced-motion it draws a still field instead of animating.
 */
export function WindParticles({ grid, inset, paused = false }: { grid: WindGrid | undefined; inset?: Inset; paused?: boolean }) {
  const { current } = useMap();
  const reduced = useReducedMotion();
  const gridRef = useRef(grid);
  const insetRef = useRef(inset);
  const engine = useRef<Engine | null>(null);
  const pausedRef = useRef(paused);

  useEffect(() => {
    const map = current?.getMap();
    if (!map) return;
    const e = createEngine(map, { reduced, grid: () => gridRef.current, inset: () => insetRef.current, paused: () => pausedRef.current });
    engine.current = e;
    return () => { e.destroy(); engine.current = null; };
  }, [current, reduced]);
  useEffect(() => { pausedRef.current = paused; engine.current?.pausedChanged(); }, [paused]);

  useEffect(() => { gridRef.current = grid; engine.current?.gridChanged(); }, [grid]);
  const { top = 0, right = 0, bottom = 0, left = 0 } = inset ?? {};
  useEffect(() => { insetRef.current = { top, right, bottom, left }; engine.current?.insetChanged(); }, [top, right, bottom, left]);
  return null;
}

type Engine = { gridChanged(): void; insetChanged(): void; pausedChanged(): void; destroy(): void };

function createEngine(map: MapLibreMap, o: {
  reduced: boolean; grid: () => WindGrid | undefined; inset: () => Inset | undefined; paused: () => boolean;
}): Engine {
  // The canvas goes inside MapLibre's canvas container, right after the GL canvas: above the basemap, below every
  // marker, popup and control, whatever z-indexes those use.
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.windParticles = o.reduced ? "still" : "animated";
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
  map.getCanvasContainer().insertBefore(canvas, map.getCanvas().nextSibling);
  const ctx = canvas.getContext("2d")!;
  const buf = document.createElement("canvas"); // scratch copy for shifting the trails with the camera
  const bctx = buf.getContext("2d")!;
  const coarse = window.matchMedia("(pointer: coarse)").matches;

  let w = 0, h = 0, dpr = 1;
  // Particles, in screen px.
  const X = new Float32Array(MAX_PARTICLES), Y = new Float32Array(MAX_PARTICLES);
  const AGE = new Float32Array(MAX_PARTICLES), LIFE = new Float32Array(MAX_PARTICLES);
  const X0 = new Float32Array(MAX_PARTICLES), Y0 = new Float32Array(MAX_PARTICLES);
  const BK = new Int16Array(MAX_PARTICLES);
  const PACE = new Float32Array(MAX_PARTICLES); // each particle's own pace (±12%), so neighbours don't march in step
  const SHOW = new Uint8Array(MAX_PARTICLES); // 0: sitting this life out (light air draws fewer particles)
  const ORDER = new Uint16Array(MAX_PARTICLES);
  const COUNT = new Int32Array(BUCKETS * 2), START = new Int32Array(BUCKETS * 2);
  let n = 0;
  // Stroke colour and width per bucket: a young and a settled alpha for each 2 kn band of the wind scale, built once.
  const knOf = (b: number) => (Math.floor(b / 2) + 0.5) * BUCKET_KN;
  const COLORS = Array.from({ length: BUCKETS * 2 }, (_, b) => windColor(knOf(b), alphaFor(knOf(b)) * (b % 2 ? 1 : 0.4)));
  const WIDTHS = Array.from({ length: BUCKETS * 2 }, (_, b) => widthFor(knOf(b)));

  // The grid, flattened, and its corners in screen px (recomputed when the camera or the grid changes).
  let nr = 0, nc = 0, GU = new Float32Array(0), GV = new Float32Array(0);
  let gx0 = 0, gx1 = 1, gy0 = 0, gy1 = 1;
  let gLats: number[] = [], gLons: number[] = [];
  const placeGrid = () => {
    if (!nr) return;
    const a = map.project([gLons[0], gLats[0]]), b = map.project([gLons[nc - 1], gLats[nr - 1]]);
    gx0 = a.x; gx1 = b.x; gy0 = a.y; gy1 = b.y; // latitude grows upward, so gy1 < gy0
  };
  const loadGrid = () => {
    const g = o.grid();
    if (!g || g.lats.length < 2 || g.lons.length < 2) { nr = nc = 0; return; }
    nr = g.lats.length; nc = g.lons.length; gLats = g.lats; gLons = g.lons;
    GU = new Float32Array(nr * nc); GV = new Float32Array(nr * nc);
    for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { GU[i * nc + j] = g.u[i][j]; GV[i * nc + j] = g.v[i][j]; }
    placeGrid();
  };
  // Bilinear sample at a screen point, into su/sv (kn east/north). Linear in screen y across the grid: over a
  // view-sized grid the Mercator stretch is far below a pixel.
  let su = 0, sv = 0;
  const sample = (x: number, y: number) => {
    let fx = ((x - gx0) / (gx1 - gx0)) * (nc - 1), fy = ((y - gy0) / (gy1 - gy0)) * (nr - 1);
    fx = fx < 0 ? 0 : fx > nc - 1 ? nc - 1 : fx;
    fy = fy < 0 ? 0 : fy > nr - 1 ? nr - 1 : fy;
    const j = Math.min(fx | 0, nc - 2), i = Math.min(fy | 0, nr - 2);
    const tx = fx - j, ty = fy - i;
    const k00 = i * nc + j, k01 = k00 + 1, k10 = k00 + nc, k11 = k10 + 1;
    const w00 = (1 - tx) * (1 - ty), w01 = tx * (1 - ty), w10 = (1 - tx) * ty, w11 = tx * ty;
    su = GU[k00] * w00 + GU[k01] * w01 + GU[k10] * w10 + GU[k11] * w11;
    sv = GV[k00] * w00 + GV[k01] * w01 + GV[k10] * w10 + GV[k11] * w11;
  };

  // The visible band, where particles are born.
  let bx0 = 0, by0 = 0, bx1 = 0, by1 = 0;
  const placeBand = () => {
    const ins = o.inset() ?? { top: 0, right: 0, bottom: 0, left: 0 };
    bx0 = Math.max(0, ins.left); bx1 = Math.min(w, w - ins.right);
    by0 = Math.max(0, ins.top); by1 = Math.min(h, h - ins.bottom);
    if (bx1 - bx0 < 48 || by1 - by0 < 48) { bx0 = 0; by0 = 0; bx1 = w; by1 = h; } // nothing sensible left: use it all
  };
  const target = () => Math.max(60, Math.min(MAX_PARTICLES, Math.round(((bx1 - bx0) * (by1 - by0)) / (coarse ? AREA_PER_PARTICLE_PHONE : AREA_PER_PARTICLE))));
  const spawn = (i: number, settled: boolean) => {
    X[i] = bx0 + Math.random() * (bx1 - bx0);
    Y[i] = by0 + Math.random() * (by1 - by0);
    PACE[i] = 0.88 + Math.random() * 0.24;
    // Drawn or not, by the wind where it lands: a particle that sits out comes back soon, somewhere else.
    if (nr) { sample(X[i], Y[i]); SHOW[i] = Math.random() < shown(Math.sqrt(su * su + sv * sv)) ? 1 : 0; } else SHOW[i] = 1;
    LIFE[i] = SHOW[i] ? LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN) : 20 + Math.random() * 40;
    AGE[i] = settled ? Math.random() * LIFE[i] : 0; // staggered ages: the field never fades in all at once
  };
  const fill = (settled: boolean) => {
    const t = target();
    for (let i = n; i < t; i++) spawn(i, settled);
    n = t;
  };

  // ── Animated field ──
  let owed = 0; // fade not yet painted, in 60 Hz frames
  const step = (dt: number) => {
    // Fade the trails. Painted once two frames' worth is owed: one stronger pass rounds a faint trail away, where
    // many weak ones would leave it stuck a few levels above clear.
    owed += dt;
    if (owed >= 2) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0,0,0,${1 - (1 - FADE) ** owed})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      owed = 0;
    }
    if (!nr) return;
    const k = SPEED_K * dt;
    COUNT.fill(0);
    for (let i = 0; i < n; i++) {
      const x = X[i], y = Y[i];
      sample(x, y);
      const nx = x + su * k * PACE[i], ny = y - sv * k * PACE[i];
      AGE[i] += dt;
      if (AGE[i] > LIFE[i] || nx < -8 || ny < -8 || nx > w + 8 || ny > h + 8) { spawn(i, false); BK[i] = -1; continue; }
      if (!SHOW[i]) { BK[i] = -1; continue; }
      // Young particles and those about to go are fainter: trails grow in and let go instead of popping.
      const b = Math.min(BUCKETS - 1, (Math.sqrt(su * su + sv * sv) / BUCKET_KN) | 0) * 2 + (AGE[i] < 10 || LIFE[i] - AGE[i] < 14 ? 0 : 1);
      BK[i] = b; COUNT[b]++;
      X0[i] = x; Y0[i] = y; X[i] = nx; Y[i] = ny;
    }
    // Counting sort by bucket, then one path and one stroke() per bucket.
    let acc = 0;
    for (let b = 0; b < COUNT.length; b++) { START[b] = acc; acc += COUNT[b]; }
    for (let i = 0; i < n; i++) { const b = BK[i]; if (b >= 0) ORDER[START[b]++] = i; }
    ctx.lineCap = "round";
    let p = 0;
    for (let b = 0; b < COUNT.length; b++) {
      const c = COUNT[b];
      if (!c) continue;
      ctx.strokeStyle = COLORS[b];
      ctx.lineWidth = WIDTHS[b];
      ctx.beginPath();
      for (const end = p + c; p < end; p++) { const i = ORDER[p]; ctx.moveTo(X0[i], Y0[i]); ctx.lineTo(X[i], Y[i]); }
      ctx.stroke();
    }
  };
  let raf = 0, last = 0, frames = 0;
  const tick = (t: number) => {
    raf = requestAnimationFrame(tick);
    if (coarse && last && t - last < 30) return; // phones: ~30 fps is plenty for streaks, and kinder to the battery
    const dt = last ? Math.min(3, Math.max(0.5, (t - last) / 16.667)) : 1;
    last = t;
    frames++;
    step(dt);
  };

  // ── Still field (reduced motion) ──
  // Seeds sit on a grid anchored to the world, not the screen, so a pan leaves every streamline where it was.
  const hash = (a: number, b: number) => {
    let s = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) >>> 0;
    s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) >>> 0;
    s = Math.imul(s ^ (s >>> 12), 0x297a2d39) >>> 0;
    return ((s ^ (s >>> 15)) >>> 0) / 4294967296;
  };
  const drawStill = () => {
    ctx.clearRect(0, 0, w, h);
    if (!nr) return;
    const origin = map.project([0, 0]);
    const c0 = Math.floor((bx0 - origin.x) / STATIC_CELL), c1 = Math.ceil((bx1 - origin.x) / STATIC_CELL);
    const r0 = Math.floor((by0 - origin.y) / STATIC_CELL), r1 = Math.ceil((by1 - origin.y) / STATIC_CELL);
    ctx.lineCap = "round";
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
      let x = origin.x + (c + 0.1 + 0.8 * hash(c, r)) * STATIC_CELL;
      let y = origin.y + (r + 0.1 + 0.8 * hash(r + 7919, c)) * STATIC_CELL;
      const steps = STATIC_STEPS - Math.floor(hash(c + 104729, r) * 6);
      for (let s = 0; s < steps; s++) {
        sample(x, y);
        const nx = x + su * STATIC_K, ny = y - sv * STATIC_K;
        const kn = Math.sqrt(su * su + sv * sv);
        // faint tail, bright head; a stronger wind is drawn brighter and a touch thicker (its line is longer already)
        ctx.strokeStyle = windColor(kn, STATIC_ALPHA * (0.6 + 0.4 * bright(kn)) * (0.3 + (0.7 * (s + 1)) / steps));
        ctx.lineWidth = widthFor(kn) + 0.15;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
        x = nx; y = ny;
      }
    }
  };

  // ── Camera: carry the trails (and the particles) with the map instead of wiping them ──
  // Two fixed geographic points tell us how the last frame's pixels map onto this frame's: a scale and a shift
  // (the map is always north-up and flat).
  let ref: { a: [number, number]; b: [number, number]; ax: number; ay: number; bx: number; by: number } | null = null;
  const anchor = () => {
    const a = map.unproject([0, 0]), b = map.unproject([w || 1, h || 1]);
    ref = { a: [a.lng, a.lat], b: [b.lng, b.lat], ax: 0, ay: 0, bx: w || 1, by: h || 1 };
  };
  const onMove = () => {
    if (!ref) anchor();
    const r = ref!;
    const A = map.project(r.a), B = map.project(r.b);
    const s = (B.x - A.x) / (r.bx - r.ax);
    placeGrid();
    if (!Number.isFinite(s) || s <= 0) { anchor(); return; }
    const tx = A.x - s * r.ax, ty = A.y - s * r.ay;
    if (Math.abs(s - 1) < 1e-4 && Math.abs(tx) < 0.05 && Math.abs(ty) < 0.05) return;
    bctx.globalCompositeOperation = "copy";
    bctx.drawImage(canvas, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = Math.abs(s - 1) > 1e-3 ? 0.9 : 1; // a zoom stretches the old trails: let them go a little faster
    ctx.drawImage(buf, tx * dpr, ty * dpr, canvas.width * s, canvas.height * s);
    ctx.restore();
    for (let i = 0; i < n; i++) { X[i] = s * X[i] + tx; Y[i] = s * Y[i] + ty; }
    r.ax = A.x; r.ay = A.y; r.bx = B.x; r.by = B.y;
  };
  const onMoveEnd = () => {
    anchor();
    if (o.reduced) drawStill();
  };

  const resize = () => {
    const el = map.getContainer();
    const nw = el.clientWidth, nh = el.clientHeight, nd = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    // ResizeObserver also reports the size it starts with: don't wipe and reseed a field that hasn't changed size.
    if (nw === w && nh === h && nd === dpr && canvas.width > 1) return;
    w = nw; h = nh; dpr = nd;
    canvas.width = buf.width = Math.max(1, Math.round(w * dpr));
    canvas.height = buf.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    placeBand();
    placeGrid();
    anchor();
    n = 0;
    if (o.reduced) drawStill(); else fill(true);
  };

  const start = () => { if (!o.reduced && !raf && !document.hidden && !o.paused()) { last = 0; raf = requestAnimationFrame(tick); } };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };
  const onVisibility = () => (document.hidden ? stop() : start());

  loadGrid();
  const ro = new ResizeObserver(resize);
  ro.observe(map.getContainer());
  resize();
  map.on("move", onMove);
  map.on("moveend", onMoveEnd);
  document.addEventListener("visibilitychange", onVisibility);
  start();

  // Dev only: lets a test (or the console) read the mode and particle count, and step frames.
  if (import.meta.env.DEV) {
    (window as unknown as { __wind?: unknown }).__wind = {
      mode: o.reduced ? "still" : "animated", count: () => n, running: () => raf !== 0, frames: () => frames, ready: () => nr > 0,
      step: (k: number) => { for (let i = 0; i < k; i++) step(1); },
    };
  }

  return {
    gridChanged() { loadGrid(); if (o.reduced) drawStill(); },
    pausedChanged() { if (o.paused()) stop(); else start(); },
    insetChanged() {
      placeBand();
      if (o.reduced) { drawStill(); return; }
      const t = target();
      if (t < n) n = t; else fill(false);
    },
    destroy() {
      stop();
      ro.disconnect();
      map.off("move", onMove);
      map.off("moveend", onMoveEnd);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.remove();
    },
  };
}
