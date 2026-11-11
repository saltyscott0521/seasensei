import { memo, useCallback, useMemo, type CSSProperties, type ReactNode } from "react";
import { compass, handoffs, inArc, windColor, windGradient, type Forecast, type Hour, type Obs, type Spot } from "../lib/wind";
import { fmtRange } from "../lib/sensei";
import { darkWord, isDaylightHour } from "../lib/session";
import { useAt, useNow } from "../lib/time";
import { DayNight, DrawIn, Handoffs, NowLine, Pill, RangeLines, SpeedGrid, TimeAxis, type Box } from "./charts/parts";
import { HOUR, nearestIndex, nightSpans, sessionSpans, speedTicks, speedTop, timeAxis, useSvgId } from "./charts/scale";
import { useScrub } from "./charts/useScrub";
import { L, R, T, windowFor, type Range } from "./ForecastChart";
import { useChartSize } from "./useChartSize";

const STRIP = 7;  // the per-hour status strip under the bars (height is part of the contract: e2e looks for rect[height=7])
const ARROWS = 14; // direction row under the strip
const B = 8 + STRIP + 6 + ARROWS + 18; // gap, strip, gap, arrows, time labels

type Status = "good" | "offdir" | "below" | "above";
// The verdict colours (styles/theme.css: go, wrongdir, off, strong). Literal fills, because each strip rect's `fill`
// attribute is what tells hours apart in the e2e test. Wrong direction is hatched (its own pattern, see HatchWrong),
// as on the ribbons and the hour grid, so it never relies on hue next to too strong.
const STATUS_FILL: Record<Status, string> = { good: "#34d399", offdir: "#f59e0b", below: "#64748b", above: "#fb7185" };
const HATCH_CSS: CSSProperties = {
  background: "repeating-linear-gradient(135deg, var(--color-wrongdir) 0 2px, color-mix(in oklab, var(--color-wrongdir) 28%, transparent) 2px 4px)",
};
const STATUS_WORD: Record<Status, string> = { good: "rideable", offdir: "wrong direction", below: "too light", above: "too strong" };
const statusOf = (h: Hour, spot: Spot): Status =>
  h.speed < spot.min ? "below" : h.speed > spot.max ? "above" : inArc(h.dir, spot) ? "good" : "offdir";

/**
 * One bar per hour on the same time axis (and the same cursor) as the line chart above it.
 *   bar        = sustained wind on the wind scale; hours inside a daylight session are full strength, others muted
 *   faded cap  = gusts
 *   strip      = what the hour means for THIS spot: rideable, wrong direction, too light, too strong (night hours dimmed:
 *                they never count towards a session)
 *   arrows     = where the wind is blowing toward
 * White dots are what the station measured.
 */
