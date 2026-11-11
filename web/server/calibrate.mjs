// Learning (forecast contract, step 7): pair what the stations measured (observe.mjs) with what each archived
// model run said for that hour (archive.mjs), and keep, per station × model, exponentially decaying statistics
// (≈ 30-day memory): the quantile map's knots, the average miss of the calibrated value per lead bucket and a
// gust factor (measured gust ÷ speed at 10 kn or more); plus pooled misses and gust factors (they set the blend's
// weights away from a sensor; pooled maps are never learned: a map borrowed from other stations backtested worse
// than the raw model), the blend's residual range (from daylight hours with 10 kn or more forecast, which is when
// a rider reads it), and a rolling 30-day score of the blend against each raw model. /api/calibration serves the result; the browser builds the SeaSensei forecast from it.
//
// How it stays correct and cheap:
//  - It only reads R2 (observations, run files, its own state). It never calls Open-Meteo.
//  - Valid hours are processed strictly in order, each exactly once. `through` in the state is the watermark; the
//    state is read from R2 at the start of a cycle and written once at the end, so a failed write, a restart or
//    two containers during a deploy can never count a station-hour-run twice.
//  - An hour is processed once it is SETTLE hours old (every run that could cover it has been archived, and the
//    observations have had time to arrive). A run counts for an hour at lead = valid − run time, if that lead is
//    1–12 h or the run is a 00/06/12/18Z one; trimmed runs are cached in memory, and a cycle reads at most
//    MAX_READS run files (it resumes where it stopped).
//  - Learned values take over gradually: what's served is a mix of the seed (calibration-seed.json; pooled where
//    the seed has nothing for a station) and the learned values, the learned share being n / (n + 300) with n the
//    decaying count of paired hours. Below n = 30 it is the seed alone.
//    Without R2, the server just serves the seed.
import fs from "node:fs";
import * as r2 from "./r2.mjs";
import { ARCHIVE_MODELS, cellOf, dirFor, runOfKey } from "./archive.mjs";
import * as observe from "./observe.mjs";
import { KNOTS, LEAD_BUCKETS, MODELS, applyQm, blendHour, bucketOf, clampCorrection, isDaylight, toKnots } from "./blend.mjs";

const HOUR = 3600, DAY = 86400;
const STATE_KEY = "calibration/v1/state.json";
const TAU_HOURS = 30 * 24;                // memory of the decaying averages
const MIN_N = 30;                         // paired hours (decaying count) before learned values are mixed in at all
const HALF_N = 300;                       // …and their share is n / (n + 300)
const SCORE_DAYS = 30;
const SETTLE_HOURS = Number(process.env.CALIBRATE_SETTLE_HOURS ?? 12);
const START_DAYS = Number(process.env.CALIBRATE_START_DAYS ?? 30);   // how far back a fresh state starts
const MAX_READS = Number(process.env.CALIBRATE_MAX_READS ?? 150);    // run files read per cycle
const MAX_HOURS = Number(process.env.CALIBRATE_MAX_HOURS ?? 240);    // observed hours processed per cycle
const CHECK_MS = Number(process.env.LEARN_CHECK_MS ?? 3600e3);
const BOOT_MS = Number(process.env.LEARN_BOOT_DELAY_MS ?? 90_000);
const WINDY = 10;                         // kn: gust factors and the residual range come from hours at least this windy
const SPEED_BINS = 50;                    // 1 kn bins, 0–50 kn
const RES_BINS = 80, RES_MIN = -20, RES_STEP = 0.5; // residual (observed − blend) bins

/* ---------------- the seed ---------------- */

