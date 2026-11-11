import clsx from "clsx";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { fmtRange } from "../../lib/sensei";
import { fmtHour, isDaylightHour } from "../../lib/session";
import { useNow } from "../../lib/time";
import { compass, rideState, windColor, type Hour, type Spot } from "../../lib/wind";
import { Skeleton } from "../bits";
import { SectionHeader } from "../ui";

const HOUR = 3600e3;
const COL = 40; // px per hour
const LABEL = 44; // the sticky row-label column

type Ride = "go" | "below" | "above" | "offdir" | "night";
type Col = { h: Hour; night: boolean; ride: Ride; dayStart: boolean; now: boolean };

const RIDE_WORDS: Record<Ride, string> = { go: "rideable", below: "too light", above: "too strong", offdir: "wrong direction", night: "night" };
const RIDE_FILL: Record<Ride, string> = { go: "bg-go", below: "bg-off/50", above: "bg-strong", offdir: "", night: "bg-line" };
const HATCH: CSSProperties = {
  background: "repeating-linear-gradient(135deg, var(--color-wrongdir) 0 2px, color-mix(in oklab, var(--color-wrongdir) 28%, transparent) 2px 4px)",
};
// The sticky label column sits over scrolling cells: the card's fill on the panel colour on solid ink, so it reads as
// the card and nothing ghosts through it. (Its width is LABEL; the day names stick at left-[44px] to match.)
const STICKY = "sticky left-0 z-10 border-r border-line [background:linear-gradient(var(--color-surface-2),var(--color-surface-2)),linear-gradient(var(--color-surface-1),var(--color-surface-1)),var(--color-ink)]";

const fmts = new Map<string, Intl.DateTimeFormat>();
const dayKeyFmt = (tz: string) => {
  let f = fmts.get(tz);
  if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })));
  return f;
};
/** "Today", "Sat 8" */
function dayLabel(t: number, tz: string, now: number) {
  const p = Object.fromEntries(dayKeyFmt(tz).formatToParts(t).map((x) => [x.type, x.value]));
  const n = Object.fromEntries(dayKeyFmt(tz).formatToParts(now).map((x) => [x.type, x.value]));
  if (p.year === n.year && p.month === n.month && p.day === n.day) return "Today";
  return `${p.weekday} ${Number(p.day)}`;
}
const dayKey = (t: number, tz: string) => dayKeyFmt(tz).formatToParts(t).filter((x) => x.type === "day" || x.type === "month").map((x) => x.value).join("-");

/**
 * Every hour from now as a dense table: time, knots (wind-scale colour), the range each hour is likely to fall in
 * (SeaSensei), gust, direction and a ride bar; night hours
 * shaded, day names stuck to the left edge. Scrolls sideways (the mouse wheel too, on desktop) and keeps the
 * highlighted hour (the charts' cursor, else the timeline's hour) in view.
 */
