// Web Push for the morning briefing: the VAPID keys, the subscriptions, their validation, and sending one push.
// Stored in R2 when it's configured (push/v1/…, durable across redeploys), else under DATA_DIR/push. Keys come from
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY when both are set; otherwise they're generated once and kept in the store.
// The private key is never logged or served.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import webpush from "web-push";
import * as r2 from "./r2.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = () => path.resolve(process.env.DATA_DIR ?? path.join(here, "..", "data"), "push");
const KEYS_KEY = "push/v1/vapid.json";
const SUBS_PREFIX = "push/v1/subs/";
export const MAX_SUBS = () => Number(process.env.PUSH_MAX_SUBSCRIPTIONS ?? 2000);
export const MAX_SPOTS = 12;
const SUBJECT = () => process.env.VAPID_SUBJECT || "https://seasensei.com";

/* ---------------- the store: R2, or files under DATA_DIR ---------------- */

const useR2 = () => r2.configured();

async function readDoc(key) {
  if (useR2()) { const b = await r2.get(key); return b ? JSON.parse(b.toString()) : null; }
  try { return JSON.parse(fs.readFileSync(path.join(dataRoot(), key.replace(/^push\/v1\//, "")), "utf8")); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
}

async function writeDoc(key, doc, { create = false } = {}) {
  const body = JSON.stringify(doc);
  if (useR2()) return r2.put(key, body, "application/json", create ? { "If-None-Match": "*" } : undefined);
  const file = path.join(dataRoot(), key.replace(/^push\/v1\//, ""));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (create && fs.existsSync(file)) throw new Error("exists");
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

async function removeDoc(key) {
  if (useR2()) return r2.del(key);
  fs.rmSync(path.join(dataRoot(), key.replace(/^push\/v1\//, "")), { force: true });
}

async function listIds() {
  if (useR2()) return (await r2.list(SUBS_PREFIX)).map((k) => k.slice(SUBS_PREFIX.length).replace(/\.json$/, "")).filter((id) => /^[0-9a-f]{64}$/.test(id));
  try { return fs.readdirSync(path.join(dataRoot(), "subs")).filter((n) => /^[0-9a-f]{64}\.json$/.test(n)).map((n) => n.slice(0, 64)); }
  catch { return []; }
}

/* ---------------- VAPID keys ---------------- */

let keys = null;          // { publicKey, privateKey }
let keysError = null;

const validKeys = (k) => k && typeof k.publicKey === "string" && typeof k.privateKey === "string"
  && Buffer.from(k.publicKey, "base64url").length === 65 && Buffer.from(k.privateKey, "base64url").length === 32;

/**
 * The keys, loaded (or made) once. A read failure leaves push off until the next try: making new keys then would
 * orphan every subscription, so new ones are made only when the store says there are none.
 */
export async function loadKeys() {
  if (keys) return keys;
  try {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      const k = { publicKey: process.env.VAPID_PUBLIC_KEY.trim(), privateKey: process.env.VAPID_PRIVATE_KEY.trim() };
      if (!validKeys(k)) throw new Error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not a valid P-256 key pair (base64url)");
      keys = k;
    } else {
      let k = await readDoc(KEYS_KEY);
      if (!k) {
        const made = { ...webpush.generateVAPIDKeys(), created: new Date().toISOString() };
        // Two containers during a deploy could both get here: only the first write lands, the other reads it back.
        try { await writeDoc(KEYS_KEY, made, { create: true }); k = made; console.log(`[push] made new VAPID keys, saved to ${useR2() ? `R2 ${KEYS_KEY}` : "DATA_DIR/push/vapid.json"}`); }
        catch { k = await readDoc(KEYS_KEY); }
      }
      if (!validKeys(k)) throw new Error("stored VAPID keys are unreadable");
      keys = { publicKey: k.publicKey, privateKey: k.privateKey };
    }
    keysError = null;
    return keys;
  } catch (e) {
    keysError = e.message;
    console.error(`[push] VAPID keys unavailable: ${e.message}`);
    return null;
  }
}
export const publicKey = () => keys?.publicKey ?? null;
export const keysStatus = () => ({ ready: !!keys, source: keys ? (process.env.VAPID_PUBLIC_KEY ? "env" : useR2() ? "r2" : "data_dir") : null, error: keysError });

/* ---------------- validation ---------------- */

// The push services browsers use. Anything else is refused: the server POSTs to whatever endpoint it's given.
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
const b64len = (s, n) => typeof s === "string" && s.length < 200 && /^[A-Za-z0-9_-]+={0,2}$/.test(s) && Buffer.from(s, "base64url").length === n;
const isNum = (x, lo, hi) => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
const isText = (s, max, re) => typeof s === "string" && s.length > 0 && s.length <= max && (!re || re.test(s));

export function endpointOk(endpoint) {
  if (!isText(endpoint, 1024)) return false;
  // Tests only: a stand-in push service (an http:// URL on localhost) the real list would refuse.
  const test = process.env.PUSH_TEST_ENDPOINT_PREFIX;
  if (test && endpoint.startsWith(test)) return true;
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  return u.protocol === "https:" && !u.username && !u.password && (u.port === "" || u.port === "443") && PUSH_HOSTS.some((re) => re.test(u.hostname));
}

export function zoneOk(tz) {
  if (!isText(tz, 64, /^[A-Za-z0-9_+\-/]+$/)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** A subscribe request → { sub } or { error }. `models` is the list of primary models the app knows. */
export function parseSubscribe(body, models) {
  const s = body?.subscription;
  if (!s || !endpointOk(s.endpoint)) return { error: "bad_endpoint" };
  if (!b64len(s.keys?.p256dh, 65) || !b64len(s.keys?.auth, 16)) return { error: "bad_keys" };
  if (!Array.isArray(body.spots) || body.spots.length < 1 || body.spots.length > MAX_SPOTS) return { error: "bad_spots" };
  const spots = [];
  for (const x of body.spots) {
    const ok = x && isText(x.id, 64, /^[\w.:-]+$/) && isText(x.name, 80) && isNum(x.lat, -90, 90) && isNum(x.lon, -180, 180)
      && isNum(x.min, 0, 80) && isNum(x.max, 0, 100) && x.max >= x.min
      && (x.dirC == null || isNum(x.dirC, 0, 360)) && (x.dirW == null || isNum(x.dirW, 0, 360))
      && (x.station == null || isText(x.station, 32, /^[\w.:-]+$/));
    if (!ok) return { error: "bad_spots" };
    spots.push({
      id: x.id, name: x.name.replace(/[\u0000-\u001f]/g, " ").trim() || "Spot", lat: x.lat, lon: x.lon, min: x.min, max: x.max,
      ...(x.dirC != null ? { dirC: x.dirC } : null), ...(x.dirW != null ? { dirW: x.dirW } : null), ...(x.station != null ? { station: x.station } : null),
    });
  }
  if (typeof body.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) return { error: "bad_time" };
  if (!zoneOk(body.timeZone)) return { error: "bad_zone" };
  const mode = body.mode ?? "daily";
  if (mode !== "daily" && mode !== "windy") return { error: "bad_mode" };
  const model = body.model ?? "sensei";
  if (!models.includes(model)) return { error: "bad_model" };
  return {
    sub: {
      subscription: { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } },
      spots, time: body.time, timeZone: body.timeZone, mode, model,
    },
  };
}

/* ---------------- subscriptions (in memory, written through to the store) ---------------- */

export const idOf = (endpoint) => crypto.createHash("sha256").update(endpoint).digest("hex");
const subs = new Map(); // id → subscription record
let loaded = null;      // the load promise, while it's in flight or done

/** Read every saved subscription once (again after a failure). */
export function load() {
  loaded ??= (async () => {
    const ids = await listIds();
    for (const id of ids) {
      if (subs.has(id)) continue;
      const doc = await readDoc(`${SUBS_PREFIX}${id}.json`).catch((e) => (console.error(`[push] couldn't read a subscription: ${e.message}`), null));
      if (doc?.subscription?.endpoint && idOf(doc.subscription.endpoint) === id) subs.set(id, doc);
    }
    console.log(`[push] ${subs.size} briefing subscription${subs.size === 1 ? "" : "s"} loaded`);
  })().catch((e) => { loaded = null; throw e; });
  return loaded;
}

export const all = () => [...subs.values()];
export const count = () => subs.size;
export const get = (id) => subs.get(id) ?? null;

/** Insert or update by endpoint; keeps what was sent already today. Returns { status: "created" | "updated" | "full" }. */
export async function upsert(sub) {
  await load();
  const id = idOf(sub.subscription.endpoint);
  const prev = subs.get(id);
  if (!prev && subs.size >= MAX_SUBS()) return { status: "full" };
  const now = new Date().toISOString();
  const doc = { ...sub, id, created: prev?.created ?? now, updated: now, lastSentDate: prev?.lastSentDate ?? null, lastResult: prev?.lastResult ?? null };
  await writeDoc(`${SUBS_PREFIX}${id}.json`, doc);
  subs.set(id, doc);
  return { status: prev ? "updated" : "created", id };
}

/** Record what happened (lastSentDate, lastResult) on the subscription as it is now; one removed meanwhile stays removed. */
export async function mark(id, patch) {
  const cur = subs.get(id);
  if (!cur) return;
  const doc = { ...cur, ...patch };
  subs.set(id, doc);
  await writeDoc(`${SUBS_PREFIX}${id}.json`, doc);
}

export async function remove(id) {
  await load();
  const had = subs.delete(id);
  await removeDoc(`${SUBS_PREFIX}${id}.json`);
  return had;
}

/* ---------------- sending ---------------- */

/**
 * One push, encrypted for the subscription and signed with our VAPID key (web-push builds the request; Node's fetch
 * sends it). Resolves to the push service's HTTP status; throws only when it can't be reached.
 */
export async function send(sub, payload, { ttl = 3 * 3600, topic = "morning-briefing" } = {}) {
  if (!keys) throw new Error("push keys unavailable");
  const req = webpush.generateRequestDetails(sub.subscription, JSON.stringify(payload), {
    TTL: ttl, urgency: "normal", topic,
    vapidDetails: { subject: SUBJECT(), publicKey: keys.publicKey, privateKey: keys.privateKey },
  });
  const headers = { ...req.headers };
  delete headers["Content-Length"];
  const r = await fetch(req.endpoint, { method: "POST", headers, body: req.body, signal: AbortSignal.timeout(20_000), redirect: "error" });
  await r.arrayBuffer().catch(() => {});
  return r.status;
}
