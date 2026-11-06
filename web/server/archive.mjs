// The forecast-run archive: each new run of each model, over the Tampa Bay area, saved to Cloudflare R2.
// It's the raw material for checking the models against what the stations measured, and later for
// correcting them (a SeaSensei blend). Nothing reads it back yet; it only has to keep accumulating.
//
// Every ARCHIVE_CHECK_MS it reads Open-Meteo's run metadata for each model. A run it hasn't saved yet is
// fetched for every point (seed spots, NOAA/airport stations, a grid) in one request, trimmed to hours from
// the run's start, gzipped and PUT to R2 at  <prefix>/<model>/YYYY/MM/DD/HHz.json.gz  (run time, UTC).
// Keys are deterministic, so a restart or two containers during a deploy just rewrite the same object.
//
// Off unless R2 is configured: R2_ACCOUNT_ID (or R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
import zlib from "node:zlib";
import { promisify } from "node:util";
import { AwsClient } from "aws4fetch";

const gzip = promisify(zlib.gzip);
const OPENMETEO = () => process.env.OPENMETEO_BASE ?? "https://api.open-meteo.com";
const COOPS = () => process.env.COOPS_BASE ?? "https://api.tidesandcurrents.noaa.gov";
const IEM = () => process.env.IEM_BASE ?? "https://mesonet.agron.iastate.edu";
const CHECK_MS = Number(process.env.ARCHIVE_CHECK_MS ?? 10 * 60_000);
const BOOT_MS = Number(process.env.ARCHIVE_BOOT_DELAY_MS ?? 30_000);
const PREFIX = () => (process.env.R2_PREFIX ?? "forecasts/v1").replace(/^\/+|\/+$/g, "");
const UA = "SeaSensei forecast archive (seasensei.com)";

/**
 * `api` is the Open-Meteo model we request; `meta` the dataset whose metadata says which run it is serving.
 * NBM updates hourly, but consecutive runs barely differ, so only every third one is kept.
 * Open-Meteo counts one call per point per run: with ~110 points that's ~4,800 calls a day, under the free 10,000.
 */
export const ARCHIVE_MODELS = [
  { id: "hrrr", api: "gfs_hrrr", meta: "ncep_hrrr_conus", days: 2 },
  { id: "rrfs", api: "ncep_rrfs_conus", meta: "ncep_rrfs_conus", days: 4 },
  { id: "nbm", api: "ncep_nbm_conus", meta: "ncep_nbm_conus", days: 7, everyHours: 3 },
  { id: "ecmwf", api: "ecmwf_ifs025", meta: "ecmwf_ifs025", days: 7 },
  { id: "gfs", api: "gfs_global", meta: "ncep_gfs013", days: 7 },
];
// Wind, plus temperature and pressure: the land–sea contrast and gradient behind the sea breeze.
const VARIABLES = ["wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "temperature_2m", "pressure_msl"];

// The app's seed spots (src/lib/wind.ts TAMPA_BAY); users' own spots live in their browsers.
const SPOTS = [
  { id: "spot:fort-de-soto", name: "Fort De Soto", lat: 27.64, lon: -82.739 },
  { id: "spot:skyway", name: "Skyway", lat: 27.628, lon: -82.66 },
  { id: "spot:picnic-island", name: "Picnic Island", lat: 27.853, lon: -82.552 },
];

function box() {
  const [west, south, east, north] = (process.env.ARCHIVE_BOX ?? "-83.2,27.2,-82.2,28.2").split(",").map(Number);
  return { west, south, east, north };
}
const inBox = (lat, lon, b = box()) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;

export function gridPoints(b = box(), step = Number(process.env.ARCHIVE_GRID_STEP ?? 0.125)) {
  const out = [];
  for (let lat = b.south; lat <= b.north + 1e-9; lat += step)
    for (let lon = b.west; lon <= b.east + 1e-9; lon += step)
      out.push({ id: `grid:${lat.toFixed(3)},${lon.toFixed(3)}`, lat: +lat.toFixed(4), lon: +lon.toFixed(4) });
  return out;
}

export const configured = () => !!(process.env.R2_BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
  && (process.env.R2_ENDPOINT || process.env.R2_ACCOUNT_ID));

async function getJson(url, timeout = 30_000) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) {
    const why = await r.json().then((j) => j.reason).catch(() => null);
    throw new Error(`${new URL(url).pathname} → HTTP ${r.status}${why ? `: ${why}` : ""}`);
  }
  return r.json();
}

/* ---------------- the points: spots, stations (refreshed daily), grid ---------------- */

let stations = { at: 0, list: [] };

async function findStations() {
  const found = [];
  const coops = await getJson(`${COOPS()}/mdapi/prod/webapi/stations.json?type=met`).catch((e) => (console.error(`[archive] NOAA stations: ${e.message}`), null));
  for (const s of coops?.stations ?? [])
    if (Number.isFinite(s.lat) && Number.isFinite(s.lng) && inBox(s.lat, s.lng)) found.push({ id: `coops:${s.id}`, name: s.name, lat: s.lat, lon: s.lng });
  const iem = await getJson(`${IEM()}/api/1/currents.json?network=FL_ASOS`).catch((e) => (console.error(`[archive] airports: ${e.message}`), null));
  for (const a of iem?.data ?? [])
    if (Number.isFinite(a.lat) && Number.isFinite(a.lon) && inBox(a.lat, a.lon)) found.push({ id: `asos:K${a.station}`, name: a.name, lat: a.lat, lon: a.lon });
  return { ok: !!coops && !!iem, list: found };
}