function HourGridImpl({ hours, tz, spot, highlightT }: { hours: Hour[]; tz: string; spot: Spot; highlightT?: number }) {
  const clock = useNow();
  const start = Math.floor(clock / HOUR) * HOUR;
  const { lat, lon, min, max, dirC, dirW } = spot;
  const cols = useMemo(() => {
    const out: Col[] = [];
    for (const h of hours) {
      if (h.t < start) continue;
      const night = !isDaylightHour(lat, lon, h.t);
      const r = rideState(h.speed, { min, max, dirC, dirW }, h.dir);
      const prev = out[out.length - 1];
      out.push({
        h, night, now: h.t === start,
        ride: night ? "night" : r === "good" ? "go" : r,
        dayStart: !!prev && dayKey(prev.h.t, tz) !== dayKey(h.t, tz),
      });
    }
    return out;
  }, [hours, start, lat, lon, min, max, dirC, dirW, tz]);

  const scroller = useRef<HTMLDivElement>(null);
  const hi = highlightT == null || !cols.length ? -1 : cols.findIndex((c) => Math.abs(c.h.t - highlightT) < HOUR / 2);

  // Keep the highlighted hour in view (two hours of context to its left).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || hi < 0) return;
    const x = hi * COL, seen0 = el.scrollLeft, seen1 = el.scrollLeft + el.clientWidth - LABEL;
    if (x >= seen0 && x + COL <= seen1) return;
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: Math.max(0, x - 2 * COL), behavior: smooth ? "smooth" : "auto" });
  }, [hi]);

  // The highlighted hour's column header says so to assistive tech (set here so the big table stays memoised).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.querySelectorAll("th[aria-current]").forEach((n) => n.removeAttribute("aria-current"));
    if (hi >= 0) el.querySelector(`th[data-t="${cols[hi].h.t}"]`)?.setAttribute("aria-current", "time");
  }, [hi, cols]);

  // A vertical mouse wheel scrolls the hours sideways, until an end, where the panel takes over again.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <section aria-labelledby="hours-h" className="flex flex-col gap-2">
      <SectionHeader id="hours-h" title="Hour by hour" />
      <div className="overflow-hidden rounded-lg border border-line bg-surface-2">
        <div ref={scroller} tabIndex={0} role="region" aria-label="Hour by hour, scrolls sideways"
          className="no-scrollbar overflow-x-auto overscroll-x-contain [mask-image:linear-gradient(to_right,#000_calc(100%-20px),transparent)] focus-visible:outline-offset-[-2px]">
          <div className="relative w-max pb-2">
            <HourTable cols={cols} tz={tz} clock={clock} />
            {hi >= 0 && (
              <div aria-hidden className="pointer-events-none absolute bottom-1.5 top-6 rounded-md bg-accent/[.07] ring-1 ring-inset ring-accent/60"
                style={{ left: LABEL + hi * COL, width: COL }} />
            )}
          </div>
        </div>
        <RideKey />
      </div>
    </section>
  );
}

