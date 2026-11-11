// The SeaSensei forecast: every raw model, tuned to local sensors, blended by how well each has been doing, bent
// toward a live reading, with a range. Pure like wind.ts: no DOM, no fetch, no React.
import { RAW_MODELS, type Hour, type ModelSeries, type RawModel, type Spot, type Window } from "./wind";

const HOUR = 3600e3, RAD = Math.PI / 180;

/* ---------- The calibration file (/api/calibration) ---------- */

/** One model at one station (or pooled): the speed map's knots [raw, tuned], the average miss per lead bucket, gust factor. */
export type ModelCal = { n: number; qm: [number, number][]; mae: number[]; gf: number };
export type CalStation = {
  id: string; name: string; lat: number; lon: number; kind: "water" | "shore" | "airport";
  models: Partial<Record<RawModel, ModelCal>>;
};
export type Calibration = {
  version: number;
  updated: string;
  source: "seed" | "learned" | "builtin";
  /** Upper bound of each lead bucket, hours ahead of now. */
  leadBuckets: number[];
  stations: CalStation[];
  pooled: { models: Record<RawModel, ModelCal> };
  /** Observed − forecast for the blend, kn, per lead bucket. */
  residual: { q10: number[]; q90: number[] };
  nowcast: { tauHours: number; maxHours: number };
  score: { days: number; from?: string; to?: string; models: Partial<Record<RawModel | "sensei", { mae: number; n: number }>> } | null;
};

const IDENTITY: [number, number][] = [[0, 0], [35, 35]];
const builtin = (mae: number[], gf: number): ModelCal => ({ n: 0, qm: IDENTITY, mae, gf });

/**
 * What the browser uses when /api/calibration is unavailable: the models as they are, weighted by typical skill.
 * Keep in step with the pooled values, residual and nowcast in web/server/calibration-seed.json.
 */
export const FALLBACK_CALIBRATION: Calibration = {
  version: 1,
  updated: "",
  source: "builtin",
  leadBuckets: [12, 36, 72, 9999],
  stations: [],
  pooled: {
    models: {
      hrrr: builtin([1.84, 2.41, 2.99, 3.44], 1.43),
      rrfs: builtin([2.05, 2.25, 2.52, 2.73], 1.43),
      nbm: builtin([2.05, 2.1, 2.19, 2.42], 1.43),
      ecmwf: builtin([2.72, 2.83, 2.93, 3.23], 1.43),
      gfs: builtin([2.77, 2.88, 2.99, 3.29], 1.43),
    },
  },
  residual: { q10: [-3.7, -4.53, -5.17, -5.68], q90: [3.11, 3.14, 3.31, 3.64] },
  nowcast: { tauHours: 2, maxHours: 6 },
  score: null,
};

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const nums = (x: unknown, n: number): x is number[] => Array.isArray(x) && x.length >= n && x.every(isNum);

function parseModelCal(x: any, buckets: number): ModelCal | null {
  if (!x || !Array.isArray(x.qm) || x.qm.length < 2 || !nums(x.mae, buckets) || !x.mae.every((m: number) => m > 0)) return null;
  const qm = x.qm.filter((k: unknown): k is [number, number] => nums(k, 2)).map((k: number[]): [number, number] => [k[0], k[1]]).sort((a: number[], b: number[]) => a[0] - b[0]);
  if (qm.length < 2) return null;
  return { n: isNum(x.n) ? x.n : 0, qm, mae: x.mae, gf: isNum(x.gf) && x.gf >= 1 ? x.gf : 1.3 };
}