const identity = (mae, gf) => ({ n: 0, qm: KNOTS.map((k) => [k, k]), mae, gf });
/** What's served when the seed file is missing or malformed: the models as they are, weighted by typical skill. */
export const BUILTIN_SEED = {
  version: 1, updated: "2026-11-11T00:00:00Z", source: "seed", leadBuckets: LEAD_BUCKETS, stations: [],
  pooled: { models: {
    hrrr: identity([1.9, 2.4, 2.8, 3.2], 1.3), rrfs: identity([2.0, 2.5, 2.9, 3.3], 1.3), nbm: identity([2.0, 2.3, 2.6, 3.0], 1.3),
    ecmwf: identity([2.3, 2.5, 2.7, 3.0], 1.35), gfs: identity([2.4, 2.7, 3.0, 3.3], 1.35),
  } },
  residual: { q10: [-2.4, -3.2, -3.8, -4.5], q90: [2.6, 3.4, 4.0, 4.8] },
  nowcast: { tauHours: 3, maxHours: 6 },
  score: null,
};

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const nums = (x, n) => Array.isArray(x) && x.length === n && x.every(isNum);

function seedModel(x, where) {
  const bad = (why) => { throw new Error(`${where}: ${why}`); };
  if (!x || typeof x !== "object") bad("missing");
  if (!Array.isArray(x.qm) || x.qm.length < 2 || !x.qm.every((k) => nums(k, 2) && k[0] >= 0 && k[1] >= 0)) bad("qm must be [[raw, calibrated], …]");
  if (!x.qm.every((k, i) => i === 0 || (k[0] > x.qm[i - 1][0] && k[1] >= x.qm[i - 1][1]))) bad("qm must rise");
  if (!nums(x.mae, LEAD_BUCKETS.length) || !x.mae.every((v) => v > 0)) bad("mae needs one positive value per lead bucket");
  if (!isNum(x.gf) || x.gf < 1 || x.gf > 3) bad("gf must be between 1 and 3");
  return { n: isNum(x.n) && x.n >= 0 ? x.n : 0, qm: toKnots(x.qm), mae: x.mae, gf: x.gf };
}

/** A seed in the contract's shape, checked and normalised to the fixed knots; throws when it isn't usable. */
export function parseSeed(json) {
  if (json?.version !== 1) throw new Error("version must be 1");
  if (!nums(json.leadBuckets, LEAD_BUCKETS.length) || json.leadBuckets.some((b, i) => b !== LEAD_BUCKETS[i])) throw new Error(`leadBuckets must be ${JSON.stringify(LEAD_BUCKETS)}`);
  const pooled = Object.fromEntries(MODELS.map((m) => [m, seedModel(json.pooled?.models?.[m], `pooled.${m}`)]));
  if (!Array.isArray(json.stations)) throw new Error("stations must be a list");
  const stations = json.stations.map((s, i) => {
    if (!s || typeof s.id !== "string" || !isNum(s.lat) || !isNum(s.lon) || !["water", "shore", "airport"].includes(s.kind)) throw new Error(`stations[${i}] needs id, lat, lon and kind`);
    const models = Object.fromEntries(Object.entries(s.models ?? {}).map(([m, x]) => {
      if (!MODELS.includes(m)) throw new Error(`stations[${i}]: unknown model ${m}`);
      return [m, seedModel(x, `${s.id}.${m}`)];
    }));
    return { id: s.id, name: String(s.name ?? s.id), lat: s.lat, lon: s.lon, kind: s.kind, models };
  });
  const r = json.residual, n = LEAD_BUCKETS.length;
  if (!nums(r?.q10, n) || !nums(r?.q90, n) || r.q10.some((v, i) => v > 0 || r.q90[i] < 0)) throw new Error("residual needs q10 ≤ 0 ≤ q90 per lead bucket");
  const nc = json.nowcast;
  if (!isNum(nc?.tauHours) || nc.tauHours <= 0 || !isNum(nc?.maxHours) || nc.maxHours < 0) throw new Error("nowcast needs tauHours and maxHours");
  return {
    version: 1, updated: typeof json.updated === "string" && !Number.isNaN(Date.parse(json.updated)) ? json.updated : BUILTIN_SEED.updated,
    source: "seed", leadBuckets: LEAD_BUCKETS, stations, pooled: { models: pooled },
    residual: { q10: r.q10, q90: r.q90 }, nowcast: { tauHours: nc.tauHours, maxHours: nc.maxHours },
    score: json.score && typeof json.score === "object" && json.score.models ? json.score : null,
  };
}

