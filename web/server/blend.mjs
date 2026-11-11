// The SeaSensei blend, as the forecast contract describes it (steps 2 and 3), in one pure module: the server
// scores this against the raw models, so it has to be the same arithmetic the browser shows.

export const MODELS = ["hrrr", "rrfs", "nbm", "ecmwf", "gfs"];
/** The raw speeds (kn) every quantile map has a knot at. */
export const KNOTS = [0, 4, 8, 12, 16, 20, 25, 35];
/** Upper bound of each lead bucket, hours. */
export const LEAD_BUCKETS = [12, 36, 72, 9999];
export const bucketOf = (leadHours) => { const i = LEAD_BUCKETS.findIndex((b) => leadHours <= b); return i < 0 ? LEAD_BUCKETS.length - 1 : i; };

/** A correction never moves a speed by more than 40 % or 6 kn, and never below zero. */
export function clampCorrection(raw, calibrated) {
  const lim = Math.min(0.4 * raw, 6);
  return Math.max(0, Math.min(raw + lim, Math.max(raw - lim, calibrated)));
}

/** Piecewise-linear through the knots; outside them the nearest knot's offset carries on. No clamp. */
export function interpolate(qm, x) {
  if (x <= qm[0][0]) return x + (qm[0][1] - qm[0][0]);
  for (let i = 1; i < qm.length; i++) {
    const [x0, y0] = qm[i - 1], [x1, y1] = qm[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  const [xn, yn] = qm[qm.length - 1];
  return x + (yn - xn);
}

/** A model's raw speed through its quantile map. */
export const applyQm = (qm, raw) => clampCorrection(raw, interpolate(qm, raw));

/** Any valid map → the eight fixed knots, clamped and never decreasing. */
export function toKnots(qm) {
  let floor = 0;
  return KNOTS.map((r) => { floor = Math.max(floor, applyQm(qm, r)); return [r, +floor.toFixed(2)]; });
}

/**
 * One hour's blend. Each member: { speed (calibrated, kn), raw (the model's own speed), gust (its own, or null),
 * dir (degrees, or null), mae (its error at this lead), gf (its fallback gust factor) }. Models without a value
 * simply aren't members. Weights ∝ 1 / mae².
 */
export function blendHour(members) {
  const ms = members.filter((m) => Number.isFinite(m.speed) && m.mae > 0);
  if (!ms.length) return null;
  const ws = ms.map((m) => 1 / m.mae ** 2), total = ws.reduce((a, b) => a + b, 0);
  const mean = (f) => ms.reduce((a, m, i) => a + ws[i] * f(m), 0) / total;
  const speed = mean((m) => m.speed);
  let u = 0, v = 0;
  ms.forEach((m, i) => { if (Number.isFinite(m.dir)) { u += ws[i] * Math.sin((m.dir * Math.PI) / 180); v += ws[i] * Math.cos((m.dir * Math.PI) / 180); } });
  // Each model's own gust-to-speed ratio; its fallback factor when it has no gust (or no wind to take a ratio of).
  const ratio = mean((m) => (Number.isFinite(m.gust) && m.raw >= 1 ? Math.min(3, Math.max(1, m.gust / m.raw)) : m.gf ?? 1.3));
  return { speed, gust: Math.max(speed, speed * ratio), dir: u || v ? (Math.atan2(u, v) * 180 / Math.PI + 360) % 360 : null };
}
