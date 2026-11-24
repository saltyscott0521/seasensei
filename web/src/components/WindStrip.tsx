import * as Slider from "@radix-ui/react-slider";
import { motion } from "motion/react";
import clsx from "clsx";
import { memo, useMemo, useRef, useState, type PointerEvent, type Ref } from "react";
import { duration, ease } from "../lib/motion";
import { MODEL_INFO, windColor } from "../lib/wind";
import { labelWidth, markDrawn, shouldDrawIn, useSvgId } from "./charts/scale";
import { useChartSize } from "./useChartSize";
import { useWindScale } from "../lib/windScale";

export type Area = { mean: number; peak: number; dir: number } | null;
type Day = { i: number; label: string };

/** The frame marking the chosen hour (the slider's thumb), px wide. Radix keeps the thumb inside the strip, so an hour's
 *  centre runs from FRAME/2 to width − FRAME/2, and the bars use the same scale: the frame always sits over its bar. */
const FRAME = 14;
/** The day names' row over the bars. */
const LABEL_H = 12;
/** At this speed a bar reaches full height; under it, height follows (speed / FULL_KN) ^ CURVE, so light wind stays
 *  short and 20+ kn stands tall. Stronger hours keep the full height and get a cap in their own colour. */
const FULL_KN = 25;
const CURVE = 1.4;
const frac = (kn: number) => Math.pow(Math.min(1, Math.max(0, kn) / FULL_KN), CURVE);

/**
 * The week as a strip of wind: one thin bar per forecast hour, touching, its height the strongest wind in view
 * (dramatic on purpose) and filled with the map's wind scale, night hours dimmed, day names over dotted dividers, your
 * threshold as a dashed line. The chosen hour is a rounded frame (the slider's thumb: keyboard and screen readers use it,
 * "Forecast time"); a tap anywhere jumps there, and a drag scrubs. `size`: `compact` is a short strip with no names or
 * threshold (a short phone's resting sheet leaves little map); `tall` nearly doubles the bars and enlarges the day
 * names and the threshold tag, for the phone's handle snap, where the map has the room.
 */
export type StripSize = "compact" | "normal" | "tall";
const BARS_H: Record<StripSize, number> = { compact: 20, normal: 44, tall: 84 };
const LABELS: Record<StripSize, { h: number; font: number }> = { compact: { h: 0, font: 10 }, normal: { h: LABEL_H, font: 10 }, tall: { h: 16, font: 12 } };

