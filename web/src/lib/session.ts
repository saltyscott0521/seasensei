// The session engine: daylight, rideable sessions, a verdict per spot, ranking, and how much the models agree.
// Pure like wind.ts: no DOM, no fetch, no React.
import { agreement, compass, inArc, isRideable, MODEL_INFO, type Hour, type Model, type ModelCompare, type Spot, type Window } from "./wind";

const HOUR = 3600e3, DAY = 864e5, RAD = Math.PI / 180;

/* ---------- The sun (NOAA solar calculator: Meeus' low-precision equations, good to well under a minute) ---------- */

/** Declination (radians) and the equation of time (minutes) at ms epoch t. */
function solar(t: number) {
  const T = (t / DAY + 2440587.5 - 2451545) / 36525; // Julian centuries since J2000
  const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360; // geometric mean longitude
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T); // mean anomaly
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD); // apparent longitude
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega * RAD);
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  return { decl: Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)), eqTime };
}

const sunCache = new Map<string, { sunrise: number; sunset: number }>();

/**
 * Sunrise and sunset (ms epoch) on the day `t` falls in at (lat, lon) — the local solar day, so no time zone is
 * needed. Upper limb on the horizon with standard refraction (90.833°), as NOAA and almanacs quote it.
 * Polar day gives a 24 h day around solar noon; polar night gives sunrise = sunset = solar noon.
 */
