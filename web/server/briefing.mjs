// The morning briefing: a Web Push each morning, at the rider's chosen time in their time zone, saying where and
// when today ("Fort De Soto · On at 1 PM"). The words come from the app's own engine (engine.mjs, bundled from
// src/lib/briefing.ts by scripts/build-engine.mjs), fed the same two Open-Meteo requests per spot the app makes and
// the server's own calibration, so the push says what the board says. No nowcast: the morning push is about the
// day, and the reading would only bend the next few hours.
//
// Every few minutes a cycle finds the subscriptions whose local time has passed today (by at most STALE minutes,
// so a long outage doesn't send a stale morning push in the afternoon) and that haven't had today's; builds each
// briefing (forecasts are shared across subscribers by rounded position and cached 30 minutes); and sends it with a
// 3-hour TTL. Today is marked sent only after the push service says 2xx; a 404/410 deletes the subscription.
import * as calibrate from "./calibrate.mjs";
import * as push from "./push.mjs";

let E = null; // the engine
try { E = await import("./engine.mjs"); }
catch (e) { console.error(`[briefing] off: server/engine.mjs is missing or broken (run \`npm run build\` in web/): ${e.message}`); }

const OPENMETEO = () => (process.env.OPENMETEO_BASE ?? "https://api.open-meteo.com").replace(/\/$/, "");
const NWS = () => (process.env.NWS_BASE ?? "https://api.weather.gov").replace(/\/$/, "");
const UA = "SeaSensei morning briefing (seasensei.com)";
// Every minute, so a 7:30 briefing goes at 7:30, not 7:33. Cheap: the subscriptions live in memory (listed from the store
// once, kept current by subscribe/unsubscribe), so a cycle reads nothing from R2 and fetches forecasts only when one is due.
const CHECK_MS = Number(process.env.BRIEFING_CHECK_MS ?? 60_000);
const BOOT_MS = Number(process.env.BRIEFING_BOOT_DELAY_MS ?? 60_000);
const STALE_MIN = Number(process.env.BRIEFING_STALE_MINUTES ?? 120);
const FORECAST_TTL = 30 * 60_000, PARTIAL_TTL = 5 * 60_000, ALERT_TTL = 10 * 60_000;
const HOUR = 3600e3;
const MAX_BODY = 16 * 1024;
const RATE = Number(process.env.PUSH_RATE_LIMIT ?? 30); // subscribe/unsubscribe requests per IP per 10 minutes

const info = {
  lastCycle: null, cycles: 0, due: 0, sent: 0, failed: 0, pruned: 0, skipped: 0, noForecast: 0, errors: 0, lastError: null,
  calls: { lastCycle: 0, today: 0, day: null, total: 0 }, alertCalls: 0,
};

export const available = () => !!E && !!push.publicKey();
/** The bundled engine (null when engine.mjs is missing), for the home-screen widget (widget.mjs). */
export const engine = () => E;

/* ---------------- forecasts and alerts, shared across subscribers ---------------- */

const forecasts = new Map(); // "lat,lon" → { at, ttl, series|null }
const alerts = new Map();    // "lat,lon" → { at, alert|null }
let cycleCalls = 0;

function countCall() {
  const day = new Date().toISOString().slice(0, 10);
  if (info.calls.day !== day) { info.calls.day = day; info.calls.today = 0; }
  info.calls.today++; info.calls.total++; cycleCalls++;
}

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) { await r.arrayBuffer().catch(() => {}); throw new Error(`${new URL(url).pathname} → HTTP ${r.status}`); }
  return r.json();
}

const inflight = new Map();
/**
 * A spot's raw models (both requests, as the app makes them), or null when neither arrived. Shared with the
 * home-screen widget (widget.mjs): one cache, so a place costs at most two Open-Meteo calls per 30 minutes.
 */
