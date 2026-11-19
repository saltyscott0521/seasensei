// The morning briefing: "where and when today" in one notification. Pure (no React, no fetch). The app uses it for the
// preview in the briefing panel; scripts/build-engine.mjs bundles it, with everything it needs from session.ts,
// sensei.ts, wind.ts, forecast.ts and marine.ts, into server/engine.mjs, so the push the server sends says exactly
// what the board says.
import { fmtUntil, type MarineAlert } from "./marine";
import { chanceOf, fmtHour, fmtSpan, fmtStrength, fmtWeekday, rankSpots, sameDay, sessions, verdict, type Session, type Verdict } from "./session";
import type { Forecast, Spot } from "./wind";

export { forecastFrom } from "./forecast";
export { alertsUrl, parseAlerts, type MarineAlert } from "./marine";
export { FALLBACK_CALIBRATION, parseCalibration } from "./sensei";
export { parseSpotModels, PRIMARY_MODELS, SPOT_REQUESTS, spotModelsUrl } from "./wind";

const HOUR = 3600e3;

export type BriefingSpot = Pick<Spot, "id" | "name" | "lat" | "lon" | "min" | "max" | "dirC" | "dirW" | "station">;
export type BriefingMode = "daily" | "windy";

export type Briefing = {
  /** "Fort De Soto · On at 1 PM" · "No session today" */
  title: string;
  /** "1–5 PM · 15–21 kn SW · Likely. Also Picnic Island 3–5 PM (Possible)." (+ a marine alert on its own line) */
  body: string;
  /** Where a tap goes: the featured spot, else the board. */
  url: string;
  /** The featured spot (today's best, else the next session's), if any. */
  spotId: string | null;
  /** Is there a session today (on now, or later today)? "Only when it's on" sends only then. */
  on: boolean;
  /** The alert line, when one was given. */
  alert: string | null;
  /** Each spot's verdict, best first (for the admin dry run). */
  spots: { id: string; name: string; state: Verdict["state"]; label: string; detail: string }[];
};

/** "Small Craft Advisory until 10 PM" (in the spots' zone; "until Thu 10 PM" when it runs into another day). */
export const fmtAlert = (a: Pick<MarineAlert, "event" | "ends">, tz: string, now = Date.now()) =>
  a.ends != null ? `${a.event} ${fmtUntil(a.ends, tz, now).replace(/^Until/, "until")}` : a.event;

const chanceTag = (s: Session) => { const c = chanceOf(s); return c ? ` (${c})` : ""; };
const span = (s: Session, tz: string) => fmtSpan(s.start, s.end + HOUR, tz);

/**
 * The briefing for a set of spots at `now` (the moment it goes out). `forecasts[i]` is spot i's forecast as the app
 * builds it for the rider's primary model (forecastFrom); a spot without one is left out. Null when no spot has one.
 * Ranking and copy are the board's: sessions() from now, verdict(), rankSpots().
 */
export function composeBriefing(spots: BriefingSpot[], forecasts: (Forecast | null | undefined)[], now: number, alert?: MarineAlert | null): Briefing | null {
  const rows = spots.flatMap((spot, i) => {
    const fc = forecasts[i];
    if (!fc?.hours.length) return [];
    const list = sessions(fc.hours, spot, { from: now });
    return [{ spot, tz: fc.timeZone, verdict: verdict(spot, fc.hours, list, now, fc.timeZone) as Verdict | null }];
  });
  if (!rows.length) return null;
  const ranked = rankSpots(rows);
  const best = ranked[0], tz = best.tz, v = best.verdict!;
  const today = ranked.filter((r) => (r.verdict!.state === "on" || r.verdict!.state === "today") && r.verdict!.session);
  const alertLine = alert ? fmtAlert(alert, tz, now) : null;
  let title: string, body: string, featured: typeof best | null;

  if (today.length) {
    featured = today[0];
    const s = featured.verdict!.session!;
    const chance = chanceOf(s);
    const others = today.slice(1, 3).map((r) => `${r.spot.name} ${span(r.verdict!.session!, r.tz)}${chanceTag(r.verdict!.session!)}`);
    title = `${featured.spot.name} · ${featured.verdict!.label}`;
    body = `${[span(s, featured.tz), fmtStrength(s), chance].filter(Boolean).join(" · ")}.${others.length ? ` Also ${others.join(", ")}.` : ""}`;
  } else {
    const next = ranked.find((r) => r.verdict!.state === "upcoming" && r.verdict!.session);
    featured = next ?? null;
    title = "No session today";
    if (next) {
      const s = next.verdict!.session!;
      const day = sameDay(s.start, now, next.tz) ? "today" : fmtWeekday(s.start, next.tz);
      body = `Next: ${day} ${fmtHour(s.start, next.tz)} at ${next.spot.name}${chanceTag(s)}.`;
    } else {
      body = v.best ? `Nothing rideable in the forecast this week (best ${v.detail.replace(/^best /, "")}).` : "Nothing rideable in the forecast this week.";
    }
  }
  if (alertLine) body += `\n${alertLine}.`;
  return {
    title, body, url: featured ? `/?spot=${encodeURIComponent(featured.spot.id)}` : "/", spotId: featured?.spot.id ?? null,
    on: today.length > 0, alert: alertLine,
    spots: ranked.map((r) => ({ id: r.spot.id, name: r.spot.name, state: r.verdict!.state, label: r.verdict!.label, detail: r.verdict!.detail })),
  };
}

export const shouldSend = (b: Pick<Briefing, "on">, mode: BriefingMode) => mode === "daily" || b.on;

/* ---------- Local clock time in a zone (the rider's, for scheduling) ---------- */

const parts = (t: number, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(t).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
};

/** The rider's calendar day ("2026-11-19") and minutes past local midnight at `t`. */
export function localClock(t: number, tz: string) {
  const p = parts(t, tz);
  return { date: `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`, minutes: p.h * 60 + p.mi };
}

/** "07:30" → 450, or null. */
export const parseHHMM = (s: string) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s); return m ? +m[1] * 60 + +m[2] : null; };

/** The next moment the clock in `tz` reads `time` ("07:00") after `now`. */
export function nextAt(time: string, tz: string, now = Date.now()) {
  const want = parseHHMM(time) ?? 7 * 60;
  for (let day = 0; day < 3; day++) {
    const p = parts(now + day * 864e5, tz);
    // Guess as if the zone were UTC, then correct by the zone's offset at the guess (twice, for DST changes).
    let t = Date.UTC(p.y, p.mo - 1, p.d, 0, want);
    for (let k = 0; k < 2; k++) { const q = parts(t, tz); t += (Date.UTC(p.y, p.mo - 1, p.d, 0, want) - Date.UTC(q.y, q.mo - 1, q.d, q.h, q.mi)); }
    if (t > now) return t;
  }
  return now + 864e5;
}
