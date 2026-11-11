import clsx from "clsx";
import { motion } from "motion/react";
import { ChevronRight, MapPin, RotateCw, Star } from "lucide-react";
import { memo, useId, useMemo, type CSSProperties, type FocusEvent } from "react";
import { duration, ease } from "../../lib/motion";
import { useModelCompare } from "../../lib/data";
import { ago, chanceOf, confidence, fmtDay, fmtHour, fmtKm, fmtSpan, fmtStrength, fmtWindow, NEARBY_WARN_KM, sameDay, type Session } from "../../lib/session";
import { useNow } from "../../lib/time";
import { useSpotNow, type RankedSpot } from "../../lib/useSpotNow";
import { windColor, type Spot } from "../../lib/wind";
import { Skeleton, WindArrow } from "../bits";
import { capitalise, markerState, TONE_TEXT } from "../map/markerState";
import { Button, cardClass, ConfidenceDots, Ribbon, RIBBON_WORDS, VerdictPill, type RibbonState } from "../ui";
import { allSessions, dayRibbon, noneDetail, weekCells, type WeekCell } from "./board";

const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: duration.base, ease } };
const HOUR = 3600e3;

/**
 * One ranked spot on the Today board: its name, the verdict (pill + when/how strong), today's daylight ribbon with a
 * "now" tick (tomorrow's, labelled, once today's daylight is over), and a small reading that follows the timeline. A
 * `<button>` named by its text (it opens the spot). The verdict is about now: while the timeline points elsewhere it
 * goes neutral, and the reading names the hour's state in the map marker's words ("Today 11 PM · 8 kn · Too light").
 * The top-ranked card (`best`) carries the day's answer on a tab over its top edge ("Best today", in go when it is on
 * today) instead of a separate row that repeats it. On desktop it adds a seven-day strip and the ribbon's end times.
 * While the forecast loads it keeps the same shape with skeletons. Phones: ≤ 104 px tall, so two fit the resting sheet.
 */