export function seriesAt(lat, lon, now) {
  const la = +lat.toFixed(3), lo = +lon.toFixed(3), key = `${la},${lo}`;
  const hit = forecasts.get(key);
  if (hit && now - hit.at < hit.ttl) return Promise.resolve(hit.series);
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const res = await Promise.allSettled(E.SPOT_REQUESTS.map((r) => {
      countCall();
      return getJson(E.spotModelsUrl(la, lo, r).replace("https://api.open-meteo.com", OPENMETEO()));
    }));
    const failed = res.filter((r) => r.status === "rejected");
    let series = null;
    if (failed.length < res.length) {
      try { series = E.parseSpotModels(res.map((r, i) => ({ json: r.status === "fulfilled" ? r.value : null, models: E.SPOT_REQUESTS[i].models }))); }
      catch (e) { failed.push({ reason: e }); }
    }
    if (failed.length) console.error(`[briefing] forecast at ${key}: ${failed.map((f) => f.reason?.message ?? f.reason).join("; ")}`);
    forecasts.set(key, { at: Date.now(), ttl: failed.length ? PARTIAL_TTL : FORECAST_TTL, series });
    return series;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** The most serious marine alert in force at a point, or null (also when NWS can't be reached). */
async function alertAt(lat, lon, now) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = alerts.get(key);
  if (hit && now - hit.at < ALERT_TTL) return hit.alert;
  let alert = null;
  try {
    info.alertCalls++;
    alert = E.parseAlerts(await getJson(E.alertsUrl(lat, lon, NWS()), { Accept: "application/geo+json" }), now)[0] ?? null;
  } catch (e) { console.error(`[briefing] alerts: ${e.message}`); }
  alerts.set(key, { at: now, alert });
  return alert;
}

let calSrc = null, calParsed = null;
/** The server's own calibration (what /api/calibration serves), read the way the browser reads it. */
export function calibration() {
  const doc = calibrate.calibration();
  if (doc !== calSrc) {
    calSrc = doc;
    try { calParsed = E.parseCalibration(JSON.parse(JSON.stringify(doc))); }
    catch (e) { console.error(`[briefing] calibration unusable, using the built-in one: ${e.message}`); calParsed = E.FALLBACK_CALIBRATION; }
  }
  return calParsed;
}

/** One subscriber's briefing at `now`, or null when no spot's forecast could be had. */
export async function briefingFor(sub, now = Date.now()) {
  const cal = calibration(), hour = Math.floor(now / HOUR) * HOUR;
  const fcs = await Promise.all(sub.spots.map(async (s) => {
    const series = await seriesAt(s.lat, s.lon, now);
    return series ? E.forecastFrom(series, sub.model, cal, s, hour) : null;
  }));
  const plain = E.composeBriefing(sub.spots, fcs, now);
  if (!plain) return null;
  const at = sub.spots.find((s) => s.id === plain.spotId) ?? sub.spots[0];
  const alert = await alertAt(at.lat, at.lon, now);
  return alert ? E.composeBriefing(sub.spots, fcs, now, alert) : plain;
}

const payloadOf = (b) => ({ title: b.title, body: b.body, url: b.url, tag: "morning-briefing" });

/* ---------------- the scheduler ---------------- */

/** Today's local date if this subscription's briefing is due at `now`, else null. */
export function dueDate(sub, now = Date.now()) {
  const { date, minutes } = E.localClock(now, sub.timeZone);
  if (sub.lastSentDate === date) return null;
  const late = minutes - (E.parseHHMM(sub.time) ?? 420);
  return late >= 0 && late <= STALE_MIN ? date : null;
}

/** Send one push and deal with the answer. Returns the push service's status (0 when it couldn't be reached). */
async function deliver(sub, b) {
  let status = 0;
  try { status = await push.send(sub, payloadOf(b)); }
  catch (e) { info.failed++; info.lastError = `push: ${e.message}`; return 0; }
  if (status === 404 || status === 410) { await push.remove(sub.id).catch(() => {}); info.pruned++; }
  else if (status < 200 || status >= 300) { info.failed++; info.lastError = `push service answered HTTP ${status}`; }
  return status;
}

let busy = false;
export async function cycle(now = Date.now()) {
  if (busy || !E) return;
  busy = true;
  cycleCalls = 0;
  try {
    if (!(await push.loadKeys())) return;
    await push.load();
    const due = push.all().map((sub) => ({ sub, date: dueDate(sub, now) })).filter((x) => x.date);
    info.due = due.length;
    for (const { sub, date } of due) {
      const b = await briefingFor(sub, now);
      if (!b) { info.noForecast++; continue; } // tried again next cycle, while it's still morning
      if (!E.shouldSend(b, sub.mode)) {
        info.skipped++;
        await push.mark(sub.id, { lastSentDate: date, lastResult: { at: new Date(now).toISOString(), result: "skipped" } });
        continue;
      }
      const status = await deliver(sub, b);
      if (status >= 200 && status < 300) {
        info.sent++;
        await push.mark(sub.id, { lastSentDate: date, lastResult: { at: new Date(now).toISOString(), result: "sent", status } });
      }
    }
  } catch (e) {
    info.errors++; info.lastError = e.message;
    console.error(`[briefing] ${e.message}`);
  } finally {
    info.cycles++;
    info.lastCycle = new Date(now).toISOString();
    info.calls.lastCycle = cycleCalls;
    if (cycleCalls) console.log(`[briefing] cycle: ${info.due} due, ${cycleCalls} Open-Meteo calls`);
    busy = false;
  }
}

export function startBriefings() {
  if (!E) return;
  push.loadKeys().then((k) => k && push.load()).catch((e) => console.error(`[briefing] couldn't load subscriptions: ${e.message}`));
  setTimeout(() => cycle(), BOOT_MS).unref();
  setInterval(() => cycle(), CHECK_MS).unref();
}

/** For /api/push/status: counts only, never endpoints or places. */
export const status = () => ({
  available: available(), engine: !!E, keys: push.keysStatus(), subscribers: push.count(), maxSubscribers: push.MAX_SUBS(),
  checkMinutes: CHECK_MS / 60_000, ...info, calls: { ...info.calls }, cachedForecasts: forecasts.size,
});

/* ---------------- HTTP ---------------- */

const json = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => Object.assign(new Error("too large"), { code: 413 });
    if (Number(req.headers["content-length"]) > MAX_BODY) { req.resume(); return reject(tooLarge()); }
    let size = 0;
    const chunks = [];
    req.on("data", (c) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); }); // past the limit: read and dropped
    req.on("end", () => {
      if (size > MAX_BODY) return reject(tooLarge());
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null")); }
      catch { reject(Object.assign(new Error("bad json"), { code: 400 })); }
    });
    req.on("error", reject);
  });
}

