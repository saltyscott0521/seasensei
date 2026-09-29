// Pure wind logic — no DOM, no fetch. Everything here is unit-tested.

export type Spot = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  min: number; // knots, bottom of the range this spot is ridden in
  max: number;
  station?: string; // NOAA CO-OPS station id for live wind
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

export type Model = "hrrr" | "nbm";
export type Hour = { t: number; speed: number; gust: number; dir: number; model: Model }; // t = ms epoch, knots, deg FROM
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

export function forecastUrl(lat: number, lon: number) {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    hourly: "wind_speed_10m,wind_gusts_10m,wind_direction_10m",
    // HRRR (3 km, hourly updates) runs out at 48 h; NOAA's National Blend (NBM) carries it to 7 days.
    models: "gfs_hrrr,ncep_nbm_conus", wind_speed_unit: "kn", timeformat: "unixtime",
    timezone: "auto", forecast_days: "7", past_days: "1",
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

export function stationUrl(station: string) {
  const q = new URLSearchParams({
    station, product: "wind", date: "latest", units: "english",
    time_zone: "gmt", format: "json", application: "SeaSensei",
  });
  return `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${q}`;
}

export const STATIONS_URL = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=met";

/**
 * Open-Meteo response → hours. Each hour comes from HRRR when HRRR has it, else from NBM
 * (multi-model responses suffix keys with the model name; a single-model response doesn't).
 */
export function parseForecast(json: any): Forecast {
  const h = json.hourly, hours: Hour[] = [];
  const col = (k: string, m: string) => h[`${k}_${m}`] ?? (m === "gfs_hrrr" ? h[k] : undefined) ?? [];
  const src = [["gfs_hrrr", "hrrr"], ["ncep_nbm_conus", "nbm"]] as const;
  for (let i = 0; i < h.time.length; i++) {
    for (const [m, model] of src) {
      const s = col("wind_speed_10m", m)[i], g = col("wind_gusts_10m", m)[i], d = col("wind_direction_10m", m)[i];
      if (s == null || g == null || d == null) continue;
      hours.push({ t: h.time[i] * 1000, speed: s, gust: g, dir: d, model });
      break;
    }
  }
  return { timeZone: json.timezone, hours };
}

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

/**
 * Wind speed → colour, a smooth gradient anchored to the ranges riders think in:
 * green holds through ~15–20 kn, purple ~20–30, red from ~30 (deepening past 40, red is the top).
 * Each colour is flat across the core of its range and blends into its neighbour near the edges.
 */
const STOPS: [number, [number, number, number]][] = [
  [0, [100, 116, 139]],  // calm: slate
  [6, [59, 130, 246]],   // blue
  [11, [34, 211, 238]], [13, [34, 211, 238]], // cyan
  [16, [34, 197, 94]], [19, [34, 197, 94]],   // 15–20: green
  [22, [168, 85, 247]], [28, [168, 85, 247]], // 20–30: purple
  [32, [239, 68, 68]], [38, [239, 68, 68]],   // 30–40: red
  [44, [185, 28, 28]],                        // 40+: deep red
];

const rgbAt = (kn: number): [number, number, number] => {
  if (kn <= STOPS[0][0]) return STOPS[0][1];
  if (kn >= STOPS[STOPS.length - 1][0]) return STOPS[STOPS.length - 1][1];
  let i = 0;
  while (kn > STOPS[i + 1][0]) i++;
  const [k0, c0] = STOPS[i], [k1, c1] = STOPS[i + 1];
  const t = (kn - k0) / (k1 - k0);
  return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * t)) as [number, number, number];
};

export function windColor(kn: number, alpha = 1) {
  const c = rgbAt(kn);
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

const SCALE_MAX = 45;
/** CSS gradient of the scale (0–45 kn) for legends and slider tracks. */
export const windGradient = (dir = "90deg") =>
  `linear-gradient(${dir},${STOPS.map(([k, c]) => `rgb(${c.join(",")}) ${(k / SCALE_MAX) * 100}%`).join(",")})`;

/** SVG gradient stops for a chart whose y-axis runs 0..top knots (offset 0 = bottom). */
export function windStops(top: number) {
  const inside = STOPS.filter(([k]) => k < top).map(([k, c]) => ({ offset: k / top, color: `rgb(${c.join(",")})` }));
  return [...inside, { offset: 1, color: `rgb(${rgbAt(top).join(",")})` }];
}

/* ---------- A week of wind fields for the map's time scrubber ---------- */

/** Per grid point, hourly speed/dir for the whole forecast (HRRR where it has data, else NBM). */
export type WindField = { lats: number[]; lons: number[]; times: number[]; models: Model[]; speed: (number | null)[][]; dir: (number | null)[][] };

export function parseField(arr: any[], lats: number[], lons: number[]): WindField {
  const h0 = arr[0].hourly;
  const times: number[] = h0.time.map((t: number) => t * 1000);
  const pick = (h: any, k: string, i: number) => h[`${k}_gfs_hrrr`]?.[i] ?? h[`${k}_ncep_nbm_conus`]?.[i] ?? h[k]?.[i] ?? null;
  return {
    lats, lons, times,
    models: times.map((_, i) => (h0.wind_speed_10m_gfs_hrrr?.[i] != null ? "hrrr" : "nbm")),
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

export const MODELS = [
  { key: "gfs_hrrr", label: "HRRR", color: "#22d3ee", note: "3 km, to 48 h" },
  { key: "ncep_nbm_conus", label: "NBM", color: "#facc15", note: "NOAA blend, to 7 d" },
  { key: "ecmwf_ifs025", label: "ECMWF", color: "#a78bfa", note: "European, to 7 d" },
  { key: "gfs_global", label: "GFS", color: "#fb923c", note: "US global, to 7 d" },
] as const;

export type ModelCompare = { times: number[]; series: Record<string, (number | null)[]> };

export function modelsUrl(lat: number, lon: number) {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), hourly: "wind_speed_10m", models: MODELS.map((m) => m.key).join(","),
    wind_speed_unit: "kn", timeformat: "unixtime", timezone: "auto", forecast_days: "7", past_days: "1",
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

export function parseModels(json: any): ModelCompare & { timeZone: string } {
  const h = json.hourly;
  return {
    timeZone: json.timezone,
    times: h.time.map((t: number) => t * 1000),
    series: Object.fromEntries(MODELS.map((m) => [m.key, (h[`wind_speed_10m_${m.key}`] ?? []) as (number | null)[]])),
  };
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
