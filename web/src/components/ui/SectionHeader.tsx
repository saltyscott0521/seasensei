import clsx from "clsx";
import type { ReactNode } from "react";

export type SectionHeaderProps = {
  /** The section's name. Never put a spot name here: tests find spots by a heading containing the name. */
  title: ReactNode;
  /** Right-aligned extra: a count, a chip, a small action. */
  aside?: ReactNode;
  /** Heading level (default h3). Use the level that fits the outline of the view. */
  as?: "h2" | "h3" | "h4";
  /** Put on the heading, for `aria-labelledby` on the section it heads. */
  id?: string;
  className?: string;
};

/**
 * A section's title row: 13 px semibold heading on the left, an optional `aside` on the right.
 * @example <SectionHeader title="Sessions" aside={<ConfidenceDots level="high" />} />
 * @example <section aria-labelledby="hours-h"><SectionHeader id="hours-h" title="Hour by hour" aside="Sat–Fri" />…</section>
 */
export function SectionHeader({ title, aside, as: H = "h3", id, className }: SectionHeaderProps) {
  return (
    <div className={clsx("flex min-h-6 items-center justify-between gap-3 px-1", className)}>
      <H id={id} className="min-w-0 truncate text-label font-semibold text-fg">{title}</H>
      {aside != null && <div className="flex shrink-0 items-center gap-2 text-caption text-fg-3">{aside}</div>}
    </div>
  );
}
