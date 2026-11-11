import { describe, expect, it } from "vitest";
import { nowVerdict, rankSpots, sessions, sunTimes, verdict } from "./session";
import type { Hour } from "./wind";

// Only the session engine's tricky parts: the sun, night hours, minimum length, direction across north, the verdict.
const H = 3600e3;
const spot = { lat: 27.64, lon: -82.739, min: 15, max: 30 }; // Fort De Soto
const day = (iso: string, f: (utcHour: number) => Partial<Hour>): Hour[] =>
  Array.from({ length: 24 }, (_, i) => ({ t: Date.parse(iso) + i * H, speed: 20, gust: 24, dir: 225, model: "hrrr" as const, ...f(i) }));

describe("session engine", () => {
  it("sunrise and sunset match the almanac (astral and NOAA's calculator agree to ~15 s)", () => {
    const tampa = sunTimes(27.95, -82.46, Date.parse("2026-11-06T17:00:00Z"));
    expect(Math.abs(tampa.sunrise - Date.parse("2026-11-06T11:44:48Z"))).toBeLessThan(60e3);
    expect(Math.abs(tampa.sunset - Date.parse("2026-11-06T22:41:44Z"))).toBeLessThan(60e3);
    // in June the sunset falls on the next UTC date, but it is still the same local day
    const june = sunTimes(27.95, -82.46, Date.parse("2026-06-21T23:30:00Z"));
    expect(Math.abs(june.sunset - Date.parse("2026-06-22T00:28:45Z"))).toBeLessThan(60e3);
  });

  it("night hours never count, and a run shorter than 2 h is not a session", () => {
    // rideable all day and night, except a lull at 16:00 UTC that leaves a lone rideable hour at 15:00
    const hours = day("2026-11-06T00:00:00Z", (i) => (i === 14 || i === 16 ? { speed: 8 } : {}));
    const { sunrise, sunset } = sunTimes(spot.lat, spot.lon, Date.parse("2026-11-06T17:00:00Z"));
    const s = sessions(hours, spot);
    expect(s.map((x) => [new Date(x.start).getUTCHours(), new Date(x.end).getUTCHours()])).toEqual([[12, 13], [17, 21]]);
    for (const x of s) { expect(x.start).toBeGreaterThanOrEqual(sunrise); expect(x.end + H).toBeLessThanOrEqual(sunset); }
  });

  it("a session's direction averages across north", () => {
    const hours = day("2026-11-06T00:00:00Z", (i) => ({ dir: i % 2 ? 350 : 10 }));
    const [s] = sessions(hours, spot);
    expect(Math.min(s.dir, 360 - s.dir)).toBeLessThan(1);
  });

  it("verdicts read in the spot's time zone, and spots rank on → today → upcoming → none", () => {
    const tz = "America/New_York";
    const hours = [...day("2026-11-06T00:00:00Z", () => ({})), ...day("2026-11-07T00:00:00Z", () => ({}))];
    const list = sessions(hours, spot);
    const at = (iso: string) => verdict(spot, hours, list.filter((s) => s.end + H > Date.parse(iso)), Date.parse(iso), tz);
    expect(at("2026-11-06T15:30:00Z")).toMatchObject({ state: "on", label: "On now", detail: "till 5 PM · 20 kn SW" });
    expect(at("2026-11-06T09:00:00Z")).toMatchObject({ state: "today", label: "On at 7 AM", detail: "7 AM–5 PM · 20 kn SW" });
    expect(at("2026-11-06T23:00:00Z")).toMatchObject({ state: "upcoming", label: "Next: Sat 7 AM" });
    const calm = hours.map((h) => ({ ...h, speed: h.t === Date.parse("2026-11-07T18:00:00Z") ? 13 : 9 }));
    const none = verdict(spot, calm, [], Date.parse("2026-11-06T15:30:00Z"), tz);
    expect(none).toMatchObject({ state: "none", label: "No session this week", detail: "best Sat 13 kn" });
    const rows = ["none", "upcoming", "on", "today"].map((k) => ({ k, verdict: k === "none" ? none : at({ on: "2026-11-06T15:30:00Z", today: "2026-11-06T09:00:00Z", upcoming: "2026-11-06T23:00:00Z" }[k]!) }));
    expect(rankSpots(rows).map((r) => r.k)).toEqual(["on", "today", "upcoming", "none"]);
    // a quiet week: the spot closest to rideable leads, never the one that is only ever too strong
    const quiet = (speed: number) => verdict(spot, hours.map((h) => ({ ...h, speed })), [], Date.parse("2026-11-06T15:30:00Z"), tz);
    expect(rankSpots([{ k: "storm", verdict: quiet(40) }, { k: "light", verdict: quiet(13) }]).map((r) => r.k)).toEqual(["light", "storm"]);
  });

  it("only a fresh reading from the spot's own station overrules the forecast: on, too light, or left alone when stale", () => {
    const tz = "America/New_York", now = Date.parse("2026-11-06T18:30:00Z"); // 1:30 PM in Tampa
    // a light day (10 kn): no session; then a windy one (20 kn): on now
    const light = day("2026-11-06T05:00:00Z", () => ({ speed: 10, gust: 12 }));
    const none = verdict(spot, light, sessions(light, spot, { from: now }), now, tz);
    const read = (speed: number, ageMin = 5, dir = 225) => ({ speed, dir, t: now - ageMin * 60e3 });
    // the forecast as shown is bent toward the reading for this hour and the next, then drops back
    const bent = light.map((h) => (h.t <= now && now - h.t < 2 * H ? { ...h, speed: 18 } : h.t > now && h.t - now < H ? { ...h, speed: 16 } : h));
    const on = nowVerdict(none, { spot, hours: bent, now, tz, reading: read(18), forecastOn: false });
    expect([on.state, on.label, on.detail, on.verdict.state]).toEqual(["on", "On now", "18 kn at the sensor · till 3 PM", "on"]);
    expect(nowVerdict(none, { spot, hours: light, now, tz, reading: read(18) }).detail).toBe("18 kn at the sensor · may not last the hour");
    expect(nowVerdict(none, { spot, hours: light, now, tz, reading: read(18, 45) }).state).toBe("none"); // 45 min old: not now
    expect(nowVerdict(none, { spot, hours: light, now, tz, reading: read(18, 5, 45) }).state).toBe("on"); // any direction allowed here
    expect(nowVerdict(none, { spot: { ...spot, dirC: 225, dirW: 90 }, hours: light, now, tz, reading: read(18, 5, 45) }).state).toBe("none"); // NE at a SW spot

    const windy = day("2026-11-06T05:00:00Z", () => ({}));
    const go = verdict(spot, windy, sessions(windy, spot, { from: now }), now, tz);
    expect(go.state).toBe("on");
    const lightNow = nowVerdict(go, { spot, hours: windy, now, tz, reading: read(9), forecastOn: true });
    expect([lightNow.state, lightNow.label, lightNow.detail]).toEqual(["light", "Too light now", "Forecast says on, sensor reads 9 kn"]);
    expect(nowVerdict(go, { spot, hours: windy, now, tz, reading: read(34), forecastOn: true }).label).toBe("Too strong now");
    // at night a rideable reading doesn't make a session
    const night = Date.parse("2026-11-07T03:00:00Z");
    expect(nowVerdict(none, { spot, hours: light, now: night, tz, reading: { speed: 18, dir: 225, t: night - 60e3 } }).state).toBe("none");
  });
});