export const SpotCard = memo(function SpotCard({ row, onSelect, best = false, onHover }: {
  row: RankedSpot; onSelect: (s: Spot) => void;
  /** This is the board's top spot: show the day's answer on it. */
  best?: boolean;
  /** Pointer or focus on the card (its id) and off it (null), so the map can light its marker. */
  onHover?: (id: string | null) => void;
}) {
  const { spot, forecast, status, verdict } = row;
  const sn = useSpotNow(spot);
  const now = useNow();
  const tz = forecast?.timeZone;
  const hours = forecast?.hours;
  const all = useMemo(() => (hours ? allSessions(hours, spot) : []), [hours, spot]);
  const ribbon = useMemo(() => (hours && tz ? dayRibbon(hours, spot, all, now, tz) : null), [hours, spot, all, now, tz]);
  const week = useMemo(() => (hours && tz ? weekCells(hours, spot, all, now, tz) : null), [hours, spot, all, now, tz]);
  // The verdict about now, checked against the spot's own sensor ("On now · 18 kn at the sensor · till 4 PM"); wind
  // over the range right now reads "Too strong now", as on the map. A spot with no session says why.
  const pill = verdict && hours && tz ? sn.pill : null;
  const detail = pill ? (pill.by === "forecast" && verdict!.state === "none" ? noneDetail(hours!, spot, now, tz!) : pill.detail) : "";
  const scrubbed = sn.at != null;
  const failed = status === "error" && !forecast;
  const answer = best && verdict && hours && tz ? answerFor(row, now, all) : null;
  // How sure: the session's chance in a word, on every card (it comes with the SeaSensei forecast). A raw model has
  // none, so the top spot's session falls back to how well the models agree (one comparison; the detail reuses it).
  const chance = pill && pill.state !== "strong" ? chanceOf(verdict!.session) : null;
  const sess = answer && !chance ? verdict!.session : null;
  const models = useModelCompare(sess ? spot : undefined);
  const conf = sess ? confidence(models.data, sess.start, sess.end + HOUR) : null;
  // The day's answer is a go (the best spot is on today): its detail is the big line. The go wash and tab only while
  // the board shows now (not another hour).
  const goAnswer = !!answer && (pill?.state === "on" || pill?.state === "today");
  const go = goAnswer && !scrubbed;
  // A short name (the day's answer, the spot, its verdict) and the rest as its description, not one long run-on name.
  const id = useId();
  // Keyboard focus lights the marker too; focus put back by the app after a mouse "Back" doesn't.
  const hover = onHover ? {
    onPointerEnter: () => onHover(spot.id), onPointerLeave: () => onHover(null),
    onFocus: (e: FocusEvent<HTMLElement>) => { if (focusVisible(e.currentTarget)) onHover(spot.id); }, onBlur: () => onHover(null),
  } : {};

  return (
    <div className="relative">
      <button type="button" onClick={() => onSelect(spot)} aria-busy={!verdict && !failed ? true : undefined} {...hover} data-spot-card={spot.id}
        aria-labelledby={`${answer ? `${id}k ` : ""}${id}n ${id}v`} aria-describedby={`${id}r ${id}d ${id}w`} data-best={answer ? verdict!.state : undefined} data-go={go || undefined}
        className={clsx(cardClass({ interactive: true, go, padding: "none" }), "group relative px-3.5 pb-3 pt-3 active:scale-[.99] motion-reduce:active:scale-100 transition-[background-color,border-color,transform] duration-(--dur-fast)",
          "focus-visible:outline-offset-[-2px]")}>
        {answer && <Answer id={`${id}k`} go={go} answer={answer} />}

        <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-0.5">
          <h3 id={`${id}n`} className="min-w-0 flex-[1_1_auto] break-words text-body font-semibold tracking-[-0.01em] text-fg">{spot.name}</h3>
          <Reading id={`${id}r`} spot={spot} sn={sn} tz={tz} now={now} />
          <ChevronRight aria-hidden className="-mr-1 hidden size-4 shrink-0 text-fg-3 transition-transform duration-(--dur-fast) group-hover:translate-x-0.5 motion-reduce:transition-none md:block" />
        </div>

        {failed ? (
          <p id={`${id}v`} className="mt-1 flex h-6 items-center pr-20 text-label text-fg-2">Couldn't load the forecast.</p>
        ) : verdict ? (
          <motion.div {...fade} id={`${id}v`} className="mt-1 flex min-h-6 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <VerdictPill state={pill?.state ?? verdict.state} label={pill?.label ?? verdict.label} muted={scrubbed} />
            {detail && <span className={clsx("num min-w-0", goAnswer ? "text-body font-medium text-fg" : "text-label text-fg-2")}>{detail}</span>}
            {/* phones: the dots ride at the end of the strip below, so this row stays one line at 375 px at any hour */}
            {chance && <ChanceWord word={chance} className="ml-auto max-md:hidden" />}
            {conf && <ConfidenceDots level={conf.level} label={conf.label} className="ml-auto max-md:hidden" />}
          </motion.div>
        ) : (
          <div className="mt-1 flex h-6 items-center gap-2"><Skeleton className="h-6 w-[5.5rem] rounded-full" /><Skeleton className="h-3.5 w-36" /></div>
        )}

        <div className="mt-3 flex h-2 items-center gap-2 text-micro text-fg-3 md:h-4">
          {ribbon ? (
            <motion.div {...fade} id={`${id}d`} className="flex min-w-0 flex-1 items-center gap-2">
              {/* Phones hide the times, never the day: an evening strip is tomorrow's, and says so (and is dimmed) */}
              {ribbon.day === "Today" ? <span aria-hidden className="num hidden shrink-0 whitespace-nowrap md:inline">{ribbon.from}</span> : (
                <span aria-hidden data-testid="ribbon-day" className="num shrink-0 whitespace-nowrap font-medium leading-none text-fg-2">
                  <span className="md:hidden">{ribbon.day}</span><span className="hidden md:inline">{ribbon.from}</span>
                </span>
              )}
              <Ribbon cells={ribbon.cells} nowIndex={ribbon.nowIndex} height={8} label={ribbon.label}
                className={clsx("min-w-0 flex-1", ribbon.day !== "Today" && "opacity-60")} />
              <span aria-hidden className="num hidden shrink-0 whitespace-nowrap md:inline">{ribbon.to}</span>
              {chance && <ChanceWord word={chance} className="md:hidden" />}
              {conf && <ConfidenceDots level={conf.level} label={conf.label} className="md:hidden" />}
            </motion.div>
          ) : failed ? <div aria-hidden className="h-2 flex-1 rounded-full bg-line" /> : <Skeleton className="h-2 flex-1 rounded-full" />}
        </div>

        {/* Desktop: the week at a glance, one cell per day coloured by its best daylight hour */}
        <div className="mt-3 hidden border-t border-line pt-2.5 md:block">
          {week ? <motion.div {...fade} id={`${id}w`}><WeekStrip cells={week} at={sn.at} tz={tz!} /></motion.div>
            : <div aria-hidden className="grid grid-cols-7 gap-2">{Array.from({ length: 7 }, (_, i) => <span key={i} className="flex flex-col items-center gap-1"><span className="h-4" /><span className={clsx("h-1 w-full rounded-full", failed ? "bg-line" : "bg-surface-3 motion-safe:animate-pulse")} /></span>)}</div>}
        </div>
      </button>

      {failed && (
        <Button size="sm" variant="secondary" onClick={() => sn.fc.refetch()} aria-label={`Retry loading ${spot.name}`}
          className="absolute right-3 top-[34px] max-md:top-[30px]">
          <RotateCw /> Retry
        </Button>
      )}
    </div>
  );
});

