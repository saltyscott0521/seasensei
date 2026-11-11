import { describe, expect, it } from "vitest";
import { hourlyObs, inArc, chainForecast, parseObservation, parseSpotModels } from "./wind";

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

  it("the forecast hands off HRRR → RRFS → NBM as each runs out", () => {
    const f = chainForecast(parseSpotModels([{ models: ["hrrr", "rrfs", "nbm"], json: { timezone: "UTC", hourly: { time: [0, 3600, 7200],
      wind_speed_10m_gfs_hrrr: [10, null, null], wind_gusts_10m_gfs_hrrr: [14, null, null], wind_direction_10m_gfs_hrrr: [90, null, null],
      wind_speed_10m_ncep_rrfs_conus: [11, 15, null], wind_gusts_10m_ncep_rrfs_conus: [15, 20, null], wind_direction_10m_ncep_rrfs_conus: [95, 120, null],
      wind_speed_10m_ncep_nbm_conus: [9, 14, 18], wind_gusts_10m_ncep_nbm_conus: [13, 19, 24], wind_direction_10m_ncep_nbm_conus: [80, 110, 200] } } }]), "hrrr");
    expect(f.hours.map((h) => [h.speed, h.model])).toEqual([[10, "hrrr"], [15, "rrfs"], [18, "nbm"]]);
  });
});