export function sunTimes(lat: number, lon: number, t: number): { sunrise: number; sunset: number } {
  const day = Math.floor((t + (lon / 360) * DAY) / DAY); // local solar date (days since 1970-01-01)
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${day}`;
  const hit = sunCache.get(key);
  if (hit) return hit;
  const midnight = day * DAY; // 00:00 UTC of that date; solar noon is ~720 − 4·lon minutes after it
  const event = (sign: 1 | -1) => {
    let m = 720 - 4 * lon + sign * 360;
    for (let i = 0; i < 3; i++) { // evaluate the sun at the event itself, not at noon
      const { decl, eqTime } = solar(midnight + m * 60e3);
      const cosH = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl);
      m = 720 - 4 * lon - eqTime + sign * 4 * (Math.acos(Math.min(1, Math.max(-1, cosH))) / RAD);
    }
    return Math.round(midnight + m * 60e3);
  };
  const out = { sunrise: event(-1), sunset: event(1) };
  if (sunCache.size > 2000) sunCache.clear();
  sunCache.set(key, out);
  return out;
}

/** Is the sun up at this instant? */
export function isDaylight(lat: number, lon: number, t: number) {
  const s = sunTimes(lat, lon, t);
  return t >= s.sunrise && t < s.sunset;
}

/** Is the sun up for the whole forecast hour [t, t + 1 h)? Sessions only count these, so none starts before sunrise or ends after sunset. */
export function isDaylightHour(lat: number, lon: number, t: number) {
  const s = sunTimes(lat, lon, t);
  return t >= s.sunrise && t + HOUR <= s.sunset;
}

/** Which side of the night t is on, in words: "before sunrise" in the morning, "after dark" in the evening (split at solar noon). */
export function darkWord(lat: number, lon: number, t: number) {
  const s = sunTimes(lat, lon, t);
  return t < (s.sunrise + s.sunset) / 2 ? "before sunrise" : "after dark";
}

/* ---------- Sessions ---------- */

/** A run of rideable daylight hours. `start`/`end` are the first/last hour's t, like Window (it ends at end + 1 h). */
export type Session = Window & {
  hours: Hour[];
  /** max sustained, kn */ peak: number;
  /** max gust, kn */ peakGust: number;
  /** mean sustained, kn */ avg: number;
  /** circular mean direction (FROM, degrees) */ dir: number;
  /** gust − speed ≥ 10 kn in any hour, or gust ≥ 1.5 × speed at the peak */ gusty: boolean;
  /** model of the first hour */ model: Model;
  /** any hour from NBM */ lowConfidence: boolean;
};

export type SessionSpot = Pick<Spot, "lat" | "lon" | "min" | "max" | "dirC" | "dirW">;

/** Circular mean of directions (degrees), so 350° and 10° give 0°, not 180°. */
export function meanDir(dirs: number[]) {
  const u = dirs.reduce((a, d) => a + Math.sin(d * RAD), 0), v = dirs.reduce((a, d) => a + Math.cos(d * RAD), 0);
  return (Math.atan2(u, v) / RAD + 360) % 360;
}

function toSession(hs: Hour[]): Session {
  const peakH = hs.reduce((a, h) => (h.speed > a.speed ? h : a));
  return {
    start: hs[0].t, end: hs[hs.length - 1].t, hours: hs,
    peak: peakH.speed,
    peakGust: Math.max(...hs.map((h) => h.gust)),
    avg: hs.reduce((a, h) => a + h.speed, 0) / hs.length,
    dir: meanDir(hs.map((h) => h.dir)),
    gusty: hs.some((h) => h.gust - h.speed >= 10) || peakH.gust >= 1.5 * peakH.speed,
    model: hs[0].model,
    lowConfidence: hs.some((h) => h.model === "nbm"),
  };
}

/**
 * Rideable sessions: hours with sustained wind in range AND from a workable direction AND in daylight, merged when
 * contiguous, kept when at least `minHours` long. Runs are judged whole; `from` then drops the ones already over
 * (a session in progress keeps its real start).
 */
export function sessions(hours: Hour[], spot: SessionSpot, { from, minHours = 2 }: { from?: number; minHours?: number } = {}): Session[] {
  const runs: Hour[][] = [];
  let cur: Hour[] | null = null;
  for (const h of hours) {
    if (!(isRideable(h, spot) && isDaylightHour(spot.lat, spot.lon, h.t))) { cur = null; continue; }
    if (cur && h.t - cur[cur.length - 1].t <= HOUR) cur.push(h);
    else runs.push((cur = [h]));
  }
  return runs.filter((r) => r.length >= minHours).map(toSession).filter((s) => from == null || s.end + HOUR > from);
}

/* ---------- Copy (en-US, in the spot's forecast time zone) ---------- */

const fmts = new Map<string, Intl.DateTimeFormat>();
const fmt = (tz: string, o: Intl.DateTimeFormatOptions) => {
  const k = tz + JSON.stringify(o);
  let f = fmts.get(k);
  if (!f) fmts.set(k, (f = new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o })));
  return f;
};
// Newer ICU puts a narrow no-break space before AM/PM; keep the copy a plain space so it reads and matches predictably.
const plain = (s: string) => s.replace(/\u202f/g, " ");

/** "1 PM" */
export const fmtHour = (t: number, tz: string) => plain(fmt(tz, { hour: "numeric" }).format(t));
/** "6:52 AM" */
export const fmtClock = (t: number, tz: string) => plain(fmt(tz, { hour: "numeric", minute: "2-digit" }).format(t));
/** "Sat" */
export const fmtWeekday = (t: number, tz: string) => fmt(tz, { weekday: "short" }).format(t);
/** Same calendar day in tz? */
export const sameDay = (a: number, b: number, tz: string) => {
  const f = fmt(tz, { year: "numeric", month: "numeric", day: "numeric" });
  return f.format(a) === f.format(b);
};
/** "Today" or "Sat". */
export const fmtDay = (t: number, tz: string, now = Date.now()) => (sameDay(t, now, tz) ? "Today" : fmtWeekday(t, tz));

/** A span of clock hours, end exclusive: "1–5 PM", "11 AM–4 PM". */
export function fmtSpan(start: number, end: number, tz: string) {
  const a = fmtHour(start, tz), b = fmtHour(end, tz);
  const [ah, am] = a.split(" "), bm = b.split(" ")[1];
  return am && am === bm ? `${ah}–${b}` : `${a}–${b}`;
}

/** A window or session as a chip: "Today 1–5 PM", "Sat 11 AM–4 PM"; one that runs past midnight names both days. */
export function fmtWindow(w: Window, tz: string, now = Date.now()) {
  const end = w.end + HOUR;
  return sameDay(w.start, end, tz)
    ? `${fmtDay(w.start, tz, now)} ${fmtSpan(w.start, end, tz)}`
    : `${fmtDay(w.start, tz, now)} ${fmtHour(w.start, tz)} – ${fmtDay(end, tz, now)} ${fmtHour(end, tz)}`;
}

/** "18–22 kn SW": mean to peak sustained, and the mean direction. */
export function fmtStrength(s: Pick<Session, "avg" | "peak" | "dir">) {
  const lo = Math.round(s.avg), hi = Math.round(s.peak);
  return `${lo === hi ? hi : `${lo}–${hi}`} kn ${compass(s.dir)}`;
}

/** "Today 1–5 PM · 18–22 kn SW" */
export const fmtSession = (s: Session, tz: string, now = Date.now()) => `${fmtWindow(s, tz, now)} · ${fmtStrength(s)}`;

/** "just now", "4 min ago", "2 h ago" */
export function ago(t: number, now = Date.now()) {
  const m = Math.max(0, Math.round((now - t) / 60_000));
  return m < 1 ? "just now" : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** Distances are never truncated: "0.5 km", "14 km". */
export const fmtKm = (km: number) => `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;

/* ---------- The verdict: am I kiting, when, how strong ---------- */

export type VerdictState = "on" | "today" | "upcoming" | "none";
export type Verdict = {
  state: VerdictState;
  /** "On now" · "On at 1 PM" · "Next: Sat 11 AM" · "No session this week" */
  label: string;
  /** "till 4 PM · 18–22 kn SW" · "1–5 PM · 18–22 kn SW" · "11 AM–4 PM · 17–21 kn SW" · "best Tue 13 kn" */
  detail: string;
  /** The session the verdict is about (null for "none"). */
  session: Session | null;
  /** The strongest daylight hour from now on, any direction (what "none" quotes). */
  best: Hour | null;
  /**
   * How close the spot gets to rideable: knots between its range and the nearest daylight hour from a workable
   * direction (0 = in range, just never for 2 h; Infinity = never from a workable direction). "none" ranks by it,
   * so a spot that is only ever too strong is never featured as the best of a quiet week.
   */
  gap: number;
};

/**
 * One line per spot. `list` is its sessions (chronological, e.g. from `sessions()`); `hours` the whole forecast.
 * on = now inside a session; today = one starts later today; upcoming = a later day; none = no session in the forecast.
 */
export function verdict(spot: SessionSpot, hours: Hour[], list: Session[], now: number, timeZone: string): Verdict {
  const day = hours.filter((h) => h.t + HOUR > now && isDaylightHour(spot.lat, spot.lon, h.t));
  const best = day.reduce<Hour | null>((b, h) => (!b || h.speed > b.speed ? h : b), null);
  const gap = day.reduce((g, h) => (inArc(h.dir, spot) ? Math.min(g, Math.max(0, spot.min - h.speed, h.speed - spot.max)) : g), Infinity);
  const tz = timeZone;
  const cur = list.find((s) => s.start <= now && now < s.end + HOUR);
  if (cur) return { state: "on", label: "On now", detail: `till ${fmtHour(cur.end + HOUR, tz)} · ${fmtStrength(cur)}`, session: cur, best, gap: 0 };
  const next = list.find((s) => s.start > now);
  if (next) {
    const today = sameDay(next.start, now, tz);
    return {
      state: today ? "today" : "upcoming",
      label: today ? `On at ${fmtHour(next.start, tz)}` : `Next: ${fmtWeekday(next.start, tz)} ${fmtHour(next.start, tz)}`,
      detail: `${fmtSpan(next.start, next.end + HOUR, tz)} · ${fmtStrength(next)}`,
      session: next, best, gap: 0,
    };
  }
  return {
    state: "none", label: "No session this week",
    detail: best ? `best ${sameDay(best.t, now, tz) ? "today" : fmtWeekday(best.t, tz)} ${Math.round(best.speed)} kn` : "",
    session: null, best, gap,
  };
}

/** What a verdict pill says about now: the engine's states, or "strong" when the wind right now is over the range. */
export type NowVerdict = { state: VerdictState | "strong"; label: string; detail: string };

/**
 * The verdict as the card and hero show it: the session engine's, except that wind over the spot's max right now (the
 * live reading, else the model's hour: the map marker's rule) reads "Too strong now", whatever the forecast says. The
 * forecast's answer moves into the detail ("forecast till 5 PM · 21–24 kn SW", "On at 1 PM · 1–5 PM · 18–22 kn SW").
 */
export function nowVerdict(v: Verdict, nowSpeed: number | null | undefined, spot: Pick<SessionSpot, "max">, detail = v.detail): NowVerdict {
  if (nowSpeed == null || !(nowSpeed > spot.max)) return { state: v.state, label: v.label, detail };
  const said = v.state === "on" ? `forecast ${detail}` : v.state === "none" ? detail : [v.label, detail].filter(Boolean).join(" · ");
  return { state: "strong", label: "Too strong now", detail: said };
}

const ORDER: Record<VerdictState, number> = { on: 0, today: 1, upcoming: 2, none: 3 };
const span = (s: Session | null) => (s ? s.end - s.start : 0);

/**
 * Best spot first: on (most time left) → today (earliest start, then longer) → upcoming (soonest) → none (closest to
 * rideable: the smallest gap between the range and a daylight hour from a workable direction, then the stronger).
 * Rows without a verdict yet go last. Stable, and returns a new array.
 */
export function rankSpots<T extends { verdict: Verdict | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const va = a.verdict, vb = b.verdict;
    if (!va || !vb) return (va ? 0 : 1) - (vb ? 0 : 1);
    if (va.state !== vb.state) return ORDER[va.state] - ORDER[vb.state];
    const sa = va.session, sb = vb.session;
    if (va.state === "on") return (sb?.end ?? 0) - (sa?.end ?? 0);
    if (va.state === "today") return (sa?.start ?? 0) - (sb?.start ?? 0) || span(sb) - span(sa);
    if (va.state === "upcoming") return (sa?.start ?? 0) - (sb?.start ?? 0);
    const ga = va.gap ?? Infinity, gb = vb.gap ?? Infinity;
    if (ga !== gb) return ga === Infinity ? 1 : gb === Infinity ? -1 : ga - gb;
    return (vb.best?.speed ?? -1) - (va.best?.speed ?? -1);
  });
}

