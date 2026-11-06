// Shared, pure helpers for the spot charts and the timeline: cached time formatting, the time axis, the y scale,
// night and session spans, and the plain-language summaries the charts expose to screen readers.
import { useId } from "react";
import { fmtHour, fmtWeekday, sameDay, sessions, sunTimes, type SessionSpot } from "../../lib/session";
import { compass, type Hour } from "../../lib/wind";

export const HOUR = 3600e3;
const DAY = 864e5;

/* ---------- Time formatting (en-US in the given zone; one formatter per zone and pattern, made once) ---------- */

const fmts = new Map<string, Intl.DateTimeFormat>();
const fmt = (tz: string, o: Intl.DateTimeFormatOptions) => {
  const k = tz + JSON.stringify(o);
  let f = fmts.get(k);
  if (!f) fmts.set(k, (f = new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o })));
  return f;
};

/** Hour of the day, 0–23, in tz. */
export const hourOfDay = (t: number, tz: string) => Number(fmt(tz, { hour: "numeric", hourCycle: "h23" }).format(t)) % 24;
/** "Sat 3 PM" */
export const fmtWhen = (t: number, tz: string) => `${fmtWeekday(t, tz)} ${fmtHour(t, tz)}`;
/** "Saturday 3 PM", for screen readers. */
export const fmtWhenLong = (t: number, tz: string) => `${fmt(tz, { weekday: "long" }).format(t)} ${fmtHour(t, tz)}`;
/** "Today 3 PM" / "Sat 3 PM" */
export const fmtWhenRel = (t: number, tz: string, now = Date.now()) => `${sameDay(t, now, tz) ? "Today" : fmtWeekday(t, tz)} ${fmtHour(t, tz)}`;

/* ---------- Scales ---------- */

/** Top of the speed axis: 5 kn above the spot's range or the strongest value, rounded up to 5. */
export const speedTop = (spotMax: number, values: number[]) => Math.ceil(Math.max(spotMax + 5, ...values) / 5) * 5;
/** Speed gridlines every 10 kn up to the top. */
export const speedTicks = (top: number) => [0, 10, 20, 30, 40, 50, 60].filter((v) => v <= top);

/** Index of the item whose time is nearest `t`. */
export function nearestIndex<T>(items: T[], t: number, timeOf: (x: T) => number) {
  let best = 0;
  for (let i = 1; i < items.length; i++) if (Math.abs(timeOf(items[i]) - t) < Math.abs(timeOf(items[best]) - t)) best = i;
  return best;
}

export type XLabel = { x: number; text: string; day: boolean };

/**
 * The time axis between t0 and t1: midnight rules, and labels that never crowd. Under ~3½ days it shows hours every
 * 3/4/6/12 h (whichever keeps them ≥ 36 px apart) with the day's name at midnight; over that, one day name per day,
 * centred on its noon.
 */
export function timeAxis(t0: number, t1: number, tz: string, x: (t: number) => number, plotW: number) {
  const hours = Math.max(1, (t1 - t0) / HOUR);
  const pxPerHour = plotW / hours;
  const long = hours > 80;
  const step = [3, 4, 6, 12].find((s) => s * pxPerHour >= 36) ?? 24;
  const rules: number[] = [];
  const labels: XLabel[] = [];
  for (let t = Math.ceil(t0 / HOUR) * HOUR; t <= t1; t += HOUR) {
    const h = hourOfDay(t, tz);
    if (h === 0) rules.push(x(t));
    if (long) { if (h === 12) labels.push({ x: x(t), text: fmtWeekday(t, tz), day: true }); }
    else if (h === 0) labels.push({ x: x(t), text: fmtWeekday(t, tz), day: true });
    else if (h % step === 0) labels.push({ x: x(t), text: fmtHour(t, tz), day: false });
  }
  return { rules, labels };
}

/** Approximate width of a label at 10 px, to keep labels inside the chart. */
export const labelWidth = (text: string, size = 10) => text.length * size * 0.58;

/* ---------- Spans: night and rideable sessions ---------- */

/** Sunset → sunrise spans that overlap [t0, t1], clipped to it. */
export function nightSpans(lat: number, lon: number, t0: number, t1: number): [number, number][] {
  const days: { sunrise: number; sunset: number }[] = [];
  for (let t = t0 - DAY; t <= t1 + DAY; t += DAY) {
    const s = sunTimes(lat, lon, t);
    if (!days.length || days[days.length - 1].sunrise !== s.sunrise) days.push(s);
  }
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < days.length; i++) {
    const a = Math.max(t0, days[i].sunset), b = Math.min(t1, days[i + 1].sunrise);
    if (b > a) out.push([a, b]);
  }
  return out;
}

/** Daylight sessions (≥ 2 h rideable) as [start, end) spans, clipped to [t0, t1]; the same runs the session chips show. */
export function sessionSpans(hours: Hour[], spot: SessionSpot, t0: number, t1: number) {
  return sessions(hours, spot).flatMap((s): [number, number][] => {
    const a = Math.max(t0, s.start), b = Math.min(t1, s.end + HOUR);
    return b > a ? [[a, b]] : [];
  });
}

/* ---------- Words ---------- */

/** One sentence about the forecast in [t0, t1] for screen readers: the peak, then the sessions. */
export function forecastSummary(hs: Hour[], all: Hour[], spot: SessionSpot, tz: string, now = Date.now()) {
  if (!hs.length) return "";
  const peak = hs.reduce((a, h) => (h.speed > a.speed ? h : a));
  const t0 = hs[0].t, t1 = hs[hs.length - 1].t;
  const runs = sessions(all, spot).filter((s) => s.end >= t0 && s.start <= t1);
  const when = (t: number) => fmtWhenRel(t, tz, now);
  const ride = runs.length
    ? `Rideable ${runs.map((s) => `${when(s.start)} to ${fmtHour(s.end + HOUR, tz)}`).join(", ")}.`
    : "No rideable daylight session in this range.";
  return `Peaks at ${Math.round(peak.speed)} knots ${compass(peak.dir)}, gusts ${Math.round(peak.gust)}, ${when(peak.t)}. ${ride}`;
}

/** An id safe inside url(#…): React's useId adds characters CSS url() references dislike. */
export function useSvgId(prefix: string) {
  return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, "");
}

/** Some charts draw in once per page visit for a given key (spot + chart), never again on remounts or range switches. */
const drawn = new Set<string>();
export const shouldDrawIn = (key: string) => !drawn.has(key);
export const markDrawn = (key: string) => void drawn.add(key);
