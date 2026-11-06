import clsx from "clsx";
import { ArrowUp, CalendarDays, Clock3, Navigation2Off } from "lucide-react";
import type { ComponentPropsWithRef } from "react";
import { chipClass, type ChipSize, type Tone } from "./Chip";

/**
 * The verdict for a spot. `on` / `today` / `upcoming` / `none` are the session engine's `Verdict.state`;
 * `strong` and `wrongdir` are for an hour (or now) that is too strong, or blowing from the wrong direction.
 */
export type VerdictState = "on" | "today" | "upcoming" | "none" | "strong" | "wrongdir";

/**
 * Each state's colour role — the one mapping the whole app uses (cards, hero, map markers):
 *   on       go, solid, with a filled dot          ("On now")
 *   today    go, outlined, with a clock            ("On at 1 PM": a full session later today is good news, not a warning)
 *   upcoming neutral, with a calendar              ("Next: Sat 11 AM": nothing to ride today)
 *   none     off, with a hollow ring               ("No session this week")
 *   strong   strong, with an up arrow              ("Too strong")
 *   wrongdir wrongdir, with a crossed-out arrow    ("Wrong direction")
 * Amber (`soon`) is not a verdict: it is kept for marginal hours and lower confidence.
 */
export const VERDICT_TONE: Record<VerdictState, Tone> = {
  on: "go", today: "go", upcoming: "neutral", none: "off", strong: "strong", wrongdir: "wrongdir",
};

/** "today" is the go hue as an outline: the same good news as "on", told apart by its clock and its hollow fill. */
const CHIP_TONE: Record<VerdictState, Tone> = { ...VERDICT_TONE, today: "go-outline" };

const DOT: Record<ChipSize, string> = { sm: "size-1.5", md: "size-2", lg: "size-2.5" };

/** A solid dot for "on" and a hollow ring for "none", so the two read apart without colour. */
function Glyph({ state, size }: { state: VerdictState; size: ChipSize }) {
  switch (state) {
    case "on": return <span aria-hidden className={clsx("shrink-0 rounded-full bg-current ring-3 ring-current/20", DOT[size])} />;
    case "none": return <span aria-hidden className={clsx("shrink-0 rounded-full border-[1.5px] border-current", DOT[size])} />;
    case "today": return <Clock3 aria-hidden strokeWidth={2.25} />;
    case "upcoming": return <CalendarDays aria-hidden strokeWidth={2.25} className="text-fg-3" />;
    case "strong": return <ArrowUp aria-hidden strokeWidth={2.5} />;
    case "wrongdir": return <Navigation2Off aria-hidden strokeWidth={2.25} />;
  }
}

export type VerdictPillProps = Omit<ComponentPropsWithRef<"span">, "children"> & {
  state: VerdictState;
  /** The words, always shown: "On now", "On at 1 PM", "Next: Sat 11 AM", "No session this week". */
  label: string;
  /** `sm` for map popups, `md` (default) for cards and rows, `lg` for the spot hero. */
  size?: ChipSize;
  /**
   * The verdict is about now while the view shows another hour (the timeline or a chart is scrubbed): neutral, so its
   * colour never reads as the answer for the hour beside it. The glyph and the words stay.
   */
  muted?: boolean;
};

/**
 * A verdict as glyph + word on its verdict colour (never colour alone). Renders a `<span>`; extra props pass through.
 * @example <VerdictPill state="on" label="On now" />
 * @example <VerdictPill state="today" label="On at 1 PM" size="lg" title="1–5 PM · 18–22 kn SW" />
 */
export function VerdictPill({ state, label, size = "md", muted = false, className, ...rest }: VerdictPillProps) {
  return (
    <span {...rest} data-verdict={state} data-muted={muted || undefined}
      className={clsx(chipClass(muted ? "neutral" : CHIP_TONE[state], size), className)}>
      <Glyph state={state} size={size} />
      {label}
    </span>
  );
}
