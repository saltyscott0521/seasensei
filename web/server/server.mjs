// SeaSensei's server: the built app (dist/), the daily wind discussion (JSON API, archive, RSS) and the
// scheduler that writes it, the forecast-run archive (archive.mjs, to R2), the station observations (observe.mjs)
// and the learning that turns the two into /api/calibration (calibrate.mjs). No framework; Node core only,
// plus the Anthropic SDK in discussion.mjs and aws4fetch (R2 request signing) in r2.mjs.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { configured } from "./discussion.mjs";
import { describeError, publish, startScheduler, status } from "./publish.mjs";
import * as store from "./store.mjs";
import * as archive from "./archive.mjs";
import * as observe from "./observe.mjs";
import * as calibrate from "./calibrate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(process.env.DIST_DIR ?? path.join(here, "..", "dist"));
const PORT = Number(process.env.PORT ?? 80);
const SITE = (process.env.SITE_URL ?? "https://seasensei.com").replace(/\/$/, "");
const ADMIN_TOKEN = process.env.DISCUSSION_ADMIN_TOKEN ?? "";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".mjs": "application/javascript",
  ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain",
};

/**
 * Sent with every response. The Content-Security-Policy lists what the built app really loads: its own scripts,
 * styles and workers (MapLibre's worker is a same-origin module; blob: covers its fallback), inline styles (the
 * first-paint <style> in index.html and React's style attributes), Geist from Google Fonts, map style, tiles,
 * glyphs and sprites from OpenFreeMap, wind and stations from Open-Meteo, NOAA and IEM, and Cloudflare's
 * analytics beacon. CSP_REPORT_ONLY=1 turns it into a report-only header without a deploy of new code.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://static.cloudflareinsights.com",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://tiles.openfreemap.org",
  "connect-src 'self' https://api.open-meteo.com https://api.tidesandcurrents.noaa.gov https://mesonet.agron.iastate.edu https://api.weather.gov https://tiles.openfreemap.org https://cloudflareinsights.com",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000",
  "Permissions-Policy": "geolocation=(self), camera=(), microphone=(), payment=()",
  "X-Frame-Options": "DENY",
  [process.env.CSP_REPORT_ONLY === "1" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy"]: CSP,
};

function sendJson(res, status, body, cache = "no-store") {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": cache });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(DIST, urlPath);
  if (!file.startsWith(DIST + path.sep) && file !== DIST) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // A missing file with an extension is a 404, never index.html: during a deploy the old container can be asked
    // for the new build's hashed assets, and an "immutable" HTML answer would get cached at the edge under a .js URL.
    if (path.extname(urlPath)) { res.writeHead(404, { "Cache-Control": "no-store" }); return res.end(); }
    file = path.join(DIST, "index.html"); // SPA fallback for app routes
  }
  const ext = path.extname(file);
  const immutable = urlPath.startsWith("/assets/") || urlPath.startsWith("/maplibre/");
  res.writeHead(200, {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
}

/* ---------------- discussion API ---------------- */

const meta = () => { const { configured, publishHour, timeZone } = status(); return { configured, publishHour, timeZone }; };

function handleDiscussion(url, res) {
  const date = url.searchParams.get("date");
  if (date != null && !store.isDate(date)) return sendJson(res, 400, { error: "bad_date", message: "date must be YYYY-MM-DD" });
  const discussion = date ? store.get(date) : store.latest();
  sendJson(res, 200, { discussion, ...meta() }, "public, max-age=300");
}

const safeEqual = (a, b) => {
  const x = crypto.createHash("sha256").update(a).digest(), y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
};

/** Regenerate on demand. Off unless DISCUSSION_ADMIN_TOKEN is set; the scheduler needs none of this. */
async function handleGenerate(req, res) {
  if (!ADMIN_TOKEN) return sendJson(res, 404, { error: "disabled" });
  const given = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(given, ADMIN_TOKEN)) return sendJson(res, 401, { error: "unauthorized" });
  try {
    const force = new URL(req.url, "http://x").searchParams.get("force") === "1";
    const { status: outcome, discussion } = await publish({ force });
    sendJson(res, 200, { status: outcome, date: discussion.date });
  } catch (e) {
    console.error("[discussion] manual generation failed:", describeError(e));
    sendJson(res, 502, { error: "failed", message: describeError(e) });
  }
}

/* ---------------- RSS ---------------- */

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function feed(res) {
  const items = store.list(30).map((i) => store.get(i.date)).filter(Boolean).map((d) => {
    const link = `${SITE}/?discussion=${d.date}`;
    const body = [d.bottomLine, ...d.drivers.map((x) => `${x.title}: ${x.detail} (${x.timing})`), d.uncertainty && `Uncertainty: ${d.uncertainty}`].filter(Boolean).join("\n\n");
    return `<item><title>${xml(d.headline)}</title><link>${link}</link><guid isPermaLink="true">${link}</guid><pubDate>${new Date(d.generatedAt).toUTCString()}</pubDate><description>${xml(body)}</description></item>`;
  });
  const out = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>SeaSensei wind discussion</title><link>${SITE}/</link><description>A daily look at the fronts, pressure and storms steering the wind around Tampa Bay. AI-written from National Weather Service products.</description><language>en-us</language>${items.join("")}</channel></rss>`;
  res.writeHead(200, { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=900" });
  res.end(out);
}

/* ---------------- routing ---------------- */

function route(req, res) {
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname;
  if (p === "/healthz") { res.writeHead(200); return res.end("ok"); }
  if (p === "/api/discussion/generate") {
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }); return res.end(); }
    return handleGenerate(req, res);
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  if (p === "/api/discussion") return handleDiscussion(url, res);
  if (p === "/api/discussions") return sendJson(res, 200, { items: store.list(), ...meta() }, "public, max-age=300");
  if (p === "/feed.xml") return feed(res);
  if (p === "/api/calibration") return sendJson(res, 200, calibrate.calibration(), "public, max-age=600");
  if (p === "/api/archive") return sendJson(res, 200, { ...archive.status(), observations: observe.status(), learning: calibrate.status() });
  serveStatic(req, res);
}

// A bad request must never take the process down (it also runs the schedulers): "//" and a broken percent-escape both throw.
const server = http.createServer((req, res) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  try { route(req, res); }
  catch (e) {
    const bad = e instanceof URIError || (e instanceof TypeError && /Invalid URL/i.test(e.message));
    if (!bad) console.error("[server] request failed:", req.method, req.url, e);
    if (res.headersSent) return res.destroy();
    res.writeHead(bad ? 400 : 500, { "Cache-Control": "no-store" });
    res.end();
  }
});
process.on("uncaughtException", (e) => console.error("[server] uncaught:", e));
process.on("unhandledRejection", (e) => console.error("[server] unhandled rejection:", e));

server.listen(PORT, () => {
  console.log(`seasensei on :${PORT} · dist=${DIST} · discussion ${configured() ? `enabled, publishes ${status().publishHour}:00 ${status().timeZone}` : "disabled (no ANTHROPIC_API_KEY)"} · admin ${ADMIN_TOKEN ? "on" : "off"} · forecast archive ${archive.configured() ? `to R2 bucket ${process.env.R2_BUCKET}` : "off (no R2 settings)"}`);
  startScheduler();
  archive.startArchive();
  calibrate.startLearning();
});
