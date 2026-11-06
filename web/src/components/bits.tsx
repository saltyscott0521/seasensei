import { motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { setPrimaryModel, usePrimaryModel } from "../lib/data";
import { turn, useUnwrappedAngle } from "../lib/motion";
import { CHAIN_PLAIN, chainLabel, compass, MODEL_INFO, PRIMARY_MODELS, windColor, type Model, type Ride } from "../lib/wind";
import { VerdictPill, type VerdictState } from "./ui/VerdictPill";

/**
 * Arrow pointing DOWNWIND (where the wind is going). It turns the short way round (350° → 10° is +20°) on a CSS
 * ease-out with no overshoot, and doesn't move at all under reduced motion. A plain <svg>, so a strip of 190 of
 * them costs nothing per frame.
 */
export function WindArrow({ dir, size = 16, className }: { dir: number; size?: number; className?: string }) {
  const rot = useUnwrappedAngle(dir) + 180;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={`from ${compass(dir)}`}
      className={clsx("origin-center transition-transform duration-(--dur-slow) ease-ui motion-reduce:transition-none", className)}
      style={{ transform: `rotate(${rot}deg)` }}>
      <path d="M12 3 L18 19 L12 15.5 L6 19 Z" fill="currentColor" />
    </svg>
  );
}

const rad = (deg: number) => (deg * Math.PI) / 180;
/** A point on the dial (viewBox 100) at compass bearing `deg` (0 = N, clockwise) and radius `r`. */
const pt = (deg: number, r: number) => `${(50 + r * Math.sin(rad(deg))).toFixed(2)} ${(50 - r * Math.cos(rad(deg))).toFixed(2)}`;
const arcD = (c: number, w: number, r: number) => `M${pt(c - w / 2, r)} A${r} ${r} 0 ${w > 180 ? 1 : 0} 1 ${pt(c + w / 2, r)}`;
const R = 47; // ring radius

/**
 * Compass dial: N up, a needle entering from where the wind comes FROM (pointing downwind, like WindArrow), and,
 * given the spot's `arc`, the rideable directions as a go band on the ring (a faint full ring for "Any direction").
 * The needle turns the short way on a critically damped spring and keeps clear of the centre readout.
 * @example <Dial dir={shown.dir} speed={shown.speed} arc={spot} />
 */
export function Dial({ dir, speed, size = 132, arc }: { dir: number; speed: number; size?: number; arc?: { dirC?: number; dirW?: number } }) {
  const ticks = Array.from({ length: 72 }, (_, i) => i * 5);
  const c = windColor(speed);
  const glow = `dialglow-${useId().replace(/[^\w-]/g, "")}`; // unique: several dials may share a page
  const rot = useUnwrappedAngle(dir);
  const hasArc = arc?.dirC != null && arc.dirW != null;
  const anyDir = hasArc && arc.dirW! >= 360;
  const deg = ((Math.round(dir) % 360) + 360) % 360;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0" aria-hidden>
        <defs>
          <radialGradient id={glow} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={c} stopOpacity="0.22" />
            <stop offset="100%" stopColor={c} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="49" fill={`url(#${glow})`} />
        <circle cx="50" cy="50" r={R} fill="none" className="stroke-line-strong" strokeWidth="0.75" />
        {hasArc && (anyDir
          ? <circle cx="50" cy="50" r={R} fill="none" className="stroke-go" strokeOpacity="0.4" strokeWidth="2" data-arc="any" />
          : <g data-arc={`${arc.dirC}/${arc.dirW}`}>
              <path d={`M50 50 L${arcD(arc.dirC!, arc.dirW!, R).slice(1)} Z`} className="fill-go" fillOpacity="0.07" />
              <path d={arcD(arc.dirC!, arc.dirW!, R)} fill="none" className="stroke-go" strokeWidth="3" strokeLinecap="round" />
            </g>)}
        {ticks.map((t) => (
          <line key={t} x1="50" y1="6.5" x2="50" y2={t % 90 === 0 ? 12 : t % 30 === 0 ? 10.5 : 8.5}
            className={t % 90 === 0 ? "stroke-fg-2" : t % 30 === 0 ? "stroke-fg-3" : "stroke-line-strong"} strokeWidth={t % 90 === 0 ? 1.2 : 0.6}
            transform={`rotate(${t} 50 50)`} />
        ))}
        {(["N", "E", "S", "W"] as const).map((l, i) => (
          <text key={l} x={50 + 30 * Math.sin(rad(i * 90))} y={50 - 30 * Math.cos(rad(i * 90))} textAnchor="middle" dominantBaseline="central"
            fontSize="8" fontWeight="600" className={l === "N" ? "fill-fg-2" : "fill-fg-3"}>{l}</text>
        ))}
      </svg>
      <motion.div className="absolute inset-0" initial={false} animate={{ rotate: rot }} transition={turn}>
        {/* needle: enters at the ring on the FROM side and points downwind, stopping short of the centre text */}
        <svg viewBox="0 0 100 100" className="absolute inset-0" aria-hidden>
          <path d="M50 26 L56 6.5 L50 10.5 L44 6.5 Z" fill={c} className="stroke-ink" strokeWidth="0.8" strokeLinejoin="round" />
        </svg>
      </motion.div>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-micro font-semibold tracking-[0.12em] text-fg-2">{compass(dir)}</span>
        <span className="num text-caption text-fg-3">{deg}°</span>
      </div>
    </div>
  );
}

