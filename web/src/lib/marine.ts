// Marine alerts from the National Weather Service, pure (no React): parsed here for the app (alerts.ts) and for
// the server's morning briefing (bundled by scripts/build-engine.mjs).

/**
 * Active National Weather Service alerts that matter on the water, for the area around the rider's spots.
 * Read straight from api.weather.gov (public, no key, CORS open; the browser sends nothing that identifies the rider).
 * Marine zones and the land beside them are separate NWS zones, so two points are asked: the middle of the spots
 * (over the bay, for a set of spots around one) and the first spot itself. Any failure is silent: no alert, no error.
 */
export type MarineAlert = {
  id: string;
  /** "Small Craft Advisory" */
  event: string;
  /** The forecaster's one-line summary when there is one, else the NWS headline. */
  headline: string;
  /** What, where, when, impacts. Plain text with blank lines between paragraphs. */
  description: string;
  /** What to do, when given. */
  instruction: string;
  /** "Tampa Bay waters; Coastal waters from …" */
  area: string;
  /** When it stops applying (ms), or null if the product doesn't say. */
  ends: number | null;
  /** 0 = warning, 1 = watch, 2 = advisory, 3 = statement. */
  rank: number;
};

// Small Craft Advisory, Gale / Storm / Hurricane Force Wind, Special Marine Warning, Marine Weather Statement,
// rip currents (also carried by Beach Hazards and High Surf), tropical products, fog over water, waterspouts.
const MARINE = /small craft|gale|storm (warning|watch)|hurricane|tropical|typhoon|special marine|marine weather|rip current|beach hazards|high surf|hazardous seas|dense fog|waterspout/i;

const rankOf = (event: string) => (/warning/i.test(event) ? 0 : /watch/i.test(event) ? 1 : /advisory/i.test(event) ? 2 : 3);
const time = (v: unknown) => { const t = typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
/** NWS hard-wraps its text at ~70 columns: join the lines of each paragraph, keep the paragraph breaks. */
const unwrap = (s: string) => s.replace(/\r/g, "").split(/\n{2,}/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean).join("\n\n");

/** The marine-relevant, still-active alerts in one api.weather.gov response (GeoJSON), most serious first. */
export function parseAlerts(json: unknown, now = Date.now()): MarineAlert[] {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: MarineAlert[] = [];
  for (const f of features) {
    const p = (f as { properties?: Record<string, unknown> })?.properties;
    if (!p) continue;
    const event = text(p.event);
    if (!MARINE.test(event) || p.status !== "Actual" || p.messageType === "Cancel") continue;
    const ends = time(p.ends) ?? time(p.expires);
    if (ends != null && ends <= now) continue;
    const summary = (p.parameters as { NWSheadline?: unknown[] } | undefined)?.NWSheadline?.[0];
    out.push({
      id: text(p.id) || `${event}:${ends}`, event, headline: unwrap(text(summary)) || text(p.headline) || event,
      description: unwrap(text(p.description)), instruction: unwrap(text(p.instruction)), area: text(p.areaDesc), ends, rank: rankOf(event),
    });
  }
  return sortAlerts(out);
}

/** Most serious first, then the one ending soonest; one entry per alert id, and one per event name and end time. */
export function sortAlerts(list: MarineAlert[]) {
  const seen = new Set<string>();
  return list
    .filter((a) => { const k = `${a.event}|${a.ends}`; if (seen.has(a.id) || seen.has(k)) return false; seen.add(a.id); seen.add(k); return true; })
    .sort((a, b) => a.rank - b.rank || (a.ends ?? Infinity) - (b.ends ?? Infinity));
}

export const alertsUrl = (lat: number, lon: number, base = "https://api.weather.gov") => `${base}/alerts/active?point=${lat.toFixed(3)},${lon.toFixed(3)}`;

/** "Until 7 PM", "Until Thu 7 PM" (another day), in the spots' time zone. */
export function fmtUntil(ends: number, tz: string, now = Date.now()) {
  const day = (t: number) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(t);
  const d = new Date(ends);
  const hm = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", ...(d.getUTCMinutes() ? { minute: "2-digit" } : {}) }).format(d);
  const sameDay = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now) === new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  return `Until ${sameDay ? "" : `${day(ends)} `}${hm}`;
}
