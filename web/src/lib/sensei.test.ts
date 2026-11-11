import { describe, expect, it } from "vitest";
import { applyNowcast, blend, buildSensei, clampCorrection, FALLBACK_CALIBRATION, quantileMap } from "./sensei";
import type { Hour, ModelSeries } from "./wind";

// Like wind.test.ts: only the logic that is easy to get wrong. Behaviour is covered end to end in /e2e.

const HOUR = 3600e3;

describe("the SeaSensei blend", () => {
  it("the speed map interpolates between knots, carries the last correction on, and is clamped to 40 % and 6 kn", () => {
    const qm: [number, number][] = [[0, 0], [8, 10], [16, 22], [35, 41]];
    expect(quantileMap(qm, 4)).toBeCloseTo(5);
    expect(quantileMap(qm, 12)).toBeCloseTo(16);
    expect(quantileMap(qm, 40)).toBeCloseTo(46); // past the last knot: +6, not a runaway slope
    expect(clampCorrection(5, 9)).toBeCloseTo(7); // +80 % asked, +40 % given
    expect(clampCorrection(30, 20)).toBeCloseTo(24); // −10 kn asked, −6 kn given
    expect(clampCorrection(10, 11)).toBeCloseTo(11);
  });

  it("weights renormalise when a model has no value, so a model running out is not a handoff", () => {
    const s = (v: (number | null)[]) => ({ speed: v, gust: v.map((x) => (x == null ? null : x * 1.5)), dir: v.map(() => 200) });
    const series: ModelSeries = { timeZone: "UTC", times: [0, HOUR], models: { hrrr: s([10, null]), nbm: s([20, 20]), gfs: s([14, 14]) } };
    const cal = structuredClone(FALLBACK_CALIBRATION);
    cal.pooled.models.hrrr.mae = [1, 1, 1, 1]; cal.pooled.models.nbm.mae = [2, 2, 2, 2]; cal.pooled.models.gfs.mae = [2, 2, 2, 2];
    const [a, b] = buildSensei(series, cal, {}, 0);
    expect(a.speed).toBeCloseTo((10 * 16 + 20 + 14) / 18); // weights 1/mae⁴: 1, 1⁄16, 1⁄16
    expect(b.speed).toBeCloseTo(17); // HRRR gone: NBM and GFS share it equally
    expect(b.gust).toBeCloseTo(17 * 1.5);
    expect([a.model, b.model]).toEqual(["sensei", "sensei"]);
    expect(b.lo!).toBeLessThan(b.speed); expect(b.hi!).toBeGreaterThan(b.speed);
  });

  it("directions blend across north (350° and 10° give north, not south)", () => {
    const x = blend([{ speed: 10, ratio: 1.3, dir: 350, mae: 2 }, { speed: 12, ratio: 1.3, dir: 10, mae: 2 }])!;
    expect(Math.min(x.dir, 360 - x.dir)).toBeLessThan(1);
  });

  it("the nowcast adds the sensor's miss to the hours ahead, fading with time, never to the past or below zero", () => {
    const now = 100 * HOUR;
    const hours: Hour[] = Array.from({ length: 12 }, (_, i) => ({ t: now + (i - 3) * HOUR, speed: 10, gust: 13, dir: 200, model: "sensei", lo: 8, hi: 12 }));
    const cfg = { tauHours: 3, maxHours: 6 };
    const up = applyNowcast(hours, { speed: 16, t: now }, cfg, now);
    expect(up[2].speed).toBe(10); // an hour ago: left as forecast
    expect(up[3].speed).toBeCloseTo(16); // now
    expect(up[6].speed).toBeCloseTo(10 + 6 * Math.exp(-1)); // three hours ahead: e⁻¹ of the miss
    expect([up[6].lo, up[6].hi]).toEqual([8 + 6 * Math.exp(-1), 12 + 6 * Math.exp(-1)].map((v) => expect.closeTo(v)));
    expect(up[10].speed).toBe(10); // beyond six hours
    // a dead-calm reading against a forecast that was already dropping: the lull stops at zero
    const dropping = hours.map((h, i) => (i > 3 ? { ...h, speed: 2, gust: 3, lo: 0.5, hi: 4 } : h));
    const down = applyNowcast(dropping, { speed: 0, t: now }, cfg, now);
    expect(down[4]).toMatchObject({ speed: 0, lo: 0 });
    expect(down.every((h) => h.speed >= 0 && h.gust >= h.speed && h.lo! >= 0)).toBe(true);
  });
});
