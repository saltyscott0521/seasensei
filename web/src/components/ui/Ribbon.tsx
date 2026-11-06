import clsx from "clsx";
import type { CSSProperties } from "react";

/** An hour's (or a day's) verdict: rideable, marginal, too light, too strong, wrong direction, or no data. */
export type RibbonState = "go" | "soon" | "off" | "strong" | "wrongdir" | "none";
export type RibbonCell = {
  state: RibbonState;
  /** Hover text for the cell, e.g. "1 PM · 18 kn SW". Not read by screen readers (the row has one summary). */
  title: string;
};

const FILL: Record<RibbonState, string> = {
  go: "bg-go",
  soon: "bg-soon",
  off: "bg-off/45",
  strong: "bg-strong",
  wrongdir: "", // hatched, see HATCH: the pattern is its glyph, so it never relies on hue next to soon/strong
  none: "bg-line",
};
const HATCH: CSSProperties = {
  background: "repeating-linear-gradient(135deg, var(--color-wrongdir) 0 2px, color-mix(in oklab, var(--color-wrongdir) 28%, transparent) 2px 4px)",
};

/** How each state is said in the row's summary. */
export const RIBBON_WORDS: Record<RibbonState, string> = {
  go: "rideable", soon: "marginal", off: "too light", strong: "too strong", wrongdir: "wrong direction", none: "no data",
};

const ORDER: RibbonState[] = ["go", "soon", "strong", "wrongdir", "off", "none"];

/** "12 hours: 5 rideable, 3 marginal, 4 too light" (the default accessible summary). */
export function ribbonSummary(cells: RibbonCell[], unit = "hour") {
  const n: Partial<Record<RibbonState, number>> = {};
  for (const c of cells) n[c.state] = (n[c.state] ?? 0) + 1;
  const parts = ORDER.filter((s) => n[s]).map((s) => `${n[s]} ${RIBBON_WORDS[s]}`);
  return `${cells.length} ${unit}${cells.length === 1 ? "" : "s"}: ${parts.join(", ") || "no data"}`;
}

export type RibbonProps = {
  /** One cell per hour (sunrise → sunset) or per day; left to right. */
  cells: RibbonCell[];
  /** Index of the current cell: draws the accent "now" tick at its centre. Fractions place it between centres. */
  nowIndex?: number;
  /** Bar height in px (default 8). */
  height?: number;
  /** The accessible summary. Defaults to counts per state (`ribbonSummary`); pass a better one when you have times. */
  label?: string;
  /** Word for a cell in the default summary ("hour", or "day" for a week ribbon). */
  unit?: string;
  className?: string;
};

/**
 * A row of verdict-coloured cells, e.g. today's daylight hours on a spot card, with a "now" tick.
 * It is one `role="img"` with a text summary; cells carry hover titles.
 * @example <Ribbon cells={hours.map((h) => ({ state: stateOf(h), title: `${fmt(h.t)} · ${Math.round(h.speed)} kn` }))} nowIndex={i} label="Rideable 1–5 PM" />
 */
export function Ribbon({ cells, nowIndex, height = 8, label, unit = "hour", className }: RibbonProps) {
  const last = cells.length - 1;
  const now = nowIndex != null && cells.length ? Math.min(Math.max(nowIndex, 0), last) : null;
  return (
    <div role="img" aria-label={label ?? ribbonSummary(cells, unit)} className={clsx("relative flex w-full gap-px", className)} style={{ height }}>
      {cells.map((c, i) => (
        <div key={i} title={c.title} data-state={c.state} style={c.state === "wrongdir" ? HATCH : undefined}
          className={clsx("min-w-0 flex-1", FILL[c.state], i === 0 ? "rounded-l-full" : "rounded-l-[2px]", i === last ? "rounded-r-full" : "rounded-r-[2px]")} />
      ))}
      {now != null && (
        <span aria-hidden className="pointer-events-none absolute -inset-y-[3px] w-0.5 -translate-x-1/2 rounded-full bg-accent ring-2 ring-ink/80"
          style={{ left: `${((now + 0.5) / cells.length) * 100}%` }} />
      )}
    </div>
  );
}