/* ---------- Confidence: do the models agree? ---------- */

export type Confidence = {
  level: "high" | "mid" | "low";
  /** "Models agree · 3 kn spread" · "Some disagreement · 5 kn spread" · "Models disagree · 8 kn spread" */
  label: string;
  /** Average max − min across the models over the span, kn. */
  spread: number;
};

/** The words for a level, capitalised as a label starts ("Models agree"); lower-case them mid-sentence. */
export const AGREEMENT_WORDS: Record<Confidence["level"], string> = { high: "Models agree", mid: "Some disagreement", low: "Models disagree" };

/**
 * One rule for every surface (session rows, the chart chip, the model chips): the level comes from the spread as it
 * is shown, rounded to a knot — ≤ 3 kn agree, ≤ 6 kn some disagreement, more disagree — so one number never carries
 * two labels.
 */
export function confidenceOf(spread: number): Confidence {
  const kn = Math.round(spread);
  const level = kn <= 3 ? "high" : kn <= 6 ? "mid" : "low";
  return { level, label: `${AGREEMENT_WORDS[level]} · ${kn} kn spread`, spread };
}

/** How well the five models agree over [from, to); null without data. For a session: confidence(c, s.start, s.end + 3600e3). */
export function confidence(compare: ModelCompare | null | undefined, from: number, to: number): Confidence | null {
  const a = compare ? agreement(compare, from, to) : null;
  return a ? confidenceOf(a.avg) : null;
}

