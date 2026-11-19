import clsx from "clsx";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type MouseEvent } from "react";
import { fmtRange } from "../../lib/sensei";
import { fmtHour, isDaylightHour, sessions } from "../../lib/session";
import { requestAt, useCanSetAt, useNow } from "../../lib/time";
import { compass, windColor, type Hour, type Spot } from "../../lib/wind";
import { hourState } from "../home/board";
import { Skeleton } from "../bits";
import { RIBBON_WORDS, SectionHeader, type RibbonState } from "../ui";

const HOUR = 3600e3;
const COL = 28; // px per hour: 12+ hours across a phone

/** An hour's answer: the ribbon's states (go only inside a session), or night (never a session, whatever the wind). */
type State = Exclude<RibbonState, "none"> | "night";
type Col = { h: Hour; state: State; dayStart: boolean; now: boolean; words: string; label: string };

const WORDS: Record<State, string> = { ...RIBBON_WORDS, night: "night" };
// The bars and gust cells carry the wind scale; the thin band under them carries the answer (the colour contract),
// joined into runs. Too light and night draw no band: the short bars say it.
const BAND: Record<State, string> = { go: "bg-go", soon: "bg-soon", strong: "bg-strong", wrongdir: "", off: "", night: "" };
const NIGHT_KEY = "h-2 w-3 rounded-[2px] bg-ink/60 ring-1 ring-inset ring-line-strong";
const HATCH: CSSProperties = {
  background: "repeating-linear-gradient(135deg, var(--color-wrongdir) 0 2px, color-mix(in oklab, var(--color-wrongdir) 28%, transparent) 2px 4px)",
};
const KEY: State[] = ["go", "soon", "strong", "wrongdir", "night"];
const KEY_WORDS: Record<State, string> = { go: "Rideable", soon: "Marginal", off: "Too light", strong: "Too strong", wrongdir: "Wrong direction", night: "Night" };
/** The bars' fixed scale: 0–TOP kn over PLOT px, so 8 kn is short and 24 kn towers (the number rides on top). */
const TOP = 30, PLOT = 76, HEAD = 15;
const barPx = (kn: number) => Math.max(14, Math.round((Math.min(kn, TOP) / TOP) * PLOT));
/** The wind scale's colour for a speed, and ink or white on it, whichever reads (WCAG luminance). */
function swatch(kn: number) {
  const [r, g, b] = windColor(kn).match(/\d+/g)!.map(Number);
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return { background: `rgb(${r},${g},${b})`, color: L > 0.2 ? "var(--color-ink)" : "#fff" };
}

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
/** "3 PM" → "3p" on even hours, else "" (the column keeps its full name for assistive tech). */
const shortHour = (label: string) => {
  const m = label.match(/^(\d+)(:\d+)? (AM|PM)$/);
  return m && +m[1] % 2 === 0 ? `${m[1]}${m[2] ?? ""}${m[3] === "AM" ? "a" : "p"}` : "";
};

/**
 * Every hour from now as a narrow bar on one fixed scale (0–30 kn), filled with the wind-scale gradient, the gust a
 * faint tick above it; under each bar a band in the colour contract (a session's hours go and joined into one run,
 * marginal amber, too light quiet, too strong, wrong direction hatched; none at night, which is dimmed), then the
 * speed and a downwind arrow. Day names stick to the left edge; each hour's name and tooltip say it all in words
 * (with SeaSensei's likely range). Scrolls sideways (the mouse wheel too, on desktop), keeps the highlighted hour (the
 * charts' cursor, else the timeline's) in view, and a tap on an hour puts the one clock there.
 */