function loadSeed() {
  const file = process.env.CALIBRATION_SEED_FILE || new URL("./calibration-seed.json", import.meta.url);
  try { return { seed: parseSeed(JSON.parse(fs.readFileSync(file, "utf8"))), error: null }; }
  catch (e) {
    console.error(`[calibration] seed file not usable (${e.message}); serving the built-in identity seed`);
    return { seed: parseSeed(BUILTIN_SEED), error: e.message };
  }
}
const { seed, error: seedError } = loadSeed();

/* ---------------- the state: decaying statistics ---------------- */

const zeros = (n) => new Array(n).fill(0);
/** One station × model (or pooled model): n paired hours; histograms of forecast and observed speed; per lead bucket [Σ|error|, hours]; gust [Σ observed gust, Σ observed speed]. All decaying. */
const newAcc = () => ({ n: 0, f: zeros(SPEED_BINS), o: zeros(SPEED_BINS), mae: LEAD_BUCKETS.map(() => [0, 0]), gf: [0, 0] });
export const freshState = (through) => ({
  version: 1, updated: null, through, clock: through, pairedHours: 0, stations: {}, pooled: {},
  residual: LEAD_BUCKETS.map(() => ({ w: 0, h: zeros(RES_BINS) })), score: {},
});

const saneAcc = (a) => a && isNum(a.n) && nums(a.f, SPEED_BINS) && nums(a.o, SPEED_BINS) && Array.isArray(a.mae) && a.mae.length === LEAD_BUCKETS.length && a.mae.every((x) => nums(x, 2)) && nums(a.gf, 2);
/** A state read back from R2 is used only if it's whole; anything else starts again (the archive is still there). */
export function saneState(s) {
  return !!s && s.version === 1 && isNum(s.through) && isNum(s.clock) && isNum(s.pairedHours)
    && s.stations && typeof s.stations === "object" && Object.values(s.stations).every((st) => st && isNum(st.lat) && isNum(st.lon) && st.models && Object.values(st.models).every(saneAcc))
    && s.pooled && typeof s.pooled === "object" && Object.values(s.pooled).every(saneAcc)
    && Array.isArray(s.residual) && s.residual.length === LEAD_BUCKETS.length && s.residual.every((r) => r && isNum(r.w) && nums(r.h, RES_BINS))
    && s.score && typeof s.score === "object";
}

const scale = (xs, k) => { for (let i = 0; i < xs.length; i++) xs[i] *= k; };
function decayAcc(a, k) { a.n *= k; scale(a.f, k); scale(a.o, k); for (const x of a.mae) scale(x, k); scale(a.gf, k); }
/** Moves the state's clock to hour `t`: everything learned so far fades by exp(−hours / 720), observed or not. */
function decayTo(st, t) {
  const k = Math.exp(-Math.max(0, t - st.clock) / HOUR / TAU_HOURS);
  st.clock = t;
  for (const s of Object.values(st.stations)) for (const a of Object.values(s.models)) decayAcc(a, k);
  for (const a of Object.values(st.pooled)) decayAcc(a, k);
  for (const r of st.residual) { r.w *= k; scale(r.h, k); }
}

const bin = (x) => Math.min(SPEED_BINS - 1, Math.max(0, Math.floor(x)));
/** Weight below speed x, spreading each 1 kn bin evenly. */
function below(h, x) {
  const i = bin(x);
  let a = 0;
  for (let k = 0; k < i; k++) a += h[k];
  return a + h[i] * Math.min(1, Math.max(0, x - i));
}
/** The speed below which `mass` of the weight lies. */
function speedAt(h, mass) {
  let a = 0;
  for (let k = 0; k < h.length; k++) {
    if (h[k] > 0 && a + h[k] >= mass) return k + (mass - a) / h[k];
    a += h[k];
  }
  return h.length;
}
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/**
 * The quantile map at the fixed knots: a raw speed goes to the observed speed at the same rank
 * (the share of forecasts below it = the share of observations below the answer). Knots the forecasts rarely
 * reach carry the correction of the nearest knot they do; then the ±40 % / ±6 kn clamp, never decreasing.
 * Null when there isn't enough to say anything.
 */