/** The server's file → a calibration we can trust; throws when it isn't usable (the caller then keeps the built-in one). */
export function parseCalibration(json: any): Calibration {
  const buckets: unknown = json?.leadBuckets;
  if (!nums(buckets, 1)) throw new Error("Calibration has no lead buckets");
  const n = buckets.length;
  const pooled = {} as Record<RawModel, ModelCal>;
  for (const m of RAW_MODELS) pooled[m] = parseModelCal(json.pooled?.models?.[m], n) ?? fit(FALLBACK_CALIBRATION.pooled.models[m], n);
  const stations: CalStation[] = (Array.isArray(json.stations) ? json.stations : []).flatMap((s: any): CalStation[] => {
    if (!s || !isNum(s.lat) || !isNum(s.lon) || !["water", "shore", "airport"].includes(s.kind)) return [];
    const models: CalStation["models"] = {};
    for (const m of RAW_MODELS) { const c = parseModelCal(s.models?.[m], n); if (c) models[m] = c; }
    return [{ id: String(s.id), name: String(s.name ?? s.id), lat: s.lat, lon: s.lon, kind: s.kind, models }];
  });
  const res = json.residual, now = json.nowcast, fb = FALLBACK_CALIBRATION;
  return {
    version: isNum(json.version) ? json.version : 1,
    updated: String(json.updated ?? ""),
    source: json.source === "learned" ? "learned" : "seed",
    leadBuckets: buckets,
    stations,
    pooled: { models: pooled },
    residual: nums(res?.q10, n) && nums(res?.q90, n) ? { q10: res.q10, q90: res.q90 } : { q10: fitN(fb.residual.q10, n), q90: fitN(fb.residual.q90, n) },
    nowcast: isNum(now?.tauHours) && now.tauHours > 0 && isNum(now?.maxHours) ? { tauHours: now.tauHours, maxHours: now.maxHours } : fb.nowcast,
    score: json.score && typeof json.score === "object" && json.score.models ? json.score : null,
  };
}
const fitN = (xs: number[], n: number) => Array.from({ length: n }, (_, i) => xs[Math.min(i, xs.length - 1)]);
const fit = (c: ModelCal, n: number): ModelCal => ({ ...c, mae: fitN(c.mae, n) });

/* ---------- Step 2: tuning each model's speed to a local sensor ---------- */

/** A monotone piecewise-linear map through the knots; past the last knot the last correction carries on. */
export function quantileMap(qm: [number, number][], raw: number) {
  if (raw <= qm[0][0]) return qm[0][1] + (raw - qm[0][0]);
  for (let i = 1; i < qm.length; i++) {
    const [r0, c0] = qm[i - 1], [r1, c1] = qm[i];
    if (raw <= r1) return r1 === r0 ? c1 : c0 + ((raw - r0) / (r1 - r0)) * (c1 - c0);
  }
  const [rl, cl] = qm[qm.length - 1];
  return raw + (cl - rl);
}

/** Never move a model's speed by more than 40 % or 6 kn, and never below zero. */
export function clampCorrection(raw: number, tuned: number) {
  const cap = Math.min(0.4 * raw, 6);
  return Math.max(0, raw + Math.min(cap, Math.max(-cap, tuned - raw)));
}

/**
 * The calibration station that is the spot's own chosen station, if any. The file's ids carry their network
 * ("coops:8726607", "asos:KSPG"); a spot stores the bare id ("8726607"). "none" and auto (no station) match nothing.
 */
export function ownCalStation(cal: Calibration, spot: Pick<Spot, "station">) {
  const id = spot.station;
  if (!id || id === "none") return null;
  return cal.stations.find((s) => s.id === id || s.id.slice(s.id.indexOf(":") + 1) === id) ?? null;
}

/** One model's tuning at a spot: its speed map (clamped), its average miss per lead bucket and its gust factor. */
export type SpotModelCal = { tune: (raw: number) => number; mae: number[]; gf: number };
export type SpotCal = { station: CalStation | null; models: Record<RawModel, SpotModelCal> };

/**
 * A station's map (and its miss and gust factor) is used only when it is the spot's own station: a neighbour's map
 * did worse than no map at every station left out of the backtest. Every other spot uses the pooled values.
 */