export const BarChart = memo(function BarChart({ forecast, spot, range, obs, scrubT, onScrub }: {
  forecast: Forecast; spot: Spot; range: Range; obs?: Obs[]; scrubT?: number | null; onScrub: (h: Hour | null) => void;
}) {
  const now = useNow();
  const at = useAt();
  const shared = scrubT ?? at; // the parent's cursor, else the timeline's hour
  const tz = forecast.timeZone;
  const hs = useMemo(() => windowFor(forecast.hours, range, now), [forecast.hours, range, now]);
  const [wrapRef, { w: W, h: H }] = useChartSize(172, 0.36, 300);
  const box: Box = useMemo(() => ({ l: L, r: W - R, t: T, b: H - B }), [W, H]);
  const axisBox: Box = useMemo(() => ({ ...box, b: box.b + 4 }), [box]); // rules run down to the status strip
  const ids = { clip: useSvgId("bars"), desc: useSvgId("bdesc"), hatch: useSvgId("wrong") };

  const m = useMemo(() => {
    const t0 = hs[0].t, t1 = hs[hs.length - 1].t;
    const top = speedTop(spot.max, hs.map((h) => h.gust));
    const plotW = W - L - R, plotH = H - T - B;
    const x = (t: number) => L + ((t - t0) / (t1 - t0 || 1)) * plotW;
    const y = (v: number) => T + (1 - v / top) * plotH;
    const slot = plotW / Math.max(hs.length - 1, 1);
    const barW = Math.max(1.5, slot - (slot > 9 ? 3 : slot > 4 ? 1.2 : 0.6));
    const sess = sessionSpans(forecast.hours, spot, t0 - HOUR, t1 + HOUR);
    const inSession = (t: number) => sess.some(([a, b]) => t >= a && t < b);
    const anySession = sess.length > 0;
    const rows = hs.map((h) => {
      const st = statusOf(h, spot);
      const day = isDaylightHour(spot.lat, spot.lon, h.t);
      return { h, st, day, lit: !anySession || inSession(h.t) };
    });
    const seen = (obs ?? []).filter((o) => o.t >= t0 && o.t <= t1 && Math.abs(Math.round(o.t / HOUR) * HOUR - o.t) < 4 * 60e3 + 1);
    const count = (s: Status) => rows.filter((r) => r.st === s).length;
    const summary = `${hs.length} hours: ${count("good")} rideable by speed and direction (${rows.filter((r) => r.st === "good" && r.day).length} of them in daylight), `
      + `${count("below")} too light, ${count("above")} too strong, ${count("offdir")} from the wrong direction.`;
    return {
      t0, t1, top, x, y, slot, barW, rows, seen, summary,
      ticks: speedTicks(top),
      axis: timeAxis(t0, t1, tz, x, plotW),
      nights: nightSpans(spot.lat, spot.lon, t0 - HOUR / 2, t1 + HOUR / 2).map(([a, b]): [number, number] => [Math.max(a, t0), Math.min(b, t1)]),
      hand: handoffs(hs).map((d) => ({ ...d, x: x(d.t) - slot / 2 })),
      every: slot >= 22 ? 1 : slot >= 11 ? 2 : slot >= 6 ? 4 : slot >= 3 ? 8 : 24,
    };
  }, [hs, spot, obs, forecast.hours, tz, W, H]);

  const times = useMemo(() => hs.map((h) => h.t), [hs]);
  const tAtX = useCallback((px: number) => m.t0 + ((px - L) / (W - L - R)) * (m.t1 - m.t0), [m, W]);
  const emit = useCallback((i: number | null) => onScrub(i == null ? null : hs[i]), [onScrub, hs]);
  const scrub = useScrub(times, tAtX, emit, shared ?? now);

  if (!W) return <div ref={wrapRef} style={{ height: H }} />;

  const stripY = H - B + 8, arrowY = stripY + STRIP + 6 + ARROWS / 2;
  const nowX = now >= m.t0 && now <= m.t1 ? m.x(now) : null;
  const ct = scrub.t ?? (shared != null && shared >= m.t0 - HOUR / 2 && shared <= m.t1 + HOUR / 2 ? shared : null);
  const ci = ct != null ? nearestIndex(hs, ct, (h) => h.t) : null;
  const cur = ci != null ? m.rows[ci] : null;

  return (
    <div ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-describedby={ids.desc}
        aria-label={`Hourly wind bars, ${range === "24h" ? "past 24 hours" : range === "48h" ? "next 48 hours" : "7 days"}`}
        className="block cursor-crosshair touch-pan-y select-none"
        {...scrub.handlers}>
        <defs>
          <pattern id={ids.hatch} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill={STATUS_FILL.offdir} fillOpacity=".28" />
            <rect width="2" height="4" fill={STATUS_FILL.offdir} />
          </pattern>
        </defs>
        <DayNight nights={m.nights} x={m.x} box={box} />
        <SpeedGrid ticks={m.ticks} y={m.y} box={box} />
        <RangeLines y={m.y} min={spot.min} max={spot.max} box={box} />
        <TimeAxis rules={m.axis.rules} labels={m.axis.labels} box={axisBox} labelY={H - 6} W={W} />

        <DrawIn id={ids.clip} drawKey={`bars:${spot.id}`} W={W} H={H}>
          <g opacity={cur ? 0.5 : 1}>
            <Bars rows={m.rows} x={m.x} y={m.y} barW={m.barW} slot={m.slot} stripY={stripY} arrowY={arrowY} every={m.every} hatch={ids.hatch} />
          </g>
          {m.seen.map((o) => (
            <circle key={o.t} cx={m.x(Math.round(o.t / HOUR) * HOUR)} cy={m.y(o.speed)} r={Math.min(3.2, Math.max(1.6, m.slot / 3))}
              fill="white" strokeWidth="1" className="stroke-ink" />
          ))}
        </DrawIn>

        <Handoffs hand={m.hand} box={axisBox} W={W} labelY={14} />
        {nowX != null && <NowLine x={nowX} box={axisBox} tag={!cur} />}

        {cur && ci != null && (
          <g pointerEvents="none">
            {/* the hovered hour at full strength over the muted rest */}
            <Bar row={cur} x={m.x} y={m.y} barW={m.barW} full />
            <line x1={m.x(cur.h.t)} x2={m.x(cur.h.t)} y1={T - 2} y2={H - B + 4} className="stroke-fg" strokeOpacity=".7" />
            <Pill x={m.x(cur.h.t)} y={1} minX={2} maxX={W - 2}>
              <tspan className="fill-fg" fontWeight="600">{`${Math.round(cur.h.speed)} kn${fmtRange(cur.h) ? ` (${fmtRange(cur.h)})` : ""} ${compass(cur.h.dir)}`}</tspan>
              {` · gusts ${Math.round(cur.h.gust)} · ${cur.st === "good" && !cur.day ? `in range, ${darkWord(spot.lat, spot.lon, cur.h.t)}` : STATUS_WORD[cur.st]}`}
            </Pill>
          </g>
        )}
      </svg>
      <p id={ids.desc} hidden>{m.summary}</p>

      <ChartKey station={m.seen.length > 0 || (obs?.length ?? 0) > 0} />
    </div>
  );
});

