// The morning briefing in the browser: the rider's settings (on/off, time, mode; localStorage), whether this browser
// can do Web Push at all, and keeping the server's copy of the subscription in step with the spots and the primary
// model. The server (server/briefing.mjs) writes and sends the briefing; the panel (home/BriefingPanel.tsx) drives this.
import { useEffect, useSyncExternalStore } from "react";
import type { BriefingMode } from "./briefing";
import { usePrimaryModel, useSpots } from "./data";
import type { Model, Spot } from "./wind";

export type BriefingSettings = { on: boolean; time: string; mode: BriefingMode };

const KEY = "morningBriefing";
export const DEFAULT_BRIEFING: BriefingSettings = { on: false, time: "07:00", mode: "daily" };
/** The server keeps at most this many spots per rider (the first ones on the board). */
export const BRIEFING_MAX_SPOTS = 12;

let settings: BriefingSettings = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (s && typeof s === "object") {
      return {
        on: s.on === true,
        time: typeof s.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) ? s.time : DEFAULT_BRIEFING.time,
        mode: s.mode === "windy" ? "windy" : "daily",
      };
    }
  } catch { /* storage unavailable or corrupt */ }
  return DEFAULT_BRIEFING;
})();
const listeners = new Set<() => void>();

export function setBriefing(patch: Partial<BriefingSettings>) {
  settings = { ...settings, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}
export const useBriefingSettings = () =>
  useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => settings);

/* ---------- What this browser can do ---------- */

export type PushSupport = "ok" | "ios-install" | "unsupported";

/** iPhone and iPad only get Web Push from a Home Screen app; everything else needs a service worker and PushManager. */
export function pushSupport(): PushSupport {
  const nav = navigator as Navigator & { standalone?: boolean };
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  const standalone = nav.standalone === true || (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches);
  if (ios && !standalone) return "ios-install";
  if (!("serviceWorker" in nav) || typeof window.PushManager === "undefined" || typeof window.Notification === "undefined") return "unsupported";
  return "ok";
}

export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/* ---------- The server ---------- */

export class BriefingError extends Error {}

const spotPayload = (spots: Spot[]) => spots.slice(0, BRIEFING_MAX_SPOTS).map((s) => ({
  id: s.id, name: s.name.slice(0, 80), lat: s.lat, lon: s.lon, min: s.min, max: s.max,
  ...(s.dirC != null ? { dirC: s.dirC } : null), ...(s.dirW != null ? { dirW: s.dirW } : null), ...(s.station ? { station: s.station } : null),
}));

async function post(path: string, body: unknown) {
  let r: Response;
  try { r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw new BriefingError("Couldn't reach SeaSensei. Check your connection and try again."); }
  if (r.ok) return r.json().catch(() => ({}));
  const error = await r.json().then((j) => j?.error).catch(() => null);
  if (error === "full" || r.status === 503) throw new BriefingError("Morning briefings aren't available right now. Try again later.");
  if (r.status === 429) throw new BriefingError("Too many changes at once. Try again in a few minutes.");
  throw new BriefingError("SeaSensei couldn't save your briefing. Try again later.");
}

async function registration() {
  // Idempotent: the app registers /sw.js after load in production; this also covers a tap before that.
  return navigator.serviceWorker.register("/sw.js");
}

const keyBytes = (b64url: string) => {
  const s = atob(b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "="));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

// What the server last got from this tab (spots, model, time, mode); null until the first sync of this app load.
let synced: string | null = null;
const sigOf = (spots: Spot[], model: Model, s: BriefingSettings) => JSON.stringify([spotPayload(spots), model, s.time, s.mode]);

function subscribeBody(sub: PushSubscription, spots: Spot[], model: Model, s: BriefingSettings) {
  return { subscription: sub.toJSON(), spots: spotPayload(spots), time: s.time, timeZone: deviceTimeZone(), mode: s.mode, model };
}

/**
 * Turn it on: ask for permission (call this straight from the tap), subscribe this browser with our key, and send the
 * server the spots, time, zone, mode and model. Throws a BriefingError with words for the rider.
 */
export async function turnOn(spots: Spot[], model: Model, s: BriefingSettings) {
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") {
    throw new BriefingError(permission === "denied"
      ? "Notifications are blocked for SeaSensei. Allow them in your browser's settings for this site, then try again."
      : "SeaSensei needs permission to send notifications for this.");
  }
  if (!spots.length) throw new BriefingError("Add a spot first: the briefing is about your spots.");
  let key: string;
  try {
    const r = await fetch("/api/push/key");
    if (!r.ok) throw new Error();
    key = (await r.json()).publicKey;
  } catch { throw new BriefingError("Morning briefings aren't available right now. Try again later."); }
  const reg = await registration();
  const want = keyBytes(key);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, want)) { await sub.unsubscribe().catch(() => {}); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  await post("/api/push/subscribe", subscribeBody(sub, spots, model, s));
  synced = sigOf(spots, model, s);
  setBriefing({ ...s, on: true });
}

/** Turn it off: the server forgets this browser, and the browser drops the subscription. */
export async function turnOff() {
  const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (sub) {
    await post("/api/push/unsubscribe", { endpoint: sub.endpoint });
    await sub.unsubscribe().catch(() => {});
  }
  synced = null;
  setBriefing({ on: false });
}

/**
 * While it's on, keep the server's copy in step: the spots (added, edited, deleted), the primary model, the time and
 * mode, re-sent a moment after the last change (and once per app load, so a lost copy comes back). If the browser
 * no longer has a subscription (the rider revoked permission) it's switched off here too.
 */
export function useBriefingSync() {
  const s = useBriefingSettings();
  const spots = useSpots();
  const model = usePrimaryModel();
  useEffect(() => {
    if (!s.on || pushSupport() !== "ok") return;
    const sig = sigOf(spots, model, s);
    if (sig === synced) return;
    const timer = setTimeout(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (!sub || Notification.permission !== "granted") { setBriefing({ on: false }); return; }
        if (!spots.length) await post("/api/push/unsubscribe", { endpoint: sub.endpoint });
        else await post("/api/push/subscribe", subscribeBody(sub, spots, model, s));
        synced = sig;
      } catch { /* tried again on the next change or app load */ }
    }, 1500);
    return () => clearTimeout(timer);
  }, [s, spots, model]);
}
