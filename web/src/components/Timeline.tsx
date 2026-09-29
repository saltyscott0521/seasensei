import * as Slider from "@radix-ui/react-slider";
import { AnimatePresence, motion } from "motion/react";
import { Pause, Play, RotateCcw, Wind } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { compass, windColor, windStops, type Model } from "../lib/wind";
import { useChartSize } from "./useChartSize";

type Area = { mean: number; peak: number; dir: number } | null;

// Radix keeps the 20px thumb inside the track, so its centre runs from 10px to width−10px.
// The chart uses the same inset so a point on the chart sits exactly above the thumb for that hour.
const INSET = 10;

/**
 * Scrub the map through the week. The chart above the slider summarises the wind across whatever
 * is on screen (the same grid that drives the particles): filled = typical, line = strongest in
 * view, dashed = your threshold. Drag either one; index 0 is "now".
 */
export function Timeline({ hours, models, area, threshold, index, onIndex, playing, onPlaying, tz }: {
  hours: number[]; models: Model[]; area: Area[]; threshold: number; index: number; onIndex: (i: number) => void;
  playing: boolean; onPlaying: (p: boolean) => void; tz: string;
}) {
  const last = Math.max(0, hours.length - 1);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => onIndex(index >= last ? 0 : index + 1), 450);
    return () => clearInterval(id);
  }, [playing, index, last, onIndex]);

  const outlook = useMemo(() => {
    if (!area.length) return null;
    const cur = area[0];
    const fmt = new Intl.DateTimeFormat([], { timeZone: tz, weekday: "short", hour: "numeric" });
    if (cur && cur.peak >= threshold) {
      const end = area.findIndex((a, i) => i > 0 && (!a || a.peak < threshold));
      return { kind: "now" as const, i: 0, text: `Windy now: up to ${Math.round(cur.peak)} kn in view`, sub: end > 0 ? `easing by ${fmt.format(hours[end])}` : "all week" };
    }
    const i = area.findIndex((a) => a && a.peak >= threshold);
    if (i < 0) {
      const best = area.reduce((b, a, j) => (a && (!area[b] || a.peak > area[b]!.peak) ? j : b), 0);
      return { kind: "none" as const, i: best, text: `No ${threshold}+ kn in view this week`, sub: area[best] ? `best: ${fmt.format(hours[best])}, ${Math.round(area[best]!.peak)} kn` : "" };
    }
    let j = i;
    while (j + 1 < area.length && area[j + 1] && area[j + 1]!.peak >= threshold) j++;
    const top = area.slice(i, j + 1).reduce((m, a) => Math.max(m, a!.peak), 0);
    return { kind: "coming" as const, i, text: `Wind on the way: ${fmt.format(hours[i])}`, sub: `up to ${Math.round(top)} kn ${compass(area[i]!.dir)} for ${j - i + 1} h` };
  }, [area, hours, threshold, tz]);

  if (hours.length < 2) return null;
  const t = hours[index];
  const label = index === 0 ? "Now" : new Intl.DateTimeFormat([], { timeZone: tz, weekday: "short", hour: "numeric" }).format(t);
  const dayFmt = new Intl.DateTimeFormat([], { timeZone: tz, weekday: "short" });
  const hourOf = (x: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(x));
  const midnights = hours.map((h, i) => ({ h, i })).filter(({ h, i }) => i > 0 && hourOf(h) === 0);
  const nbmFrom = models.findIndex((m) => m === "nbm");
  const a = area[index];
  const seek = (i: number) => { onPlaying(false); onIndex(Math.max(0, Math.min(last, i))); };

  return (
    <div className="glass flex items-center gap-3 rounded-2xl px-3 py-2.5">
      <motion.button whileTap={{ scale: 0.9 }} onClick={() => onPlaying(!playing)} aria-label={playing ? "Pause" : "Play the week"}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-400 to-emerald-400 text-slate-950 shadow-lg shadow-cyan-500/30">
        {playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" />}
      </motion.button>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between gap-2">
          {outlook ? (
            <button onClick={() => seek(outlook.i)} data-testid="outlook"
              className={`-my-1.5 flex min-h-8 min-w-0 items-center gap-1.5 rounded-lg py-1.5 text-left text-[12px] leading-tight max-md:min-h-9 ${outlook.kind === "none" ? "text-white/55" : "text-white"}`}>
              <Wind className={`h-3.5 w-3.5 shrink-0 ${outlook.kind === "none" ? "text-white/40" : "text-emerald-300"}`} />
              <span className="truncate"><b className="font-semibold">{outlook.text}</b>{outlook.sub && <span className="text-white/50"> · {outlook.sub}</span>}</span>
            </button>
          ) : <span className="text-[12px] text-white/40">Loading the week…</span>}
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${index === 0 ? "bg-emerald-400/15 text-emerald-300"
            : models[index] === "nbm" ? "bg-amber-400/15 text-amber-200" : "bg-cyan-400/15 text-cyan-200"}`}>
            {index === 0 ? "LIVE" : models[index] === "nbm" ? "NBM" : "HRRR"}
          </span>
        </div>

        <AreaChart area={area} index={index} threshold={threshold} nbmFrom={nbmFrom} midnights={midnights.map((m) => m.i)} onSeek={seek} />

        <div className="mt-0.5 flex items-baseline justify-between gap-2">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={label} initial={{ y: 4, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -4, opacity: 0 }}
              transition={{ duration: 0.15 }} className="num truncate text-[12px] font-semibold">
              {label}{a && <span className="font-normal text-white/55"> · typical {Math.round(a.mean)} kn, up to <span style={{ color: windColor(a.peak) }}>{Math.round(a.peak)}</span> {compass(a.dir)}</span>}
            </motion.span>
          </AnimatePresence>
        </div>
        <Slider.Root className="relative flex h-5 w-full touch-none select-none items-center" min={0} max={last} step={1}
          value={[index]} onValueChange={([v]) => seek(v)}>
          <Slider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-white/10">
            {nbmFrom > 0 && (
              <span className="absolute inset-y-0 right-0 bg-amber-300/15" style={{ left: `${(nbmFrom / last) * 100}%` }} />
            )}
            <Slider.Range className="absolute h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" />
          </Slider.Track>
          <Slider.Thumb aria-label="Forecast time" className="block h-5 w-5 rounded-full border-2 border-white bg-[#0b1220] shadow-lg outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/40" />
        </Slider.Root>
        <div className="relative mt-1 h-3 text-[9px] text-white/40" style={{ marginInline: INSET }}>
          {midnights.map(({ h, i }) => (
            <span key={h} className="absolute -translate-x-1/2" style={{ left: `${(i / last) * 100}%` }}>{dayFmt.format(h)}</span>
          ))}
        </div>
      </div>

      {/* A fixed slot: the button appearing mustn't resize the chart under your finger. */}
      <div className="h-9 w-9 shrink-0">
        <AnimatePresence>
          {index > 0 && (
            <motion.button initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
              onClick={() => seek(0)} aria-label="Back to now"
              className="grid h-9 w-9 place-items-center rounded-full text-white/70 ring-1 ring-white/15 hover:bg-white/10">
              <RotateCcw className="h-4 w-4" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function AreaChart({ area, index, threshold, nbmFrom, midnights, onSeek }: {
  area: Area[]; index: number; threshold: number; nbmFrom: number; midnights: number[]; onSeek: (i: number) => void;
}) {
  const [ref, { w: W, h: H }] = useChartSize(56, 0, 56);
  const svgRef = useRef<SVGSVGElement>(null);
  const last = Math.max(1, area.length - 1);

  const m = useMemo(() => {
    const vals = area.flatMap((a) => (a ? [a.peak] : []));
    const top = Math.max(25, Math.ceil((Math.max(threshold, ...vals) + 2) / 5) * 5);
    const x = (i: number) => INSET + (i / last) * (W - 2 * INSET);
    const y = (v: number) => H - 2 - (v / top) * (H - 6);
    const line = (k: "mean" | "peak") => {
      let d = "", pen = false;
      area.forEach((a, i) => { if (!a) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(a[k]).toFixed(1)}`; pen = true; });
      return d;
    };
    const mean = line("mean");
    const fill = mean ? `${mean}L${x(last).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z` : "";
    // shade the stretches where somewhere in view reaches your threshold
    const runs: [number, number][] = [];
    area.forEach((a, i) => {
      const on = !!a && a.peak >= threshold;
      if (on && (!runs.length || runs[runs.length - 1][1] !== i - 1)) runs.push([i, i]);
      else if (on) runs[runs.length - 1][1] = i;
    });
    return { top, x, y, fill, mean, peak: line("peak"), runs };
  }, [area, threshold, W, H, last]);

  function seekAt(e: React.PointerEvent) {
    const r = svgRef.current!.getBoundingClientRect();
    onSeek(Math.round(((e.clientX - r.left - INSET) / (r.width - 2 * INSET)) * last));
  }

  return (
    <div ref={ref}>
      <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block cursor-pointer touch-pan-y select-none" role="img"
        aria-label="Wind in view over the next week"
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); seekAt(e); }}
        onPointerMove={(e) => e.buttons && seekAt(e)}>
        <defs>
          <linearGradient id="area-grad" x1="0" y1={m.y(0)} x2="0" y2={m.y(m.top)} gradientUnits="userSpaceOnUse">
            {windStops(m.top).map((st, i) => <stop key={i} offset={st.offset} stopColor={st.color} />)}
          </linearGradient>
        </defs>
        {m.runs.map(([a, b]) => (
          <rect key={a} x={m.x(a) - 1} width={Math.max(2, m.x(b) - m.x(a) + 2)} y={0} height={H} fill="rgb(52 211 153 / .08)" />
        ))}
        {nbmFrom > 0 && <line x1={m.x(nbmFrom)} x2={m.x(nbmFrom)} y1={0} y2={H} stroke="rgb(250 204 21 / .35)" strokeDasharray="2 3" />}
        {midnights.map((i) => <line key={i} x1={m.x(i)} x2={m.x(i)} y1={0} y2={H} stroke="rgb(255 255 255 / .07)" />)}
        {m.fill && <path d={m.fill} fill="url(#area-grad)" fillOpacity=".35" />}
        {m.peak && <path d={m.peak} fill="none" stroke="url(#area-grad)" strokeWidth="1.8" strokeLinejoin="round" />}
        <line x1={INSET} x2={W - INSET} y1={m.y(threshold)} y2={m.y(threshold)} stroke="rgb(255 255 255 / .35)" strokeDasharray="3 3" />
        <text x={W - INSET - 2} y={m.y(threshold) - 3} textAnchor="end" fontSize="9" fontWeight="600" fill="rgb(255 255 255 / .75)" className="num"
          style={{ paintOrder: "stroke", stroke: "#0a101c", strokeWidth: 3 }}>{threshold} kn</text>
        <line x1={m.x(index)} x2={m.x(index)} y1={0} y2={H} stroke="white" strokeOpacity=".8" />
        {area[index] && <circle cx={m.x(index)} cy={m.y(area[index]!.peak)} r="3.2" fill={windColor(area[index]!.peak)} stroke="#05080f" strokeWidth="1.5" />}
      </svg>
    </div>
  );
}
