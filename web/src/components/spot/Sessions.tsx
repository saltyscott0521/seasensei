import clsx from "clsx";
import { motion } from "motion/react";
import { TriangleAlert, Wind } from "lucide-react";
import { memo } from "react";
import { duration, ease, spring, stagger } from "../../lib/motion";
import { chanceOf, confidence, fmtDay, fmtHour, fmtSpan, fmtStrength, fmtWindow, sameDay, type Session } from "../../lib/session";
import { useNow } from "../../lib/time";
import { compass, MODEL_INFO, type Hour, type ModelCompare } from "../../lib/wind";
import { Skeleton } from "../bits";
import { Chip, ConfidenceDots, SectionHeader } from "../ui";
import { OFFSHORE_CAUTION, shoreWord } from "./shore";

const HOUR = 3600e3;

/**
 * The week's rideable daylight sessions as a schedule: day, hours, the range the wind is likely to fall in, and how
 * likely the session is in a word (a raw model has no chance: it keeps the models' agreement dots and its NBM tag).
 * Gusty and offshore sessions are tagged; offshore ones stay listed, with a caution. Picking one moves the charts'
 * cursor to its strongest hour.
 */
export const Sessions = memo(function Sessions({ sessions, tz, models, loading, best, scrubT, atT, onPick, seaward }: {
  /** The bearing from the spot out over open water, where the coast can tell. */
  seaward?: number | null;
  sessions: Session[];
  tz: string;
  models?: ModelCompare;
  loading: boolean;
  /** With no session, the strongest daylight hour ahead (any direction), to say how close it gets. */
  best: Hour | null;
  /** The charts' cursor (a picked session shows as pressed). */
  scrubT?: number;
  /** The timeline's hour: the session it falls in gets a quiet marker. */
  atT?: number | null;
  onPick: (s: Session) => void;
}) {
  const now = useNow();
  const offshore = seaward != null && sessions.some((s) => shoreWord(s.dir, seaward) === "offshore");
  return (
    <section aria-labelledby="sessions-h" className="flex flex-col gap-2">
      <SectionHeader id="sessions-h" title="Sessions"
        aside={sessions.length ? <span className="num">{sessions.length} this week · daylight, 2 h+</span> : undefined} />
      {loading ? (
        <div className="flex flex-col gap-px overflow-hidden rounded-lg border border-line" aria-busy="true" aria-label="Finding sessions">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-11 rounded-none" />)}
        </div>
      ) : sessions.length ? (
        <ul className="overflow-hidden rounded-lg border border-line bg-surface-2">
          {sessions.map((s, i) => (
            <motion.li key={s.start} className="border-t border-line first:border-t-0"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: stagger(i), opacity: { duration: duration.base, ease, delay: stagger(i) } }}>
              <SessionRow s={s} tz={tz} now={now} models={models} onPick={onPick} shore={seaward != null ? shoreWord(s.dir, seaward) : null}
                selected={scrubT != null && scrubT >= s.start && scrubT <= s.end} atHour={atT != null && atT >= s.start && atT <= s.end} />
            </motion.li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-line bg-surface-2 px-3.5 py-3">
          <p className="text-label font-medium text-fg-2">No rideable window this week.</p>
          <p className="mt-0.5 text-caption text-fg-3">
            {best ? <>Strongest daylight wind: <span className="num">{fmtDay(best.t, tz, now)} {fmtHour(best.t, tz)} · {Math.round(best.speed)} kn {compass(best.dir)}</span>. </> : null}
            A session is 2 h or more of daylight in your range and direction.
          </p>
        </div>
      )}
      {offshore && !loading && (
        <p data-testid="offshore-note" className="flex items-start gap-1.5 px-1 text-caption text-fg-2">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-wrongdir" />
          <span>{OFFSHORE_CAUTION}. Those sessions are tagged; ride them only if you know the spot.</span>
        </p>
      )}
    </section>
  );
});

const CHANCE_TITLE = {
  Likely: "Likely: the wind reaches your minimum at least 7 times in 10",
  Possible: "Possible: the wind reaches your minimum 4 to 7 times in 10",
  Unlikely: "Unlikely: the wind reaches your minimum fewer than 4 times in 10",
} as const;

function SessionRow({ s, tz, now, models, selected, atHour, onPick, shore }: {
  s: Session; tz: string; now: number; models?: ModelCompare; selected: boolean; atHour: boolean; onPick: (s: Session) => void;
  shore: string | null;
}) {
  // SeaSensei says how likely the session is; only a raw model falls back to how well the models agree.
  const chance = chanceOf(s);
  const conf = chance ? null : confidence(models, s.start, s.end + HOUR);
  const end = s.end + HOUR;
  const oneDay = sameDay(s.start, end, tz);
  const day = fmtDay(s.start, tz, now);
  const on = s.start <= now && now < end;
  // NBM later in the week: never shown as more than medium confidence.
  const level = conf && s.lowConfidence && conf.level === "high" ? "mid" : conf?.level;
  // The button's name says it all in words (and never contains "models": the chart's "Models" switch must stay unique).
  const name = [fmtWindow(s, tz, now), fmtStrength(s), chance?.toLowerCase(), shore, s.gusty && "gusty",
    conf && `${level === "high" ? "high" : level === "mid" ? "medium" : "low"} confidence, ${Math.round(conf.spread)} kn spread`,
    s.lowConfidence && "NBM blend, lower confidence"].filter(Boolean).join(", ");
  return (
    <button type="button" onClick={() => onPick(s)} aria-pressed={selected} aria-label={`${name}. Show on the charts`}
      className={clsx("group relative flex min-h-11 w-full cursor-pointer items-center gap-2.5 px-3.5 py-1.5 text-left transition-colors duration-150 focus-visible:outline-offset-[-2px]",
        selected ? "bg-accent-soft" : "hover:bg-surface-3")}>
      {(selected || atHour) && <span aria-hidden className={clsx("absolute inset-y-1.5 left-0 w-0.5 rounded-full", selected ? "bg-accent" : "bg-accent/50")} />}
      {/* span[title^=MODEL] whose text starts with the window ("Today 1–5 PM"): the e2e contract for a session */}
      <span title={s.model === "nbm" ? "NBM blend (later in the week): lower confidence"
        : `${MODEL_INFO[s.model].label} forecast${s.lowConfidence ? ", running into the NBM blend: lower confidence" : ""}`}
        className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <span className={clsx("w-12 shrink-0 text-label font-semibold", on ? "text-go" : "text-fg")}>{oneDay ? day : fmtWindow(s, tz, now).split(" ")[0]}</span>
        {/* the hours, then the strength with its direction; on a narrow phone the strength drops under the hours */}
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
          <span className="num whitespace-nowrap text-label text-fg">{oneDay ? fmtSpan(s.start, end, tz) : fmtWindow(s, tz, now).split(" ").slice(1).join(" ")}</span>
          <span className="num whitespace-nowrap text-label text-fg-2">{fmtStrength(s)}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center justify-end gap-1.5">
        {s.gusty && <Chip size="sm" icon={<Wind />}>Gusty</Chip>}
        {s.lowConfidence && (
          <span className="inline-flex h-5 items-center rounded-full border border-dashed border-fg-3 px-1.5 text-micro font-medium text-fg-2">NBM</span>
        )}
        {shore === "offshore" && <Chip size="sm" tone="wrongdir" icon={<TriangleAlert />} title={OFFSHORE_CAUTION}>Offshore</Chip>}
        {chance ? <span data-testid="chance" title={CHANCE_TITLE[chance]} className="min-w-[3.4rem] text-right text-caption font-medium text-fg-2">{chance}</span>
          : conf ? <ConfidenceDots level={level!} label={s.lowConfidence ? `${conf.label}, NBM blend: lower confidence` : conf.label} />
          : <span aria-hidden className="w-6" />}
      </span>
    </button>
  );
}