type AnswerText = { kicker: string; rest: string };

/** How likely the session is, in a word (neutral ink: how sure is a different question from whether it's rideable). */
function ChanceWord({ word, className }: { word: string; className?: string }) {
  return <span data-testid="chance" className={clsx("shrink-0 whitespace-nowrap text-caption font-medium leading-none text-fg-2", className)}>{word}</span>;
}

/** `:focus-visible`, where the browser knows it (keyboard focus, not focus a script put back after a click). */
const focusVisible = (el: Element) => { try { return el.matches(":focus-visible"); } catch { return true; } };

/**
 * The day's answer for the top spot, as one sentence: "Best today · Fort De Soto · 1–5 PM · 18–22 kn SW",
 * "No session today · Skyway · Sat 11 AM–4 PM · 17–21 kn SW" ("Done today · …" once today's session is over) or
 * "No session this week · Skyway · Too light · best Tue 13 kn". The card shows the kicker; the rest is on the card
 * already, so it is only in the sentence. `all` is every session, past ones included.
 */
function answerFor(row: RankedSpot, now: number, all: Session[]): AnswerText {
  const v = row.verdict!, s = v.session, tz = row.forecast!.timeZone;
  const go = v.state === "on" || v.state === "today";
  const done = all.some((x) => sameDay(x.start, now, tz) && x.end + HOUR <= now);
  const kicker = go ? "Best today" : v.state === "upcoming" ? (done ? "Done today" : "No session today") : "No session this week";
  const what = !s && v.state === "on" ? v.detail // on by the sensor, with no forecast session behind it
    : s
    ? go ? `${fmtSpan(s.start, s.end + HOUR, tz)} · ${fmtStrength(s)}` : `${fmtWindow(s, tz, now)} · ${fmtStrength(s)}`
    : noneDetail(row.forecast!.hours, row.spot, now, tz);
  return { kicker, rest: [row.spot.name, what].filter(Boolean).join(" · ") };
}

/**
 * The answer's tab, riding the card's top edge (no height of its own, so two cards still fit the resting sheet).
 * Its text is the whole sentence (the e2e contract `today-answer`); only the kicker shows, the card says the rest.
 */
function Answer({ id, go, answer }: { id: string; go: boolean; answer: AnswerText }) {
  return (
    <span data-testid="today-answer" className={clsx("absolute -top-2.5 left-3 z-10 inline-flex h-5 items-center gap-1 rounded-full px-2 text-micro font-semibold uppercase leading-none tracking-[0.08em] ring-1 ring-inset",
      go ? "bg-[color-mix(in_oklab,var(--color-go)_16%,var(--color-ink))] text-go ring-go/40" : "bg-ink text-fg-2 ring-line-strong")}>
      {go && <Star aria-hidden className="size-3 fill-current" strokeWidth={0} />}
      <span id={id}>{answer.kicker}</span><span className="sr-only"> · {answer.rest}</span>
    </span>
  );
}

/**
 * The small "now" on the card: where it's from, speed, arrow and gust. While you scrub, the timeline's hour, with its
 * state in the map marker's words (one function says both), in the marker's colour.
 */
