// Pure wind logic — no DOM, no fetch. Everything here is unit-tested.

export type Spot = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  min: number; // knots, bottom of the range this spot is ridden in
  max: number;
  /** NOAA CO-OPS station id for live wind; "none" = forecast only; missing = auto (nearest live sensor, see lib/session.ts). */
  station?: string;
  /** Wind directions (FROM, degrees) this spot works in: centre ± width/2. Missing or width ≥ 360 = any. */
  dirC?: number;
  dirW?: number;
};

export type Arc = Pick<Spot, "dirC" | "dirW">;

/** Is a FROM-direction inside the spot's allowed arc? (No arc, or a full circle, allows everything.) */
export function inArc(dir: number, arc?: Arc) {
  if (arc?.dirC == null || arc.dirW == null || arc.dirW >= 360) return true;
  const d = Math.abs((((dir - arc.dirC) % 360) + 540) % 360 - 180); // angular distance 0..180
  return d <= arc.dirW / 2;
}

export function arcLabel(arc?: Arc) {
  if (arc?.dirC == null || arc.dirW == null || arc.dirW >= 360) return "Any direction";
  return `${compass(arc.dirC)} ±${Math.round(arc.dirW / 2)}° (${compass(arc.dirC - arc.dirW / 2)}–${compass(arc.dirC + arc.dirW / 2)})`;
}

export type Model = "sensei" | "hrrr" | "rrfs" | "nbm" | "ecmwf" | "gfs";
/** The models as they come from Open-Meteo; "sensei" is our blend of them (lib/sensei.ts). */
export type RawModel = Exclude<Model, "sensei">;
export const RAW_MODELS: RawModel[] = ["hrrr", "rrfs", "nbm", "ecmwf", "gfs"];

/** Every model we show, keyed by our id; `key` is Open-Meteo's model name (SeaSensei's is our own). */
export const MODEL_INFO: Record<Model, { key: string; label: string; color: string; note: string }> = {
  sensei: { key: "sensei", label: "SeaSensei", color: "#f1f5f9", note: "Our blend of all five models, tuned to local sensors" },
  hrrr: { key: "gfs_hrrr", label: "HRRR", color: "#22d3ee", note: "3 km, to 48 h" },
  rrfs: { key: "ncep_rrfs_conus", label: "RRFS", color: "#f472b6", note: "3 km, NOAA's new model, to 84 h" },
  nbm: { key: "ncep_nbm_conus", label: "NBM", color: "#facc15", note: "NOAA blend, to 7 d" },
  ecmwf: { key: "ecmwf_ifs025", label: "ECMWF", color: "#a78bfa", note: "European, 25 km, to 7 d" },
  gfs: { key: "gfs_global", label: "GFS", color: "#fb923c", note: "US global, to 7 d" },
};
/** What a rider can pick to lead the forecast: SeaSensei (the default), then each raw model. */
export const PRIMARY_MODELS: Model[] = ["sensei", ...RAW_MODELS];
export const DEFAULT_MODEL: Model = "sensei";

/**
 * The raw models a forecast is drawn from, best first; each hour comes from the first one that has it.
 * HRRR runs out at 48 h, RRFS carries on to 84 h, then NOAA's blend to 7 days. The global models cover the week alone.
 * SeaSensei blends all five at a spot (no chain); for the map's wind field, which stays raw, it uses HRRR's chain.
 */
export function chainFor(primary: Model): RawModel[] {
  if (primary === "hrrr" || primary === "sensei") return ["hrrr", "rrfs", "nbm"];
  if (primary === "rrfs") return ["rrfs", "nbm"];
  return [primary];
}
/** Where a forecast switches from one model to the next (HRRR → RRFS at ~48 h, RRFS → NBM at ~84 h). SeaSensei has none. */
export function handoffs(hours: Hour[]) {
  return hours.flatMap((h, i) => (i > 0 && h.model !== hours[i - 1].model ? [{ t: h.t, from: hours[i - 1].model, to: h.model }] : []));
}