async function points(now = Date.now()) {
  if (now - stations.at > 24 * 3600e3) {
    const { ok, list } = await findStations();
    // Keep yesterday's list over a partial one; retry within the hour when a lookup failed.
    if (ok || list.length >= stations.list.length) stations = { at: ok ? now : now - 23 * 3600e3, list };
  }
  return [...SPOTS, ...stations.list, ...gridPoints()];
}

/* ---------------- one run ---------------- */

const runMeta = (m) => getJson(`${OPENMETEO()}/data/${m.meta}/static/meta.json`);

/** The run's values for every point, from the run's first hour on. Beyond `dataEnd`, Open-Meteo is serving an earlier run. */
export async function fetchRun(m, pts, meta) {
  const run = meta.last_run_initialisation_time;
  const q = new URLSearchParams({
    latitude: pts.map((p) => p.lat).join(","), longitude: pts.map((p) => p.lon).join(","),
    hourly: VARIABLES.join(","), models: m.api, wind_speed_unit: "kn", timeformat: "unixtime",
    past_days: "1", forecast_days: String(m.days),
  });
  const res = await getJson(`${OPENMETEO()}/v1/forecast?${q}`, 90_000);
  const arr = Array.isArray(res) ? res : [res];
  if (arr.length !== pts.length) throw new Error(`asked for ${pts.length} points, got ${arr.length}`);
  const time = arr[0].hourly.time;
  const from = time.findIndex((t) => t >= run);
  if (from < 0) throw new Error("no hours from this run in the response");
  const col = (h, v) => h[`${v}_${m.api}`] ?? h[v] ?? [];
  return {
    version: 1,
    model: m.id, openMeteoModel: m.api,
    run: new Date(run * 1000).toISOString(),
    availableAt: meta.last_run_availability_time ? new Date(meta.last_run_availability_time * 1000).toISOString() : null,
    dataEnd: meta.data_end_time ? new Date(meta.data_end_time * 1000).toISOString() : null,
    resolutionSeconds: meta.temporal_resolution_seconds ?? 3600,
    fetchedAt: new Date().toISOString(),
    units: arr[0].hourly_units ?? null,
    times: time.slice(from),
    points: pts.map((p, i) => ({ ...p, gridLat: arr[i].latitude, gridLon: arr[i].longitude, elevation: arr[i].elevation })),
    // values[variable][point][hour]
    values: Object.fromEntries(VARIABLES.map((v) => [v, arr.map((r) => col(r.hourly, v).slice(from))])),
  };
}

export const keyFor = (model, runSec) => {
  const d = new Date(runSec * 1000), p = (n) => String(n).padStart(2, "0");
  return `${PREFIX()}/${model}/${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${p(d.getUTCHours())}z.json.gz`;
};

let client = null;
async function put(key, body) {
  client ??= new AwsClient({ accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
  const endpoint = (process.env.R2_ENDPOINT ?? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/$/, "");
  const r = await client.fetch(`${endpoint}/${process.env.R2_BUCKET}/${key}`, {
    method: "PUT", body, headers: { "Content-Type": "application/gzip" }, signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`R2 PUT ${key} → HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
}

/* ---------------- scheduler ---------------- */

const state = { lastCheck: null, lastError: null, models: {} };
let busy = false;

async function archiveModel(m) {
  const meta = await runMeta(m);
  const run = meta.last_run_initialisation_time;
  if (!Number.isFinite(run)) throw new Error("no run time in the metadata");
  const seen = state.models[m.id];
  if (seen?.run === run) return;
  if (m.everyHours && new Date(run * 1000).getUTCHours() % m.everyHours) { state.models[m.id] = { ...seen, run, skipped: true }; return; }

  const doc = await fetchRun(m, await points(), meta);
  // A newer run landing mid-fetch would make this a mix; leave it and take the new one next check.
  if ((await runMeta(m)).last_run_initialisation_time !== run) return;
  const key = keyFor(m.id, run);
  const body = await gzip(JSON.stringify(doc));
  await put(key, body);
  state.models[m.id] = { run, saved: doc.run, key, points: doc.points.length, hours: doc.times.length, bytes: body.length, savedAt: new Date().toISOString() };
  console.log(`[archive] ${m.id} ${doc.run}: ${doc.points.length} points × ${doc.times.length} h → ${key} (${Math.round(body.length / 1024)} KB)`);
}

export async function tick() {
  if (busy) return;
  busy = true;
  try {
    let error = null;
    for (const m of ARCHIVE_MODELS) {
      try { await archiveModel(m); } catch (e) { error = `${m.id}: ${e.message}`; console.error(`[archive] ${error}`); }
    }
    state.lastCheck = new Date().toISOString();
    state.lastError = error;
  } finally { busy = false; }
}

export function startArchive() {
  if (!configured()) return;
  setTimeout(() => tick(), BOOT_MS).unref();
  setInterval(() => tick(), CHECK_MS).unref();
}

/** For /api/archive: what was saved last, per model. No keys or bucket details. */
export const status = () => ({
  configured: configured(),
  lastCheck: state.lastCheck,
  lastError: state.lastError,
  models: Object.fromEntries(Object.entries(state.models).map(([id, s]) => [id, s.saved ? { run: s.saved, key: s.key, points: s.points, hours: s.hours, bytes: s.bytes, savedAt: s.savedAt } : null])),
});
