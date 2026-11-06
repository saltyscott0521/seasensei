import clsx from "clsx";
import type { ComponentPropsWithRef, ReactNode } from "react";

/** Neutral chrome, the interactive accent, or one of the verdict colours. */
export type Tone = "neutral" | "accent" | "go" | "go-outline" | "soon" | "off" | "strong" | "wrongdir";
export type ChipSize = "sm" | "md" | "lg";

// Literal class strings: Tailwind only sees whole class names. `off` (#64748b) is too dark for text on the
// panels (about 4:1), so its chips keep fg-2 text and carry the colour in the fill and the ring.
const TONE: Record<Tone, string> = {
  neutral: "bg-surface-3 text-fg-2 ring-line",
  accent: "bg-accent-soft text-accent ring-accent/30",
  go: "bg-go/14 text-go ring-go/30",
  // the go hue as an outline: good news that hasn't started yet (a session later today)
  "go-outline": "bg-transparent text-go ring-go/55",
  soon: "bg-soon/14 text-soon ring-soon/30",
  off: "bg-off/20 text-fg-2 ring-off/40",
  strong: "bg-strong/14 text-strong ring-strong/30",
  wrongdir: "bg-wrongdir/14 text-wrongdir ring-wrongdir/30",
};

const SIZE: Record<ChipSize, string> = {
  sm: "h-5 gap-1 px-2 text-micro font-medium [&_svg]:size-3",
  md: "h-6 gap-1.5 px-2.5 text-caption font-medium [&_svg]:size-3.5",
  lg: "h-8 gap-2 px-3 text-label font-semibold [&_svg]:size-4",
};

/**
 * The class string behind `Chip`, for elements that must stay something else (a `motion.span`, a `<button>`).
 * @example <motion.span className={chipClass("go")} title="HRRR">1–5 PM</motion.span>
 */
export const chipClass = (tone: Tone = "neutral", size: ChipSize = "md") =>
  clsx("inline-flex shrink-0 items-center whitespace-nowrap rounded-full ring-1 ring-inset [&_svg]:shrink-0", TONE[tone], SIZE[size]);

export type ChipProps = Omit<ComponentPropsWithRef<"span">, "children"> & {
  /** Colour role. Verdict tones must also say it in words (or pass an `icon`); never colour alone. */
  tone?: Tone;
  /** `sm` 20 px / 11 px text, `md` 24 px / 12 px text, `lg` 32 px / 13 px semibold (hero verdicts). */
  size?: ChipSize;
  /** A leading lucide icon or glyph; it is hidden from screen readers and sized for the chip. */
  icon?: ReactNode;
  children?: ReactNode;
};

/**
 * A small rounded label: a range, a direction arc, a model tag, a verdict word. Renders a `<span>` and passes
 * every other prop through, so `title`, `data-*` and `aria-*` work as usual.
 * @example <Chip>15–30 kn</Chip>
 * @example <Chip tone="soon" size="sm" icon={<Clock3 />}>NBM · lower confidence</Chip>
 */
export function Chip({ tone = "neutral", size = "md", icon, className, children, ...rest }: ChipProps) {
  return (
    <span {...rest} className={clsx(chipClass(tone, size), className)}>
      {icon != null && <span aria-hidden className="contents">{icon}</span>}
      {children}
    </span>
  );
}