/** "SeaSensei" · "HRRR → RRFS → NBM" */
export const chainLabel = (primary: Model) =>
  primary === "sensei" ? MODEL_INFO.sensei.label : chainFor(primary).map((m) => MODEL_INFO[m].label).join(" → ");

/** What each choice of lead model means, in a rider's words (the picker's visible caption). */
export const CHAIN_PLAIN: Record<Model, string> = {
  sensei: MODEL_INFO.sensei.note,
  hrrr: "Sharpest local model first, then NOAA's blend",
  rrfs: "NOAA's new local model first, then its blend",
  nbm: "NOAA's blend of models, all week",
  ecmwf: "The European global model, all week",
  gfs: "The US global model, all week",
};
/** t = ms epoch, knots, deg FROM. SeaSensei hours also carry the range the wind is likely to fall in (`lo`–`hi`, kn). */
export type Hour = { t: number; speed: number; gust: number; dir: number; model: Model; lo?: number; hi?: number };
export type Forecast = { timeZone: string; hours: Hour[] };
export type Observation = { name: string; t: number; speed: number; gust: number; dir: number };
export type Station = { id: string; name: string; lat: number; lon: number };
export type Window = { start: number; end: number };
/** A live station reading from any source, normalised to knots / degrees FROM. */
export type LiveReading = {
  id: string; source: "noaa" | "airport"; name: string; lat: number; lon: number;
  speed: number; gust: number | null; dir: number; t: number;
};

export const IEM_URL = (network: string) => `https://mesonet.agron.iastate.edu/api/1/currents.json?network=${network}`;

/** Iowa Environmental Mesonet "currents" (airport ASOS/AWOS): sknt/gust in knots, drct degrees, utc_valid ISO. */
export function parseIem(json: any): LiveReading[] {
  return (json.data ?? [])
    .filter((r: any) => Number.isFinite(r.sknt) && Number.isFinite(r.lat) && Number.isFinite(r.lon) && r.utc_valid)
    .map((r: any) => ({
      id: `K${r.station}`, source: "airport" as const, name: AIRPORT_NAMES[r.station] ?? titleCase(r.name ?? r.station), lat: r.lat, lon: r.lon,
      speed: r.sknt, gust: Number.isFinite(r.gust) ? r.gust : null, dir: Number.isFinite(r.drct) ? r.drct : 0,
      t: Date.parse(r.utc_valid),
    }));
}
// What locals call them (the feed has two different "St Petersburg"s).
const AIRPORT_NAMES: Record<string, string> = {
  SPG: "Albert Whitted (SPG)", PIE: "St. Pete–Clearwater (PIE)", TPF: "Peter O. Knight (TPF)", MCF: "MacDill AFB (MCF)",
  TPA: "Tampa Intl (TPA)", VDF: "Tampa Executive (VDF)", CLW: "Clearwater Air Park (CLW)", SRQ: "Sarasota–Bradenton (SRQ)",
};
const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s);

export const inBox = (lat: number, lon: number, b: Bounds) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;

/** Bounding box of the spots, padded; the area we pull live stations for. */
export function spotsBox(spots: { lat: number; lon: number }[], pad = 0.35): Bounds {
  if (!spots.length) return { west: -83.1, south: 27.3, east: -82.2, north: 28.2 };
  const lats = spots.map((s) => s.lat), lons = spots.map((s) => s.lon);
  return { west: Math.min(...lons) - pad, south: Math.min(...lats) - pad, east: Math.max(...lons) + pad, north: Math.max(...lats) + pad };
}

/** Nearest live reading within maxKm, preferring NOAA's 6-minute sensors over hourly airport reports. */
export function nearestLive(readings: LiveReading[], lat: number, lon: number, maxKm = 16) {
  const withKm = readings.map((r) => ({ ...r, km: distanceKm(lat, lon, r.lat, r.lon) })).filter((r) => r.km <= maxKm);
  return withKm.sort((a, b) => (a.source === b.source ? a.km - b.km : a.source === "noaa" ? -1 : 1))[0] ?? null;
}