/* ---------- Station semantics ---------- */

/** `spot.station`: a NOAA station id, NO_STATION (forecast only, no nearby fallback), or undefined (auto: nearest live sensor). */
export const NO_STATION = "none";
/** Auto mode uses a live sensor this close; beyond NEARBY_WARN_KM the UI shows it amber. */
export const NEARBY_MAX_KM = 16;
export const NEARBY_WARN_KM = 8;
/** A reading older than this isn't "now". */
export const FRESH_MS = 90 * 60_000;
/** The spot's own station id, if it has one (not "none", not auto). */
export const ownStation = (spot?: Pick<Spot, "station">) => (spot?.station && spot.station !== NO_STATION ? spot.station : undefined);

/** Where a spot's "now" comes from. */
export type NowSource = "station" | "nearby" | "model";
/** A live reading behind "now": the spot's own station, or (auto) the nearest sensor. km is spot → sensor. */
export type Sensor = { kind: "station" | "nearby"; id: string; name: string; t: number; speed: number; gust: number | null; dir: number; km: number | null };

/**
 * The hero's source line: "Live · Old Port Tampa · 0.5 km · 4 min ago", "Nearby sensor · Middle Tampa Bay · 14 km ·
 * 4 min ago", or "HRRR forecast". "Live" is only for the spot's own station.
 */
export function sourceLine({ source, sensor, model }: { source: NowSource; sensor: Sensor | null; model?: Model | null }, now = Date.now()) {
  if (source === "model" || !sensor) return `${model ? MODEL_INFO[model].label : "Model"} forecast`;
  return [source === "station" ? "Live" : "Nearby sensor", sensor.name, sensor.km != null ? fmtKm(sensor.km) : null, ago(sensor.t, now)]
    .filter(Boolean).join(" · ");
}
