// SeaSensei's server: the built app (dist/) plus POST /api/outlook. No framework; Node core only,
// apart from the Anthropic SDK used in outlook.mjs.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { cacheKey, configured, generateOutlook, validateSpots } from "./outlook.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(process.env.DIST_DIR ?? path.join(here, "..", "dist"));
const PORT = Number(process.env.PORT ?? 80);

// Spend guards for a public endpoint. Only fresh generations count; cache hits are free.
const DAILY_CAP = Number(process.env.OUTLOOK_DAILY_CAP ?? 40);
const PER_IP_CAP = Number(process.env.OUTLOOK_PER_IP_CAP ?? 8);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".mjs": "application/javascript",
  ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain",
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
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

/* ---------------- outlook: cache, de-dupe, caps ---------------- */

const cache = new Map();    // key -> { at, outlook }
const inflight = new Map(); // key -> Promise
let day = "", total = 0;
const perIp = new Map();

function underCaps(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; total = 0; perIp.clear(); }
  if (total >= DAILY_CAP) return "The outlook has hit today's limit. It refreshes tomorrow.";
  if ((perIp.get(ip) ?? 0) >= PER_IP_CAP) return "You've generated a lot of outlooks today. Try again tomorrow.";
  return null;
}

async function readBody(req, limit = 16_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new Error("request too large"); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function handleOutlook(req, res) {
  if (!configured()) return sendJson(res, 503, { error: "not_configured", message: "The AI outlook isn't set up on this server yet." });
  let spots;
  try { spots = validateSpots(await readBody(req)); } catch (e) { return sendJson(res, 422, { error: "bad_request", message: e.message }); }

  const key = cacheKey(spots);
  const hit = cache.get(key);
  if (hit) return sendJson(res, 200, { ...hit.outlook, cached: true });

  if (!inflight.has(key)) {
    const ip = String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "?");
    const blocked = underCaps(ip);
    if (blocked) return sendJson(res, 429, { error: "limit", message: blocked });
    total++; perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    const p = generateOutlook(spots)
      .then((outlook) => {
        cache.set(key, { at: Date.now(), outlook });
        for (const [k] of cache) if (!k.startsWith(key.split(":")[0] + ":")) cache.delete(k); // drop earlier 3-h slots
        console.log(`[outlook] ${spots.length} spots, ${outlook.usage.input} in / ${outlook.usage.output} out tokens, ${total}/${DAILY_CAP} today`);
        return outlook;
      })
      .catch((e) => { total--; perIp.set(ip, Math.max(0, (perIp.get(ip) ?? 1) - 1)); throw e; }) // failures don't use up the allowance
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }

  try {
    sendJson(res, 200, { ...(await inflight.get(key) ?? cache.get(key)?.outlook), cached: false });
  } catch (e) {
    // Most specific first; never string-match messages.
    if (e instanceof Anthropic.AuthenticationError) { console.error("[outlook] bad API key"); return sendJson(res, 503, { error: "not_configured", message: "The AI outlook isn't configured correctly." }); }
    if (e instanceof Anthropic.RateLimitError) return sendJson(res, 503, { error: "busy", message: "The forecaster is busy. Try again in a minute." });
    if (e instanceof Anthropic.APIError) { console.error(`[outlook] API ${e.status}: ${e.message}`); return sendJson(res, 502, { error: "upstream", message: "The forecaster had a problem. Try again shortly." }); }
    console.error("[outlook]", e);
    return sendJson(res, 502, { error: "failed", message: e.message ?? "Couldn't write the outlook." });
  }
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (url === "/healthz") { res.writeHead(200); return res.end("ok"); }
  if (url.startsWith("/api/outlook")) {
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }); return res.end(); }
    return handleOutlook(req, res);
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  serveStatic(req, res);
});

server.listen(PORT, () => console.log(`seasensei on :${PORT} · dist=${DIST} · outlook ${configured() ? "enabled" : "disabled (no ANTHROPIC_API_KEY)"} · caps ${DAILY_CAP}/day, ${PER_IP_CAP}/ip`));