/** NOAA sends "" for a missing value, and Number("") is 0 — that would be a fake calm reading. */
const num = (x: unknown) => (x == null || String(x).trim() === "" ? NaN : Number(x));

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = (deg: number) => POINTS[Math.floor((((deg % 360) + 360) % 360) / 22.5 + 0.5) % 16];

export const TAMPA_BAY: Omit<Spot, "id">[] = [
  { name: "Fort De Soto", lat: 27.64, lon: -82.739, min: 15, max: 30 },
  { name: "Skyway", lat: 27.628, lon: -82.66, min: 15, max: 30 },
  { name: "Picnic Island", lat: 27.853, lon: -82.552, min: 15, max: 30, station: "8726607" },
];

/**
 * Which grid cell each model is read from at a spot. Open-Meteo's `cell_selection` applies to a whole request, so a
 * spot is two requests: HRRR and ECMWF from the nearest sea cell (their land cells read too light on the shore),
 * RRFS, NBM and GFS from the default cell.
 */
export const SPOT_REQUESTS: { models: RawModel[]; cell?: "sea" }[] = [
  { models: ["hrrr", "ecmwf"], cell: "sea" },
  { models: ["rrfs", "nbm", "gfs"] },
];

/** One of a spot's two Open-Meteo requests (speed, gust, direction; a day back, a week ahead). */
export function spotModelsUrl(lat: number, lon: number, req: { models: RawModel[]; cell?: "sea" }) {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    hourly: "wind_speed_10m,wind_gusts_10m,wind_direction_10m",
    models: req.models.map((m) => MODEL_INFO[m].key).join(","), wind_speed_unit: "kn", timeformat: "unixtime",
    timezone: "auto", forecast_days: "7", past_days: "1",
  });
  if (req.cell) q.set("cell_selection", req.cell);
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/** Every raw model at a spot, hour by hour (null where a model has no value). `partial`: a request is missing. */
export type ModelSeries = {
  timeZone: string;
  times: number[];
  models: Partial<Record<RawModel, { speed: (number | null)[]; gust: (number | null)[]; dir: (number | null)[] }>>;
  partial?: boolean;
  /** Why a request is missing ("HTTP 429"). */
  error?: string;
};

/**
 * A spot's Open-Meteo responses → one series per model on one time axis. `json` is null for a request that failed;
 * at least one must have arrived. (Multi-model responses suffix keys with the model name; a single-model one doesn't.)
 */
export function parseSpotModels(parts: { json: any; models: RawModel[] }[]): ModelSeries {
  const ok = parts.filter((p) => p.json?.hourly?.time);
  if (!ok.length) throw new Error("No forecast data");
  const times: number[] = [...new Set(ok.flatMap((p) => p.json.hourly.time as number[]))].sort((a, b) => a - b).map((t) => t * 1000);
  const out: ModelSeries = { timeZone: ok[0].json.timezone, times, models: {}, partial: ok.length < parts.length };
  for (const { json, models } of ok) {
    const h = json.hourly, at = new Map<number, number>(h.time.map((t: number, i: number) => [t * 1000, i]));
    for (const m of models) {
      const col = (k: string): (number | null)[] | undefined => h[`${k}_${MODEL_INFO[m].key}`] ?? (models.length === 1 ? h[k] : undefined);
      const speed = col("wind_speed_10m");
      if (!speed) continue;
      const pick = (c?: (number | null)[]) => times.map((t) => { const i = at.get(t); return i == null ? null : c?.[i] ?? null; });
      out.models[m] = { speed: pick(speed), gust: pick(col("wind_gusts_10m")), dir: pick(col("wind_direction_10m")) };
    }
  }
  return out;
}

/** Keep the models a failed request would have brought, from what was loaded before, on the fresh time axis. */
export function carryOver(fresh: ModelSeries, prev: ModelSeries): ModelSeries {
  const at = new Map(prev.times.map((t, i) => [t, i]));
  const models = { ...fresh.models };
  for (const m of RAW_MODELS) {
    const old = prev.models[m];
    if (models[m] || !old) continue;
    const pick = (c: (number | null)[]) => fresh.times.map((t) => { const i = at.get(t); return i == null ? null : c[i] ?? null; });
    models[m] = { speed: pick(old.speed), gust: pick(old.gust), dir: pick(old.dir) };
  }
  return { ...fresh, models };
}

