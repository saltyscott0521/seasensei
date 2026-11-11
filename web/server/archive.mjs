// The forecast-run archive: each new run of each model, over the Tampa Bay area, saved to Cloudflare R2.
// It's the raw material for checking the models against what the stations measured and for correcting
// them: calibrate.mjs reads it back and pairs it with the station observations (observe.mjs).
//
// Every ARCHIVE_CHECK_MS it reads Open-Meteo's run metadata for each model. A run newer than the last one saved
// is fetched for every point (seed spots, NOAA/airport stations, a grid) in one request, trimmed to hours from
// the run's start, gzipped and PUT to R2 at  <prefix>/<model>[-sea]/YYYY/MM/DD/HHz.json.gz  (run time, UTC).
// HRRR and ECMWF are fetched with cell_selection=sea, as the browser asks for them at a spot; those files live
// under <model>-sea so they can't be mistaken for the older default-cell files under <model>, and every file
// since version 2 says which it is in `cell`.
//
// Open-Meteo's servers don't always agree on the latest run, and a forecast response doesn't say which run it
// came from. So a run is saved only when the metadata read before and after the data agree, and when the data
// isn't still the previous saved run's (see archiveModel). Anything else is discarded, counted and retried.
//
// Off unless R2 is configured: R2_ACCOUNT_ID (or R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
import * as r2 from "./r2.mjs";

const OPENMETEO = () => process.env.OPENMETEO_BASE ?? "https://api.open-meteo.com";
export const COOPS = () => process.env.COOPS_BASE ?? "https://api.tidesandcurrents.noaa.gov";
export const IEM = () => process.env.IEM_BASE ?? "https://mesonet.agron.iastate.edu";
const CHECK_MS = Number(process.env.ARCHIVE_CHECK_MS ?? 10 * 60_000);
const BOOT_MS = Number(process.env.ARCHIVE_BOOT_DELAY_MS ?? 30_000);
const PREFIX = () => (process.env.R2_PREFIX ?? "forecasts/v1").replace(/^\/+|\/+$/g, "");
const UA = "SeaSensei forecast archive (seasensei.com)";

/**
 * `api` is the Open-Meteo model we request; `meta` the dataset whose metadata says which run it is serving;
 * `cell` the grid cell asked for ("sea"; without it Open-Meteo's default, which prefers land).
 * NBM updates hourly, but consecutive runs barely differ, so only every third one is kept.
 * Open-Meteo counts one call per point per run: with ~110 points that's ~4,800 calls a day, under the free 10,000.
 */
