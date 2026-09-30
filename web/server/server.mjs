// SeaSensei's server: the built app (dist/), the daily wind discussion (JSON API, archive, RSS) and the
// scheduler that writes it. No framework; Node core only, plus the Anthropic SDK in discussion.mjs.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { configured } from "./discussion.mjs";
import { describeError, publish, startScheduler, status } from "./publish.mjs";
import * as store from "./store.mjs";

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

function sendJson(res, status, body, cache = "no-store") {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": cache });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(DIST, urlPath);
  if (!file.startsWith(DIST + path.sep) && file !== DIST) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html"); // SPA fallback
  const ext = path.extname(file);
  const immutable = urlPath.startsWith("/assets/") || urlPath.startsWith("/maplibre/");
  res.writeHead(200, {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  fs.createReadStream(file).pipe(res);
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

const server = http.createServer((req, res) => {
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
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`seasensei on :${PORT} · dist=${DIST} · discussion ${configured() ? `enabled, publishes ${status().publishHour}:00 ${status().timeZone}` : "disabled (no ANTHROPIC_API_KEY)"} · admin ${ADMIN_TOKEN ? "on" : "off"}`);
  startScheduler();
});
