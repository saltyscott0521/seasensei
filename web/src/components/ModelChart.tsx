import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { agreement, MODELS, spreadAt, type ModelCompare, type Spot } from "../lib/wind";
import type { Range } from "./ForecastChart";

const W = 640, H = 200, L = 28, R = 8, T = 12, B = 26;
const HOUR = 3600e3;

/** HRRR, NBM, ECMWF and GFS on one axis. The shaded band is the spread between them — a free confidence signal. */
export function ModelChart({ data, spot, range, tz }: { data: ModelCompare; spot: Spot; range: Range; tz: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  const idx = useMemo(() => {
    const now = Date.now();
    const from = range === "24h" ? now - 24 * HOUR : now - 6 * HOUR;
    const to = range === "24h" ? now + 3 * HOUR : range === "48h" ? now + 48 * HOUR : Infinity;
    return data.times.flatMap((t, i) => (t >= from && t <= to ? [i] : []));
  }, [data, range]);

  const m = useMemo(() => {
    const t0 = data.times[idx[0]], t1 = data.times[idx[idx.length - 1]];
    const all = idx.flatMap((i) => MODELS.map((mm) => data.series[mm.key]?.[i]).filter((v): v is number => v != null));
    const top = Math.ceil(Math.max(spot.max + 5, ...all) / 5) * 5;
    const x = (t: number) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
    const y = (v: number) => T + (1 - v / top) * (H - T - B);
    const path = (key: string) => {
      let d = "", pen = false;
      for (const i of idx) {
        const v = data.series[key]?.[i];
        if (v == null) { pen = false; continue; }
        d += `${pen ? "L" : "M"}${x(data.times[i]).toFixed(1)},${y(v).toFixed(1)}`; pen = true;
      }
      return d;
    };
    const sp = idx.map((i) => ({ i, s: spreadAt(data, i) })).filter((p) => p.s);
    const band = sp.length > 1
      ? sp.map((p, k) => `${k ? "L" : "M"}${x(data.times[p.i]).toFixed(1)},${y(p.s!.max).toFixed(1)}`).join("")
        + sp.slice().reverse().map((p) => `L${x(data.times[p.i]).toFixed(1)},${y(p.s!.min).toFixed(1)}`).join("") + "Z"
      : "";
    const dayFmt = new Intl.DateTimeFormat([], { timeZone: tz, weekday: "short" });
    const hourFmt = new Intl.DateTimeFormat([], { timeZone: tz, hour: "numeric" });
    const hourOf = (t: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(t));
    const long = t1 - t0 > 80 * HOUR;
    const labels = idx.map((i) => data.times[i]).filter((t) => (long ? hourOf(t) === 0 || hourOf(t) === 12 : hourOf(t) % (range === "24h" ? 4 : 6) === 0))
      .map((t) => ({ x: x(t), text: hourOf(t) === 0 ? dayFmt.format(t) : long ? "" : hourFmt.format(t), day: hourOf(t) === 0 }));
    return { t0, t1, top, x, y, paths: MODELS.map((mm) => ({ ...mm, d: path(mm.key) })), band, labels, ticks: [0, 10, 20, 30, 40, 50].filter((v) => v <= top) };
  }, [data, idx, spot, range, tz]);

  const now = Date.now();
  const nowX = now >= m.t0 && now <= m.t1 ? m.x(now) : null;
  const nowI = idx.reduce((b, i) => (Math.abs(data.times[i] - now) < Math.abs(data.times[b] - now) ? i : b), idx[0]);
  const shownI = cursor ?? nowI;
  const sp = spreadAt(data, shownI);
  const ag = agreement(data, now, now + 48 * HOUR);
  const ag7 = agreement(data, now + 48 * HOUR, now + 7 * 24 * HOUR);

  function onMove(e: React.PointerEvent) {
    const r = svgRef.current!.getBoundingClientRect();
    const t = m.t0 + ((((e.clientX - r.left) / r.width) * W - L) / (W - L - R)) * (m.t1 - m.t0);
    setCursor(idx.reduce((b, i) => (Math.abs(data.times[i] - t) < Math.abs(data.times[b] - t) ? i : b), idx[0]));
  }

  const chip = (a: NonNullable<typeof ag>, when: string) => (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${a.level === "high" ? "bg-emerald-400/15 text-emerald-300" : a.level === "mid" ? "bg-amber-400/15 text-amber-200" : "bg-rose-400/15 text-rose-300"}`}>
      {when}: {a.label.toLowerCase()} · ±{(a.avg / 2).toFixed(0)} kn
    </span>
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5 px-1">{ag && chip(ag, "Next 48 h")}{ag7 && chip(ag7, "Days 3–7")}</div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y select-none" role="img" aria-label="Wind forecast by model"
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setCursor(null)} onPointerUp={(e) => e.pointerType !== "mouse" && setCursor(null)}>
        {m.ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={m.y(v)} y2={m.y(v)} stroke="rgb(255 255 255 / .06)" />
            <text x={L - 6} y={m.y(v) + 3.5} textAnchor="end" fontSize="10" fill="rgb(255 255 255 / .35)" className="num">{v}</text>
          </g>
        ))}
        <rect x={L} width={W - L - R} y={m.y(spot.max)} height={m.y(spot.min) - m.y(spot.max)} fill="rgb(52 211 153 / .06)" />
        <line x1={L} x2={W - R} y1={m.y(spot.min)} y2={m.y(spot.min)} stroke="rgb(52 211 153 / .3)" strokeDasharray="3 4" />
        <line x1={L} x2={W - R} y1={m.y(spot.max)} y2={m.y(spot.max)} stroke="rgb(52 211 153 / .3)" strokeDasharray="3 4" />
        {m.labels.map((l) => (
          <g key={l.x}>
            {l.day && <line x1={l.x} x2={l.x} y1={T} y2={H - B} stroke="rgb(255 255 255 / .1)" />}
            <text x={l.x} y={H - 8} textAnchor="middle" fontSize="10" fill={l.day ? "rgb(255 255 255 / .75)" : "rgb(255 255 255 / .35)"} fontWeight={l.day ? 600 : 400}>{l.text}</text>
          </g>
        ))}
        {m.band && <motion.path key={`b-${range}`} d={m.band} fill="rgb(255 255 255 / .09)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} />}
        {m.paths.map((p, k) => (
          <motion.path key={`${p.key}-${range}`} d={p.d} fill="none" stroke={p.color} strokeWidth={p.key === "gfs_hrrr" ? 2.4 : 1.8}
            strokeLinejoin="round" strokeLinecap="round" opacity={0.95}
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: 0.1 * k, ease: "easeOut" }} />
        ))}
        {nowX != null && <line x1={nowX} x2={nowX} y1={T} y2={H - B} stroke="rgb(255 255 255 / .45)" strokeDasharray="2 3" />}
        {cursor != null && <line x1={m.x(data.times[cursor])} x2={m.x(data.times[cursor])} y1={T} y2={H - B} stroke="white" strokeOpacity=".7" />}
        {cursor != null && MODELS.map((mm) => {
          const v = data.series[mm.key]?.[cursor];
          return v == null ? null : <circle key={mm.key} cx={m.x(data.times[cursor])} cy={m.y(v)} r="3.5" fill={mm.color} stroke="#05080f" strokeWidth="1.5" />;
        })}
      </svg>

      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {MODELS.map((mm) => {
          const v = data.series[mm.key]?.[shownI];
          return (
            <div key={mm.key} className="rounded-xl bg-white/[.04] px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-white/60"><i className="h-2 w-2 rounded-full" style={{ background: mm.color }} />{mm.label}</div>
              <div className="num text-base font-semibold" style={{ opacity: v == null ? 0.3 : 1 }}>{v == null ? "—" : Math.round(v)}<span className="ml-0.5 text-[10px] font-normal text-white/40">kn</span></div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-[10px] text-white/35">
        {new Intl.DateTimeFormat([], { timeZone: tz, weekday: "short", hour: "numeric" }).format(data.times[shownI])}
        {sp ? ` · spread ${sp.min.toFixed(0)}–${sp.max.toFixed(0)} kn` : ""} · drag to scrub · HRRR ends at 48 h
      </p>
    </div>
  );
}
