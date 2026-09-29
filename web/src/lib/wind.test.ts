import { describe, expect, it } from "vitest";
import {
  buildGrid, compass, gridPoints, nearestHour, nearestStations, parseForecast, parseObservation,
  parseStations, rideState, rideableWindows, sample, toUV, windColor,
} from "./wind";

describe("compass", () => {
  it("rounds to 16 points and wraps", () => {
    expect(compass(0)).toBe("N");
    expect(compass(359)).toBe("N");
    expect(compass(90)).toBe("E");
    expect(compass(-90)).toBe("W");
  });
});

describe("parsers", () => {
  it("drops null forecast hours past HRRR's horizon", () => {
    const f = parseForecast({ timezone: "America/New_York", hourly: {
      time: [0, 3600, 7200], wind_speed_10m: [10, null, 20], wind_gusts_10m: [15, 1, 25], wind_direction_10m: [90, 90, 180] } });
    expect(f.hours).toHaveLength(2);
    expect(f.hours[1].t).toBe(7_200_000);
  });

  it("reads the latest CO-OPS row (string values, GMT times)", () => {
    const o = parseObservation({ metadata: { name: "Old Port Tampa" }, data: [
      { t: "2026-09-28 12:00", s: "10.5", d: "45", g: "14" }, { t: "2026-09-28 12:06", s: "11.0", d: "50.0", g: "15.2" }] });
    expect(o).toMatchObject({ name: "Old Port Tampa", speed: 11, gust: 15.2, dir: 50, t: Date.UTC(2026, 8, 28, 12, 6) });
  });

  it("surfaces a station's error reply and empty data", () => {
    expect(() => parseObservation({ error: { message: "No data was found" } })).toThrow(/No data/);
    expect(() => parseObservation({ data: [] })).toThrow(/no wind reading/);
  });

  it("maps the station list and skips rows without coordinates", () => {
    const s = parseStations({ stations: [{ id: 8726607, name: "Old Port Tampa", lat: 27.86, lng: -82.55 }, { id: 1, name: "x" }] });
    expect(s).toEqual([{ id: "8726607", name: "Old Port Tampa", lat: 27.86, lon: -82.55 }]);
  });
});

describe("rideable windows", () => {
  const hrs = [5, 16, 20, 40, 18].map((speed, i) => ({ t: i * 3600e3, speed, gust: speed, dir: 0 }));
  it("finds runs inside the range", () => {
    expect(rideableWindows(hrs, 15, 30)).toEqual([{ start: 3600e3, end: 7200e3 }, { start: 14400e3, end: 14400e3 }]);
  });
  it("finds the nearest hour", () => {
    expect(nearestHour(hrs, 3.4 * 3600e3)?.t).toBe(3 * 3600e3);
  });
  it("classifies ride state", () => {
    expect(rideState(10, { min: 15, max: 30 })).toBe("below");
    expect(rideState(15, { min: 15, max: 30 })).toBe("good");
    expect(rideState(31, { min: 15, max: 30 })).toBe("above");
  });
});

describe("stations", () => {
  it("sorts by distance", () => {
    const near = nearestStations([
      { id: "far", name: "Far", lat: 30, lon: -82.5 },
      { id: "near", name: "Near", lat: 27.86, lon: -82.55 },
    ], 27.853, -82.552, 1);
    expect(near[0].id).toBe("near");
    expect(near[0].km).toBeLessThan(2);
  });
});

describe("wind field", () => {
  it("converts FROM-direction to a vector pointing downwind", () => {
    const n = toUV(10, 0); // wind from the north blows south
    expect(n.u).toBeCloseTo(0);
    expect(n.v).toBeCloseTo(-10);
    const w = toUV(10, 270); // from the west blows east
    expect(w.u).toBeCloseTo(10);
  });

  it("builds a padded, snapped grid around the bounds", () => {
    const g = gridPoints({ west: -82.9, south: 27.5, east: -82.4, north: 28 }, 6);
    expect(g.lats).toHaveLength(8);
    expect(g.lats[0]).toBeLessThan(27.5);
    expect(g.lons.at(-1)!).toBeGreaterThan(-82.4);
  });

  it("samples bilinearly and clamps outside the grid", () => {
    const lats = [0, 1], lons = [0, 1];
    const g = buildGrid(lats, lons, [{ speed: 10, dir: 270 }, { speed: 20, dir: 270 }, { speed: 10, dir: 270 }, { speed: 20, dir: 270 }]);
    expect(sample(g, 0.5, 0.5).speed).toBeCloseTo(15);
    expect(sample(g, 5, 5).speed).toBeCloseTo(20);
  });

  it("colors the sweet spot green-ish and calm blue-ish", () => {
    expect(windColor(0)).toBe("rgba(70,90,140,1)");
    expect(windColor(17)).toBe("rgba(52,211,153,1)");
    expect(windColor(99, 0.5)).toBe("rgba(236,72,153,0.5)");
  });
});