/** A raw model's forecast: each hour from the first model in its chain that has it (of the models that arrived). */
export function chainForecast(s: ModelSeries, primary: RawModel): Forecast {
  const chain = chainFor(primary), hours: Hour[] = [];
  s.times.forEach((t, i) => {
    for (const model of chain) {
      const m = s.models[model], speed = m?.speed[i], gust = m?.gust[i], dir = m?.dir[i];
      if (speed == null || gust == null || dir == null) continue;
      hours.push({ t, speed, gust, dir, model });
      break;
    }
  });
  return { timeZone: s.timeZone, hours };
}

export function stationUrl(station: string) {
  const q = new URLSearchParams({
    station, product: "wind", date: "latest", units: "english",
    time_zone: "gmt", format: "json", application: "SeaSensei",
  });
  return `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${q}`;
}

export const STATIONS_URL = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=met";

/** CO-OPS wind → observation. Values are strings, times "yyyy-MM-dd HH:mm" GMT; no-data stations send {error}. */
export function parseObservation(json: any): Observation {
  if (json.error) throw new Error(json.error.message);
  const row = json.data?.[json.data.length - 1];
  const t = row ? Date.parse(row.t.replace(" ", "T") + ":00Z") : NaN;
  const [speed, gust, dir] = row ? [row.s, row.g, row.d].map(num) : [NaN, NaN, NaN];
  if (!row || [t, speed, gust, dir].some(Number.isNaN)) throw new Error("Station returned no wind reading");
  return { name: json.metadata?.name ?? "NOAA station", t, speed, gust, dir };
}

export function parseStations(json: any): Station[] {
  return (json.stations ?? [])
    .filter((s: any) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s: any) => ({ id: String(s.id), name: s.name, lat: s.lat, lon: s.lng }));
}

type Rideable = Pick<Spot, "min" | "max" | "dirC" | "dirW">;
export const isRideable = (h: Pick<Hour, "speed" | "dir">, spot: Rideable) =>
  h.speed >= spot.min && h.speed <= spot.max && inArc(h.dir, spot);

