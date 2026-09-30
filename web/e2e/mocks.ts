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

/** Sea-breeze-ish day: 8 kn overnight rising to ~24 kn mid-afternoon, wind from the SW. */
const speedAt = (t: number) => 16 + 8 * Math.sin(((t / HOUR - 9) / 24) * 2 * Math.PI);
const dirAt = () => 225;

function hourlyTimes(hrrrOnly = false) {
  const start = nowHour() - 24 * HOUR;
  const n = hrrrOnly ? 24 + 48 : 24 + 7 * 24;
  return Array.from({ length: n }, (_, i) => start + i * HOUR);
}

function locationPayload(url: URL, lat: number, lon: number, i: number) {
  const q = url.searchParams, hourly = q.get("hourly")!, models = (q.get("models") ?? "").split(",");
  const times = hourlyTimes();
  const cut = nowHour() + 48 * HOUR; // HRRR ends at 48 h
  const out: Record<string, unknown> = { time: times };
  const add = (variable: string, fn: (t: number, model: string) => number) => {
    for (const m of models) out[`${variable}_${m}`] = times.map((t) => (m === "gfs_hrrr" && t > cut ? null : +(fn(t, m) + (i % 3) * 0.2).toFixed(1)));
  };
  const bias: Record<string, number> = { gfs_hrrr: 0, ncep_nbm_conus: -1, ecmwf_ifs025: -3, gfs_global: 1 };
  if (hourly.includes("wind_speed_10m")) add("wind_speed_10m", (t, m) => speedAt(t) + (bias[m] ?? 0));
  if (hourly.includes("wind_gusts_10m")) add("wind_gusts_10m", (t, m) => speedAt(t) + 4 + (bias[m] ?? 0));
  if (hourly.includes("wind_direction_10m")) add("wind_direction_10m", () => dirAt());
  return { latitude: lat, longitude: lon, timezone: "America/New_York", utc_offset_seconds: -14400, hourly: out };
}

const STATIONS = [
  { id: "8726607", name: "Old Port Tampa", lat: 27.8578, lng: -82.5528 },
  { id: "8726412", name: "Middle Tampa Bay", lat: 27.66175, lng: -82.599525 },
  { id: "8726724", name: "Clearwater Beach", lat: 27.9783, lng: -82.8317 },
];
const fmtNoaa = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

export async function mockApis(page: Page) {
  await page.route("**/fonts.googleapis.com/**", (r) => r.abort());
  await page.route("**/fonts.gstatic.com/**", (r) => r.abort());

  await page.route("https://api.open-meteo.com/v1/forecast?**", (route) => {
    const url = new URL(route.request().url());
    const lats = url.searchParams.get("latitude")!.split(","), lons = url.searchParams.get("longitude")!.split(",");
    const all = lats.map((la, i) => locationPayload(url, +la, +lons[i], i));
    return json(route, all.length === 1 ? all[0] : all);
  });

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