export function spotCalibration(cal: Calibration, spot: Pick<Spot, "station">): SpotCal {
  const station = ownCalStation(cal, spot);
  const models = {} as Record<RawModel, SpotModelCal>;
  for (const m of RAW_MODELS) {
    const c = station?.models[m] ?? cal.pooled.models[m];
    models[m] = { tune: (raw) => clampCorrection(raw, quantileMap(c.qm, raw)), mae: c.mae, gf: c.gf };
  }
  return { station, models };
}

/* ---------- Step 3: the blend ---------- */

/** Which lead bucket an hour falls in: hours ahead of now (past hours use the first). */
export function leadBucket(leadBuckets: number[], hoursAhead: number) {
  const i = leadBuckets.findIndex((b) => hoursAhead <= b);
  return i < 0 ? leadBuckets.length - 1 : i;
}

/** One model's say at one hour: tuned speed, its own gust-to-speed ratio, direction, and its average miss at this lead. */
export type BlendInput = { speed: number; ratio: number; dir: number | null; mae: number };

/**
 * Weights ∝ 1 / mae⁴ over the models that have a value, so a missing model just drops out and the rest carry on
 * (no hard handoffs). Speed is the weighted mean, direction the weighted circular mean (350° and 10° give 0°), gust
 * the blended speed times the weighted mean gust ratio, never under the speed.
 */
export function blend(inputs: BlendInput[]): { speed: number; gust: number; dir: number; min: number; max: number } | null {
  if (!inputs.length) return null;
  const ws = inputs.map((x) => 1 / x.mae ** 4);
  const sum = ws.reduce((a, b) => a + b, 0);
  let speed = 0, ratio = 0, u = 0, v = 0, wd = 0;
  inputs.forEach((x, i) => {
    const w = ws[i] / sum;
    speed += w * x.speed;
    ratio += w * x.ratio;
    if (x.dir != null) { u += w * Math.sin(x.dir * RAD); v += w * Math.cos(x.dir * RAD); wd += w; }
  });
  const speeds = inputs.map((x) => x.speed);
  return {
    speed, gust: Math.max(speed, speed * ratio),
    dir: wd > 0 ? (Math.atan2(u, v) / RAD + 360) % 360 : 0,
    min: Math.min(...speeds), max: Math.max(...speeds),
  };
}

/** Share of the tuned model spread the range must cover at least. */
const SPREAD_COVER = 0.6;

/**
 * The SeaSensei hours for a spot from whatever models arrived: each tuned (step 2), blended (3), with a range (5).
 * Hours no model covers are left out. `now` sets each hour's lead.
 */
export function buildSensei(series: ModelSeries, cal: Calibration, spot: Pick<Spot, "station">, now = Date.now()): Hour[] {
  const sc = spotCalibration(cal, spot);
  const have = RAW_MODELS.filter((m) => series.models[m]);
  const out: Hour[] = [];
  series.times.forEach((t, i) => {
    const b = leadBucket(cal.leadBuckets, (t - now) / HOUR);
    const inputs: BlendInput[] = [];
    for (const m of have) {
      const s = series.models[m]!, raw = s.speed[i], c = sc.models[m];
      if (raw == null) continue;
      const g = s.gust[i];
      // Tuned to the spot's own station: that station's gust factor. Otherwise the model's own gustiness; with no
      // gust (or next to no wind, where the ratio means nothing) its usual factor.
      const ratio = !sc.station && g != null && raw >= 1 ? Math.min(3, Math.max(1, g / raw)) : c.gf;
      inputs.push({ speed: c.tune(raw), ratio, dir: s.dir[i] ?? null, mae: c.mae[b] });
    }
    const x = blend(inputs);
    if (!x) return;
    const lo = Math.min(x.speed + cal.residual.q10[b], x.speed - SPREAD_COVER * (x.speed - x.min));
    const hi = Math.max(x.speed + cal.residual.q90[b], x.speed + SPREAD_COVER * (x.max - x.speed));
    out.push({ t, speed: x.speed, gust: x.gust, dir: x.dir, model: "sensei", lo: Math.max(0, lo), hi });
  });
  return out;
}

/* ---------- Step 4: the nowcast ---------- */

