import clsx from "clsx";
import { motion } from "motion/react";
import { spring } from "../../lib/motion";

export type SegmentedProps<T extends string> = {
  value: T;
  onChange: (v: T) => void;
  /** `[value, label]` pairs. Labels are the buttons' names ("7 days", "Models"): keep them unique on screen. */
  options: [T, string][];
  /**
   * The moving highlight's `layoutId`. Keep it unique per instance on screen: a second copy of the same control
   * (the full-screen charts) appends a suffix, e.g. `view-pill-x`.
   */
  id: string;
  /** Optional name for the group, read before its buttons. */
  label?: string;
  className?: string;
};

/**
 * A pill toggle: one `aria-pressed` button per option, with an accent thumb that slides to the chosen one
 * (no slide under reduced motion). 32 px tall on desktop; on phones 44 px (40 px buttons whose hit area also
 * covers the track's padding).
 * @example <Segmented id={`range-pill${idSuffix}`} value={range} onChange={setRange} options={[["48h", "48 h"], ["7d", "7 days"]]} />
 */
export function Segmented<T extends string>({ value, onChange, options, id, label, className }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={clsx("relative inline-flex shrink-0 rounded-full bg-surface-2 p-0.5 ring-1 ring-inset ring-line", className)}>
      {options.map(([k, text]) => {
        const on = value === k;
        return (
          <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={on}
            className={clsx("relative h-7 cursor-pointer rounded-full px-2.5 text-caption font-medium transition-colors duration-150",
              "before:absolute before:-inset-y-0.5 before:inset-x-0 max-md:h-10 max-md:px-3",
              on ? "text-fg" : "text-fg-3 hover:text-fg-2")}>
            {on && <motion.span layoutId={id} transition={spring} aria-hidden
              className="absolute inset-0 rounded-full bg-accent-soft ring-1 ring-inset ring-accent/35 shadow-raised" />}
            <span className="relative whitespace-nowrap">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
