// The Today board's per-spot reading of a forecast: hour and day states for the ribbons, and an honest line for a
// spot with no session. Pure (no React); the cards memoise it.
import { fmtHour, fmtSpan, fmtWeekday, isDaylightHour, sameDay, sessions, type Session } from "../../lib/session";
import { compass, inArc, type Hour, type Spot } from "../../lib/wind";
import { RIBBON_WORDS, type RibbonCell, type RibbonState } from "../ui";

const HOUR = 3600e3;
/** Knots under the range that still count as marginal (a bigger kite, a heavier board). */
export const MARGINAL_KN = 2;

/**
 * One hour's state for the ribbon: go inside a session; strong above the range; wrongdir when the speed is right
 * but the direction isn't; soon for a rideable hour too short for a session, or up to 2 kn under the range; else off.
 */
export function hourState(h: Hour, spot: Spot, list: Session[]): RibbonState {
  if (list.some((s) => h.t >= s.start && h.t <= s.end)) return "go";
  if (h.speed > spot.max) return "strong";
  const dirOk = inArc(h.dir, spot);
  if (h.speed >= spot.min) return dirOk ? "soon" : "wrongdir";
  return h.speed >= spot.min - MARGINAL_KN && dirOk ? "soon" : "off";
}

/**
 * The daylight hours of the local day containing t, one cell per hour, by the session engine's own rule (the whole
 * hour between sunrise and sunset), so a cell can only be "go" where a session can be and the ribbon ends where the
 * sessions do.
 */
export const daylightHours = (hours: Hour[], spot: Spot, t: number, tz: string) =>
  hours.filter((h) => sameDay(h.t, t, tz) && isDaylightHour(spot.lat, spot.lon, h.t));

const cellTitle = (h: Hour, tz: string, state: RibbonState) =>
  `${fmtHour(h.t, tz)} · ${Math.round(h.speed)} kn ${compass(h.dir)} · ${RIBBON_WORDS[state]}`;

export type DayRibbon = {
  /** "Today", or "Tomorrow" once today's daylight is over. */
  day: string;
  cells: RibbonCell[];
  /** Fractional cell index of `now` (for the tick), or undefined outside these hours. */
  nowIndex: number | undefined;
  /** Where the cells start and end, for the labels either side: "7 AM", "5 PM" ("Tomorrow 7 AM" for tomorrow). */
  from: string;
  to: string;
  label: string;
};

/**
 * Sunrise → sunset for the board's day: today while it's light, tomorrow once today's daylight hours are over
 * (an evening check is about tomorrow). `all` is every session in the forecast (past ones colour the morning).
 */
export function dayRibbon(hours: Hour[], spot: Spot, all: Session[], now: number, tz: string): DayRibbon | null {
  let hs = daylightHours(hours, spot, now, tz);
  const over = !hs.length || now >= hs[hs.length - 1].t + HOUR;
  if (over) {
    const next = hours.find((h) => h.t > now && !sameDay(h.t, now, tz));
    hs = next ? daylightHours(hours, spot, next.t, tz) : [];
  }
  if (!hs.length) return null;
  const cells = hs.map((h) => { const state = hourState(h, spot, all); return { state, title: cellTitle(h, tz, state) }; });
  const first = hs[0].t, end = hs[hs.length - 1].t + HOUR;
  const nowIndex = now >= first && now < end ? (now - first) / HOUR - 0.5 : undefined;
  const day = over ? "Tomorrow" : "Today";
  const go = all.filter((s) => sameDay(s.start, first, tz));
  const says = go.length
    ? `rideable ${go.map((s) => fmtSpan(s.start, s.end + HOUR, tz)).join(" and ")}`
    : summarise(cells);
  const from = `${day === "Today" ? "" : `${day} `}${fmtHour(first, tz)}`, to = fmtHour(end, tz);
  return { day, cells, nowIndex, from, to, label: `${day}, sunrise to sunset: ${says}` };
}

const ORDER: RibbonState[] = ["go", "soon", "strong", "wrongdir", "off", "none"];
const summarise = (cells: RibbonCell[]) => {
  const n = new Map<RibbonState, number>();
  for (const c of cells) n.set(c.state, (n.get(c.state) ?? 0) + 1);
  return ORDER.filter((s) => n.get(s)).map((s) => `${n.get(s)} h ${RIBBON_WORDS[s]}`).join(", ");
};

/** One day of the week at a glance: its colour (the ribbon's states), its best session and its strongest daylight hour. */
export type WeekCell = RibbonCell & {
  label: string;
  /** The day's first daylight hour still ahead (ms epoch). */
  t: number;
  /** The day's best session that isn't over: the likeliest, then the longest. Null without one. */
  session: Session | null;
  /** The strongest daylight hour still ahead that day, any direction. Null with no daylight left or no forecast. */
  peak: Hour | null;
};