const hits = new Map(); // ip → { start, n }
function limited(req) {
  const ip = String(req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > 600e3) hits.delete(k);
  const h = hits.get(ip);
  if (!h || now - h.start > 600e3) { hits.set(ip, { start: now, n: 1 }); return false; }
  return ++h.n > RATE;
}

/** Same origin only: a browser always sends Origin on a POST; it has to be this site. */
function foreign(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host !== req.headers.host; } catch { return true; }
}

async function subscribe(req, res) {
  if (foreign(req)) return json(res, 403, { error: "forbidden" });
  if (limited(req)) return json(res, 429, { error: "slow_down" });
  if (!available()) return json(res, 503, { error: "unavailable" });
  const body = await readBody(req);
  const { sub, error } = push.parseSubscribe(body, E.PRIMARY_MODELS);
  if (error) return json(res, 400, { error });
  const r = await push.upsert(sub);
  if (r.status === "full") return json(res, 503, { error: "full" });
  json(res, 200, { ok: true, status: r.status, next: new Date(E.nextAt(sub.time, sub.timeZone)).toISOString() });
}

async function unsubscribe(req, res) {
  if (foreign(req)) return json(res, 403, { error: "forbidden" });
  if (limited(req)) return json(res, 429, { error: "slow_down" });
  const body = await readBody(req);
  if (typeof body?.endpoint !== "string" || body.endpoint.length > 1024) return json(res, 400, { error: "bad_endpoint" });
  const removed = await push.remove(push.idOf(body.endpoint));
  json(res, 200, { ok: true, removed });
}

/** Admin: build (and, unless dry, send) the briefing now for one endpoint or everyone. Doesn't count as today's. */
async function sendNow(req, res, url) {
  if (!available()) return json(res, 503, { error: "unavailable" });
  await push.load();
  const endpoint = url.searchParams.get("endpoint"), dry = url.searchParams.get("dry") === "1";
  const targets = endpoint ? [push.get(push.idOf(endpoint))] : push.all();
  if (targets.some((t) => !t)) return json(res, 404, { error: "no_such_subscription" });
  const now = Date.now(), results = [];
  for (const sub of targets) {
    const b = await briefingFor(sub, now);
    const row = { id: sub.id.slice(0, 12), mode: sub.mode, time: sub.time, timeZone: sub.timeZone, wouldSend: b ? E.shouldSend(b, sub.mode) : false, briefing: b };
    if (!dry && b) row.status = await deliver(sub, b);
    results.push(row);
  }
  json(res, 200, { dry, count: results.length, results });
}

/**
 * The /api/push/* routes. Returns false for any other path. `admin(req)` checks the bearer token (it answers itself
 * when that fails and returns false).
 */
export function handle(req, res, url, admin) {
  const p = url.pathname;
  if (!p.startsWith("/api/push/")) return false;
  const run = (f) => {
    f().catch((e) => {
      if (e.code === 413) return json(res, 413, { error: "too_large" });
      if (e.code === 400) return json(res, 400, { error: "bad_json" });
      console.error(`[push] ${p}: ${e.message}`);
      if (!res.headersSent) json(res, 502, { error: "store_failed" });
    });
    return true;
  };
  const method = (m) => { if (req.method === m) return true; res.writeHead(405, { Allow: m }); res.end(); return false; };
  if (p === "/api/push/key") {
    if (!method("GET")) return true;
    return run(async () => {
      if (E) await push.loadKeys();
      return available() ? json(res, 200, { publicKey: push.publicKey() }) : json(res, 503, { error: "unavailable" });
    });
  }
  if (p === "/api/push/status") { if (method("GET")) json(res, 200, status()); return true; }
  if (p === "/api/push/subscribe") return method("POST") ? run(() => subscribe(req, res)) : true;
  if (p === "/api/push/unsubscribe") return method("POST") ? run(() => unsubscribe(req, res)) : true;
  if (p === "/api/push/send-now") return method("POST") ? (admin(req, res) ? run(() => sendNow(req, res, url)) : true) : true;
  json(res, 404, { error: "not_found" });
  return true;
}
