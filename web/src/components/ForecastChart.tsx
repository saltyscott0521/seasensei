import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { rideableWindows, windColor, type Forecast, type Hour, type Obs, type Spot } from "../lib/wind";

export type Range = "24h" | "48h" | "7d";
const W = 640, H = 200, L = 28, R = 8, T = 12, B = 26;
const HOUR = 3600e3;

/** The forecast hours to draw for a range, and whether they're mostly in the past. */
export function windowFor(hours: Hour[], range: Range, now = Date.now()) {
  const from = range === "24h" ? now - 24 * HOUR : now - 6 * HOUR;
  const to = range === "24h" ? now + 3 * HOUR : range === "48h" ? now + 48 * HOUR : Infinity;
  const r = hours.filter((h) => h.t >= from && h.t <= to);
  return r.length > 1 ? r : hours;
}

/**
 * HRRR/NBM chart: speed area coloured by the wind scale, gust line, the spot's range band,
 * rideable windows (speed AND direction), NBM hatching, "now", scrubbing, and — when we have
 * them — the station's actual readings drawn over the forecast.
 */
export function ForecastChart({ forecast, spot, onScrub, range, obs }: {
  forecast: Forecast; spot: Spot; onScrub: (h: Hour | null) => void; range: Range; obs?: Obs[];
}) {
  const hs = useMemo(() => windowFor(forecast.hours, range), [forecast.hours, range]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  const m = useMemo(() => {
    const t0 = hs[0].t, t1 = hs[hs.length - 1].t;
    const seen = (obs ?? []).filter((o) => o.t >= t0 && o.t <= t1);
    const top = Math.ceil(Math.max(spot.max + 5, ...hs.map((h) => h.gust), ...seen.map((o) => o.speed)) / 5) * 5;
    const x = (t: number) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
    const y = (v: number) => T + (1 - v / top) * (H - T - B);
    const line = (k: "speed" | "gust") => hs.map((h, i) => `${i ? "L" : "M"}${x(h.t).toFixed(1)},${y(h[k]).toFixed(1)}`).join("");
    const area = `${line("speed")}L${x(t1)},${y(0)}L${x(t0)},${y(0)}Z`;
    const ticks = [0, 10, 20, 30, 40, 50].filter((v) => v <= top);
    const tzOpt = { timeZone: forecast.timeZone };
    const hourFmt = new Intl.DateTimeFormat([], { ...tzOpt, hour: "numeric" });
    const dayFmt = new Intl.DateTimeFormat([], { ...tzOpt, weekday: "short" });
    const hourOf = (t: number) => Number(new Intl.DateTimeFormat("en-US", { ...tzOpt, hour: "numeric", hourCycle: "h23" }).format(t));
    const long = t1 - t0 > 80 * HOUR;
    const step = range === "24h" ? 4 : 6;
    const labels = hs.filter((h) => (long ? hourOf(h.t) === 0 || hourOf(h.t) === 12 : hourOf(h.t) % step === 0))
      .map((h) => ({ x: x(h.t), text: hourOf(h.t) === 0 ? dayFmt.format(h.t) : long ? "" : hourFmt.format(h.t), day: hourOf(h.t) === 0 }));
    const nbm = hs.find((h) => h.model === "nbm");
    const wins = rideableWindows(hs, spot);
    const obsLine = seen.length > 1 ? seen.map((o, i) => `${i ? "L" : "M"}${x(o.t).toFixed(1)},${y(o.speed).toFixed(1)}`).join("") : null;
    return { t0, t1, top, x, y, area, speed: line("speed"), gust: line("gust"), ticks, labels, wins, nbmX: nbm ? x(nbm.t) : null, obsLine, seen };
  }, [hs, obs, spot, range, forecast.timeZone]);

  const now = Date.now();
  const nowX = now >= m.t0 && now <= m.t1 ? m.x(now) : null;

  function onMove(e: React.PointerEvent) {
    const r = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = m.t0 + ((px - L) / (W - L - R)) * (m.t1 - m.t0);
    let best = 0;
    hs.forEach((h, i) => { if (Math.abs(h.t - t) < Math.abs(hs[best].t - t)) best = i; });
    setCursor(best);
    onScrub(hs[best]);
  }
  function onLeave() { setCursor(null); onScrub(null); }

  const gradId = `spd-${spot.id}`;
  const c = cursor != null ? hs[cursor] : null;
  const cObs = c ? m.seen.reduce<Obs | null>((b, o) => (Math.abs(o.t - c.t) < 45 * 60e3 && (!b || Math.abs(o.t - c.t) < Math.abs(b.t - c.t)) ? o : b), null) : null;

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y select-none" role="img"
      aria-label={range === "24h" ? "Past 24 hours, forecast versus actual" : range === "48h" ? "48 hour wind forecast" : "7 day wind forecast"}
      onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={onLeave} onPointerUp={(e) => e.pointerType !== "mouse" && onLeave()}>
      <defs>
        <linearGradient id={gradId} x1="0" y1={m.y(0)} x2="0" y2={m.y(m.top)} gradientUnits="userSpaceOnUse">
          {[0, 8, 13, 17, 22, 27, 32, 40].filter((k) => k <= m.top).map((k) => (
            <stop key={k} offset={k / m.top} stopColor={windColor(k)} />
          ))}
        </linearGradient>
        <linearGradient id={`${gradId}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="white" stopOpacity=".55" />
          <stop offset="1" stopColor="white" stopOpacity=".04" />
        </linearGradient>
        <mask id={`${gradId}-m`}><rect width={W} height={H} fill={`url(#${gradId}-fade)`} /></mask>
        <pattern id={`${gradId}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="rgb(255 255 255 / .05)" strokeWidth="3" />
        </pattern>
      </defs>

      {m.ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={m.y(v)} y2={m.y(v)} stroke="rgb(255 255 255 / .06)" />
          <text x={L - 6} y={m.y(v) + 3.5} textAnchor="end" fontSize="10" fill="rgb(255 255 255 / .35)" className="num">{v}</text>
        </g>
      ))}

      {/* the spot's speed range */}
      <rect x={L} width={W - L - R} y={m.y(spot.max)} height={m.y(spot.min) - m.y(spot.max)} fill="rgb(52 211 153 / .06)" />
      <line x1={L} x2={W - R} y1={m.y(spot.min)} y2={m.y(spot.min)} stroke="rgb(52 211 153 / .35)" strokeDasharray="3 4" />
      <line x1={L} x2={W - R} y1={m.y(spot.max)} y2={m.y(spot.max)} stroke="rgb(52 211 153 / .35)" strokeDasharray="3 4" />

      {/* rideable windows: right speed and right direction */}
      {m.wins.map((w) => (
        <rect key={w.start} x={m.x(w.start)} width={Math.max(m.x(w.end + HOUR) - m.x(w.start), 4)} y={T} height={H - T - B}
          fill="rgb(52 211 153 / .1)" rx="3" />
      ))}

      {m.labels.map((l) => (
        <g key={l.x}>
          {l.day && <line x1={l.x} x2={l.x} y1={T} y2={H - B} stroke="rgb(255 255 255 / .1)" />}
          <text x={l.x} y={H - 8} textAnchor="middle" fontSize="10" fill={l.day ? "rgb(255 255 255 / .75)" : "rgb(255 255 255 / .35)"} fontWeight={l.day ? 600 : 400}>{l.text}</text>
        </g>
      ))}

      <motion.path key={`a-${range}`} d={m.area} fill={`url(#${gradId})`} mask={`url(#${gradId}-m)`}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} />
      <motion.path key={`g-${range}`} d={m.gust} fill="none" stroke="rgb(255 255 255 / .35)" strokeWidth="1.2" strokeDasharray="2 4"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: "easeOut" }} />
      <motion.path key={`s-${range}`} d={m.speed} fill="none" stroke={`url(#${gradId})`} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: "easeOut" }} />

      {/* what the station actually measured */}
      {m.obsLine && (
        <motion.path key={`o-${range}`} d={m.obsLine} fill="none" stroke="white" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 3px rgb(255 255 255 / .55))" }}
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.3, ease: "easeOut", delay: 0.25 }} />
      )}

      {m.nbmX != null && (
        <g pointerEvents="none">
          <rect x={m.nbmX} width={W - R - m.nbmX} y={T} height={H - T - B} fill={`url(#${gradId}-hatch)`} />
          <line x1={m.nbmX} x2={m.nbmX} y1={T} y2={H - B} stroke="rgb(250 204 21 / .45)" strokeDasharray="3 3" />
          <text x={m.nbmX - 4} y={T + 9} textAnchor="end" fontSize="9" fontWeight="600" fill="rgb(255 255 255 / .45)">HRRR</text>
          <text x={m.nbmX + 4} y={T + 9} fontSize="9" fontWeight="600" fill="rgb(250 204 21 / .75)">NBM · lower confidence</text>
        </g>
      )}

      {nowX != null && (
        <g>
          <line x1={nowX} x2={nowX} y1={T} y2={H - B} stroke="rgb(255 255 255 / .5)" strokeDasharray="2 3" />
          <text x={nowX + 4} y={T + 9} fontSize="9" fill="rgb(255 255 255 / .6)" fontWeight="600">NOW</text>
        </g>
      )}

      {c && (
        <g pointerEvents="none">
          <line x1={m.x(c.t)} x2={m.x(c.t)} y1={T} y2={H - B} stroke="white" strokeOpacity=".7" />
          <circle cx={m.x(c.t)} cy={m.y(c.gust)} r="3" fill="white" fillOpacity=".6" />
          <circle cx={m.x(c.t)} cy={m.y(c.speed)} r="5" fill={windColor(c.speed)} stroke="#05080f" strokeWidth="2" />
          {cObs && <circle cx={m.x(cObs.t)} cy={m.y(cObs.speed)} r="4" fill="white" stroke="#05080f" strokeWidth="2" />}
          {cObs && (
            <text x={Math.min(Math.max(m.x(c.t), L + 60), W - 70)} y={T + 22} textAnchor="middle" fontSize="11" fontWeight="600" fill="white" className="num"
              style={{ paintOrder: "stroke", stroke: "#05080f", strokeWidth: 3 }}>
              model {Math.round(c.speed)} · actual {Math.round(cObs.speed)}
            </text>
          )}
        </g>
      )}
    </svg>
  );
}