type Row = { h: Hour; st: Status; day: boolean; lit: boolean };

/** One hour's gust cap and bar. The speed bar's fill is exactly windColor(speed): its opacity is separate. */
function Bar({ row, x, y, barW, full = false }: { row: Row; x: (t: number) => number; y: (v: number) => number; barW: number; full?: boolean }) {
  const { h, st, lit } = row;
  const bx = x(h.t) - barW / 2, base = y(0), sy = y(h.speed), gy = y(h.gust), rx = Math.min(2, barW / 2);
  const op = full ? 1 : (lit ? 1 : 0.5) * (st === "offdir" ? 0.7 : 1);
  return (
    <g opacity={op}>
      <rect x={bx} width={barW} y={gy} height={Math.max(0, base - gy)} rx={rx} fill={windColor(h.gust, 0.22)} />
      <rect x={bx} width={barW} y={sy} height={Math.max(0, base - sy)} rx={rx} fill={windColor(h.speed)} />
    </g>
  );
}

/** Every bar, its status cell and (every few hours) a direction arrow. Memoised: a scrub only redraws the cursor. */
const Bars = memo(function Bars({ rows, x, y, barW, slot, stripY, arrowY, every, hatch }: {
  rows: Row[]; x: (t: number) => number; y: (v: number) => number; barW: number; slot: number; stripY: number; arrowY: number; every: number; hatch: string;
}) {
  return (
    <g>
      {rows.map((r, i) => (
        <g key={r.h.t}>
          <Bar row={r} x={x} y={y} barW={barW} />
          <rect x={x(r.h.t) - barW / 2} y={stripY} width={Math.max(barW, slot - 0.5)} height={STRIP} rx="1.5"
            fill={r.st === "offdir" ? `url(#${hatch})` : STATUS_FILL[r.st]} opacity={r.day ? 1 : 0.35} />
          {i % every === 0 && (
            <path d="M0 -5.5 L3.3 4.5 L0 2.4 L-3.3 4.5 Z" transform={`translate(${x(r.h.t).toFixed(1)} ${arrowY}) rotate(${Math.round(r.h.dir + 180)})`}
              className="fill-fg-2" />
          )}
        </g>
      ))}
    </g>
  );
});

/**
 * One key for the forecast line and the bars above it: what each mark is (wind, gusts as the dashed line and the faded
 * bar tops, the station's readings, your sessions, night), then what the strip under the bars says about each hour.
 */
function ChartKey({ station }: { station: boolean }) {
  const item = (swatch: ReactNode, word: string) => (
    <li className="flex items-center gap-1.5 whitespace-nowrap"><span aria-hidden className="flex items-center gap-0.5">{swatch}</span>{word}</li>
  );
  return (
    <div className="mt-2.5 flex flex-col gap-1.5 px-1 text-micro text-fg-3">
      <ul aria-label="Chart key: gusts are the dashed line and the faded tops of the bars" className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {item(<i className="h-[3px] w-3.5 rounded-full" style={{ background: windGradient() }} />, "Wind")}
        {item(<>
          <i className="w-3.5 border-t-[1.5px] border-dashed border-fg-2" />
          <i className="flex h-2.5 w-1.5 flex-col overflow-hidden rounded-[1.5px]"><i className="h-1 bg-fg-3/40" /><i className="flex-1 bg-fg-2" /></i>
        </>, "Gusts")}
        {station && item(<i className="size-2 rounded-full bg-white ring-1 ring-ink" />, "Station")}
        {item(<i className="h-2.5 w-3 rounded-[2px] bg-go/20 shadow-[inset_0_-2px_0_var(--color-go)]" />, "Session")}
        {item(<i className="h-2.5 w-3 rounded-[2px] bg-ink/70 ring-1 ring-inset ring-line" />, "Night")}
      </ul>
      <ul aria-label="The strip under the bars" className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <li aria-hidden className="font-medium text-fg-2">Strip:</li>
        {(["good", "offdir", "below", "above"] as const).map((k) => (
          <li key={k} className="flex items-center gap-1.5 whitespace-nowrap">
            <i aria-hidden className="h-[7px] w-3 rounded-[2px]" style={k === "offdir" ? HATCH_CSS : { background: STATUS_FILL[k] }} />
            {STATUS_WORD[k][0].toUpperCase() + STATUS_WORD[k].slice(1)}
          </li>
        ))}
      </ul>
    </div>
  );
}
