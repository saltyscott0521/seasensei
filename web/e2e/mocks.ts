import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";

/**
 * Deterministic stand-ins for every network dependency: Open-Meteo, NOAA (stations + readings),
 * the Iowa Mesonet airports, and OpenFreeMap (a blank style; real vector tiles around Fort De Soto
 * for the coastline test). Times are generated relative to "now" so the app's clocks agree.
 */

const HOUR = 3600;
const json = (route: Route, body: unknown) => route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
const nowHour = () => Math.floor(Date.now() / 1000 / HOUR) * HOUR;

/** Sea-breeze-ish day: 8 kn overnight rising to ~24 kn mid-afternoon, wind from the SW. `t` in seconds. HRRR reads exactly this; the other models are offset (see `bias`). */
export const speedAt = (t: number) => 16 + 8 * Math.sin(((t / HOUR - 9) / 24) * 2 * Math.PI);
const dirAt = () => 225;

function hourlyTimes(hrrrOnly = false) {
  const start = nowHour() - 24 * HOUR;
  const n = hrrrOnly ? 24 + 48 : 24 + 7 * 24;
  return Array.from({ length: n }, (_, i) => start + i * HOUR);
}

/**
 * What a test can change about the stand-ins. `sea`: knots added to every model read with `cell_selection=sea` (the
 * spot requests for HRRR and ECMWF), so a test can make the sea cell windier than the land cell.
 */
export type MockOptions = {
  sea?: number;
  /** Active NWS alerts (api.weather.gov features, see `alertFeature`). None by default. */
  alerts?: unknown[];
};

/** One api.weather.gov alert. `hours`: how long from now until it ends. */
export function alertFeature(event = "Small Craft Advisory", hours = 6, extra: Record<string, unknown> = {}) {
  const ends = new Date(Date.now() + hours * 3600e3).toISOString();
  return {
    type: "Feature",
    properties: {
      id: `urn:oid:e2e.${event.replace(/\W+/g, "-")}`, event, status: "Actual", messageType: "Alert", severity: "Minor",
      areaDesc: "Tampa Bay waters", ends, expires: ends,
      headline: `${event} issued by NWS Tampa Bay Ruskin FL`,
      description: "* WHAT...Southwest winds 20 to 25 kt with gusts up to 30 kt\nand seas 4 to 6 ft.\n\n* WHERE...Tampa Bay waters.",
      instruction: "Inexperienced mariners, especially those operating smaller\nvessels, should avoid navigating in hazardous conditions.",
      parameters: { NWSheadline: [`${event.toUpperCase()} IN EFFECT UNTIL THIS EVENING`] },
      ...extra,
    },
  };
}

function locationPayload(url: URL, lat: number, lon: number, i: number, opts: MockOptions) {
  const q = url.searchParams, hourly = q.get("hourly")!, models = (q.get("models") ?? "").split(",");
  const times = hourlyTimes();
  const cut = nowHour() + 48 * HOUR; // HRRR ends at 48 h
  const rrfsCut = nowHour() + 84 * HOUR; // RRFS at 84 h
  const out: Record<string, unknown> = { time: times };
  const add = (variable: string, fn: (t: number, model: string) => number) => {
    // Like Open-Meteo: a single-model request has plain keys, a multi-model one suffixes each with the model.
    for (const m of models) out[models.length === 1 ? variable : `${variable}_${m}`] = times.map((t) => ((m === "gfs_hrrr" && t > cut) || (m === "ncep_rrfs_conus" && t > rrfsCut) ? null : +(fn(t, m) + (i % 3) * 0.2).toFixed(1)));
  };
  const bias: Record<string, number> = { gfs_hrrr: 0, ncep_rrfs_conus: 0.5, ncep_nbm_conus: -1, ecmwf_ifs025: -3, gfs_global: 1 };
  const sea = q.get("cell_selection") === "sea" ? opts.sea ?? 0 : 0;
  if (hourly.includes("wind_speed_10m")) add("wind_speed_10m", (t, m) => speedAt(t) + (bias[m] ?? 0) + sea);
  if (hourly.includes("wind_gusts_10m")) add("wind_gusts_10m", (t, m) => speedAt(t) + 4 + (bias[m] ?? 0) + sea);
  if (hourly.includes("wind_direction_10m")) add("wind_direction_10m", () => dirAt());
  return { latitude: lat, longitude: lon, timezone: "America/New_York", utc_offset_seconds: -14400, hourly: out };
}

