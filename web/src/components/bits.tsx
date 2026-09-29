import { motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import clsx from "clsx";
import { compass, windColor, type Ride } from "../lib/wind";

/** Arrow pointing DOWNWIND (where the wind is going), spring-rotated. */
export function WindArrow({ dir, size = 16, className }: { dir: number; size?: number; className?: string }) {
  return (
    <motion.svg
      width={size} height={size} viewBox="0 0 24 24" className={className}
      initial={false} animate={{ rotate: dir + 180 }} transition={{ type: "spring", stiffness: 120, damping: 16 }}
      aria-label={`from ${compass(dir)}`} role="img"
    >
      <path d="M12 3 L18 19 L12 15.5 L6 19 Z" fill="currentColor" />
    </motion.svg>
  );
}

/** Compass dial with a spring needle and the rideable arc for context. */
export function Dial({ dir, speed, size = 132 }: { dir: number; speed: number; size?: number }) {
  const ticks = Array.from({ length: 72 }, (_, i) => i * 5);
  const c = windColor(speed);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0">
        <defs>
          <radialGradient id="dialglow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={c} stopOpacity="0.28" />
            <stop offset="100%" stopColor={c} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="url(#dialglow)" />
        <circle cx="50" cy="50" r="46" fill="none" stroke="rgb(255 255 255 / .09)" />
        {ticks.map((t) => (
          <line key={t} x1="50" y1="5" x2="50" y2={t % 90 === 0 ? 11 : t % 30 === 0 ? 9 : 7}
            stroke={t % 90 === 0 ? "rgb(255 255 255 / .6)" : "rgb(255 255 255 / .18)"} strokeWidth={t % 90 === 0 ? 1.2 : 0.6}
            transform={`rotate(${t} 50 50)`} />
        ))}
        {["N", "E", "S", "W"].map((l, i) => (
          <text key={l} x="50" y="19" textAnchor="middle" fontSize="7" fontWeight="600" fill="rgb(255 255 255 / .55)"
            transform={`rotate(${i * 90} 50 50)`}>{l}</text>
        ))}
      </svg>
      <motion.div className="absolute inset-0" initial={false} animate={{ rotate: dir }}
        transition={{ type: "spring", stiffness: 70, damping: 12 }}>
        {/* needle: fat end = where it comes FROM */}
        <svg viewBox="0 0 100 100" className="absolute inset-0">
          <path d="M50 14 L55.5 50 L50 46 L44.5 50 Z" fill={c} />
          <path d="M50 86 L52.5 54 L50 56 L47.5 54 Z" fill="rgb(255 255 255 / .35)" />
        </svg>
      </motion.div>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[11px] font-semibold tracking-widest text-white/60">{compass(dir)}</span>
        <span className="num text-xs text-white/40">{Math.round(dir)}°</span>
      </div>
    </div>
  );
}

export function Knots({ value, className }: { value: number; className?: string }) {
  return <NumberFlow value={Math.round(value)} className={clsx("num", className)} willChange />;
}

const RIDE: Record<Ride, { label: string; cls: string }> = {
  good: { label: "In range", cls: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30" },
  below: { label: "Too light", cls: "bg-slate-400/10 text-slate-300 ring-slate-400/20" },
  above: { label: "Overpowered", cls: "bg-rose-400/15 text-rose-300 ring-rose-400/30" },
};
export function RideBadge({ ride, className }: { ride: Ride; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1", RIDE[ride].cls, className)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", ride === "good" ? "bg-emerald-400" : ride === "above" ? "bg-rose-400" : "bg-slate-400")} />
      {RIDE[ride].label}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-white/[.06]", className)} />;
}

export function Sparkline({ values, min, max, width = 120, height = 32 }: { values: number[]; min: number; max: number; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const top = Math.max(max + 4, ...values);
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - (v / top) * (height - 2) - 1;
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <rect x="0" width={width} y={y(max)} height={Math.max(0, y(min) - y(max))} fill="rgb(52 211 153 / .1)" />
      <path d={d} fill="none" stroke="rgb(255 255 255 / .75)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
