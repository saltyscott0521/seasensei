import { memo, useCallback, useMemo } from "react";
import { handoffs, compass, windStops, windColor, type Forecast, type Hour, type Obs, type Spot } from "../lib/wind";
import { useAt, useNow } from "../lib/time";
import { DayNight, DrawIn, Handoffs, HatchDef, NowLine, Pill, RangeLines, Sessions, SpeedGrid, TimeAxis, type Box } from "./charts/parts";
import { forecastSummary, fmtWhen, HOUR, nearestIndex, nightSpans, sessionSpans, speedTicks, speedTop, timeAxis, useSvgId } from "./charts/scale";
import { useScrub } from "./charts/useScrub";
import { useChartSize } from "./useChartSize";

export type Range = "24h" | "48h" | "7d";
/** Plot margins shared by the line and bar charts, so their time axes line up exactly. */
export const L = 30, R = 10, T = 24, B = 24;

/** The forecast hours to draw for a range, and whether they're mostly in the past. */
export function windowFor(hours: Hour[], range: Range, now = Date.now()) {
  const from = range === "24h" ? now - 24 * HOUR : now - 6 * HOUR;
  const to = range === "24h" ? now + 3 * HOUR : range === "48h" ? now + 48 * HOUR : Infinity;
  const r = hours.filter((h) => h.t >= from && h.t <= to);
  return r.length > 1 ? r : hours;
}

const LABEL: Record<Range, string> = { "24h": "Past 24 hours, forecast versus actual", "48h": "48 hour wind forecast", "7d": "7 day wind forecast" };

/**
 * The line chart: sustained wind as an area on the wind scale, gusts as a thin dashed line, the rider's daylight
 * sessions (the same runs as the session chips) as a go band, night shaded, model handoffs (NBM hatched), now in
 * accent, the station's readings in white when we have them, and a scrub cursor with a readout. `scrubT` is the
 * shared cursor: another chart's scrub, else the timeline's hour (shown only when it falls inside this range).
 */