/** Where tapping a day puts the clock: its session's start, else its strongest daylight hour. */
export const dayTarget = (c: Pick<WeekCell, "session" | "peak">): number | null => c.session?.start ?? c.peak?.t ?? null;

const span = (s: Session) => s.end - s.start;
/** The better of two sessions on one day: the likelier, then the longer. */
const better = (a: Session, b: Session) => ((b.chance ?? 0) - (a.chance ?? 0) || span(b) - span(a)) > 0 ? b : a;

/**
 * Seven days from today, each coloured by its best daylight hour still ahead (go > soon > strong > wrongdir > off):
 * what's left of today, then whole days. A session already over doesn't colour today.
 */
export function weekCells(hours: Hour[], spot: Spot, all: Session[], now: number, tz: string): WeekCell[] {
  // one representative time per local day, today first
  const days: number[] = [now];
  for (const h of hours) {
    if (days.length >= 7) break;
    if (h.t > now && !sameDay(h.t, days[days.length - 1], tz)) days.push(h.t);
  }
  while (days.length < 7) days.push(days[days.length - 1] + 864e5);
  return days.map((t, i) => {
    const label = fmtWeekday(t, tz);
    const whole = daylightHours(hours, spot, t, tz);
    const hs = whole.filter((h) => h.t + HOUR > now);
    if (!hs.length) return { state: "none" as const, title: `${label} · ${i === 0 && whole.length ? "daylight is over" : "no forecast"}`, label, t, session: null, peak: null };
    const list = all.filter((x) => sameDay(x.start, hs[0].t, tz) && x.end + HOUR > now);
    const states = hs.map((h) => hourState(h, spot, list));
    const state = ORDER.find((s) => states.includes(s)) ?? "none";
    const s = list.length ? list.reduce(better) : null;
    const peak = hs.reduce((a, h) => (h.speed > a.speed ? h : a));
    const title = s
      ? `${label} · rideable ${fmtSpan(s.start, s.end + HOUR, tz)}`
      : `${label} · ${RIBBON_WORDS[state]} · best ${Math.round(peak.speed)} kn ${compass(peak.dir)}`;
    return { state, title, label, t: hs[0].t, session: s, peak };
  });
}

/** A day of the board's week: the best spot that day, and its cell. */
export type BoardDay = WeekCell & { spot: Spot };

/**
 * The week across every spot: for each day the spot with the best answer (a session before a marginal day before the
 * rest; then the likelier session, the longer one, the stronger wind). `rows` are the spots in board order, each with
 * its seven cells; ties keep that order.
 */
export function bestPerDay(rows: { spot: Spot; cells: WeekCell[] }[]): BoardDay[] {
  if (!rows.length) return [];
  return rows[0].cells.map((_, d) => {
    let best = rows[0];
    for (const r of rows.slice(1)) {
      const a = best.cells[d], b = r.cells[d];
      const diff = ORDER.indexOf(a.state) - ORDER.indexOf(b.state)
        || (b.session?.chance ?? 0) - (a.session?.chance ?? 0)
        || (b.session ? span(b.session) : 0) - (a.session ? span(a.session) : 0)
        || (a.state === "strong" || a.state === "wrongdir" ? 0 : (b.peak?.speed ?? -1) - (a.peak?.speed ?? -1));
      if (diff > 0) best = r;
    }
    return { ...best.cells[d], spot: best.spot };
  });
}

/** Every session in the forecast, past ones included (the ribbon colours the morning that's gone too). */
export const allSessions = (hours: Hour[], spot: Spot) => sessions(hours, spot);

/**
 * Why there's no session, in the rider's words: wrong direction, too strong, too short, or too light (with the
 * best daylight hour). Replaces the engine's bare "best Tue 13 kn" on the card.
 */
export function noneDetail(hours: Hour[], spot: Spot, now: number, tz: string): string {
  const day = hours.filter((h) => h.t + HOUR > now && isDaylightHour(spot.lat, spot.lon, h.t));
  if (!day.length) return "";
  const best = day.reduce((a, h) => (h.speed > a.speed ? h : a));
  const when = (t: number) => (sameDay(t, now, tz) ? "today" : fmtWeekday(t, tz));
  const inRange = day.filter((h) => h.speed >= spot.min && h.speed <= spot.max);
  if (inRange.length && inRange.every((h) => !inArc(h.dir, spot))) {
    const h = inRange.reduce((a, x) => (x.speed > a.speed ? x : a));
    return spot.dirC != null ? `Wrong direction · ${compass(h.dir)}, needs ${compass(spot.dirC)}` : `Wrong direction · ${compass(h.dir)}`;
  }
  if (inRange.length) return `Only short windows · best ${when(best.t)} ${Math.round(best.speed)} kn`;
  if (best.speed > spot.max) return `Too strong · ${Math.round(best.speed)} kn ${when(best.t)}`;
  return `Too light · best ${when(best.t)} ${Math.round(best.speed)} kn`;
}
