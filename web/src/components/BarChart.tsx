import { motion } from "motion/react";
import { useMemo, useRef } from "react";
import { compass, inArc, windColor, type Forecast, type Hour, type Obs, type Spot } from "../lib/wind";
import { L, R, T, windowFor, type Range } from "./ForecastChart";
import { useChartSize } from "./useChartSize";

const HOUR = 3600e3;
const STRIP = 7;   // status strip under the bars
const ARROWS = 16; // direction row under the strip
const B = 30 + STRIP + ARROWS;

type Status = "good" | "offdir" | "below" | "above";
const STATUS_FILL: Record<Status, string> = {
  good: "rgb(52 211 153)", offdir: "rgb(252 211 77)", below: "rgb(100 116 139 / .55)", above: "rgb(251 113 133)",
};
const statusOf = (h: Hour, spot: Spot): Status =>
  h.speed < spot.min ? "below" : h.speed > spot.max ? "above" : inArc(h.dir, spot) ? "good" : "offdir";

/**
 * One bar per hour, on the same time axis (and the same scrub cursor) as the line chart above it.
 *   bar colour   = sustained wind on the speed scale (blue calm → green → yellow → magenta)
 *   ghost cap    = gusts, same colour, faded
 *   strip below  = what that hour means for THIS spot: green rideable, amber right speed but wrong
 *                  direction, grey too light, red too strong
 *   arrows       = where the wind is blowing toward
 * White dots are what the station actually measured.
 */
