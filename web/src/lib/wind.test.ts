import { describe, expect, it } from "vitest";
import {
  buildGrid, compass, gridPoints, nearestHour, nearestStations, parseForecast, parseObservation,
  agreement, arcLabel, fieldAt, hourlyObs, inArc, isRideable, nearestLive, parseField, parseIem, parseModels, parseObsSeries, scoreForecast, spreadAt, parseStations, rideState, rideableWindows, sample, spotsBox, toUV, windColor,
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

  it("uses HRRR while it lasts, then NBM", () => {
    const f = parseForecast({ timezone: "UTC", hourly: {
      time: [0, 3600, 7200],
      wind_speed_10m_gfs_hrrr: [10, 12, null], wind_gusts_10m_gfs_hrrr: [14, 16, null], wind_direction_10m_gfs_hrrr: [90, 95, null],
      wind_speed_10m_ncep_nbm_conus: [9, 11, 18], wind_gusts_10m_ncep_nbm_conus: [13, 15, 24], wind_direction_10m_ncep_nbm_conus: [80, 85, 200],
    } });
    expect(f.hours.map((h) => [h.speed, h.model])).toEqual([[10, "hrrr"], [12, "hrrr"], [18, "nbm"]]);
  });

  it("reads the latest CO-OPS row (string values, GMT times)", () => {
    const o = parseObservation({ metadata: { name: "Old Port Tampa" }, data: [
      { t: "2026-09-28 12:00", s: "10.5", d: "45", g: "14" }, { t: "2026-09-28 12:06", s: "11.0", d: "50.0", g: "15.2" }] });
    expect(o).toMatchObject({ name: "Old Port Tampa", speed: 11, gust: 15.2, dir: 50, t: Date.UTC(2026, 8, 28, 12, 6) });
  });

  it("treats blank strings as missing, not as 0 kn", () => {
    expect(() => parseObservation({ data: [{ t: "2026-09-28 12:00", s: "", d: "", g: "" }] })).toThrow(/no wind reading/);
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
  const hrs = [5, 16, 20, 40, 18].map((speed, i) => ({ t: i * 3600e3, speed, gust: speed, dir: 0, model: "hrrr" as const }));
  it("finds runs inside the range", () => {
    expect(rideableWindows(hrs, { min: 15, max: 30 })).toEqual([{ start: 3600e3, end: 7200e3 }, { start: 14400e3, end: 14400e3 }]);
  });
  it("finds the nearest hour", () => {
    expect(nearestHour(hrs, 3.4 * 3600e3)?.t).toBe(3 * 3600e3);
  });
  it("classifies ride state", () => {
    expect(rideState(10, { min: 15, max: 30 })).toBe("below");
    expect(rideState(15, { min: 15, max: 30 })).toBe("good");
    expect(rideState(31, { min: 15, max: 30 })).toBe("above");
    expect(rideState(20, { min: 15, max: 30, dirC: 225, dirW: 90 }, 90)).toBe("offdir");
    expect(rideState(10, { min: 15, max: 30, dirC: 225, dirW: 90 }, 90)).toBe("below"); // speed wins
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

describe("live stations", () => {
  it("parses IEM airport currents and skips rows without wind", () => {
    const r = parseIem({ data: [
      { station: "TPF", name: "Tampa/Knight", lat: 27.92, lon: -82.45, sknt: 9, gust: 15, drct: 240, utc_valid: "2026-09-29T02:55:00Z" },
      { station: "SPG", name: "ST PETERSBURG", lat: 27.77, lon: -82.63, sknt: null, drct: 0, utc_valid: "2026-09-29T02:55:00Z" },
    ] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "KTPF", source: "airport", speed: 9, gust: 15, dir: 240, t: Date.UTC(2026, 8, 29, 2, 55) });
  });

  it("prefers a NOAA sensor over a closer airport, within range", () => {
    const base = { gust: null, dir: 0, t: 0, speed: 5 };
    const rs = [
      { ...base, id: "KX", source: "airport" as const, name: "Airport", lat: 27.63, lon: -82.66 },
      { ...base, id: "8726412", source: "noaa" as const, name: "Middle Tampa Bay", lat: 27.662, lon: -82.6 },
      { ...base, id: "far", source: "noaa" as const, name: "Far", lat: 29, lon: -82 },
    ];
    expect(nearestLive(rs, 27.628, -82.66)?.id).toBe("8726412");
    expect(nearestLive(rs, 30.5, -80)).toBeNull();
  });

  it("pads the spots' bounding box", () => {
    expect(spotsBox([{ lat: 27.6, lon: -82.7 }], 0.5)).toEqual({ west: -83.2, south: 27.1, east: -82.2, north: 28.1 });
  });
});

describe("wind field over time", () => {
  const point = (hrrr: (number | null)[], nbm: number[]) => ({ hourly: {
    time: [0, 3600, 7200],
    wind_speed_10m_gfs_hrrr: hrrr, wind_direction_10m_gfs_hrrr: hrrr.map((x) => (x == null ? null : 270)),
    wind_speed_10m_ncep_nbm_conus: nbm, wind_direction_10m_ncep_nbm_conus: nbm.map(() => 90),
  } });
  const f = parseField([point([10, 12, null], [9, 11, 20])], [27.6], [-82.6]);

  it("takes HRRR while it lasts, then NBM, per hour", () => {
    expect(f.models).toEqual(["hrrr", "hrrr", "nbm"]);
    expect(f.speed[0]).toEqual([10, 12, 20]);
    expect(f.dir[0]).toEqual([270, 270, 90]);
  });

  it("builds the grid for the nearest hour", () => {
    const at = fieldAt(f, 7000e3);
    expect(at.t).toBe(7_200_000);
    expect(at.model).toBe("nbm");
    expect(at.grid.speed[0][0]).toBe(20);
  });
});

describe("direction arcs", () => {
  const sw = { dirC: 225, dirW: 90 }; // SW ± 45° → 180°..270°
  it("allows inside the arc, including its edges", () => {
    expect(inArc(225, sw)).toBe(true);
    expect(inArc(180, sw)).toBe(true);
    expect(inArc(270, sw)).toBe(true);
    expect(inArc(271, sw)).toBe(false);
    expect(inArc(0, sw)).toBe(false);
  });
  it("wraps through north", () => {
    const n = { dirC: 0, dirW: 90 }; // 315°..45°
    expect(inArc(350, n)).toBe(true);
    expect(inArc(20, n)).toBe(true);
    expect(inArc(180, n)).toBe(false);
  });
  it("treats a missing or full arc as any direction", () => {
    expect(inArc(123, {})).toBe(true);
    expect(inArc(123, { dirC: 10, dirW: 360 })).toBe(true);
    expect(arcLabel({})).toBe("Any direction");
    expect(arcLabel(sw)).toBe("SW ±45° (S–W)");
  });
  it("only counts hours from a workable direction as rideable", () => {
    const spot = { min: 15, max: 30, ...sw };
    expect(isRideable({ speed: 20, dir: 230 }, spot)).toBe(true);
    expect(isRideable({ speed: 20, dir: 90 }, spot)).toBe(false);
    const hrs = [[20, 230], [20, 90], [20, 240]].map(([speed, dir], i) => ({ t: i * 3600e3, speed, gust: speed, dir, model: "hrrr" as const }));
    expect(rideableWindows(hrs, spot)).toEqual([{ start: 0, end: 0 }, { start: 7200e3, end: 7200e3 }]);
  });
});

describe("forecast vs actual", () => {
  it("parses a CO-OPS history and drops blank rows", () => {
    const o = parseObsSeries({ data: [{ t: "2026-09-28 12:00", s: "10", d: "200", g: "14" }, { t: "2026-09-28 12:06", s: "", d: "", g: "" }] });
    expect(o).toEqual([{ t: Date.UTC(2026, 8, 28, 12, 0), speed: 10, gust: 14, dir: 200 }]);
  });

  it("averages 6-minute readings into hours and vector-averages direction across north", () => {
    const base = Date.UTC(2026, 8, 28, 12, 0);
    const h = hourlyObs([
      { t: base - 12 * 60e3, speed: 10, gust: 12, dir: 350 },
      { t: base + 6 * 60e3, speed: 14, gust: 20, dir: 10 },
    ]);
    expect(h).toHaveLength(1);
    expect(h[0].t).toBe(base);
    expect(h[0].speed).toBe(12);
    expect(h[0].gust).toBe(20);
    expect(h[0].dir === 0 || h[0].dir < 1 || h[0].dir > 359).toBe(true);
  });

  it("scores bias (model − observed) and average miss", () => {
    const t0 = Date.UTC(2026, 8, 28, 12, 0);
    const hours = [10, 12, 14, 16].map((speed, i) => ({ t: t0 + i * 3600e3, speed, gust: speed, dir: 200, model: "hrrr" as const }));
    const obs = [12, 15, 15, 20].map((speed, i) => ({ t: t0 + i * 3600e3, speed, gust: speed, dir: 200 }));
    const s = scoreForecast(hours, obs)!;
    expect(s.n).toBe(4);
    expect(s.bias).toBeCloseTo(-2.5); // model ran low
    expect(s.mae).toBeCloseTo(2.5);
    expect(s.dirErr).toBeCloseTo(0);
  });

  it("won't score on a couple of points", () => {
    const t0 = Date.UTC(2026, 8, 28, 12, 0);
    expect(scoreForecast([{ t: t0, speed: 1, gust: 1, dir: 0, model: "hrrr" }], [{ t: t0, speed: 1, gust: 1, dir: 0 }])).toBeNull();
  });
});

describe("model comparison", () => {
  const c = parseModels({ timezone: "UTC", hourly: { time: [0, 3600, 7200],
    wind_speed_10m_gfs_hrrr: [10, 10, null], wind_speed_10m_ncep_nbm_conus: [11, 12, 10],
    wind_speed_10m_ecmwf_ifs025: [9, 14, 22], wind_speed_10m_gfs_seamless: [10, 11, 12] } });
  it("finds the spread across models that have a value", () => {
    expect(spreadAt(c, 0)).toEqual({ min: 9, max: 11, spread: 2, n: 4 });
    expect(spreadAt(c, 2)).toMatchObject({ min: 10, max: 22, n: 3 });
  });
  it("summarises agreement", () => {
    expect(agreement(c, 0, 3600e3)?.label).toBe("Models agree");
    expect(agreement(c, 7200e3, 9000e3)?.label).toBe("Models disagree");
    expect(agreement(c, 1e12, 2e12)).toBeNull();
  });
});
