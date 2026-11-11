import clsx from "clsx";
import { TriangleAlert } from "lucide-react";
import { memo, useMemo, type CSSProperties } from "react";
import { chanceOf, fmtSpan, fmtStrength, sameDay } from "../../lib/session";
import { requestAt, useAt, useCanSetAt, useNow } from "../../lib/time";
import type { RankedSpot } from "../../lib/useSpotNow";
import { rememberedShore, shoreWord } from "../spot/shore";
import { RIBBON_WORDS, SectionHeader, type RibbonState } from "../ui";
import { allSessions, bestPerDay, dayTarget, weekCells, type BoardDay } from "./board";

const HOUR = 3600e3;
const FILL: Record<RibbonState, string> = { go: "bg-go", soon: "bg-soon", off: "bg-off/45", strong: "bg-strong", wrongdir: "", none: "bg-line" };
const HATCH: CSSProperties = {
  background: "repeating-linear-gradient(135deg, var(--color-wrongdir) 0 2px, color-mix(in oklab, var(--color-wrongdir) 28%, transparent) 2px 4px)",
};

/**
 * The week at a glance on the Today board, phones included: one row per day with the best spot that day, its session's
 * hours, the range the wind is likely to fall in and how likely it is in a word; a day with no session anywhere says
 * how close the best spot gets. Coloured by the ribbon's states. Tapping a day puts the one clock on that session's
 * start, so the map and the cards show it (rows are plain text until the shell listens for the clock).
 */
export const WeekBoard = memo(function WeekBoard({ rows }: { rows: RankedSpot[] }) {
  const now = useNow();
  const at = useAt();
  const canSet = useCanSetAt();
  const tz = rows.find((r) => r.forecast)?.forecast?.timeZone;
  const days = useMemo(() => {
    const ready = rows.filter((r) => r.forecast);
    if (!tz || !ready.length) return [];
    return bestPerDay(ready.map((r) => {
      const hours = r.forecast!.hours;
      return { spot: r.spot, cells: weekCells(hours, r.spot, allSessions(hours, r.spot), now, tz) };
    }));
  }, [rows, now, tz]);
  if (!tz || !days.length) return null;
  const atDay = at != null ? days.findIndex((d) => sameDay(d.t, at, tz)) : -1;
  return (
    <section aria-labelledby="week-h" className="flex flex-col gap-2">
      <SectionHeader id="week-h" title="This week" aside="best spot each day" />
      <ul data-testid="week-board" data-clock={canSet || undefined} className="overflow-hidden rounded-lg border border-line bg-surface-2">
        {days.map((d, i) => <li key={i} className="border-t border-line first:border-t-0"><DayRow d={d} today={i === 0} tz={tz} now={now} current={i === atDay} canSet={canSet} /></li>)}
      </ul>
    </section>
  );
});

function DayRow({ d, today, tz, now, current, canSet }: { d: BoardDay; today: boolean; tz: string; now: number; current: boolean; canSet: boolean }) {
  const s = d.session, t = dayTarget(d);
  const day = today ? "Today" : d.label;
  const seaward = s ? rememberedShore(d.spot) : null;
  const offshore = !!s && seaward != null && shoreWord(s.dir, seaward) === "offshore";
  const chance = chanceOf(s);
  const words = s
    ? [d.spot.name, fmtSpan(s.start, s.end + HOUR, tz), fmtStrength(s), chance?.toLowerCase(), offshore && "offshore"].filter(Boolean).join(", ")
    : d.peak ? `no session, ${RIBBON_WORDS[d.state]}, best ${Math.round(d.peak.speed)} kn at ${d.spot.name}` : "no forecast";
  const body = (
    <>
      {current && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />}
      <span className={clsx("w-11 shrink-0 text-label font-semibold", current ? "text-accent" : s ? "text-fg" : "text-fg-2")}>{day}</span>
      <span aria-hidden data-state={d.state} style={d.state === "wrongdir" ? HATCH : undefined} className={clsx("h-5 w-1 shrink-0 rounded-full", FILL[d.state])} />
      {s ? (
        <>
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <span className="min-w-0 truncate text-label text-fg">{d.spot.name}</span>
            <span className="num whitespace-nowrap text-label text-fg-2">{fmtSpan(s.start, s.end + HOUR, tz)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {offshore && <TriangleAlert aria-label="Offshore" className="size-3.5 text-wrongdir" />}
            <span className="num whitespace-nowrap text-caption text-fg-2">{fmtStrength(s)}</span>
            {chance && <span className="min-w-[3.4rem] text-right text-caption font-medium text-fg-2">{chance}</span>}
          </span>
        </>
      ) : (
        <span className="num min-w-0 flex-1 truncate text-label text-fg-3">
          {d.peak ? <>No session · {RIBBON_WORDS[d.state]}, best {Math.round(d.peak.speed)} kn at {d.spot.name}</> : "No forecast"}
        </span>
      )}
    </>
  );
  const cls = "relative flex min-h-11 w-full items-center gap-2.5 px-3.5 py-1.5 text-left md:min-h-10";
  if (!canSet || t == null) return <div data-day={day} className={cls}>{body}</div>;
  return (
    <button type="button" data-day={day} aria-pressed={current} aria-label={`${day}: ${words}. Show that day`} onClick={() => requestAt(t <= now ? null : t)}
      className={clsx(cls, "cursor-pointer transition-colors duration-(--dur-fast) hover:bg-surface-3 focus-visible:outline-offset-[-2px]", current && "bg-accent-soft")}>
      {body}
    </button>
  );
}