export const ForecastChart = memo(function ForecastChart({ forecast, spot, onScrub, range, obs, scrubT, maxH = 560, minH = 250 }: {
  forecast: Forecast; spot: Spot; onScrub: (h: Hour | null) => void; range: Range; obs?: Obs[]; scrubT?: number | null; maxH?: number; minH?: number;
}) {
  const now = useNow();
  const at = useAt();
  const shared = scrubT ?? at; // the parent's cursor, else the timeline's hour
  const tz = forecast.timeZone;
  const hs = useMemo(() => windowFor(forecast.hours, range, now), [forecast.hours, range, now]);
  const [wrapRef, { w: W, h: H }] = useChartSize(minH, 0.62, maxH);
  const box: Box = useMemo(() => ({ l: L, r: W - R, t: T, b: H - B }), [W, H]);
  const ids = { grad: useSvgId("spd"), fade: useSvgId("fade"), mask: useSvgId("mask"), hatch: useSvgId("hatch"), clip: useSvgId("draw"), desc: useSvgId("desc") };

  const m = useMemo(() => {
    const t0 = hs[0].t, t1 = hs[hs.length - 1].t;
    const seen = (obs ?? []).filter((o) => o.t >= t0 && o.t <= t1);
    const top = speedTop(spot.max, [...hs.map((h) => h.gust), ...seen.map((o) => o.speed)]);
    const x = (t: number) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
    const y = (v: number) => T + (1 - v / top) * (H - T - B);
    const pts = (k: "speed" | "gust") => hs.map((h, i) => `${i ? "L" : "M"}${x(h.t).toFixed(1)},${y(h[k]).toFixed(1)}`).join("");
    const speed = pts("speed");
    const nbm = hs.find((h, i) => i > 0 && h.model === "nbm"); // NBM after a sharper model: hatch it as lower confidence
    return {
      t0, t1, top, x, y, seen, speed,
      area: `${speed}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`,
      gust: pts("gust"),
      ticks: speedTicks(top),
      axis: timeAxis(t0, t1, tz, x, W - L - R),
      nights: nightSpans(spot.lat, spot.lon, t0, t1),
      sessions: sessionSpans(forecast.hours, spot, t0, t1),
      nbmX: nbm ? x(nbm.t) : null,
      hand: handoffs(hs).map((d) => ({ ...d, x: x(d.t) })),
      obsLine: seen.length > 1 ? seen.map((o, i) => `${i ? "L" : "M"}${x(o.t).toFixed(1)},${y(o.speed).toFixed(1)}`).join("") : null,
    };
  }, [hs, obs, spot, forecast.hours, tz, W, H]);

  const times = useMemo(() => hs.map((h) => h.t), [hs]);
  const tAtX = useCallback((px: number) => m.t0 + ((px - L) / (W - L - R)) * (m.t1 - m.t0), [m, W]);
  const emit = useCallback((i: number | null) => onScrub(i == null ? null : hs[i]), [onScrub, hs]);
  const scrub = useScrub(times, tAtX, emit, shared ?? now);

  const summary = useMemo(() => {
    const base = forecastSummary(hs, forecast.hours, spot, tz, now);
    const keys = " The left and right arrow keys read each hour, with Shift six at a time; Escape clears.";
    if (range !== "24h" || m.seen.length < 2) return base + keys;
    const meas = m.seen.reduce((a, o) => (o.speed > a.speed ? o : a));
    return `${base} The station measured up to ${Math.round(meas.speed)} knots, drawn in white.${keys}`;
  }, [hs, forecast.hours, spot, tz, now, range, m.seen]);

  if (!W) return <div ref={wrapRef} style={{ height: H }} />;

  const nowX = now >= m.t0 && now <= m.t1 ? m.x(now) : null;
  const ct = scrub.t ?? (shared != null && shared >= m.t0 - HOUR / 2 && shared <= m.t1 + HOUR / 2 ? shared : null);
  const c = ct != null ? hs[nearestIndex(hs, ct, (h) => h.t)] : null;
  const cObs = c ? m.seen.reduce<Obs | null>((b, o) => (Math.abs(o.t - c.t) < 45 * 60e3 && (!b || Math.abs(o.t - c.t) < Math.abs(b.t - c.t)) ? o : b), null) : null;

  return (
    <div ref={wrapRef} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={LABEL[range]} aria-describedby={ids.desc}
        aria-roledescription="chart" tabIndex={0}
        className="block cursor-crosshair touch-pan-y select-none rounded-sm"
        onMouseDown={(e) => e.preventDefault()} {...scrub.handlers} {...scrub.keys}>
        <defs>
          <linearGradient id={ids.grad} x1="0" y1={m.y(0)} x2="0" y2={m.y(m.top)} gradientUnits="userSpaceOnUse">
            {windStops(m.top).map((st, i) => <stop key={i} offset={st.offset} stopColor={st.color} />)}
          </linearGradient>
          <linearGradient id={ids.fade} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="white" stopOpacity=".5" />
            <stop offset="1" stopColor="white" stopOpacity=".03" />
          </linearGradient>
          <mask id={ids.mask}><rect width={W} height={H} fill={`url(#${ids.fade})`} /></mask>
          <HatchDef id={ids.hatch} />
        </defs>

        <DayNight nights={m.nights} x={m.x} box={box} />
        <Sessions spans={m.sessions} x={m.x} box={box} base={m.y(0)} />
        <SpeedGrid ticks={m.ticks} y={m.y} box={box} />
        <RangeLines y={m.y} min={spot.min} max={spot.max} box={box} />
        <TimeAxis rules={m.axis.rules} labels={m.axis.labels} box={box} labelY={H - 7} W={W} />

        <DrawIn id={ids.clip} drawKey={`line:${spot.id}`} W={W} H={H}>
          <path d={m.area} fill={`url(#${ids.grad})`} mask={`url(#${ids.mask})`} />
          <path d={m.gust} fill="none" strokeWidth="1.25" strokeDasharray="3 3" strokeLinecap="round" className="stroke-fg-2" />
          <path d={m.speed} fill="none" stroke={`url(#${ids.grad})`} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {/* what the station actually measured, over an ink halo so it reads on any colour */}
          {m.obsLine && <path d={m.obsLine} fill="none" strokeWidth="4.5" strokeLinejoin="round" strokeLinecap="round" className="stroke-ink/80" />}
          {m.obsLine && <path d={m.obsLine} fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        </DrawIn>

        {m.nbmX != null && <rect pointerEvents="none" x={m.nbmX} width={Math.max(0, W - R - m.nbmX)} y={T} height={H - T - B} fill={`url(#${ids.hatch})`} />}
        <Handoffs hand={m.hand} box={box} W={W} labelY={14} confidence />
        {nowX != null && <NowLine x={nowX} box={box} tag={!c} />}

        {c && (
          <g pointerEvents="none">
            <line x1={m.x(c.t)} x2={m.x(c.t)} y1={T - 2} y2={H - B} className="stroke-fg" strokeOpacity=".7" />
            <circle cx={m.x(c.t)} cy={m.y(c.gust)} r="2.5" className="fill-fg-2" />
            <circle cx={m.x(c.t)} cy={m.y(c.speed)} r="5" fill={windColor(c.speed)} strokeWidth="2" className="stroke-ink" />
            {cObs && <circle cx={m.x(cObs.t)} cy={m.y(cObs.speed)} r="4" fill="white" strokeWidth="2" className="stroke-ink" />}
            <Pill x={m.x(c.t)} y={1} minX={2} maxX={W - 2}>
              <tspan className="fill-fg" fontWeight="600">{fmtWhen(c.t, tz)}</tspan>
              {` · ${Math.round(c.speed)} kn ${compass(c.dir)} · gusts ${Math.round(c.gust)}`}
              {cObs ? ` · actual ${Math.round(cObs.speed)}` : ""}
            </Pill>
          </g>
        )}
      </svg>
      <p id={ids.desc} hidden>{summary}</p>
    </div>
  );
});