export function learnedQm(acc) {
  const nf = sum(acc.f), no = sum(acc.o);
  if (!(nf > 0) || !(no > 0)) return null;
  const support = Math.max(6, 0.02 * nf);
  const offs = KNOTS.map((r) => {
    if (r === 0) return 0;
    const under = below(acc.f, r);
    return under >= support && nf - under >= support ? speedAt(acc.o, (under / nf) * no) - r : null;
  });
  const known = KNOTS.map((_, i) => i).filter((i) => i > 0 && offs[i] != null);
  if (!known.length) return null;
  const lo = known[0], hi = known.at(-1);
  let floor = 0;
  return KNOTS.map((r, i) => {
    const off = offs[i] ?? (i > hi ? offs[hi] : i < lo ? (offs[lo] * r) / KNOTS[lo] : offs[known.filter((j) => j < i).at(-1)]);
    floor = Math.max(floor, clampCorrection(r, r + off));
    return [r, +floor.toFixed(2)];
  });
}

/** The learned share of a served value: nothing below 30 paired hours, then n / (n + 300). */
export const share = (n) => (n >= MIN_N ? n / (n + HALF_N) : 0);

/**
 * What's in force for one station × model or pooled model: the prior (seed / pooled) mixed with the learned values
 * by `share(n)`, for the knots, the misses and the gust factor alike; the mixed map is clamped and never decreasing.
 * Pooled models (`withMap` false) keep the seed's map, whatever was observed.
 */
function inForce(acc, prior, withMap = true) {
  const w = acc ? share(acc.n) : 0, qm = w && withMap ? learnedQm(acc) : null;
  if (!w || (withMap && !qm)) return prior ? { ...prior, learned: false } : null;
  const mix = (old, now) => old + w * (now - old);
  let floor = 0;
  return {
    n: Math.round(acc.n), learned: true,
    qm: qm ? KNOTS.map((r, i) => { floor = Math.max(floor, clampCorrection(r, mix(prior.qm[i][1], qm[i][1]))); return [r, +floor.toFixed(2)]; }) : prior.qm,
    mae: acc.mae.map(([e, hours], b) => (hours >= 24 ? +Math.max(0.3, mix(prior.mae[b], e / hours)).toFixed(2) : prior.mae[b])),
    gf: acc.gf[1] >= 30 * WINDY ? +Math.min(2, Math.max(1, mix(prior.gf, acc.gf[0] / acc.gf[1]))).toFixed(2) : prior.gf,
  };
}

/** Everything in force for a state: pooled per model, and per station the models that have their own values. */
function table(st) {
  const pooled = Object.fromEntries(MODELS.map((m) => [m, inForce(st.pooled[m], seed.pooled.models[m], false)]));
  const stations = new Map(seed.stations.map((s) => [s.id, { ...s, models: Object.fromEntries(Object.entries(s.models).map(([m, x]) => [m, { ...x, learned: false }])) }]));
  for (const [id, s] of Object.entries(st.stations)) {
    const prior = stations.get(id);
    const models = { ...prior?.models };
    for (const m of MODELS) {
      const x = inForce(s.models[m], prior?.models[m] ?? pooled[m]);
      if (x?.learned) models[m] = x;
    }
    // The seed's description of a station (the scientist's, e.g. its kind) wins over the one inferred from its id.
    stations.set(id, { id, name: prior?.name ?? s.name, lat: prior?.lat ?? s.lat, lon: prior?.lon ?? s.lon, kind: prior?.kind ?? s.kind, models });
  }
  return { pooled, stations };
}