export function WindStrip({ area, index, threshold, nbmFrom, days, nights, onSeek, summary, valueText, thumbRef, size = "normal" }: {
  area: Area[]; index: number; threshold: number; nbmFrom: number; days: Day[]; nights: [number, number][];
  onSeek: (i: number) => void; summary: string; valueText: string; thumbRef: Ref<HTMLSpanElement>; size?: StripSize;
}) {
  const compact = size === "compact";
  const barsH = BARS_H[size];
  const labelH = LABELS[size].h;
  const H = labelH + barsH;
  const [ref, { w: W }] = useChartSize(H, 0, H);
  const svgRef = useRef<SVGSVGElement>(null);
  const last = Math.max(1, area.length - 1);

  const seekAt = (e: PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    onSeek(Math.round(((e.clientX - r.left - FRAME / 2) / (r.width - FRAME)) * last));
  };

  return (
    <div ref={ref} className="relative" style={{ height: H }} data-wind-strip={size}>
      {W > 0 && (
        <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`}
          className="block cursor-grab touch-none select-none active:cursor-grabbing"
          role={compact ? undefined : "img"} aria-hidden={compact || undefined}
          aria-label={compact ? undefined : `Wind in view over the next week${summary ? `: ${summary}` : ""}`}
          onPointerDown={(e) => { if (e.button !== 0) return; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); seekAt(e); }}
          onPointerMove={(e) => e.buttons && seekAt(e)}>
          <Bars area={area} W={W} H={H} labelH={labelH} font={LABELS[size].font} threshold={threshold} nbmFrom={nbmFrom} days={days} nights={nights} compact={compact} />
        </svg>
      )}
      {/* The slider sits over the bars and takes no pointer (the strip above does that, with the same scale); it is the
          frame you see and what the keyboard moves. */}
      <Slider.Root className="pointer-events-none absolute inset-x-0 bottom-0 flex select-none items-center" style={{ height: barsH }}
        min={0} max={Math.max(0, area.length - 1)} step={1} value={[index]} onValueChange={([v]) => onSeek(v)}>
        <Slider.Track className="absolute inset-0" />
        <Slider.Thumb ref={thumbRef} aria-label="Forecast time" aria-valuetext={valueText} data-testid="timeline-frame"
          className="pointer-events-none block rounded-[5px] border-2 border-fg bg-fg/10 shadow-raised outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-ink"
          style={{ width: FRAME, height: barsH + 2 }} />
      </Slider.Root>
    </div>
  );
}

/** Everything that doesn't move with the frame. Memoised: scrubbing only moves the thumb. Draws in once per visit. */
const Bars = memo(function Bars({ area, W, H, labelH, font, threshold, nbmFrom, days, nights, compact }: {
  area: Area[]; W: number; H: number; labelH: number; font: number; threshold: number; nbmFrom: number; days: Day[]; nights: [number, number][];
  compact?: boolean;
}) {
  const scale = useWindScale();
  const gradId = useSvgId("strip");
  const last = Math.max(1, area.length - 1);
  const step = (W - FRAME) / last;
  const x = (i: number) => FRAME / 2 + i * step;
  const bottom = H - 1, room = H - labelH - 3;
  const y = (kn: number) => bottom - Math.max(1.5, room * frac(kn));
  const [drawIn] = useState(() => { const k = compact ? "timeline-strip-compact" : "timeline-strip"; const d = shouldDrawIn(k); markDrawn(k); return d; });

  // The scale up a bar: at height f of the room the colour is the speed that reaches f, so every bar's top wears its own speed.
  const stops = useMemo(() => Array.from({ length: 21 }, (_, k) => {
    const f = k / 20;
    return { offset: f, color: windColor(FULL_KN * Math.pow(f, 1 / CURVE)) };
  }), [scale]);
  const isNight = (i: number) => nights.some(([a, b]) => i >= a && i < b);
  const m = useMemo(() => ({ x, y }), [W, H, labelH, last]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <g>
      <defs>
        <linearGradient id={gradId} x1="0" y1={bottom} x2="0" y2={bottom - room} gradientUnits="userSpaceOnUse">
          {stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} />)}
        </linearGradient>
      </defs>
      <motion.g data-bars initial={drawIn ? { scaleY: 0, opacity: 0 } : false} animate={{ scaleY: 1, opacity: 1 }}
        transition={{ duration: duration.slow * 1.5, ease }} style={{ transformOrigin: `0px ${bottom}px` }}>
        {area.map((a, i) => {
          if (!a) return null;
          const top = y(a.peak), night = isNight(i);
          return (
            <g key={i} opacity={night ? 0.38 : 1} data-bar={i} data-kn={Math.round(a.peak)} data-night={night || undefined}>
              <rect x={x(i) - step / 2} width={step + 0.4} y={top} height={bottom - top} fill={`url(#${gradId})`} />
              {a.peak > FULL_KN && <rect x={x(i) - step / 2} width={step + 0.4} y={top} height={3} fill={windColor(a.peak)} />}
            </g>
          );
        })}
      </motion.g>
      <line x1={0} x2={W} y1={bottom + 0.5} y2={bottom + 0.5} className="stroke-line" />
      {days.map(({ i, label }, k) => {
        const dx = x(i) - step / 2, next = days[k + 1] ? x(days[k + 1].i) - step / 2 : W;
        return (
          <g key={i}>
            <line x1={dx} x2={dx} y1={compact ? 0 : 1} y2={bottom} strokeDasharray="1 2.5" className="stroke-line-strong" />
            {!compact && next - dx >= labelWidth(label, font) + 6 && dx >= labelWidth("Now", font) + 8 && <text x={dx + 4} y={font - 1} fontSize={font} fontWeight="600" className="fill-fg-3">{label}</text>}
          </g>
        );
      })}
      {!compact && <text x={2} y={font - 1} fontSize={font} fontWeight="600" className="fill-fg-2">Now</text>}
      {nbmFrom > 0 && <line x1={x(nbmFrom)} x2={x(nbmFrom)} y1={labelH} y2={bottom} stroke={MODEL_INFO.nbm.color} strokeOpacity=".6" strokeDasharray="2 3" />}
      {!compact && <>
        <line x1={0} x2={W} y1={y(threshold)} y2={y(threshold)} strokeDasharray="3 3" className="stroke-fg-2" strokeOpacity=".7" />
        <ThresholdTag area={area} m={m} W={W} H={H} threshold={threshold} days={days} labelH={labelH} font={font} />
      </>}
    </g>
  );
});

/**
 * The threshold's "15 kn" tag, on a solid chip so nothing shows through it, at the first place along its line where it
 * clears the bars, the day dividers and their names: the right end, then the left, then along the line from the right,
 * under or over it. Where the bars run everywhere, the first place clear of the days.
 */
function ThresholdTag({ area, m, W, H, threshold, days, labelH, font }: {
  area: Area[]; m: { x: (i: number) => number; y: (v: number) => number }; W: number; H: number; threshold: number; days: Day[];
  labelH: number; font: number;
}) {
  const text = `${threshold} kn`;
  const w = Math.ceil(labelWidth(text, font)) + 6, h = font + 2, ly = m.y(threshold);
  const last = Math.max(1, area.length - 1);
  const xs = [W - w - 2, 2];
  for (let x = W - w - 10; x > 2; x -= 8) xs.push(x);
  const ys = [ly - 2 - h, ly + 2].filter((y) => y >= labelH && y + h <= H);
  const clear = (x0: number, y0: number, bars: boolean) => {
    const x1 = x0 + w, y1 = y0 + h;
    for (const { i, label } of days) {
      const dx = m.x(i);
      if (dx >= x0 - 3 && dx <= x1 + 3) return false;
      if (y0 < labelH && dx + 4 < x1 && dx + 4 + labelWidth(label, font) > x0) return false;
    }
    if (x0 < labelWidth("Now", font) + 4 && y0 < labelH) return false;
    if (bars) for (let i = 0; i <= last; i++) {
      const a = area[i];
      if (!a || m.x(i) < x0 - 2 || m.x(i) > x1 + 2) continue;
      if (m.y(a.peak) <= y1) return false;
    }
    return true;
  };
  let at: [number, number] = [xs[0], ys[0] ?? Math.max(0, Math.min(H - h, ly + 2))];
  outer: for (const bars of [true, false]) for (const x of xs) for (const y of ys) if (clear(x, y, bars)) { at = [x, y]; break outer; }
  return (
    <g data-threshold-tag transform={`translate(${at[0]},${at[1]})`}>
      <rect width={w} height={h} rx={3} className={clsx("fill-ink")} fillOpacity=".9" />
      <text x={w / 2} y={font - 1} textAnchor="middle" fontSize={font} fontWeight="600" className="num fill-fg-2">{text}</text>
    </g>
  );
}
