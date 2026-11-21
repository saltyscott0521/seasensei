// The home-screen widget's data (GET /api/widget, drawn by public/widget/seasensei-widget.js in Scriptable): a
// station's wind right now and the SeaSensei forecast at the station, as the board would build it for a spot whose own
// station it is (its quantile map, the nowcast from its fresh reading). Pure; bundled into server/engine.mjs with the
// briefing, so the widget says what the board says.
import { applyNowcast, chanceWord, nowcastQualifies, type Calibration } from "./sensei";
import { forecastFrom } from "./forecast";
import { fmtHour, fmtSession, fmtStrength, fmtWeekday, holdsUntil, isDaylightHour, nowVerdict, sameDay, sessions, verdict, type SessionSpot } from "./session";
import { compass, windHex, type Hour, type ModelSeries, type Obs } from "./wind";


const HOUR = 3600e3;

export type WidgetStation = { id: string; name: string; lat: number; lon: number };
export type WidgetHour = { t: number; speed: number; gust: number; dir: number; lo: number | null; hi: number | null; color: string; night: boolean };
export type Widget = {
  station: { id: string; name: string; lat: number; lon: number };
  tz: string;
  updated: number;
  now: { t: number; speed: number; gust: number | null; dir: number; compass: string; color: string } | null;
  /** Did that reading bend the forecast (own station, ≤ 30 min old)? */
  nowcast: boolean;
  /** The past `past` hours and the next `ahead`, hourly. */
  forecast: WidgetHour[];
  /** Today's and tomorrow's sessions for a `min`–`max` kn rider, any direction: "Today 1–5 PM · 15–21 kn SW · Likely". */
  sessions: { start: number; end: number; text: string; chance: string | null }[];
  /** "On now · till 4 PM" · "On at 1 PM · 15–21 kn SW" · "Next: Sat 11 AM · 15–21 kn SW" · "Too light today · best 12 kn at 3 PM" */
  headline: string;
  min: number;
  max: number;
};

const r1 = (x: number) => Math.round(x * 10) / 10;

/** NOAA sends "" for a missing value, and Number("") is 0: a blank is no reading. */
const num = (x: unknown) => (x == null || String(x).trim() === "" ? NaN : Number(x));

/**
 * The latest CO-OPS wind reading (product=wind, time_zone=gmt) that has a speed and a direction; a blank gust is
 * no gust (null), never 0 kn. Null when there is none (or the station sent {error}).
 */
export function latestCoopsReading(json: any): Obs | null {
  if (!json || json.error) return null;
  const rows: any[] = json.data ?? [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const t = Date.parse(String(row.t).replace(" ", "T") + ":00Z"), speed = num(row.s), dir = num(row.d), gust = num(row.g);
    if ([t, speed, dir].every(Number.isFinite) && speed >= 0) return { t, speed, dir, gust };
  }
  return null;
}

export function composeWidget(o: {
  station: WidgetStation; series: ModelSeries | null; cal: Calibration; reading: Obs | null; now: number;
  min?: number; max?: number; past?: number; ahead?: number;
}): Widget {
  const { station, series, cal, now } = o;
  const min = o.min ?? 15, max = o.max ?? 30, past = o.past ?? 6, ahead = o.ahead ?? 24;
  const hour = Math.floor(now / HOUR) * HOUR;
  const tz = series?.timeZone ?? "America/New_York";
  const r = o.reading && Number.isFinite(o.reading.speed) && Number.isFinite(o.reading.dir) ? o.reading : null;
  const gust = r && Number.isFinite(r.gust) ? r.gust : null;
  const out: Widget = {
    station: { id: station.id, name: station.name, lat: station.lat, lon: station.lon }, tz, updated: now,
    now: r ? { t: r.t, speed: r1(r.speed), gust: gust == null ? null : r1(gust), dir: Math.round(r.dir), compass: compass(r.dir), color: windHex(r.speed) } : null,
    nowcast: false, forecast: [], sessions: [], headline: "", min, max,
  };
  const spot: SessionSpot = { lat: station.lat, lon: station.lon, min, max };
  if (!series) {
    out.headline = r ? `${Math.round(r.speed)} kn ${compass(r.dir)} at the sensor` : "No data";
    return out;
  }
  // The spot's own station is this one: its quantile map applies, and its fresh reading bends the next hours.
  const base = forecastFrom(series, "sensei", cal, { station: station.id }, hour).hours;
  const fresh = !!r && nowcastQualifies({ kind: "station", t: r.t }, now);
  const hours = fresh ? applyNowcast(base, r!, cal.nowcast, Math.max(r!.t, hour)) : base;
  out.nowcast = fresh && hours !== base;
  out.forecast = hours.filter((h) => h.t >= hour - past * HOUR && h.t <= hour + ahead * HOUR).map((h: Hour) => ({
    t: h.t, speed: r1(h.speed), gust: r1(h.gust), dir: Math.round(h.dir),
    lo: h.lo == null ? null : r1(h.lo), hi: h.hi == null ? null : r1(h.hi), color: windHex(h.speed), night: !isDaylightHour(station.lat, station.lon, h.t),
  }));

  const list = sessions(hours, spot, { from: now });
  out.sessions = list.filter((s) => sameDay(s.start, now, tz) || sameDay(s.start, now + 24 * HOUR, tz)).slice(0, 4).map((s) => {
    const chance = s.chance != null ? chanceWord(s.chance) : null;
    return { start: s.start, end: s.end + HOUR, text: fmtSession(s, tz, now) + (chance ? ` · ${chance}` : ""), chance };
  });

  const v = verdict(spot, hours, list, now, tz);
  const baseList = sessions(base, spot, { from: now });
  const forecastOn = baseList.some((s) => s.start <= now && now < s.end + HOUR);
  const cur = hours.find((h) => h.t <= now && now < h.t + HOUR);
  const nv = nowVerdict(v, { spot, hours, now, tz, reading: r ? { speed: r.speed, gust, dir: r.dir, t: r.t } : null, forecastOn, forecastSpeed: cur?.speed ?? null });
  const kn = (x: number) => `${Math.round(x)} kn`;
  switch (nv.state) {
    case "on": {
      const till = holdsUntil(hours, spot, now) ?? (v.session ? v.session.end + HOUR : null);
      out.headline = till ? `On now · till ${fmtHour(till, tz)}` : "On now · may not last the hour";
      break;
    }
    case "strong": out.headline = `Too strong now · ${kn(r && nv.by === "sensor" ? r.speed : cur?.speed ?? 0)}`; break;
    case "light": out.headline = `Too light now · sensor ${kn(r!.speed)}`; break;
    case "wrongdir": out.headline = `Wrong direction now · ${compass(r!.dir)}`; break;
    case "today": case "upcoming": out.headline = `${v.label} · ${fmtStrength(v.session!)}`; break;
    default: {
      const day = hours.filter((h) => h.t + HOUR > now && sameDay(h.t, now, tz) && isDaylightHour(station.lat, station.lon, h.t));
      const best = day.reduce<Hour | null>((b, h) => (!b || h.speed > b.speed ? h : b), null);
      if (best) out.headline = `Too ${best.speed > max ? "strong" : "light"} today · best ${kn(best.speed)} at ${fmtHour(best.t, tz)}`;
      else out.headline = v.best ? `No session this week · best ${fmtWeekday(v.best.t, tz)} ${kn(v.best.speed)}` : "No session this week";
    }
  }
  return out;
}