/* ---------------- one valid hour ---------------- */

const dayOf = (t) => new Date(t * 1000).toISOString().slice(0, 10);

/**
 * Folds one valid hour into the state. `obs`: [{ id, name, lat, lon, kind, s, g }] (speed and peak gust, kn);
 * `forecasts(id, model)`: [{ lead (hours), f, g, d }] from every run that counts for this hour.
 * The calibrated values scored here use what was in force before this hour, so nothing is scored on itself.
 */
export function processHour(st, t, obs, forecasts) {
  const tab = table(st);
  decayTo(st, t);
  st.through = t;
  // Spots are on the water: pooled values, the residual range and the score come from water and shore sensors;
  // airports only when there is nothing else.
  const wet = obs.filter((o) => o.kind !== "airport");
  const pool = new Set((wet.length ? wet : obs).map((o) => o.id));
  const cands = obs.map((o) => Object.fromEntries(MODELS.map((m) => [m, forecasts(o.id, m).filter((r) => isNum(r.f) && r.f >= 0)])));
  const poolSize = Object.fromEntries(MODELS.map((m) => [m, obs.filter((o, i) => pool.has(o.id) && cands[i][m].length).length]));
  const poolWeight = 1 / Math.max(1, obs.filter((o, i) => pool.has(o.id) && MODELS.some((m) => cands[i][m].length)).length);
  const day = dayOf(t);

  obs.forEach((o, i) => {
    const mine = tab.stations.get(o.id)?.models ?? {};
    const inPool = pool.has(o.id);
    const members = LEAD_BUCKETS.map(() => []);
    let paired = false;
    for (const m of MODELS) {
      const runs = cands[i][m];
      if (!runs.length) continue;
      paired = true;
      const sv = mine[m] ?? tab.pooled[m];
      const s = (st.stations[o.id] ??= { name: o.name, lat: o.lat, lon: o.lon, kind: o.kind, models: {} });
      Object.assign(s, { name: o.name, lat: o.lat, lon: o.lon, kind: o.kind });
      const targets = [{ acc: (s.models[m] ??= newAcc()), w: 1, qm: sv.qm }];
      if (inPool) targets.push({ acc: (st.pooled[m] ??= newAcc()), w: 1 / poolSize[m], qm: tab.pooled[m].qm });
      for (const { acc, w, qm } of targets) {
        acc.n += w;
        if (acc !== st.pooled[m]) { acc.o[bin(o.s)] += w; for (const r of runs) acc.f[bin(r.f)] += w / runs.length; } // no pooled map is learned
        for (let b = 0; b < LEAD_BUCKETS.length; b++) {
          const inB = runs.filter((r) => bucketOf(r.lead) === b);
          if (!inB.length) continue;
          acc.mae[b][0] += (w * sum(inB.map((r) => Math.abs(applyQm(qm, r.f) - o.s)))) / inB.length;
          acc.mae[b][1] += w;
        }
        // The gust factor is the station's own: measured gust over measured speed, in wind worth riding.
        if (isNum(o.g) && o.s >= WINDY) { acc.gf[0] += w * Math.max(o.g, o.s); acc.gf[1] += w * o.s; }
      }
      // The blend's member for each lead bucket: this model's newest run in the bucket.
      for (let b = 0; b < LEAD_BUCKETS.length; b++) {
        const r = runs.filter((x) => bucketOf(x.lead) === b).sort((a, c) => a.lead - c.lead)[0];
        if (r) members[b].push({ model: m, speed: applyQm(sv.qm, r.f), raw: r.f, gust: r.g, dir: r.d, mae: sv.mae[b], gf: sv.gf, pooled: tab.pooled[m] });
      }
    }
    if (!paired) return;
    st.pairedHours++;
    if (!inPool) return;
    const sunUp = isDaylight(o.lat, o.lon, t);
    members.forEach((ms, b) => {
      // The blend a rider at this station's own spot would see: its own maps and misses.
      const x = blendHour(ms);
      if (!x) return;
      const res = o.s - x.speed;
      // The range is read when it blows: its quantiles come from daylight hours with 10 kn or more forecast.
      if (sunUp && x.speed >= WINDY) {
        st.residual[b].w += poolWeight;
        st.residual[b].h[Math.min(RES_BINS - 1, Math.max(0, Math.floor((res - RES_MIN) / RES_STEP)))] += poolWeight;
      }
      // The score: the first two buckets (to 36 h ahead), where every model can take part.
      if (b > 1) return;
      const d = (st.score[day] ??= {});
      const add = (k, err) => { const e = (d[k] ??= [0, 0, 0]); e[0] += err; e[1]++; e[2] += Math.abs(res); };
      add("sensei", Math.abs(res));
      // …and the blend where there is no sensor to learn from, as at most spots: pooled maps (identity) and misses.
      const far = blendHour(ms.map((m) => ({ ...m, speed: applyQm(m.pooled.qm, m.raw), mae: m.pooled.mae[b], gf: m.pooled.gf })));
      d.sensei[2] += Math.abs(o.s - far.speed) - Math.abs(res); // sensei's third slot: Σ|error| of the pooled blend
      for (const m of ms) add(m.model, Math.abs(m.raw - o.s));
    });
  });
  for (const d of Object.keys(st.score)) if (Date.parse(day) - Date.parse(d) >= SCORE_DAYS * DAY * 1000) delete st.score[d];
}

