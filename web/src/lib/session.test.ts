import { describe, expect, it } from "vitest";
import { rankSpots, sessions, sunTimes, verdict } from "./session";
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
});