function Reading({ id, spot, sn, tz, now }: { id: string; spot: Spot; sn: ReturnType<typeof useSpotNow>; tz: string | undefined; now: number }) {
  const s = sn.shown;
  if (!s) return sn.fc.isError ? null : <Skeleton className="ml-auto h-4 w-24" />;
  const scrubbed = sn.at != null && tz;
  const hourState = scrubbed ? markerState(spot, sn.atHour, { at: sn.at, hour: sn.atHour, verdict: sn.verdict, sessions: sn.sessions }) : null;
  const far = !scrubbed && sn.source === "nearby" && sn.km != null && sn.km > NEARBY_WARN_KM;
  const label = scrubbed
    ? `${fmtDay(sn.at!, tz, now)} ${fmtHour(sn.at!, tz)}`
    : sn.source === "station" ? (sn.live ? "Live" : ago(sn.now!.t, now)) : sn.source === "nearby" ? `Nearby${sn.km != null ? ` · ${fmtKm(sn.km)}` : ""}` : "Now";
  const speed = Math.round(s.speed), gust = s.gust != null ? Math.round(s.gust) : null;
  return (
    <span id={id} className="ml-auto flex shrink-0 items-center gap-1.5 text-caption text-fg-3" data-testid="spot-reading">
      <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap", scrubbed && "text-accent")}
        title={far ? "This sensor is more than 8 km from the spot, so the wind there may differ." : undefined}>
        {far && <MapPin aria-hidden className="size-3 shrink-0 text-soon" strokeWidth={2.5} />}
        {label}
      </span>
      <span aria-hidden className="text-line-strong">·</span>
      {/* the arrow wears the wind-scale colour (data colour), the number stays ink-legible */}
      <span className="inline-flex" style={{ color: windColor(speed) }}><WindArrow dir={s.dir} size={12} /></span>
      <span className="num whitespace-nowrap">
        <span className="font-semibold text-fg">{speed}</span>
        <span className="text-fg-3"> kn</span>
        {gust != null && gust > speed && <span className="text-fg-3 max-[399px]:sr-only">, gust {gust}</span>}
      </span>
      {hourState && (
        <>
          <span aria-hidden className="text-line-strong">·</span>
          <span data-testid="hour-state" className={clsx("whitespace-nowrap font-medium", TONE_TEXT[hourState.tone])}>{capitalise(hourState.word)}</span>
        </>
      )}
    </span>
  );
}

const WEEK_FILL: Record<RibbonState, string> = {
  go: "bg-go", soon: "bg-soon", off: "bg-off/45", strong: "bg-strong", wrongdir: "", none: "bg-line",
};
const HATCH: CSSProperties = {
  background: "repeating-linear-gradient(135deg, var(--color-wrongdir) 0 2px, color-mix(in oklab, var(--color-wrongdir) 28%, transparent) 2px 4px)",
};

/** Seven days, each a short bar under its weekday. The day the timeline points at is marked in the accent. */
function WeekStrip({ cells, at, tz }: { cells: WeekCell[]; at: number | null; tz: string }) {
  const atDay = at != null ? cells.findIndex((c) => sameDay(c.t, at, tz)) : -1;
  const label = `This week: ${cells.map((c, i) => `${i === 0 ? "today" : c.label} ${RIBBON_WORDS[c.state]}`).join(", ")}`;
  return (
    <div role="img" aria-label={label} className="grid grid-cols-7 gap-2">
      {cells.map((c, i) => (
        <span key={i} title={c.title} className="flex min-w-0 flex-col items-center gap-1">
          <span className={clsx("text-micro leading-4", i === atDay ? "font-semibold text-accent" : i === 0 ? "font-medium text-fg-2" : "text-fg-3")}>{c.label}</span>
          <span data-state={c.state} style={c.state === "wrongdir" ? HATCH : undefined}
            className={clsx("h-1 w-full rounded-full", WEEK_FILL[c.state], i === atDay && "ring-2 ring-accent/70 ring-offset-1 ring-offset-ink")} />
        </span>
      ))}
    </div>
  );
}

/** A card-shaped placeholder (used when the board has no rows yet). */
export function SpotCardSkeleton() {
  return (
    <div aria-hidden className={clsx(cardClass({ padding: "none" }), "px-3.5 pb-3 pt-3")}>
      <div className="flex h-6 items-center justify-between"><Skeleton className="h-4 w-32" /><Skeleton className="h-4 w-20" /></div>
      <div className="mt-1 flex h-6 items-center gap-2"><Skeleton className="h-6 w-[5.5rem] rounded-full" /><Skeleton className="h-3.5 w-36" /></div>
      <Skeleton className="mt-3 h-2 rounded-full" />
    </div>
  );
}