/* ---------------- what /api/calibration serves ---------------- */

function quantile(r, q) {
  let a = 0;
  for (let k = 0; k < r.h.length; k++) {
    if (r.h[k] > 0 && a + r.h[k] >= q * r.w) return RES_MIN + (k + (q * r.w - a) / r.h[k]) * RES_STEP;
    a += r.h[k];
  }
  return RES_MIN + r.h.length * RES_STEP;
}

/** The contract's document for a state (null: nothing learned, the seed as it is). */
export function build(st) {
  const strip = ({ n, qm, mae, gf }) => ({ n, qm, mae, gf });
  if (!st) return { ...seed, stations: seed.stations.map((s) => ({ ...s })) };
  const tab = table(st);
  const stations = [...tab.stations.values()].filter((s) => Object.keys(s.models).length || seed.stations.some((x) => x.id === s.id))
    .map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, kind: s.kind, models: Object.fromEntries(Object.entries(s.models).map(([m, x]) => [m, strip(x)])) }));
  // The residual range hands over the same way as the maps.
  const learnedRes = st.residual.map((r) => share(r.w) > 0);
  const range = (r, b, q, old) => old + share(r.w) * (quantile(r, q) - old);
  const q10 = st.residual.map((r, b) => (learnedRes[b] ? +Math.min(-0.5, range(r, b, 0.1, seed.residual.q10[b])).toFixed(2) : seed.residual.q10[b]));
  const q90 = st.residual.map((r, b) => (learnedRes[b] ? +Math.max(0.5, range(r, b, 0.9, seed.residual.q90[b])).toFixed(2) : seed.residual.q90[b]));
  const days = Object.keys(st.score).sort(), totals = {};
  for (const d of days) for (const [k, [e, n, se]] of Object.entries(st.score[d])) { const x = (totals[k] ??= [0, 0, 0]); x[0] += e; x[1] += n; x[2] += se; }
  // Each raw model also carries the blend's miss over the very hours that model was scored on (`senseiMae`): like for like.
  // `senseiPooledMae`: the blend over the same hours with no station of its own (pooled maps and misses).
  const score = totals.sensei?.[1] ? {
    days: SCORE_DAYS, from: days[0], to: days.at(-1), senseiPooledMae: +(totals.sensei[2] / totals.sensei[1]).toFixed(2),
    models: Object.fromEntries(Object.entries(totals).map(([k, [e, n, se]]) => [k, k === "sensei" ? { mae: +(e / n).toFixed(2), n } : { mae: +(e / n).toFixed(2), n, senseiMae: +(se / n).toFixed(2) }])),
  } : seed.score;
  const learned = learnedRes.some(Boolean) || Object.values(tab.pooled).some((x) => x.learned) || [...tab.stations.values()].some((s) => Object.values(s.models).some((x) => x.learned));
  return {
    version: 1, updated: learned ? st.updated ?? seed.updated : seed.updated, source: learned ? "learned" : "seed", leadBuckets: LEAD_BUCKETS,
    stations, pooled: { models: Object.fromEntries(MODELS.map((m) => [m, strip(tab.pooled[m])])) },
    residual: { q10, q90 }, nowcast: seed.nowcast, score,
  };
}

