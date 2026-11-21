// GET /api/widget?station=8726412: the iPhone home-screen widget's data (public/widget/seasensei-widget.js, run by the
// Scriptable app). A NOAA station's latest wind and the SeaSensei forecast at the station, built by the app's engine
// (src/lib/widget.ts, bundled into engine.mjs) with that station's own calibration and the nowcast from its reading.
// The forecast comes from the briefing's cache (two Open-Meteo calls per place per 30 minutes, however often the widget
// polls); the reading is cached 3 minutes. Public data: CORS is open on this route only.
import { COOPS } from "./archive.mjs";
import * as briefing from "./briefing.mjs";
import * as calibrate from "./calibrate.mjs";

const READING_TTL = 3 * 60_000;
const UA = "SeaSensei widget (seasensei.com)";
export const DEFAULT_STATION = "8726412";
// Middle Tampa Bay is the widget's default, so it's always allowed, even when the served calibration doesn't list it.
const FALLBACK = { id: "8726412", name: "Middle Tampa Bay", lat: 27.66175, lon: -82.59952 };

const readings = new Map(); // id → { at, reading|null, error|null }
const inflight = new Map();
const info = { requests: 0, noaaCalls: 0, noaaErrors: 0 };

/** The NOAA stations the widget may ask for: the CO-OPS stations in the served calibration (the archive's list). */
export function stations() {
  const list = (calibrate.calibration()?.stations ?? [])
    .filter((s) => typeof s.id === "string" && s.id.startsWith("coops:") && Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map((s) => ({ id: s.id.slice(6), name: s.name, lat: s.lat, lon: s.lon }));
  return list.some((s) => s.id === FALLBACK.id) ? list : [FALLBACK, ...list];
}

function readingAt(id, now) {
  const hit = readings.get(id);
  if (hit && now - hit.at < READING_TTL) return Promise.resolve(hit);
  if (inflight.has(id)) return inflight.get(id);
  const p = (async () => {
    const q = new URLSearchParams({ station: id, product: "wind", range: "2", units: "english", time_zone: "gmt", format: "json", application: "SeaSensei" });
    let entry;
    try {
      info.noaaCalls++;
      const r = await fetch(`${COOPS()}/api/prod/datagetter?${q}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) { await r.arrayBuffer().catch(() => {}); throw new Error(`NOAA HTTP ${r.status}`); }
      const reading = briefing.engine().latestCoopsReading(await r.json());
      entry = { at: Date.now(), reading, error: reading ? null : "no recent reading" };
    } catch (e) {
      info.noaaErrors++;
      console.error(`[widget] NOAA ${id}: ${e.message}`);
      entry = { at: Date.now(), reading: null, error: "station unavailable" };
    }
    readings.set(id, entry);
    return entry;
  })().finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

const send = (res, code, body, cache) => {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": cache, "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
};

export const status = () => ({ ...info, cachedReadings: readings.size });

/** The /api/widget route. Returns false for any other path. */
export function handle(req, res, url) {
  if (url.pathname !== "/api/widget") return false;
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET", "Access-Control-Allow-Origin": "*" }); res.end(); return true; }
  const E = briefing.engine();
  if (!E) { send(res, 503, { error: "unavailable" }, "no-store"); return true; }
  const id = url.searchParams.get("station") ?? DEFAULT_STATION;
  const list = stations(), station = list.find((s) => s.id === id);
  if (!station) { send(res, 400, { error: "unknown_station", stations: list.map((s) => s.id) }, "no-store"); return true; }
  // The rider's range (default 15–30 kn): the sessions and the headline follow it; the forecast itself doesn't.
  const kn = (k, d) => { const v = Number(url.searchParams.get(k) ?? d); return Number.isFinite(v) ? Math.min(60, Math.max(1, Math.round(v))) : d; };
  const min = kn("min", 15), max = Math.max(min + 1, kn("max", 30));
  info.requests++;
  (async () => {
    const now = Date.now();
    const [series, obs] = await Promise.all([briefing.seriesAt(station.lat, station.lon, now).catch(() => null), readingAt(station.id, now)]);
    const w = E.composeWidget({ station, series, cal: briefing.calibration(), reading: obs.reading, now, min, max });
    const errors = [series ? null : "forecast unavailable", obs.reading ? null : obs.error].filter(Boolean);
    send(res, 200, { ...w, ...(errors.length ? { error: errors.join("; ") } : null) }, "public, max-age=120");
  })().catch((e) => {
    console.error(`[widget] ${e.message}`);
    if (!res.headersSent) send(res, 500, { error: "failed" }, "no-store");
  });
  return true;
}
