import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";

/**
 * Infer which wind directions have clean water upwind of a spot by ray-casting across the
 * OpenStreetMap water polygons in OpenFreeMap's vector tiles (the same tiles the map draws).
 *
 * For each bearing (the direction the wind comes FROM) we walk outward and record how far it is
 * to land. Water upwind = clean, onshore-style wind. Land close upwind = offshore: gusty and unsafe.
 */

const Z = 12;
const MAX_KM = 8;
const STEP_KM = 0.15;
const SHORE_KM = 0.3; // we're standing on the shore: ignore land right under the pin
export const BEARINGS = Array.from({ length: 16 }, (_, i) => i * 22.5);

export type Fetch = { dir: number; landKm: number | null; kind: "open" | "limited" | "land" };
export type CoastResult = { fetch: Fetch[]; suggestion: { dirC: number; dirW: number } | "any" | null };

type Poly = { rings: { x: number; y: number }[][]; minX: number; maxX: number; minY: number; maxY: number };
type TileWater = { polys: Poly[]; extent: number };

let tileTemplate: Promise<string> | null = null;
const tiles = new Map<string, Promise<TileWater>>();

const template = () =>
  (tileTemplate ??= fetch("https://tiles.openfreemap.org/planet").then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json().then((j) => j.tiles[0] as string);
  }));

const tileXY = (lat: number, lon: number) => {
  const n = 2 ** Z, r = (lat * Math.PI) / 180;
  const fx = ((lon + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { x: Math.floor(fx), y: Math.floor(fy), fx, fy };
};

function loadTile(x: number, y: number): Promise<TileWater> {
  const key = `${x}/${y}`;
  let p = tiles.get(key);
  if (!p) {
    p = template().then(async (t) => {
      const res = await fetch(t.replace("{z}", String(Z)).replace("{x}", String(x)).replace("{y}", String(y)));
      if (!res.ok) throw new Error(`Map tile HTTP ${res.status}`);
      const layer = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer()))).layers.water;
      const polys: Poly[] = [];
      for (let i = 0; layer && i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 3) continue;
        const rings = f.loadGeometry();
        const pts = rings.flat();
        polys.push({ rings, minX: Math.min(...pts.map((q) => q.x)), maxX: Math.max(...pts.map((q) => q.x)), minY: Math.min(...pts.map((q) => q.y)), maxY: Math.max(...pts.map((q) => q.y)) });
      }
      return { polys, extent: layer?.extent ?? 4096 };
    });
    tiles.set(key, p);
    p.catch(() => tiles.delete(key)); // let a later attempt retry
  }
  return p;
}

const inRing = (px: number, py: number, ring: { x: number; y: number }[]) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};

const move = (lat: number, lon: number, bearing: number, km: number): [number, number] => {
  const b = (bearing * Math.PI) / 180;
  return [lat + (km * Math.cos(b)) / 111.32, lon + (km * Math.sin(b)) / (111.32 * Math.cos((lat * Math.PI) / 180))];
};

function samplePoints(lat: number, lon: number) {
  const pts: { bearing: number; km: number; lat: number; lon: number }[] = [];
  for (const bearing of BEARINGS) for (let km = SHORE_KM; km <= MAX_KM; km += STEP_KM) pts.push({ bearing, km, ...(([a, o]) => ({ lat: a, lon: o }))(move(lat, lon, bearing, km)) });
  return pts;
}

/** Classify by distance to land: ≥3 km of water is clean, 1–3 km limited, <1 km is land upwind (offshore). */
const kindOf = (landKm: number | null): Fetch["kind"] => (landKm == null || landKm >= 3 ? "open" : landKm >= 1 ? "limited" : "land");

/** The widest run of "open" bearings, as a centre ± width (each bearing stands for 22.5°). */
export function suggestArc(fetch: Fetch[]): CoastResult["suggestion"] {
  const open = fetch.map((f) => f.kind === "open");
  if (open.every(Boolean)) return "any";
  if (!open.some(Boolean)) return null;
  const n = open.length;
  let best = { start: 0, len: 0 };
  for (let s = 0; s < n; s++) {
    if (!open[s] || open[(s + n - 1) % n]) continue; // only start at the beginning of a run
    let len = 0;
    while (len < n && open[(s + len) % n]) len++;
    if (len > best.len) best = { start: s, len };
  }
  const width = best.len * 22.5;
  return { dirC: (BEARINGS[best.start] + (width - 22.5) / 2 + 360) % 360, dirW: width };
}

export async function analyzeCoast(lat: number, lon: number): Promise<CoastResult> {
  const pts = samplePoints(lat, lon);
  const need = new Map<string, { x: number; y: number }>();
  for (const p of pts) { const t = tileXY(p.lat, p.lon); need.set(`${t.x}/${t.y}`, t); }
  const loaded = new Map(await Promise.all([...need.entries()].map(async ([k, t]) => [k, await loadTile(t.x, t.y)] as const)));

  const isWater = (la: number, lo: number) => {
    const t = tileXY(la, lo), tile = loaded.get(`${t.x}/${t.y}`)!;
    const px = (t.fx - t.x) * tile.extent, py = (t.fy - t.y) * tile.extent;
    return tile.polys.some((poly) => {
      if (px < poly.minX || px > poly.maxX || py < poly.minY || py > poly.maxY) return false;
      let inside = false;
      for (const ring of poly.rings) if (inRing(px, py, ring)) inside = !inside; // holes (islands) flip it back
      return inside;
    });
  };

  const fetch: Fetch[] = BEARINGS.map((dir) => {
    let sawWater = false, landKm: number | null = null;
    for (const p of pts.filter((q) => q.bearing === dir)) {
      if (isWater(p.lat, p.lon)) sawWater = true;
      else if (sawWater || p.km > 0.6) { landKm = p.km; break; }
    }
    return { dir, landKm, kind: kindOf(landKm) };
  });
  return { fetch, suggestion: suggestArc(fetch) };
}
