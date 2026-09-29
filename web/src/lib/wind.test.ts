import { describe, expect, it } from "vitest";
import { hourlyObs, inArc, parseForecast, parseObservation } from "./wind";

// Unit tests are kept only for logic that has actually broken. Behaviour is covered end to end in /e2e.

describe("bugs that bit", () => {
  it("a blank NOAA value is missing, not a 0 kn reading", () => {
    expect(() => parseObservation({ data: [{ t: "2026-09-28 12:00", s: "", d: "", g: "" }] })).toThrow(/no wind reading/);
  });

  it("wind direction arcs wrap through north", () => {
    expect(inArc(350, { dirC: 0, dirW: 90 })).toBe(true);
    expect(inArc(180, { dirC: 0, dirW: 90 })).toBe(false);
  });

  it("averaging directions across north doesn't give 180°", () => {
    const t = Date.UTC(2026, 8, 28, 12, 0);
    const [h] = hourlyObs([{ t: t - 12 * 60e3, speed: 10, gust: 12, dir: 350 }, { t: t + 6 * 60e3, speed: 14, gust: 20, dir: 10 }]);
    expect(Math.min(h.dir, 360 - h.dir)).toBeLessThan(1);
  });

  it("the forecast hands off from HRRR to NBM when HRRR runs out", () => {
    const f = parseForecast({ timezone: "UTC", hourly: { time: [0, 3600],
      wind_speed_10m_gfs_hrrr: [10, null], wind_gusts_10m_gfs_hrrr: [14, null], wind_direction_10m_gfs_hrrr: [90, null],
      wind_speed_10m_ncep_nbm_conus: [9, 18], wind_gusts_10m_ncep_nbm_conus: [13, 24], wind_direction_10m_ncep_nbm_conus: [80, 200] } });
    expect(f.hours.map((h) => [h.speed, h.model])).toEqual([[10, "hrrr"], [18, "nbm"]]);
  });
});
