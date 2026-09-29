// Pure wind logic — no DOM, no fetch. Everything here is unit-tested.

export type Spot = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  min: number; // knots, bottom of the range this spot is ridden in
  max: number;
  station?: string; // NOAA CO-OPS station id for live wind
};

export type Hour = { t: number; speed: number; gust: number; dir: number }; // t = ms epoch, knots, deg FROM
export type Forecast = { timeZone: string; hours: Hour[] };
export type Observation = { name: string; t: number; speed: number; gust: number; dir: number };
export type Station = { id: string; name: string; lat: number; lon: number };
export type Window = { start: number; end: number };

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
    models: "gfs_hrrr", wind_speed_unit: "kn", timeformat: "unixtime",
    timezone: "auto", forecast_days: "3",
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

/** Open-Meteo HRRR response → hours; null hours (past HRRR's ~48h horizon) are dropped. */
export function parseForecast(json: any): Forecast {
  const h = json.hourly, hours: Hour[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const s = h.wind_speed_10m[i], g = h.wind_gusts_10m[i], d = h.wind_direction_10m[i];
    if (s == null || g == null || d == null) continue;
    hours.push({ t: h.time[i] * 1000, speed: s, gust: g, dir: d });
  }
  return { timeZone: json.timezone, hours };
}

/** CO-OPS wind → observation. Values are strings, times "yyyy-MM-dd HH:mm" GMT; no-data stations send {error}. */
export function parseObservation(json: any): Observation {
  if (json.error) throw new Error(json.error.message);
  const row = json.data?.[json.data.length - 1];
  const t = row ? Date.parse(row.t.replace(" ", "T") + ":00Z") : NaN;
  const [speed, gust, dir] = row ? [row.s, row.g, row.d].map(Number) : [NaN, NaN, NaN];
  if (!row || [t, speed, gust, dir].some(Number.isNaN)) throw new Error("Station returned no wind reading");
  return { name: json.metadata?.name ?? "NOAA station", t, speed, gust, dir };
}

export function parseStations(json: any): Station[] {
  return (json.stations ?? [])
    .filter((s: any) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s: any) => ({ id: String(s.id), name: s.name, lat: s.lat, lon: s.lng }));
}

/** Runs of consecutive hours with sustained wind in [min,max] (start of first hour → start of last). */
export function rideableWindows(hours: Hour[], min: number, max: number): Window[] {
  const out: Window[] = [];
  let cur: Window | null = null;
  for (const h of hours) {
    if (h.speed >= min && h.speed <= max) cur ? (cur.end = h.t) : (cur = { start: h.t, end: h.t });
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

export const nearestHour = (hours: Hour[], t: number) =>
  hours.reduce<Hour | null>((best, h) => (!best || Math.abs(h.t - t) < Math.abs(best.t - t) ? h : best), null);

export type Ride = "below" | "good" | "above";
export const rideState = (speed: number, spot: Pick<Spot, "min" | "max">): Ride =>
  speed < spot.min ? "below" : speed > spot.max ? "above" : "good";

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

/** Knots → color on a kite-rider's scale: calm blue → sweet-spot green → nuking magenta. */
const STOPS: [number, [number, number, number]][] = [
  [0, [70, 90, 140]], [8, [56, 140, 220]], [13, [34, 211, 238]], [17, [52, 211, 153]],
  [22, [163, 230, 53]], [27, [250, 204, 21]], [32, [251, 113, 36]], [40, [236, 72, 153]],
];
export function windColor(kn: number, alpha = 1) {
  let i = 0;
  while (i < STOPS.length - 2 && kn > STOPS[i + 1][0]) i++;
  const [k0, c0] = STOPS[i], [k1, c1] = STOPS[i + 1];
  const t = Math.min(Math.max((kn - k0) / (k1 - k0), 0), 1);
  const c = c0.map((x, j) => Math.round(x + (c1[j] - x) * t));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