const STATIONS = [
  { id: "8726607", name: "Old Port Tampa", lat: 27.8578, lng: -82.5528 },
  { id: "8726412", name: "Middle Tampa Bay", lat: 27.66175, lng: -82.599525 },
  { id: "8726724", name: "Clearwater Beach", lat: 27.9783, lng: -82.8317 },
];
const fmtNoaa = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

/**
 * The calibration our server publishes (/api/calibration), as its seed looks: every model as it is (identity speed
 * maps), typical misses per lead bucket, no local stations. Tests that need tuning override the route.
 */
export function calibrationFixture() {
  const model = (mae: number[]) => ({ n: 0, qm: [[0, 0], [4, 4], [8, 8], [12, 12], [16, 16], [20, 20], [25, 25], [35, 35]], mae, gf: 1.3 });
  return {
    version: 1, updated: new Date().toISOString(), source: "seed", leadBuckets: [12, 36, 72, 9999], stations: [] as unknown[],
    pooled: { models: { hrrr: model([1.9, 2.4, 2.8, 3.2]), rrfs: model([2.0, 2.5, 2.9, 3.3]), nbm: model([2.0, 2.3, 2.6, 3.0]), ecmwf: model([2.3, 2.5, 2.7, 3.0]), gfs: model([2.4, 2.7, 3.0, 3.3]) } },
    residual: { q10: [-2.4, -3.2, -3.8, -4.5], q90: [2.6, 3.4, 4.0, 4.8] },
    nowcast: { tauHours: 3, maxHours: 6 },
    score: null,
  };
}

export async function mockApis(page: Page, opts: MockOptions = {}) {
  await page.route("**/fonts.googleapis.com/**", (r) => r.abort());
  await page.route("**/fonts.gstatic.com/**", (r) => r.abort());

  await page.route("https://api.open-meteo.com/v1/forecast?**", (route) => {
    const url = new URL(route.request().url());
    const lats = url.searchParams.get("latitude")!.split(","), lons = url.searchParams.get("longitude")!.split(",");
    const all = lats.map((la, i) => locationPayload(url, +la, +lons[i], i, opts));
    return json(route, all.length === 1 ? all[0] : all);
  });

  await page.route("**/api/calibration", (route) => json(route, calibrationFixture()));

  // NWS alerts for the area: none, unless a test asks for some.
  await page.route("https://api.weather.gov/alerts/active?**", (route) => json(route, { type: "FeatureCollection", features: opts.alerts ?? [] }));

  // The daily wind discussion (our own server). Tests that need other states override these routes.
  await page.route(/\/api\/discussion(\?.*)?$/, (route) => {
    const date = new URL(route.request().url()).searchParams.get("date");
    return json(route, discussionResponse(date));
  });
  await page.route("**/api/discussions", (route) => json(route, { items: [0, 1].map((i) => { const d = discussionFixture(i); return { date: d.date, headline: d.headline, regime: d.regime, generatedAt: d.generatedAt }; }), configured: true }));

  await page.route("https://api.tidesandcurrents.noaa.gov/mdapi/**", (r) => json(r, { count: STATIONS.length, stations: STATIONS }));
  await page.route("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?**", (route) => {
    const q = new URL(route.request().url()).searchParams, id = q.get("station")!;
    const st = STATIONS.find((s) => s.id === id);
    if (!st) return json(route, { error: { message: "No data was found." } });
    const row = (ms: number) => ({ t: fmtNoaa(ms), s: (speedAt(ms / 1000) + 1.2).toFixed(2), d: "220.0", dr: "SW", g: (speedAt(ms / 1000) + 5).toFixed(2), f: "0,0" });
    const now = Math.floor(Date.now() / 360e3) * 360e3;
    const rows = q.get("range") ? Array.from({ length: 24 * 10 }, (_, i) => row(now - (24 * 10 - 1 - i) * 360e3)) : [row(now)];
    return json(route, { metadata: { id, name: st.name, lat: String(st.lat), lon: String(st.lng) }, data: rows });
  });
  await page.route("https://mesonet.agron.iastate.edu/**", (r) => json(r, { data: [
    { station: "MCF", name: "MACDILL AFB/TAMPA", lat: 27.8598, lon: -82.5132, sknt: 6, gust: null, drct: 230, utc_valid: new Date().toISOString() },
  ] }));

  // OpenFreeMap: a blank dark style (no tiles needed to draw markers and the particle layer) …
  await page.route("https://tiles.openfreemap.org/styles/**", (r) => json(r, {
    version: 8, name: "e2e", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b1220" } }],
  }));
  // … and real water polygons around Fort De Soto for the coastline analysis.
  await page.route("https://tiles.openfreemap.org/planet", (r) => json(r, { tilejson: "3.0.0", tiles: ["https://tiles.openfreemap.org/planet/e2e/{z}/{x}/{y}.pbf"] }));
  await page.route("https://tiles.openfreemap.org/planet/e2e/**", (route) => {
    const m = route.request().url().match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/)!;
    const file = fileURLToPath(new URL(`./fixtures/tiles/${m[2]}_${m[3]}.pbf`, import.meta.url));
    return fs.existsSync(file)
      ? route.fulfill({ contentType: "application/x-protobuf", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(file) })
      : route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  });
}