/** A reading this fresh from the spot's own station bends the next hours. */
export const NOWCAST_FRESH_MS = 30 * 60_000;

/** Does this sensor reading qualify? Only the spot's own station: a neighbour's miss doesn't carry over to the spot. */
export function nowcastQualifies(sensor: { kind: "station" | "nearby"; t: number } | null | undefined, now = Date.now()) {
  return !!sensor && sensor.kind === "station" && now - sensor.t <= NOWCAST_FRESH_MS;
}

/** The forecast speed at an instant (linear between the hours around it). */
function speedAt(hours: Hour[], t: number) {
  let a: Hour | null = null, b: Hour | null = null;
  for (const h of hours) { if (h.t <= t) a = h; else { b = h; break; } }
  if (!a || !b) return (a ?? b)?.speed ?? null;
  return a.speed + ((t - a.t) / (b.t - a.t)) * (b.speed - a.speed);
}

/**
 * Bend the forecast toward what the sensor reads: the miss right now (observed − forecast at the reading), fading as
 * exp(−h / tau), added to the hour in progress and the next `maxHours` (h = hours ahead). Speed, gust and the range
 * move together and never go below zero. Hours already over are left as forecast. Returns the same array when
 * nothing changes.
 */
export function applyNowcast(hours: Hour[], obs: { speed: number; t: number }, cfg: Calibration["nowcast"], now = Date.now()): Hour[] {
  const base = speedAt(hours, obs.t);
  if (base == null) return hours;
  const err = obs.speed - base;
  if (Math.abs(err) < 0.05) return hours;
  return hours.map((h) => {
    const ahead = (h.t - now) / HOUR;
    if (ahead <= -1 || ahead > cfg.maxHours) return h;
    const d = err * Math.exp(-Math.max(0, ahead) / cfg.tauHours);
    const speed = Math.max(0, h.speed + d), shift = speed - h.speed;
    return {
      ...h, speed, gust: Math.max(speed, h.gust + shift),
      ...(h.lo != null && h.hi != null ? { lo: Math.max(0, h.lo + shift), hi: Math.max(0, h.hi + shift) } : null),
    };
  });
}

/* ---------- Step 6: chance ---------- */

/** The range is a 10–90 % interval: 2.563 standard deviations wide. */
const RANGE_SDS = 2.563;

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, good to 1e-7). */
function phi(z: number) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** How likely the wind is at least `kn` this hour (0–1), centred on the middle of its range. An hour without a range is simply yes or no. */
export function chanceAtLeast(hour: Pick<Hour, "speed" | "lo" | "hi">, kn: number) {
  const sd = hour.lo != null && hour.hi != null ? (hour.hi - hour.lo) / RANGE_SDS : 0;
  if (!(sd > 0)) return hour.speed >= kn ? 1 : 0;
  return 1 - phi((kn - (hour.lo! + hour.hi!) / 2) / sd);
}

/**
 * How likely a session is to deliver: the mean of its hours' chance of reaching the spot's minimum, held to at most
 * 15 points above its weakest hour. Null when the hours carry no range (a raw model).
 */
export function sessionChance(hours: Hour[], session: Window, spot: Pick<Spot, "min">): number | null {
  const hs = hours.filter((h) => h.t >= session.start && h.t <= session.end);
  if (!hs.length || hs.some((h) => h.lo == null || h.hi == null)) return null;
  const ps = hs.map((h) => chanceAtLeast(h, spot.min));
  return Math.min(ps.reduce((a, p) => a + p, 0) / ps.length, Math.min(...ps) + 0.15);
}

export type ChanceWord = "Likely" | "Possible" | "Unlikely";
export const chanceWord = (p: number): ChanceWord => (p >= 0.7 ? "Likely" : p >= 0.4 ? "Possible" : "Unlikely");

/** "13–19": an hour's range in whole knots, or null without one. */
export const fmtRange = (h: Pick<Hour, "lo" | "hi">) => (h.lo != null && h.hi != null ? `${Math.round(h.lo)}–${Math.round(h.hi)}` : null);