const HourTable = memo(function HourTable({ cols, tz, clock }: { cols: Col[]; tz: string; clock: number }) {
  // Day spans for the top row.
  const days: { key: number; label: string; n: number }[] = [];
  for (const c of cols) {
    if (!days.length || c.dayStart) days.push({ key: c.h.t, label: dayLabel(c.h.t, tz, clock), n: 0 });
    days[days.length - 1].n++;
  }
  const ranged = cols.some((c) => c.h.lo != null && c.h.hi != null);
  const cell = (c: Col) => clsx("p-0", c.dayStart && "border-l border-line-strong", c.night && "bg-ink/35");
  return (
    <table className="table-fixed border-separate border-spacing-0 text-center" style={{ width: LABEL + cols.length * COL }}>
      <caption className="sr-only">Hour by hour from now: wind{ranged ? ", the range it is likely to fall in," : ""} and gust in knots, direction, and whether each hour is rideable</caption>
      <colgroup>
        <col style={{ width: LABEL }} />
        {cols.map((c) => <col key={c.h.t} style={{ width: COL }} />)}
      </colgroup>
      <thead>
        <tr className="h-6">
          <td className={STICKY} />
          {days.map((d, i) => (
            <th key={d.key} scope="colgroup" colSpan={d.n} className={clsx("p-0 text-left align-bottom", i > 0 && "border-l border-line-strong")}>
              <span className="sticky left-[44px] inline-block whitespace-nowrap px-2 text-micro font-semibold text-fg">{d.label}</span>
            </th>
          ))}
        </tr>
        <tr className="h-6">
          <td className={STICKY} />
          {cols.map((c) => (
            <th key={c.h.t} scope="col" data-t={c.h.t} data-night={c.night || undefined} className={clsx(cell(c), "whitespace-nowrap text-micro font-medium",
              c.now ? "text-accent" : c.night ? "text-fg-3" : "text-fg-2")}>
              {c.now ? "Now" : fmtHour(c.h.t, tz)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr className="h-8">
          <th scope="row" className={clsx(STICKY, "pl-3 text-left text-micro font-medium text-fg-3")}>kn</th>
          {cols.map((c) => (
            <td key={c.h.t} className={cell(c)}>
              {/* the wind colour fills the cell; the number stays light on it (purple and red text on the dark panel fall below 4.5:1) */}
              <span className={clsx("num mx-[3px] grid h-7 place-items-center rounded-[7px] text-label font-semibold", c.night ? "text-fg-2" : "text-fg")}
                style={{ background: windColor(c.h.speed, c.night ? 0.16 : 0.32) }}>
                {Math.round(c.h.speed)}
              </span>
            </td>
          ))}
        </tr>
        {ranged && (
          <tr className="h-5" data-testid="range-row">
            <th scope="row" className={clsx(STICKY, "pl-3 text-left text-micro font-medium text-fg-3")}>Likely</th>
            {cols.map((c) => <td key={c.h.t} className={clsx(cell(c), "num whitespace-nowrap text-micro text-fg-3")}>{fmtRange(c.h) ?? ""}</td>)}
          </tr>
        )}
        <tr className="h-6">
          <th scope="row" className={clsx(STICKY, "pl-3 text-left text-micro font-medium text-fg-3")}>Gust</th>
          {cols.map((c) => <td key={c.h.t} className={clsx(cell(c), "num text-caption text-fg-2")}>{Math.round(c.h.gust)}</td>)}
        </tr>
        <tr className="h-6">
          <th scope="row" className={clsx(STICKY, "pl-3 text-left text-micro font-medium text-fg-3")}>From</th>
          {cols.map((c) => (
            <td key={c.h.t} className={clsx(cell(c), "text-fg-2")}>
              {/* downwind arrow, like everywhere else; named by the FROM direction */}
              <svg width="14" height="14" viewBox="0 0 24 24" role="img" aria-label={compass(c.h.dir)} className="mx-auto" style={{ transform: `rotate(${c.h.dir + 180}deg)` }}>
                <path d="M12 3 L18 19 L12 15.5 L6 19 Z" fill="currentColor" />
              </svg>
            </td>
          ))}
        </tr>
        <tr className="h-5">
          <th scope="row" className={clsx(STICKY, "pl-3 text-left text-micro font-medium text-fg-3")}>Ride</th>
          {cols.map((c, i) => {
            const prev = cols[i - 1]?.ride, next = cols[i + 1]?.ride;
            return (
              <td key={c.h.t} className={cell(c)}>
                <span aria-hidden data-ride={c.ride} style={c.ride === "offdir" ? HATCH : undefined}
                  className={clsx("block h-1.5", RIDE_FILL[c.ride], prev === c.ride ? "ml-0" : "ml-[3px] rounded-l-full", next === c.ride ? "mr-0" : "mr-[3px] rounded-r-full")} />
                <span className="sr-only">{RIDE_WORDS[c.ride]}</span>
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
});

/** The ride row's key, under the grid: every state it can show, in the words the rest of the app uses. */
function RideKey() {
  const keys: Ride[] = ["go", "offdir", "below", "above", "night"];
  return (
    <ul aria-label="The ride row" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-2 text-micro text-fg-3">
      {keys.map((k) => (
        <li key={k} className="flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden className={clsx("h-1.5 w-3 rounded-full", RIDE_FILL[k])} style={k === "offdir" ? HATCH : undefined} />
          {RIDE_WORDS[k][0].toUpperCase() + RIDE_WORDS[k].slice(1)}
        </li>
      ))}
    </ul>
  );
}

/** Holds the grid's place (same height) while the forecast loads. */
function Placeholder() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <div className="flex min-h-6 items-center px-1"><Skeleton className="h-4 w-24" /></div>
      <Skeleton className="h-[211px] rounded-lg" />
    </div>
  );
}

export const HourGrid = Object.assign(memo(HourGridImpl), { Placeholder });