export const ARCHIVE_MODELS = [
  { id: "hrrr", api: "gfs_hrrr", meta: "ncep_hrrr_conus", days: 2, cell: "sea" },
  { id: "rrfs", api: "ncep_rrfs_conus", meta: "ncep_rrfs_conus", days: 4 },
  { id: "nbm", api: "ncep_nbm_conus", meta: "ncep_nbm_conus", days: 7, everyHours: 3 },
  { id: "ecmwf", api: "ecmwf_ifs025", meta: "ecmwf_ifs025", days: 7, cell: "sea" },
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

export const configured = r2.configured;

export async function getJson(url, timeout = 30_000) {
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

/** The NOAA and airport stations in the box (`coops:<id>`, `asos:K<id>`), looked up once a day. */
export async function stationList(now = Date.now()) {
  if (now - stations.at > 24 * 3600e3) {
    const { ok, list } = await findStations();
    // Keep yesterday's list over a partial one; retry within the hour when a lookup failed.
    if (ok || list.length >= stations.list.length) stations = { at: ok ? now : now - 23 * 3600e3, list };
  }
  return stations.list;
}

const points = async () => [...SPOTS, ...(await stationList()), ...gridPoints()];

/* ---------------- one run ---------------- */

const runMeta = (m) => getJson(`${OPENMETEO()}/data/${m.meta}/static/meta.json`);

export const cellOf = (m) => m.cell ?? "land";

/** The run's values for every point, from the run's first hour on. Beyond `dataEnd`, Open-Meteo is serving an earlier run. */
export async function fetchRun(m, pts, meta) {
  const run = meta.last_run_initialisation_time;
  const q = new URLSearchParams({
    latitude: pts.map((p) => p.lat).join(","), longitude: pts.map((p) => p.lon).join(","),
    hourly: VARIABLES.join(","), models: m.api, wind_speed_unit: "kn", timeformat: "unixtime",
    past_days: "1", forecast_days: String(m.days),
  });
  if (m.cell) q.set("cell_selection", m.cell);
  const res = await getJson(`${OPENMETEO()}/v1/forecast?${q}`, 90_000);
  const arr = Array.isArray(res) ? res : [res];
  if (arr.length !== pts.length) throw new Error(`asked for ${pts.length} points, got ${arr.length}`);
  const time = arr[0].hourly.time;
  const from = time.findIndex((t) => t >= run);
  if (from < 0) throw new Error("no hours from this run in the response");
  const col = (h, v) => h[`${v}_${m.api}`] ?? h[v] ?? [];
  return {
    version: 2,
    model: m.id, openMeteoModel: m.api, cell: cellOf(m),
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

/** Where a model's runs live: `<prefix>/hrrr-sea/…` for sea-cell files, `<prefix>/gfs/…` for default-cell ones. */
export const dirFor = (m) => `${PREFIX()}/${m.id}${m.cell === "sea" ? "-sea" : ""}`;
export const keyFor = (m, runSec) => {
  const d = new Date(runSec * 1000), p = (n) => String(n).padStart(2, "0");
  return `${dirFor(m)}/${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${p(d.getUTCHours())}z.json.gz`;
};
/** The run time (unix seconds) a key stands for, or null. */
export const runOfKey = (key) => {
  const m = key.match(/\/(\d{4})\/(\d\d)\/(\d\d)\/(\d\d)z\.json\.gz$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]) / 1000 : null;
};

/* ---------------- telling one run's data from another's ---------------- */

const PRINT_POINTS = 6, PRINT_VARS = ["wind_speed_10m", "wind_gusts_10m", "wind_direction_10m"];
/** The first few points' wind, by valid time: enough to tell whether two responses hold the same run. */
const fingerprint = (doc) => ({
  run: doc.run, times: doc.times,
  rows: PRINT_VARS.flatMap((v) => (doc.values?.[v] ?? []).slice(0, PRINT_POINTS)),
});
/** True when every value the two share (same point, same valid hour) is identical: the "new" data is the old run's. */
function sameData(prev, doc) {
  const next = fingerprint(doc), at = new Map(prev.times.map((t, i) => [t, i]));
  let compared = 0;
  for (let r = 0; r < Math.min(prev.rows.length, next.rows.length); r++)
    for (let i = 0; i < next.times.length; i++) {
      const j = at.get(next.times[i]), a = j == null ? null : prev.rows[r][j], b = next.rows[r][i];
      if (a == null || b == null) continue;
      if (a !== b) return false;
      compared++;
    }
  return compared >= 6;
}

/* ---------------- scheduler ---------------- */

const state = { lastCheck: null, lastError: null, models: {} };
let busy = false;
const isoOf = (sec) => new Date(sec * 1000).toISOString();

/** After a restart: the newest run already in R2 (looking back three days), so it isn't fetched or saved again. */
async function resume(m, now) {
  for (let back = 0; back < 3; back++) {
    const keys = (await r2.list(`${keyFor(m, now / 1000 - back * 86400).split("/").slice(0, -1).join("/")}/`)).filter((k) => runOfKey(k) != null).sort();
    const key = keys.at(-1);
    if (!key) continue;
    const doc = await r2.getJsonGz(key).catch(() => null); // an unreadable file just can't be compared against
    return { run: runOfKey(key), key, print: doc?.times && doc?.values ? fingerprint(doc) : null };
  }
  return null;
}

/** A fetch that can't be trusted to be the run it would be labelled as: not saved, counted, retried later (each costs quota). */
function discard(m, s, run, why, now) {
  s.discarded = (s.discarded ?? 0) + 1;
  s.streak = (s.streak ?? 0) + 1;
  s.lastDiscard = { run: isoOf(run), why, at: new Date(now).toISOString() };
  s.retryAt = now + Math.min(CHECK_MS * 2 ** (s.streak - 1), 3600e3);
  throw new Error(`run ${isoOf(run)} not saved: ${why}`);
}

async function archiveModel(m, now = Date.now()) {
  const s = (state.models[m.id] ??= {});
  if (!s.resumed) {
    const last = await resume(m, now);
    if (last) Object.assign(s, { run: last.run, print: last.print, saved: { run: isoOf(last.run), key: last.key } });
    s.resumed = true;
  }
  if (now < (s.retryAt ?? 0)) return;

  const meta = await runMeta(m);
  const run = meta.last_run_initialisation_time;
  if (!Number.isFinite(run)) throw new Error("no run time in the metadata");
  // Nothing new. Also a server that is still on an older run than the one already saved: never go back.
  if (s.run != null && run <= s.run) return;
  if (m.everyHours && new Date(run * 1000).getUTCHours() % m.everyHours) return;

  const doc = await fetchRun(m, await points(), meta);
  // The response doesn't say which run it holds. If the metadata moved while we fetched, it could be either: don't guess.
  const after = (await runMeta(m)).last_run_initialisation_time;
  if (after !== run) discard(m, s, run, `Open-Meteo's run metadata changed during the fetch (now ${Number.isFinite(after) ? isoOf(after) : "unreadable"})`, now);
  // Metadata from an up-to-date server, data from one that isn't: the values are still the last saved run's.
  if (s.print && sameData(s.print, doc)) discard(m, s, run, `the data is still the ${s.print.run} run's`, now);

  const key = keyFor(m, run);
  const bytes = await r2.putJsonGz(key, doc);
  // Only now is the run saved: a failed PUT leaves it to be fetched again.
  Object.assign(s, { run, print: fingerprint(doc), streak: 0, retryAt: 0, saved: { run: doc.run, key, cell: doc.cell, points: doc.points.length, hours: doc.times.length, bytes, savedAt: new Date().toISOString() } });
  console.log(`[archive] ${m.id} ${doc.run} (${doc.cell} cells): ${doc.points.length} points × ${doc.times.length} h → ${key} (${Math.round(bytes / 1024)} KB)`);
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

/**
 * For /api/archive: what was saved last, per model, and how many fetches were thrown away because the run they
 * came from couldn't be established. No keys or bucket details.
 */
export const status = () => ({
  configured: configured(),
  lastCheck: state.lastCheck,
  lastError: state.lastError,
  models: Object.fromEntries(Object.entries(state.models).map(([id, s]) => [id, s.saved ?? null])),
  discarded: Object.fromEntries(Object.entries(state.models).filter(([, s]) => s.discarded).map(([id, s]) => [id, { count: s.discarded, last: s.lastDiscard }])),
});