/* ---------------- reading R2: runs and observations ---------------- */

const runs = new Map(); // key → null (unusable) | { run, end, times, pts: Map(station id → { s, g, d }) }
const info = { lastCycle: null, lastError: null, cycles: 0, through: null, pairedHours: 0, stationsLearned: 0, runsRead: 0, runsSkipped: 0, errors: 0, seedError };
let current = null, served = null, busy = false;

/** A run file → just the station points' wind. Null when it isn't the run, model and cell its key says. */
function trim(doc, m, run) {
  if (!doc || doc.model !== m.id || (doc.cell ?? "land") !== cellOf(m) || Date.parse(doc.run) / 1000 !== run || !Array.isArray(doc.times) || !Array.isArray(doc.points)) return null;
  const pts = new Map();
  doc.points.forEach((p, i) => {
    if (!/^(coops|asos):/.test(p.id ?? "")) return;
    pts.set(p.id, { s: doc.values?.wind_speed_10m?.[i] ?? [], g: doc.values?.wind_gusts_10m?.[i] ?? [], d: doc.values?.wind_direction_10m?.[i] ?? [] });
  });
  return { run, end: doc.dataEnd ? Date.parse(doc.dataEnd) / 1000 : Infinity, times: doc.times, pts };
}

const counts = (m, run, t) => { const lead = (t - run) / HOUR; return lead >= 1 && lead <= m.days * 24 && (lead <= 12 || run % (6 * HOUR) === 0); };

async function listRuns(from, to) {
  const out = {};
  for (const m of ARCHIVE_MODELS) {
    const months = [];
    for (let d = new Date((from - m.days * DAY) * 1000); d.getTime() / 1000 <= to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)))
      months.push(d.toISOString().slice(0, 7).replace("-", "/"));
    out[m.id] = [];
    for (const month of months) for (const key of await r2.list(`${dirFor(m)}/${month}/`)) { const run = runOfKey(key); if (run != null) out[m.id].push({ key, run }); }
  }
  return out;
}

