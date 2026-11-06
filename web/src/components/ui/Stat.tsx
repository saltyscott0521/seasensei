import clsx from "clsx";
import type { ReactNode } from "react";

export type StatSize = "md" | "lg" | "display";

const VALUE: Record<StatSize, string> = {
  md: "text-headline font-semibold tracking-tight",
  lg: "text-[2.5rem] leading-none font-semibold tracking-[-0.03em]",
  display: "text-display",
};
const UNIT: Record<StatSize, string> = { md: "text-caption", lg: "text-body", display: "text-title" };

export type StatProps = {
  /** The number: a plain number/string, or `<Knots value={…} />` to animate it. */
  value: ReactNode;
  /** Unit after the number, smaller and in fg-3: "kn", "°", "%". */
  unit?: string;
  /** What the number is, under it: "Gust", "Avg miss", "Now". */
  label?: ReactNode;
  /** `md` 24 px (cards), `lg` 40 px, `display` 56–72 px (the spot hero). */
  size?: StatSize;
  /** Colour for the number only, e.g. `windColor(speed)` (wind-scale data colour). Defaults to fg. */
  color?: string;
  className?: string;
};

/**
 * A big number with its unit and label, in Geist tabular figures.
 * @example <Stat value={<Knots value={18} />} unit="kn" label="Now · Old Port Tampa" size="display" />
 * @example <Stat value={Math.round(gust)} unit="kn" label="Gust" />
 */
export function Stat({ value, unit, label, size = "md", color, className }: StatProps) {
  return (
    <div className={clsx("flex flex-col", size === "display" ? "gap-1.5" : "gap-0.5", className)}>
      <div className="num flex items-baseline gap-1 whitespace-nowrap text-fg">
        <span className={VALUE[size]} style={color ? { color } : undefined}>{value}</span>
        {unit && <span className={clsx("font-medium text-fg-3", UNIT[size])}>{unit}</span>}
      </div>
      {label != null && <div className="min-w-0 truncate text-caption text-fg-3">{label}</div>}
    </div>
  );
}
