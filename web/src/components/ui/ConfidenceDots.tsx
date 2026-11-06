import clsx from "clsx";
import type { ComponentPropsWithRef } from "react";

export type ConfidenceLevel = "high" | "mid" | "low";

const FILLED: Record<ConfidenceLevel, number> = { high: 3, mid: 2, low: 1 };
const WORDS: Record<ConfidenceLevel, string> = { high: "High confidence", mid: "Medium confidence", low: "Low confidence" };

export type ConfidenceDotsProps = Omit<ComponentPropsWithRef<"span">, "children"> & {
  level: ConfidenceLevel;
  /** What screen readers (and the hover title) say, e.g. the engine's "Models agree · 3 kn spread". Defaults to "High confidence" etc. */
  label?: string;
  /** Also print the label beside the dots (11 px, fg-3). */
  showLabel?: boolean;
};

/**
 * Three dots, filled 3 / 2 / 1 for high / mid / low model agreement, with an accessible label. Neutral ink, not a
 * verdict colour: how sure the forecast is is a different question from whether it's rideable, and the count says it.
 * @example <ConfidenceDots level={c.level} label={c.label} />
 */
export function ConfidenceDots({ level, label, showLabel, className, ...rest }: ConfidenceDotsProps) {
  const text = label ?? WORDS[level];
  return (
    <span {...rest} role="img" aria-label={text} title={text} data-confidence={level}
      className={clsx("inline-flex shrink-0 items-center gap-1.5", className)}>
      <span aria-hidden className="inline-flex items-center gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span key={i} className={clsx("size-1.5 rounded-full", i < FILLED[level] ? "bg-fg-2" : "ring-1 ring-inset ring-fg-3/70")} />
        ))}
      </span>
      {showLabel && <span aria-hidden className="whitespace-nowrap text-micro font-medium text-fg-3">{text}</span>}
    </span>
  );
}
