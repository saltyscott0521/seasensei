import clsx from "clsx";
import { TriangleAlert } from "lucide-react";
import { memo, useMemo, type CSSProperties } from "react";
import { chanceOf, fmtSpan, fmtStrength, sameDay, type Session } from "../../lib/session";
import { requestAt, useCanSetAt, useNow } from "../../lib/time";
import type { Hour, Spot } from "../../lib/wind";
import { dayTarget, weekCells, type WeekCell } from "../home/board";
import { RIBBON_WORDS, SectionHeader, type RibbonState } from "../ui";
import { OFFSHORE_CAUTION, shoreWord } from "./shore";

const HOUR = 3600e3;
const FILL: Record<RibbonState, string> = { go: "bg-go", soon: "bg-soon", off: "bg-off/45", strong: "bg-strong", wrongdir: "", none: "bg-line" };
const HATCH: CSSProperties = {
  background: "repeating-linear-gradient(135deg, var(--color-wrongdir) 0 2px, color-mix(in oklab, var(--color-wrongdir) 28%, transparent) 2px 4px)",
};
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** A day's cell in words: "Fri: 7 AM–5 PM, 15–21 kn NNW, likely" or "Thu: too light, best 12 kn". */
export function dayWords(c: WeekCell, tz: string, shore?: string | null) {
  const s = c.session;
  if (s) return [fmtSpan(s.start, s.end + HOUR, tz), fmtStrength(s), chanceOf(s)?.toLowerCase(), shore === "offshore" && "offshore"].filter(Boolean).join(", ");
  if (!c.peak) return c.title.split(" · ").slice(1).join(", ");
  return `${RIBBON_WORDS[c.state]}, best ${Math.round(c.peak.speed)} kn`;
}

/**
 * The week at a glance for one spot, phones included: seven day cells (they scroll sideways where they don't fit),
 * each with the day, a bar in the ribbon's colours, its best session's hours, the range and how likely it is in a
 * word; a day without a session says why and how strong it gets. Tapping a day puts the one clock on that session's
 * start (map, hero, hour grid and charts follow); where nothing listens for the clock, `onPick` handles it locally.
 */
export const WeekStrip = memo(function WeekStrip({ hours, spot, all, tz, at, seaward, onPick }: {
  hours: Hour[]; spot: Spot;
  /** Every session in the forecast (allSessions). */
  all: Session[];
  tz: string;
  /** The hour the view is on (the timeline's, or the charts' cursor): its day is marked. */
  at?: number | null;
  seaward?: number | null;
  /** Without a clock to set: show this day here (its session, else its strongest hour). */
  onPick?: (c: WeekCell) => void;
}) {
  const now = useNow();
  const canSet = useCanSetAt();
  const cells = useMemo(() => weekCells(hours, spot, all, now, tz), [hours, spot, all, now, tz]);
  const atDay = at != null ? cells.findIndex((c) => sameDay(c.t, at, tz)) : -1;
  const pick = (c: WeekCell) => {
    const t = dayTarget(c);
    if (t == null) return;
    if (canSet) requestAt(t <= now ? null : t); else onPick?.(c);
  };
  return (
    <section aria-labelledby="week-h" className="flex flex-col gap-2">
      <SectionHeader id="week-h" title="This week" aside="best window each day" />
      <div className="overflow-hidden rounded-lg border border-line bg-surface-2">
        <ul data-testid="week-strip" data-clock={canSet || undefined}
          className="no-scrollbar flex gap-1 overflow-x-auto overscroll-x-contain p-1.5 max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-20px),transparent)]">
          {cells.map((c, i) => {
            const s = c.session;
            const shore = s && seaward != null ? shoreWord(s.dir, seaward) : null;
            const day = i === 0 ? "Today" : c.label;
            const usable = dayTarget(c) != null;
            return (
              <li key={i} className="min-w-[4.5rem] flex-1">
                <button type="button" disabled={!usable} onClick={() => pick(c)} aria-pressed={i === atDay} data-state={c.state}
                  aria-label={`${day}: ${dayWords(c, tz, shore)}${usable ? ". Show that day" : ""}`} title={shore === "offshore" ? OFFSHORE_CAUTION : c.title}
                  className={clsx("flex min-h-[5.25rem] w-full flex-col items-stretch gap-1 rounded-md px-1.5 py-1.5 text-left transition-colors duration-(--dur-fast) focus-visible:outline-offset-[-2px]",
                    usable ? "cursor-pointer hover:bg-surface-3" : "cursor-default", i === atDay && "bg-accent-soft")}>
                  <span className={clsx("flex items-center justify-between text-micro leading-4", i === atDay ? "font-semibold text-accent" : i === 0 ? "font-semibold text-fg" : "font-medium text-fg-2")}>
                    {day}
                    {shore === "offshore" && <TriangleAlert aria-hidden className="size-3 text-wrongdir" />}
                  </span>
                  <span aria-hidden style={c.state === "wrongdir" ? HATCH : undefined} className={clsx("h-1.5 w-full rounded-full", FILL[c.state])} />
                  {s ? (
                    <>
                      <span className="num whitespace-nowrap text-micro leading-4 text-fg">{fmtSpan(s.start, s.end + HOUR, tz)}</span>
                      <span className="num whitespace-nowrap text-micro leading-4 text-fg-2">{fmtStrength(s).replace(/ [NESW]+$/, "")}</span>
                      {chanceOf(s) && <span className="text-micro font-medium leading-4 text-fg-2">{chanceOf(s)}</span>}
                    </>
                  ) : (
                    <>
                      <span className="whitespace-nowrap text-micro leading-4 text-fg-3">{c.peak ? cap(RIBBON_WORDS[c.state]) : "—"}</span>
                      {c.peak && <span className="num whitespace-nowrap text-micro leading-4 text-fg-3">best {Math.round(c.peak.speed)} kn</span>}
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
});