const day = (i: number) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);

/** i = how many days ago it was published (0 = today). */
export function discussionFixture(i = 0) {
  const trends = ["easing", "steady", "building", "building", "unsettled", "light", "steady"] as const;
  const labels = ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"];
  return {
    date: day(i),
    generatedAt: new Date(Date.now() - i * 864e5).toISOString(),
    region: "Tampa Bay and west-central Florida Gulf coast",
    timeZone: "America/New_York",
    model: "claude-sonnet-5-5",
    headline: i === 0 ? "A stalled front and Atlantic high hand the wind to the east this week." : "Yesterday's pattern: sea breeze, then storms.",
    bottomLine: "A weak boundary lifts north while high pressure builds over the Atlantic, turning the flow easterly and offshore for the Gulf beaches by Thursday.",
    regime: "Easterly flow, humid",
    drivers: [
      { kind: "front", title: "Cold front stalls north of the bay", detail: "A trailing boundary meanders across the Southeast before sagging south.", timing: "Thursday into the weekend", windImpact: "Winds veer northeast and freshen behind it.", sources: ["AFD", "WPC_EXT"] },
      { kind: "pressure", title: "Atlantic high builds", detail: "The ridge strengthens offshore and tightens the gradient over the peninsula.", timing: "Wednesday onward", windImpact: "A steady east to southeast flow that is offshore on the Gulf side.", sources: ["WPC_SHORT", "MODEL"] },
      { kind: "storms", title: "Afternoon storms return", detail: "Deeper moisture means daily thunderstorms that disrupt the wind.", timing: "Late afternoons", windImpact: "Gusty and unreliable near storms; lightning risk.", sources: ["AFD"] },
    ],
    days: labels.map((label, k) => ({
      date: day(i - k), label, pattern: `Pattern ${k}.`, windTrend: trends[k], flow: k < 3 ? "E–SE" : "NE",
      kiterTakeaway: `Takeaway ${k}.`, confidence: k < 3 ? "high" : "medium",
    })),
    watch: [{ what: "How far south the front sags", when: "Clearer by Wednesday night" }],
    uncertainty: "The back half of the week hinges on the front's timing; the sources disagree by a day.",
    sources: [
      { id: "AFD", name: "NWS Tampa Bay Area Forecast Discussion", issued: new Date().toISOString(), url: "https://forecast.weather.gov/product.php?site=NWS&issuedby=TBW&product=AFD" },
      { id: "WPC_SHORT", name: "NWS Weather Prediction Center Short Range Discussion (days 1–3)", issued: new Date().toISOString(), url: "https://www.wpc.ncep.noaa.gov/discussions/hpcdiscussions.php?disc=pmdspd" },
      { id: "WPC_EXT", name: "NWS Weather Prediction Center Extended Discussion (days 3–7)", issued: new Date().toISOString(), url: "https://www.wpc.ncep.noaa.gov/discussions/hpcdiscussions.php?disc=pmdepd" },
      { id: "MODEL", name: "Forecast-model pressure and wind-direction trend (cross-check only)", issued: new Date().toISOString(), url: "https://open-meteo.com/en/docs/ecmwf-api" },
    ],
    missing: ["NHC"],
  };
}

export function discussionResponse(date: string | null) {
  const found = [0, 1].map(discussionFixture).find((d) => !date || d.date === date) ?? null;
  return { discussion: found, configured: true, publishHour: 6, timeZone: "America/New_York" };
}