/** One learning cycle. Returns the number of hours it moved the watermark by. */
export async function cycle(now = Date.now()) {
  if (!r2.configured() || busy) return 0;
  busy = true;
  try {
    // Always from R2: it is the one copy that counts (see the top of the file).
    const raw = await r2.get(STATE_KEY);
    let st = null;
    if (raw) { try { st = JSON.parse(raw.toString()); } catch { /* fall through */ } if (!saneState(st)) { console.error("[calibration] the saved state is unreadable; starting again from the archive"); st = null; } }
    const top = (ms) => Math.floor(ms / 1000 / HOUR) * HOUR;
    st ??= freshState(top(now) - START_DAYS * DAY);
    const target = top(now - SETTLE_HOURS * 3600e3), from = st.through + HOUR;
    let moved = 0, done = 0, reads = 0;
    if (from <= target) {
      const listing = await listRuns(from, target);
      const days = new Map();
      const obsDay = async (t) => {
        const key = observe.dayKey(t * 1000);
        if (!days.has(key)) days.set(key, await r2.getJsonGz(key).catch((e) => { if (e instanceof SyntaxError || e.code?.startsWith?.("Z_")) return null; throw e; }));
        return days.get(key);
      };
      for (let t = from; t <= target && done < MAX_HOURS; t += HOUR) {
        const doc = await obsDay(t);
        const obs = Object.entries(doc?.stations ?? {}).flatMap(([id, s]) => {
          const h = s?.hours?.[t];
          return h && isNum(h.s) && h.s >= 0 && isNum(s.lat) && isNum(s.lon) ? [{ id, name: String(s.name ?? id), lat: s.lat, lon: s.lon, kind: ["water", "shore", "airport"].includes(s.kind) ? s.kind : observe.kindOf(id), s: h.s, g: isNum(h.g) ? h.g : null }] : [];
        });
        if (obs.length) {
          const need = ARCHIVE_MODELS.flatMap((m) => listing[m.id].filter((r) => counts(m, r.run, t)).map((r) => ({ ...r, m })));
          const missing = need.filter((r) => !runs.has(r.key));
          const batch = missing.slice(0, MAX_READS - reads);
          for (let i = 0; i < batch.length; i += 8) await Promise.all(batch.slice(i, i + 8).map(async (r) => {
            const got = await r2.getJsonGz(r.key).catch((e) => { if (e instanceof SyntaxError || e.code?.startsWith?.("Z_")) return null; throw e; });
            const kept = trim(got, r.m, r.run);
            runs.set(r.key, kept);
            kept ? info.runsRead++ : info.runsSkipped++;
          }));
          reads += batch.length;
          if (batch.length < missing.length) break; // this cycle's reads are spent; the hour waits for the next one
          const byModel = Object.fromEntries(ARCHIVE_MODELS.map((m) => [m.id, need.filter((r) => r.m === m).map((r) => runs.get(r.key)).filter(Boolean)]));
          processHour(st, t, obs, (id, model) => byModel[model].flatMap((r) => {
            const p = r.pts.get(id);
            if (!p || t > r.end) return [];
            let i = (t - r.times[0]) / HOUR;
            if (r.times[i] !== t) i = r.times.indexOf(t);
            return i >= 0 && isNum(p.s[i]) ? [{ lead: (t - r.run) / HOUR, f: p.s[i], g: isNum(p.g[i]) ? p.g[i] : null, d: isNum(p.d[i]) ? p.d[i] : null }] : [];
          }));
          done++;
        }
        st.through = t;
        moved++;
      }
    }
    if (moved) {
      st.updated = new Date(now).toISOString();
      await r2.put(STATE_KEY, JSON.stringify(st), "application/json"); // the watermark and what it counted, in one write
      if (done) console.log(`[calibration] paired ${done} observed hours, through ${new Date(st.through * 1000).toISOString()}`);
    }
    current = st; served = null;
    for (const [key, r] of runs) if ((r?.run ?? runOfKey(key)) < st.through - 8 * DAY) runs.delete(key);
    const tab = table(st);
    Object.assign(info, {
      lastCycle: new Date(now).toISOString(), lastError: null, cycles: info.cycles + 1, through: new Date(st.through * 1000).toISOString(), pairedHours: st.pairedHours,
      stationsLearned: [...tab.stations.values()].filter((s) => Object.values(s.models).some((x) => x.learned)).length,
    });
    return moved;
  } catch (e) {
    info.errors++;
    info.lastError = e.message;
    console.error(`[calibration] ${e.message}`);
    return 0;
  } finally { busy = false; }
}

/** The document for GET /api/calibration: learned where there is enough, the seed otherwise (and without R2). */
export const calibration = () => (served ??= build(current));

/** For /api/archive. */
export const status = () => ({ ...info, source: calibration().source });

/** Hourly: save the stations' observations, then learn from them. Nothing runs without R2. */
export function startLearning() {
  if (!r2.configured()) return;
  const run = async () => { await observe.tick(); await cycle(); };
  setTimeout(run, BOOT_MS).unref();
  setInterval(run, CHECK_MS).unref();
}