/** Runs of consecutive hours with sustained wind in range AND from a workable direction. */
export function rideableWindows(hours: Hour[], spot: Rideable): Window[] {
  const out: Window[] = [];
  let cur: Window | null = null;
  for (const h of hours) {
    if (isRideable(h, spot)) cur ? (cur.end = h.t) : (cur = { start: h.t, end: h.t });
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

export const nearestHour = (hours: Hour[], t: number) =>
  hours.reduce<Hour | null>((best, h) => (!best || Math.abs(h.t - t) < Math.abs(best.t - t) ? h : best), null);

export type Ride = "below" | "good" | "above" | "offdir";
/** Speed decides below/above; a right-speed wind from the wrong direction is its own state. */
export const rideState = (speed: number, spot: Rideable, dir?: number): Ride =>
  speed < spot.min ? "below" : speed > spot.max ? "above" : dir != null && !inArc(dir, spot) ? "offdir" : "good";

/** Great-circle distance in km. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export const nearestStations = (stations: Station[], lat: number, lon: number, n = 5) =>
  stations
    .map((s) => ({ ...s, km: distanceKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, n);

/* ---------- Wind field for the map particles ---------- */

export type Bounds = { west: number; south: number; east: number; north: number };
export type WindGrid = { lats: number[]; lons: number[]; u: number[][]; v: number[][]; speed: number[][] }; // [row=lat][col=lon]

/** An n×n grid of points covering the bounds, snapped so small pans reuse the same request. */
export function gridPoints(b: Bounds, n = 7) {
  const snap = (x: number, s: number) => Math.round(x / s) * s;
  const span = Math.max(b.east - b.west, b.north - b.south);
  const step = Math.max(0.01, snap(span / (n - 1), 0.01));
  const west = snap(b.west - step, step), south = snap(b.south - step, step);
  const lats = Array.from({ length: n + 2 }, (_, i) => +(south + i * step).toFixed(4));
  const lons = Array.from({ length: n + 2 }, (_, i) => +(west + i * step).toFixed(4));
  return { lats, lons };
}

/** Meteorological direction is where wind comes FROM; u/v point where it's going (u east, v north). */
export const toUV = (speed: number, dirFrom: number) => {
  const r = (dirFrom * Math.PI) / 180;
  return { u: -speed * Math.sin(r), v: -speed * Math.cos(r) };
};

export function buildGrid(lats: number[], lons: number[], points: { speed: number; dir: number }[]): WindGrid {
  const u: number[][] = [], v: number[][] = [], speed: number[][] = [];
  lats.forEach((_, i) => {
    u.push([]); v.push([]); speed.push([]);
    lons.forEach((__, j) => {
      const p = points[i * lons.length + j];
      const w = toUV(p.speed, p.dir);
      u[i].push(w.u); v[i].push(w.v); speed[i].push(p.speed);
    });
  });
  return { lats, lons, u, v, speed };
}

/** Bilinear sample of the grid at (lat, lon), clamped to its edges. */
export function sample(g: WindGrid, lat: number, lon: number) {
  const idx = (arr: number[], x: number) => {
    const n = arr.length - 1;
    const f = Math.min(Math.max((x - arr[0]) / (arr[n] - arr[0]), 0), 1) * n;
    const i = Math.min(Math.floor(f), n - 1);
    return { i, t: f - i };
  };
  const a = idx(g.lats, lat), b = idx(g.lons, lon);
  const lerp2 = (m: number[][]) =>
    m[a.i][b.i] * (1 - a.t) * (1 - b.t) + m[a.i][b.i + 1] * (1 - a.t) * b.t +
    m[a.i + 1][b.i] * a.t * (1 - b.t) + m[a.i + 1][b.i + 1] * a.t * b.t;
  const u = lerp2(g.u), v = lerp2(g.v);
  return { u, v, speed: Math.hypot(u, v) };
}

type Stops = [number, [number, number, number]][];
export type WindScale = "blue" | "turbo" | "spectrum";

/**
 * Wind speed → colour. The rider picks the scale (settings; `lib/windScale.ts` keeps the choice, default spectrum); every
 * consumer reads it through windColor / windGradient / windStops. All three are anchored to the ranges riders think in
 * (blue and turbo: <10, 10–14, 14–18, 18–25 prime, 25–30, 30+; spectrum its own, below): each step flat across the core of its range, blending near the edges.
 * - blue: one vivid blue (hue ~200–220°, deep navy → saturated → electric → ice → near-white) that only brightens with the wind;
 *   reads without hue, for colour-blind riders too, and stays well apart from the `go` verdict's emerald (#34d399, ~158°).
 * - turbo: Google's Turbo rainbow squeezed into 0–25 kn (colour changes early, red by 24), then purple from 25 kn.
 * - spectrum: grey <10, light blue 10–12, blue 12–14, green 14–17, yellow 17–20, orange 20–25, red 25–28, purple 28+ (its own
 *   ranges). Its green leans yellow (~105°) so it never reads as `go`.
 */
export const WIND_SCALES: Record<WindScale, { label: string; note: string; stops: Stops }> = {
  spectrum: {
    label: "Spectrum", note: "Grey, blues, green, yellow, orange, red, purple",
    stops: [
      [0, [78, 86, 100]], [4, [106, 114, 128]], [9.5, [150, 156, 166]], // <10: grey
      [10.5, [150, 200, 240]], [11.5, [158, 206, 244]],                 // 10–12: light blue
      [12.5, [70, 144, 234]], [13.5, [60, 134, 230]],                   // 12–14: blue
      [14.5, [112, 206, 80]], [16.5, [96, 196, 72]],                    // 14–17: green
      [17.5, [238, 212, 64]], [19.5, [244, 204, 56]],                   // 17–20: yellow
      [20.5, [250, 150, 52]], [24.5, [244, 122, 40]],                   // 20–25: orange
      [25.5, [236, 68, 60]], [27.5, [222, 50, 54]],                     // 25–28: red
      [28.5, [178, 76, 228]], [40, [204, 64, 238]],                     // 28+: purple
    ],
  },

  blue: {
    label: "Blue", note: "One vivid blue, brighter with more wind",
    stops: [
      [0, [30, 48, 84]], [4, [36, 60, 110]], [9.5, [44, 82, 160]],     // <10: deep navy
      [11, [30, 110, 220]], [13, [34, 124, 236]],                    // 10–14: saturated blue
      [14.5, [40, 150, 255]], [17, [56, 166, 255]],                  // 14–18: azure
      [18.5, [70, 190, 255]], [24.5, [104, 200, 255]],               // 18–25: prime, electric
      [25.5, [184, 228, 255]], [29, [204, 236, 255]],                // 25–30: ice
      [30.5, [238, 246, 255]], [40, [248, 251, 255]],                // 30+: near white
    ],
  },
  turbo: {
    label: "Turbo", note: "Rainbow through 25 kn, then purple",
    stops: [
      // Google's Turbo squeezed into 0–25 kn so the colour moves at the speeds riders care about …
      [0, [64, 71, 169]], [3, [68, 132, 242]], [6, [38, 189, 228]], [9, [39, 231, 174]], [12, [109, 252, 100]],
      [15, [181, 244, 59]], [18, [240, 196, 55]], [21, [246, 121, 30]], [24.5, [202, 43, 4]],
      // … then one purple for everything strong (it pulses, like every 25 kn+ mark)
      [25.5, [168, 70, 232]], [32, [186, 92, 246]], [40, [206, 128, 255]],
    ],
  },
};
/** 25 kn and up (as shown, rounded) pulses wherever the wind right now / at the chosen hour is drawn, on every scale. */
export const PULSE_KN = 25;
export const pulses = (kn: number | null | undefined) => kn != null && Math.round(kn) >= PULSE_KN;
export const WIND_SCALE_IDS = Object.keys(WIND_SCALES) as WindScale[];
export const DEFAULT_WIND_SCALE: WindScale = "spectrum";
export const isWindScale = (v: unknown): v is WindScale => typeof v === "string" && v in WIND_SCALES;

let STOPS: Stops = WIND_SCALES[DEFAULT_WIND_SCALE].stops;
/** Switch the scale every windColor/windGradient/windStops call uses from now on (the client's store calls this). */
export function setWindScale(id: WindScale) { STOPS = (WIND_SCALES[id] ?? WIND_SCALES[DEFAULT_WIND_SCALE]).stops; }

const rgbAt = (kn: number, stops: Stops = STOPS): [number, number, number] => {
  if (kn <= stops[0][0]) return stops[0][1];
  if (kn >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  let i = 0;
  while (kn > stops[i + 1][0]) i++;
  const [k0, c0] = stops[i], [k1, c1] = stops[i + 1];
  const t = (kn - k0) / (k1 - k0);
  return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * t)) as [number, number, number];
};

export function windColor(kn: number, alpha = 1) {
  const c = rgbAt(kn);
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

/** The same scale as "#rrggbb", for consumers that can't take CSS rgba() (the home-screen widget). */
export const windHex = (kn: number) => `#${rgbAt(kn).map((c) => c.toString(16).padStart(2, "0")).join("")}`;

const SCALE_MAX = 45;
/** CSS gradient of the scale (0–45 kn) for legends and slider tracks; `scale` draws another one (the settings' previews). */
export const windGradient = (dir = "90deg", scale?: WindScale) =>
  `linear-gradient(${dir},${(scale ? WIND_SCALES[scale].stops : STOPS).map(([k, c]) => `rgb(${c.join(",")}) ${(k / SCALE_MAX) * 100}%`).join(",")})`;

/** SVG gradient stops for a chart whose y-axis runs 0..top knots (offset 0 = bottom). */
export function windStops(top: number) {
  const inside = STOPS.filter(([k]) => k < top).map(([k, c]) => ({ offset: k / top, color: `rgb(${c.join(",")})` }));
  return [...inside, { offset: 1, color: `rgb(${rgbAt(top).join(",")})` }];
}

/* ---------- A week of wind fields for the map's time scrubber ---------- */

/** Per grid point, hourly speed/dir for the whole forecast (from the first model in the chain with data). */
export type WindField = { lats: number[]; lons: number[]; times: number[]; models: Model[]; speed: (number | null)[][]; dir: (number | null)[][] };

export function parseField(arr: any[], lats: number[], lons: number[], primary: Model = "hrrr"): WindField {
  const h0 = arr[0].hourly;
  const times: number[] = h0.time.map((t: number) => t * 1000);
  const chain = chainFor(primary);
  const col = (h: any, k: string, m: Model) => h[`${k}_${MODEL_INFO[m].key}`] ?? h[k];
  const pick = (h: any, k: string, i: number) => chain.map((m) => col(h, k, m)?.[i]).find((v) => v != null) ?? null;
  return {
    lats, lons, times,
    models: times.map((_, i) => chain.find((m) => col(h0, "wind_speed_10m", m)?.[i] != null) ?? chain[chain.length - 1]),
    speed: arr.map((r) => times.map((_, i) => pick(r.hourly, "wind_speed_10m", i))),
    dir: arr.map((r) => times.map((_, i) => pick(r.hourly, "wind_direction_10m", i))),
  };
}

/** The field's grid at the hour nearest to t. */
export function fieldAt(f: WindField, t: number) {
  let i = 0;
  f.times.forEach((x, j) => { if (Math.abs(x - t) < Math.abs(f.times[i] - t)) i = j; });
  const pts = f.speed.map((s, p) => ({ speed: s[i] ?? 0, dir: f.dir[p][i] ?? 0 }));
  return { grid: buildGrid(f.lats, f.lons, pts), t: f.times[i], model: f.models[i] };
}

/* ---------- Forecast vs actual ---------- */

export type Obs = { t: number; speed: number; gust: number; dir: number };

/** CO-OPS wind history (range=24 etc.) → observations, skipping blank rows. */
export function parseObsSeries(json: any): Obs[] {
  if (json.error) throw new Error(json.error.message);
  return (json.data ?? [])
    .map((r: any) => ({ t: Date.parse(r.t.replace(" ", "T") + ":00Z"), speed: num(r.s), gust: num(r.g), dir: num(r.d) }))
    .filter((o: Obs) => [o.t, o.speed, o.gust, o.dir].every(Number.isFinite));
}

export const stationHistoryUrl = (station: string, hours = 24) => {
  const q = new URLSearchParams({ station, product: "wind", range: String(hours), units: "english", time_zone: "gmt", format: "json", application: "SeaSensei" });
  return `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${q}`;
};

/** Average observations into the top-of-hour buckets the forecast uses (bucket = hour containing the reading, centred). */
export function hourlyObs(obs: Obs[]): Obs[] {
  const by = new Map<number, Obs[]>();
  for (const o of obs) {
    const k = Math.round(o.t / 3600e3) * 3600e3;
    (by.get(k) ?? by.set(k, []).get(k)!).push(o);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([t, xs]) => {
    const mean = (f: (o: Obs) => number) => xs.reduce((a, o) => a + f(o), 0) / xs.length;
    // vector-average the direction so 350° and 10° don't average to 180°
    const u = mean((o) => Math.sin((o.dir * Math.PI) / 180)), v = mean((o) => Math.cos((o.dir * Math.PI) / 180));
    return { t, speed: mean((o) => o.speed), gust: Math.max(...xs.map((o) => o.gust)), dir: (Math.atan2(u, v) * 180 / Math.PI + 360) % 360 };
  });
}

export type Score = { n: number; bias: number; mae: number; dirErr: number };
/** How the model did against the stations: bias = model − observed (knots), mae = average miss, dirErr = average direction miss. */
export function scoreForecast(hours: Hour[], obs: Obs[]): Score | null {
  const hourly = hourlyObs(obs);
  const byT = new Map(hours.map((h) => [h.t, h]));
  const pairs = hourly.flatMap((o) => (byT.has(o.t) ? [{ m: byT.get(o.t)!, o }] : []));
  if (pairs.length < 3) return null;
  const angle = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return {
    n: pairs.length,
    bias: pairs.reduce((a, p) => a + (p.m.speed - p.o.speed), 0) / pairs.length,
    mae: pairs.reduce((a, p) => a + Math.abs(p.m.speed - p.o.speed), 0) / pairs.length,
    dirErr: pairs.reduce((a, p) => a + angle(p.m.dir, p.o.dir), 0) / pairs.length,
  };
}

/* ---------- Model comparison ---------- */

/** The raw models, with their ids: what the comparison's spread and agreement are measured across. */
export const MODELS = RAW_MODELS.map((id) => ({ id, ...MODEL_INFO[id] }));
/** Every line on the Models chart: SeaSensei, then each raw model. */
export const COMPARE_MODELS = PRIMARY_MODELS.map((id) => ({ id, ...MODEL_INFO[id] }));

/** Speeds per model on one time axis, keyed by `MODEL_INFO[..].key` (so "sensei" for ours). */
export type ModelCompare = { times: number[]; series: Record<string, (number | null)[]> };

/** The comparison for a spot: each raw model as it came, plus the SeaSensei line when given its hours. */
export function compareSeries(s: ModelSeries, sensei?: Hour[]): ModelCompare & { timeZone: string } {
  const series: ModelCompare["series"] = Object.fromEntries(MODELS.map((m) => [m.key, s.models[m.id]?.speed ?? []]));
  if (sensei) {
    const at = new Map(sensei.map((h) => [h.t, h.speed]));
    series[MODEL_INFO.sensei.key] = s.times.map((t) => at.get(t) ?? null);
  }
  return { timeZone: s.timeZone, times: s.times, series };
}

/** Across the models that have a value at hour i: min, max, and the spread between them. */
export function spreadAt(c: ModelCompare, i: number) {
  const vs = MODELS.map((m) => c.series[m.key]?.[i]).filter((v): v is number => v != null);
  if (vs.length < 2) return null;
  const min = Math.min(...vs), max = Math.max(...vs);
  return { min, max, spread: max - min, n: vs.length };
}

/** Plain-English agreement between models over [from, to) — the average spread. */
export function agreement(c: ModelCompare, from: number, to: number) {
  const sp = c.times.flatMap((t, i) => (t >= from && t < to ? [spreadAt(c, i)] : [])).filter((x) => x != null) as { spread: number }[];
  if (!sp.length) return null;
  const avg = sp.reduce((a, x) => a + x.spread, 0) / sp.length;
  return { avg, label: avg <= 3 ? "Models agree" : avg <= 6 ? "Some disagreement" : "Models disagree", level: avg <= 3 ? "high" : avg <= 6 ? "mid" : "low" } as const;
}

/**
 * The wind across the whole visible area at hour i: typical (mean), strongest (90th percentile, so one
 * odd grid point doesn't set it) and a speed-weighted mean direction.
 */
export function areaStats(f: WindField, i: number) {
  const pts = f.speed.flatMap((s, p) => (s[i] != null && f.dir[p][i] != null ? [{ s: s[i]!, d: f.dir[p][i]! }] : []));
  if (!pts.length) return null;
  const sorted = pts.map((p) => p.s).sort((a, b) => a - b);
  const u = pts.reduce((a, p) => a + p.s * Math.sin((p.d * Math.PI) / 180), 0);
  const v = pts.reduce((a, p) => a + p.s * Math.cos((p.d * Math.PI) / 180), 0);
  return {
    mean: sorted.reduce((a, x) => a + x, 0) / sorted.length,
    peak: sorted[Math.floor(0.9 * (sorted.length - 1))],
    dir: ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360,
  };
}