function HourGridImpl({ hours, tz, spot, highlightT }: { hours: Hour[]; tz: string; spot: Spot; highlightT?: number }) {
  const clock = useNow();
  const canSet = useCanSetAt();
  const start = Math.floor(clock / HOUR) * HOUR;
  const cols = useMemo(() => {
    const list = sessions(hours, spot);
    const out: Col[] = [];
    for (const h of hours) {
      if (h.t < start) continue;
      const state: State = isDaylightHour(spot.lat, spot.lon, h.t) ? (hourState(h, spot, list) as State) : "night";
      const prev = out[out.length - 1], label = fmtHour(h.t, tz), range = fmtRange(h);
      out.push({
        h, state, now: h.t === start, label,
        dayStart: !!prev && dayKey(prev.h.t, tz) !== dayKey(h.t, tz),
        words: `${h.t === start ? "Now" : label}: ${Math.round(h.speed)} kn${range ? `, likely ${range}` : ""}, gusts ${Math.round(h.gust)}, from ${compass(h.dir)}, ${WORDS[state]}`,
      });
    }
    return out;
  }, [hours, start, spot, tz]);

  const scroller = useRef<HTMLDivElement>(null);
  const hi = highlightT == null || !cols.length ? -1 : cols.findIndex((c) => Math.abs(c.h.t - highlightT) < HOUR / 2);

  // Keep the highlighted hour in view (two hours of context to its left).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || hi < 0) return;
    const x = hi * COL, seen0 = el.scrollLeft, seen1 = el.scrollLeft + el.clientWidth;
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

  // A tap on an hour puts the one clock there (pointer only: the timeline is the keyboard's way to the same place).
  const onPick = (e: MouseEvent) => {
    const t = Number((e.target as Element).closest("[data-t]")?.getAttribute("data-t"));
    if (canSet && t) requestAt(t <= clock ? null : t);
  };

  const shown = useMemo(() => KEY.filter((k) => cols.some((c) => c.state === k)), [cols]);
  return (
    <section aria-labelledby="hours-h" className="flex flex-col gap-2">
      <SectionHeader id="hours-h" title="Hour by hour" />
      <div className="overflow-hidden rounded-lg border border-line bg-surface-2">
        <div ref={scroller} tabIndex={0} role="region" aria-label="Hour by hour, scrolls sideways"
          className="no-scrollbar overflow-x-auto overscroll-x-contain [mask-image:linear-gradient(to_right,#000_calc(100%-16px),transparent)] focus-visible:outline-offset-[-2px]">
          <div className={clsx("relative w-max px-1.5 pb-1", canSet && "cursor-pointer")} onClick={onPick}>
            <HourTable cols={cols} tz={tz} clock={clock} />
            {hi >= 0 && (
              <div aria-hidden className="pointer-events-none absolute bottom-0.5 top-[18px] rounded-md bg-accent/[.07] ring-1 ring-inset ring-accent/70"
                style={{ left: 6 + hi * COL, width: COL }} />
            )}
          </div>
        </div>
        <ul aria-label="Colour key" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-line px-2.5 py-1.5 text-micro text-fg-3">
          {shown.map((k) => (
            <li key={k} className="flex items-center gap-1 whitespace-nowrap">
              <span aria-hidden className={k === "night" ? NIGHT_KEY : clsx("h-1 w-3 rounded-full", BAND[k])} style={k === "wrongdir" ? HATCH : undefined} />
              {KEY_WORDS[k]}
            </li>
          ))}
          <li className="flex items-center gap-1 whitespace-nowrap">
            <span aria-hidden className="h-2 w-3 rounded-[2px]" style={swatch(22)} />Gusts
          </li>
        </ul>
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
  const edge = (c: Col) => c.dayStart && "border-l border-line-strong";
  return (
    <table className="table-fixed border-separate border-spacing-0 text-center" style={{ width: cols.length * COL }}>
      <caption className="sr-only">Hour by hour from now: wind and gust in knots, direction, and whether each hour is rideable</caption>
      <colgroup>{cols.map((c) => <col key={c.h.t} style={{ width: COL }} />)}</colgroup>
      <thead>
        <tr className="h-[18px]">
          {days.map((d, i) => (
            <th key={d.key} scope="colgroup" colSpan={d.n} className={clsx("p-0 text-left align-bottom", i > 0 && "border-l border-line-strong")}>
              <span className="sticky left-0 inline-block whitespace-nowrap px-1 text-micro font-semibold leading-4 text-fg">{d.label}</span>
            </th>
          ))}
        </tr>
        <tr className="h-4">
          {cols.map((c) => (
            <th key={c.h.t} scope="col" data-t={c.h.t} data-night={c.state === "night" || undefined} aria-label={c.now ? "Now" : c.label}
              className={clsx("num whitespace-nowrap p-0 text-[10px] font-medium leading-4", edge(c), c.now ? "text-accent" : "text-fg-3")}>
              {c.now ? "Now" : shortHour(c.label)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {cols.map((c, i) => {
            const night = c.state === "night";
            const prev = cols[i - 1]?.state, next = cols[i + 1]?.state;
            const joinL = prev === c.state && !c.dayStart, joinR = next === c.state && !cols[i + 1]?.dayStart;
            return (
              <td key={c.h.t} data-t={c.h.t} data-ride={c.state} title={c.words} className={clsx("p-0 align-bottom", edge(c), night && "bg-ink/50")}>
                <span className="sr-only">{c.words}</span>
                <span aria-hidden className="flex flex-col">
                  <span className={clsx("flex flex-col", night && "opacity-45")}>
                    {/* the bar: as tall as the wind, in its colour, the speed on top and the (downwind) arrow inside */}
                    <span className="flex flex-col justify-end" style={{ height: PLOT + HEAD }}>
                      <span className="num text-center text-caption font-bold leading-[15px] text-fg">{Math.round(c.h.speed)}</span>
                      <span data-bar="" className="mx-px flex justify-center rounded-t-[3px] pt-[3px]" style={{ height: barPx(c.h.speed), ...swatch(c.h.speed) }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" style={{ transform: `rotate(${c.h.dir + 180}deg)` }}>
                          <path d="M12 3 L18 19 L12 15.5 L6 19 Z" fill="currentColor" />
                        </svg>
                      </span>
                    </span>
                    {/* the gust: a cell in its own colour */}
                    <span className="num mx-px mt-px text-center text-[10px] font-semibold leading-[18px]" style={swatch(c.h.gust)}>{Math.round(c.h.gust)}</span>
                  </span>
                  <span data-band={c.state} style={c.state === "wrongdir" ? HATCH : undefined}
                    className={clsx("mt-[3px] block h-[3px]", BAND[c.state],
                      joinL ? "ml-0" : "ml-px rounded-l-full", joinR ? "mr-0" : "mr-px rounded-r-full")} />
                </span>
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
});

/** Holds the grid's place (same height) while the forecast loads. */
function Placeholder() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <div className="flex min-h-6 items-center px-1"><Skeleton className="h-4 w-24" /></div>
      <Skeleton className="h-[180px] rounded-lg" />
    </div>
  );
}

export const HourGrid = Object.assign(memo(HourGridImpl), { Placeholder });