export function BarChart({ forecast, spot, range, obs, scrubT, onScrub }: {
  forecast: Forecast; spot: Spot; range: Range; obs?: Obs[]; scrubT?: number | null; onScrub: (h: Hour | null) => void;
}) {
  const hs = useMemo(() => windowFor(forecast.hours, range), [forecast.hours, range]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [wrapRef, { w: W, h: H }] = useChartSize(150, 0.36, 300);

  const m = useMemo(() => {
    const t0 = hs[0].t, t1 = hs[hs.length - 1].t;
    const top = Math.ceil(Math.max(spot.max + 5, ...hs.map((h) => h.gust)) / 5) * 5;
    const plotW = W - L - R, plotH = H - T - B;
    const x = (t: number) => L + ((t - t0) / (t1 - t0 || 1)) * plotW;
    const y = (v: number) => T + (1 - v / top) * plotH;
    const slot = plotW / Math.max(hs.length - 1, 1);
    const barW = Math.max(1.5, slot - (slot > 9 ? 3 : slot > 4 ? 1.2 : 0.6));
    const ticks = [0, 10, 20, 30, 40, 50].filter((v) => v <= top);
    const nbm = hs.find((h) => h.model === "nbm");
    const every = slot >= 22 ? 1 : slot >= 11 ? 2 : slot >= 6 ? 4 : slot >= 3 ? 8 : 24;
    const seen = (obs ?? []).filter((o) => o.t >= t0 && o.t <= t1 && Math.abs(Math.round(o.t / HOUR) * HOUR - o.t) < 4 * 60e3 + 1);
    return { t0, t1, top, x, y, plotH, slot, barW, ticks, nbmX: nbm ? x(nbm.t) : null, every, seen };
  }, [hs, spot, obs, W, H]);

  const tz = forecast.timeZone;
  const labels = useMemo(() => {
    const hourFmt = new Intl.DateTimeFormat([], { timeZone: tz, hour: "numeric" });
    const dayFmt = new Intl.DateTimeFormat([], { timeZone: tz, weekday: "short" });
    const hourOf = (t: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(t));
    const long = m.t1 - m.t0 > 80 * HOUR;
    return hs.filter((h) => (long ? hourOf(h.t) === 0 || hourOf(h.t) === 12 : hourOf(h.t) % (range === "24h" ? 4 : 6) === 0))
      .map((h) => ({ x: m.x(h.t), text: hourOf(h.t) === 0 ? dayFmt.format(h.t) : long ? "" : hourFmt.format(h.t), day: hourOf(h.t) === 0 }));
  }, [hs, m, tz, range]);

  const now = Date.now();
  const nowX = now >= m.t0 && now <= m.t1 ? m.x(now) : null;
  const cursor = scrubT != null ? hs.reduce((b, h, i) => (Math.abs(h.t - scrubT) < Math.abs(hs[b].t - scrubT) ? i : b), 0) : null;
  const stripY = H - B + 6, arrowY = stripY + STRIP + 9;

  function onMove(e: React.PointerEvent) {
    const r = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = m.t0 + ((px - L) / (W - L - R)) * (m.t1 - m.t0);
    onScrub(hs.reduce((b, h) => (Math.abs(h.t - t) < Math.abs(b.t - t) ? h : b), hs[0]));
  }

  return (
    <div ref={wrapRef}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block touch-pan-y select-none" role="img"
        aria-label={`Hourly wind bars, ${range === "24h" ? "past 24 hours" : range === "48h" ? "next 48 hours" : "7 days"}`}
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => onScrub(null)} onPointerUp={(e) => e.pointerType !== "mouse" && onScrub(null)}>
        {m.ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={m.y(v)} y2={m.y(v)} stroke="rgb(255 255 255 / .06)" />
            <text x={L - 6} y={m.y(v) + 3.5} textAnchor="end" fontSize="11" fill="rgb(255 255 255 / .4)" className="num">{v}</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={m.y(spot.min)} y2={m.y(spot.min)} stroke="rgb(52 211 153 / .4)" strokeDasharray="3 4" />
        <line x1={L} x2={W - R} y1={m.y(spot.max)} y2={m.y(spot.max)} stroke="rgb(52 211 153 / .4)" strokeDasharray="3 4" />

        {labels.map((l) => (
          <g key={l.x}>
            {l.day && <line x1={l.x} x2={l.x} y1={T} y2={H - B + 4} stroke="rgb(255 255 255 / .1)" />}
            <text x={l.x} y={H - 6} textAnchor="middle" fontSize="11" fill={l.day ? "rgb(255 255 255 / .8)" : "rgb(255 255 255 / .4)"} fontWeight={l.day ? 600 : 400}>{l.text}</text>
          </g>
        ))}

        {hs.map((h, i) => {
          const cx = m.x(h.t), bx = cx - m.barW / 2, base = m.y(0);
          const sy = m.y(h.speed), gy = m.y(h.gust);
          const st = statusOf(h, spot);
          const dim = st === "offdir" ? 0.55 : 1; // right speed, wrong direction: present but muted
          return (
            <g key={h.t} opacity={cursor != null && cursor !== i ? 0.55 : 1}>
              <motion.rect x={bx} width={m.barW} rx={Math.min(2, m.barW / 2)} fill={windColor(h.gust, 0.22)}
                initial={{ y: base, height: 0 }} animate={{ y: gy, height: base - gy }} transition={{ duration: 0.5, delay: Math.min(i * 0.004, 0.5) }} />
              <motion.rect x={bx} width={m.barW} rx={Math.min(2, m.barW / 2)} fill={windColor(h.speed)} fillOpacity={0.92 * dim}
                initial={{ y: base, height: 0 }} animate={{ y: sy, height: base - sy }} transition={{ duration: 0.6, delay: Math.min(i * 0.004, 0.5) }} />
              <rect x={bx} y={stripY} width={Math.max(m.barW, m.slot - 0.5)} height={STRIP} fill={STATUS_FILL[st]} rx="1.5" />
              {i % m.every === 0 && (
                <g transform={`translate(${cx} ${arrowY}) rotate(${h.dir + 180})`} opacity=".7">
                  <path d="M0 -6 L3.6 5 L0 2.6 L-3.6 5 Z" fill="white" />
                </g>
              )}
            </g>
          );
        })}

        {m.seen.map((o) => (
          <circle key={o.t} cx={m.x(Math.round(o.t / HOUR) * HOUR)} cy={m.y(o.speed)} r={Math.min(3.2, Math.max(1.6, m.slot / 3))} fill="white" stroke="#05080f" strokeWidth="1" />
        ))}

        {m.nbmX != null && (
          <g pointerEvents="none">
            <line x1={m.nbmX} x2={m.nbmX} y1={T} y2={H - B + 4} stroke="rgb(250 204 21 / .5)" strokeDasharray="3 3" />
            <text x={m.nbmX + 4} y={T + 9} fontSize="9" fontWeight="600" fill="rgb(250 204 21 / .8)">NBM</text>
          </g>
        )}
        {nowX != null && (
          <g pointerEvents="none">
            <line x1={nowX} x2={nowX} y1={T} y2={H - B + 4} stroke="rgb(255 255 255 / .55)" strokeDasharray="2 3" />
            <text x={nowX + 4} y={T + 9} fontSize="9" fill="rgb(255 255 255 / .65)" fontWeight="600">NOW</text>
          </g>
        )}
        {cursor != null && (
          <g pointerEvents="none">
            <line x1={m.x(hs[cursor].t)} x2={m.x(hs[cursor].t)} y1={T} y2={H - B + 4} stroke="white" strokeOpacity=".8" />
            <text x={Math.min(Math.max(m.x(hs[cursor].t), L + 46), W - 46)} y={T + 8} textAnchor="middle" fontSize="11" fontWeight="600" fill="white" className="num"
              style={{ paintOrder: "stroke", stroke: "#05080f", strokeWidth: 3 }}>
              {Math.round(hs[cursor].speed)} kn {compass(hs[cursor].dir)}
            </text>
          </g>
        )}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] text-white/45">
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-16 rounded-full" style={{ background: "linear-gradient(90deg,#465a8c,#388cdc,#22d3ee,#34d399,#a3e635,#facc15,#fb7124,#ec4899)" }} />bar = wind speed
        </span>
        <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-white/25" />faded cap = gusts</span>
        {(["good", "offdir", "below", "above"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ background: STATUS_FILL[k] }} />
            {k === "good" ? "rideable" : k === "offdir" ? "wrong direction" : k === "below" ? "too light" : "too strong"}</span>
        ))}
      </div>
    </div>
  );
}