/** A wind speed in knots, rounded, in tabular Geist, animating between values (NumberFlow respects reduced motion). */
export function Knots({ value, className }: { value: number; className?: string }) {
  return <NumberFlow value={Math.round(value)} className={clsx("num", className)} willChange />;
}

// The ride state as a verdict: glyph + word on the verdict colour (see ui/VerdictPill).
const RIDE: Record<Ride, { label: string; state: VerdictState }> = {
  good: { label: "In range", state: "on" },
  below: { label: "Too light", state: "none" },
  above: { label: "Too strong", state: "strong" },
  offdir: { label: "Wrong direction", state: "wrongdir" },
};
/** "In range" / "Too light" / "Too strong" / "Wrong direction" for an hour, as a verdict pill. */
export function RideBadge({ ride, className }: { ride: Ride; className?: string }) {
  return <VerdictPill state={RIDE[ride].state} label={RIDE[ride].label} className={className} />;
}

/** Loading placeholder on the raised surface. Give it the size of what it stands in for, so nothing jumps. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("rounded-sm bg-surface-3 motion-safe:animate-pulse", className)} />;
}

/** A tiny speed line with the spot's range as a faint go band. Decorative (the card states the numbers). */
export function Sparkline({ values, min, max, width = 120, height = 32 }: { values: number[]; min: number; max: number; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden />;
  const top = Math.max(max + 4, ...values);
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - (v / top) * (height - 2) - 1;
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      <rect x="0" width={width} y={y(max)} height={Math.max(0, y(min) - y(max))} className="fill-go" fillOpacity="0.12" />
      <path d={d} fill="none" className="stroke-fg-2" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Which model leads the forecast everywhere (map, timeline, spots); the others fill in where it runs out.
 * A native <select> named "Forecast model" (tests use selectOption; the options read "HRRR → RRFS → NBM" …) laid
 * invisibly over its own pill, so the pill can say less than the options: the chain, or with `compact` just the lead
 * model ("HRRR"). The pill is 28–32 px to the eye and 44 px to the thumb on phones.
 *
 * It returns two siblings, so a grid can place them apart: the picker, and its plain-language caption ("Sharpest
 * local model first, then NOAA's blend"), which is also the select's description. `captionClass` styles the caption;
 * the default keeps it for screen readers only.
 */
export function ModelPicker({ className, compact = false, captionClass = "sr-only" }: { className?: string; compact?: boolean; captionClass?: string }) {
  const primary = usePrimaryModel();
  const id = useId();
  return (
    <>
      <label className={clsx("group relative inline-grid shrink-0 cursor-pointer place-items-center rounded-full max-md:-my-2 max-md:h-11",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent", className)}>
        <span className="sr-only">Forecast model</span>
        <select value={primary} onChange={(e) => setPrimaryModel(e.target.value as Model)} aria-describedby={`${id}c`}
          className="absolute inset-0 size-full cursor-pointer appearance-none rounded-full opacity-0">
          {PRIMARY_MODELS.map((m) => <option key={m} value={m} className="bg-ink text-fg">{chainLabel(m)}</option>)}
        </select>
        <span aria-hidden className={clsx("pointer-events-none flex h-7 items-center gap-1 whitespace-nowrap rounded-full bg-surface-2 pl-2.5 pr-2 text-caption font-medium text-fg-2 ring-1 ring-inset ring-line",
          "transition-colors duration-(--dur-fast) group-hover:bg-surface-3 group-hover:text-fg md:h-8 md:pl-3")}>
          <span className="num">{compact ? MODEL_INFO[primary].label : chainLabel(primary)}</span>
          <ChevronDown className="size-3.5 text-fg-3" />
        </span>
      </label>
      <span id={`${id}c`} className={captionClass}>{CHAIN_PLAIN[primary]}</span>
    </>
  );
}
