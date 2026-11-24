import { animate, AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { Pause, Play, RotateCcw, Wind, WifiOff } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useSpots } from "../lib/data";
import { duration, ease, spring } from "../lib/motion";
import { fmtHour, fmtWeekday, isDaylightHour } from "../lib/session";
import { compass, MODEL_INFO, windGradient, type Model } from "../lib/wind";
import { fmtWhen, fmtWhenLong, hourOfDay, nightSpans } from "./charts/scale";
import { Skeleton } from "./bits";
import { Button, Chip, IconButton } from "./ui";
import { WindStrip, type Area, type StripSize } from "./WindStrip";
import { useWindScale } from "../lib/windScale";

const HOUR = 3600e3;
const SCALE_MAX = 45; // windGradient() spans 0–45 kn

/**
 * Scrub the map through the week. One line of outlook (tap it to jump there), the week as a strip of wind (one bar per
 * hour: the strongest wind in view, in the map's colours, its height dramatic; dashed = your threshold) that is also the
 * slider (a framed hour; tap or drag anywhere on it, arrow keys on the frame), the hour and model, and the map's colour
 * scale. Index 0 is now. Slim on purpose: on phones the whole card stays within 132px (176px when tall, at the handle snap).
 * Scrubbed (index > 0), the top line describes the chosen hour instead of the outlook from now.
 *
 * The outlook only ever points at daylight, in stretches of two hours or more, like the sessions on the board: a windy
 * night is not "wind on the way". The chip names the forecast the rider chose (`primary`); when that is SeaSensei, a
 * blend made per spot, the map's own wind comes from a single model, named as a detail ("wind map HRRR").
 *
 * `size`: `compact` is a short strip with no day names (a short phone's resting sheet leaves little map); `tall` is a
 * taller strip with bigger day names and a larger readout (the phone's handle snap, where the map has the room). A
 * change of size crossfades the strip (opacity only) rather than snapping.
 * `failed`: the wind field could not load: a one-line "unavailable" card with Try again (`onRetry`). While loading, a
 * placeholder holds the card's place.
 * `where`: where the night shading is worked out for; defaults to the middle of your spots.
 */
export const Timeline = memo(function Timeline({ hours, models, area, threshold, index, onIndex, playing, onPlaying, tz, failed, onRetry, where, size = "normal", primary }: {
  hours: number[]; models: Model[]; area: Area[]; threshold: number; index: number; onIndex: (i: number) => void;
  /** The forecast the rider chose. Defaults to the map's own model for each hour. */
  primary?: Model;
  playing: boolean; onPlaying: (p: boolean) => void; tz: string; failed?: boolean; onRetry?: () => void;
  where?: { lat: number; lon: number }; size?: StripSize;
}) {
  const compact = size === "compact", tall = size === "tall";
  // A new size crossfades in (the strip's height changes with the snap; fading hides the jump).
  const stripRef = useRef<HTMLDivElement>(null);
  const shownSize = useRef(size);
  useEffect(() => {
    if (shownSize.current === size) return;
    shownSize.current = size;
    if (stripRef.current) animate(stripRef.current, { opacity: [0, 1] }, { duration: duration.base, ease });
  }, [size]);
  const last = Math.max(0, hours.length - 1);
  const spots = useSpots();

  // Playback: one interval for the whole run (it reads the index from a ref), looping past "now" so the live
  // station layer doesn't flash back for one tick on every lap.
  const at = useRef(index);
  at.current = index;
  useEffect(() => {
    if (!playing || last < 1) return;
    const id = setInterval(() => onIndex(at.current >= last ? 1 : at.current + 1), 450);
    return () => clearInterval(id);
  }, [playing, last, onIndex]);

  // Where daylight is worked out for (and the night shading): the middle of your spots.
  const place = useMemo(() => where ?? (spots.length
    ? { lat: spots.reduce((a, s) => a + s.lat, 0) / spots.length, lon: spots.reduce((a, s) => a + s.lon, 0) / spots.length }
    : null), [where, spots]);

  const outlook = useMemo(() => {
    if (!area.length || hours.length < 2) return null;
    // Rideable-looking hours: at least the threshold somewhere in view, in daylight (without a place, any hour).
    const light = (i: number) => !place || isDaylightHour(place.lat, place.lon, hours[i]);
    const windy = (i: number) => !!area[i] && area[i]!.peak >= threshold && light(i);
    const runEnd = (i: number) => { let j = i; while (j + 1 < area.length && windy(j + 1)) j++; return j; };
    if (windy(0)) {
      const j = runEnd(0);
      const tail = j + 1 >= area.length ? "all week" : area[j + 1] && area[j + 1]!.peak >= threshold ? `till dark, ${fmtHour(hours[j + 1], tz)}` : `easing by ${fmtWhen(hours[j + 1], tz)}`;
      return { kind: "now" as const, i: 0, head: `Windy now: up to ${Math.round(area[0]!.peak)} kn in view`, mid: "", tail };
    }
    // The next daylight stretch of two hours or more (the board's sessions are at least that long).
    for (let i = 1; i < area.length; i++) {
      if (!windy(i)) continue;
      const j = runEnd(i);
      if (j > i) {
        const top = area.slice(i, j + 1).reduce((m, a) => Math.max(m, a!.peak), 0);
        return { kind: "coming" as const, i, head: `Wind on the way: ${fmtWhen(hours[i], tz)}`, mid: `up to ${Math.round(top)} kn ${compass(area[i]!.dir)}`, tail: `for ${j - i + 1} h` };
      }
      i = j;
    }
    // Nothing: the strongest daylight hour of the week.
    let best = -1;
    area.forEach((a, j) => { if (a && light(j) && (best < 0 || a.peak > area[best]!.peak)) best = j; });
    return { kind: "none" as const, i: Math.max(0, best), head: `No ${threshold}+ kn in view this week`, mid: "", tail: best >= 0 ? `best ${fmtWhen(hours[best], tz)}, ${Math.round(area[best]!.peak)} kn` : "" };
  }, [area, hours, threshold, tz, place]);

  // Days along the week (index of each local midnight) and the night spans, worked out once per field.
  const days = useMemo(() => hours.flatMap((h, i) => (i > 0 && hourOfDay(h, tz) === 0 ? [{ i, label: fmtWeekday(h, tz) }] : [])), [hours, tz]);
  const nights = useMemo(() => {
    if (!place || hours.length < 2) return [];
    const t0 = hours[0], toI = (t: number) => (t - t0) / HOUR;
    return nightSpans(place.lat, place.lon, t0, hours[last]).map(([a, b]): [number, number] => [toI(a), toI(b)]);
  }, [place, hours, last]);
  const nbmFrom = useMemo(() => models.findIndex((m) => m === "nbm"), [models]);

  const summary = useMemo(() => {
    const best = area.reduce((b, a, j) => (a && (!area[b] || a.peak > area[b]!.peak) ? j : b), 0);
    return area[best] && hours[best] != null
      ? `strongest ${Math.round(area[best]!.peak)} kn ${fmtWhen(hours[best], tz)}; dashed line at your ${threshold} kn`
      : "";
  }, [area, hours, threshold, tz]);

  const seek = useCallback((i: number) => { onPlaying(false); onIndex(Math.max(0, Math.min(last, i))); }, [onPlaying, onIndex, last]);
  // "Back to now" disappears as it is pressed: hand focus to the slider it acted on, not to the page.
  const thumbRef = useRef<HTMLSpanElement>(null);
  const backToNow = useCallback(() => { seek(0); thumbRef.current?.focus(); }, [seek]);

  if (hours.length < 2) return failed ? <TimelineFailed onRetry={onRetry} /> : <TimelinePlaceholder size={size} />;

  const t = hours[index];
  const a = area[index];
  const model = models[index];
  // One name for what's on screen: the chosen forecast. Under SeaSensei the map's wind is a single model's, a detail.
  const lead = primary === "sensei" ? primary : model;
  const mapModel = lead !== model ? MODEL_INFO[model]?.label : undefined;
  const label = index === 0 ? "Now" : fmtWhen(t, tz);
  const valueText = `${index === 0 ? "Now" : fmtWhenLong(t, tz)}, ${MODEL_INFO[lead]?.label ?? "model"} forecast`
    + (a ? `, typical ${Math.round(a.mean)}, up to ${Math.round(a.peak)} knots in view` : "")
    + (mapModel ? `, wind map from ${mapModel}` : "");
  // Scrubbed: the top line is the chosen hour ("Sat 3 PM · up to 18 kn SW in view"); at now, the outlook.
  const line = index > 0
    ? { kind: "hour" as const, head: label, mid: a ? `up to ${Math.round(a.peak)} kn ${compass(a.dir)} in view` : "no wind data in view", tail: "" }
    : outlook;
  const lineText = line && (
    <>
      <Wind aria-hidden className={clsx("size-3.5 shrink-0", line.kind === "none" ? "text-fg-3" : "text-accent")} />
      {/* One line, never cut mid-thought: what doesn't fit whole wraps onto a hidden second line. */}
      <span className="flex h-6 min-w-0 flex-1 flex-wrap items-center gap-x-1.5 overflow-hidden leading-6">
        <b className="min-w-0 max-w-full truncate font-semibold">{line.head}</b>
        {line.mid && <span className="shrink-0 whitespace-nowrap text-fg-2">· {line.mid}</span>}
        {line.tail && <span className="shrink-0 whitespace-nowrap text-fg-3">{line.mid ? "" : "· "}{line.tail}</span>}
      </span>
    </>
  );
  const lineClass = clsx("-mx-1 flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 text-left text-caption md:text-label",
    line?.kind === "none" ? "text-fg-2" : "text-fg");

  return (
    <div className="glass rounded-xl px-3 pb-2 pt-2 md:px-3.5" data-size={size}>
      <div className="flex h-6 items-center gap-2">
        {line && line.kind !== "hour" ? (
          // On phones the button is 32px tall to the thumb, in the same 24px row.
          <button type="button" onClick={() => seek(outlook!.i)} data-testid="outlook" title="Jump to this hour"
            className={clsx(lineClass, "transition-colors duration-150 hover:bg-surface-3 max-md:-my-1 max-md:h-8")}>
            {lineText}
          </button>
        ) : line ? (
          <div data-testid="outlook" className={lineClass}>{lineText}</div>
        ) : <span className="flex-1" />}
        {index === 0
          ? <Chip tone="accent" size="sm" className="font-semibold tracking-wide">NOW</Chip>
          : <Chip size="sm" className="font-semibold tracking-wide" icon={<i className="size-1.5 rounded-full" style={{ background: MODEL_INFO[lead]?.color }} />}>{MODEL_INFO[lead]?.label}</Chip>}
      </div>

      <div className="mt-1 flex items-center gap-2.5 max-md:gap-2">
        <motion.button type="button" whileTap={{ scale: 0.92 }} transition={spring} onClick={() => onPlaying(!playing)} aria-label={playing ? "Pause" : "Play the week"}
          className={clsx("relative grid shrink-0 place-items-center rounded-full bg-accent text-ink shadow-raised transition-[filter] duration-150 hover:brightness-110",
            compact ? "size-9 before:absolute before:-inset-1" : "size-10 max-md:before:absolute max-md:before:-inset-0.5")}>
          {playing ? <Pause aria-hidden className="size-4" fill="currentColor" /> : <Play aria-hidden className="ml-0.5 size-4" fill="currentColor" />}
        </motion.button>

        <div ref={stripRef} className="@container min-w-0 flex-1">
          <WindStrip area={area} index={index} threshold={threshold} nbmFrom={nbmFrom} days={days} nights={nights} onSeek={seek}
            summary={summary} valueText={valueText} thumbRef={thumbRef} size={size} />
          <div className={clsx("mt-0.5 flex items-center gap-3", tall ? "h-5" : "h-4")}>
            <span className={clsx("num min-w-0 flex-1 truncate text-fg-2", tall ? "text-caption" : "text-micro")}>
              <b data-testid="timeline-when" className="font-semibold text-fg">{label}</b>
              {a && <> · {knots(a)} kn<span className="@max-[240px]:hidden"> {compass(a.dir)}</span></>}
              {mapModel && <span data-testid="map-model" className="text-fg-3 @max-[330px]:hidden" title={`The wind drawn on the map is ${mapModel}'s. Your spots use SeaSensei.`}> · wind map {mapModel}</span>}
            </span>
            <Scale />
          </div>
        </div>

        {/* A fixed slot: the button appearing mustn't resize the chart under your finger. */}
        <div className="size-9 shrink-0">
          <AnimatePresence initial={false}>
            {index > 0 && (
              <motion.div key="back" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}
                transition={{ duration: duration.fast, ease }}>
                <IconButton aria-label="Back to now" variant="tonal" size="sm" onClick={backToNow}><RotateCcw /></IconButton>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
});

/** "12" when typical and strongest round the same, else "9–14". */
const knots = (a: NonNullable<Area>) => {
  const lo = Math.round(a.mean), hi = Math.round(a.peak);
  return lo === hi ? `${hi}` : `${lo}–${hi}`;
};

/** The map's colour scale, compact: a 4px gradient bar with 0 / 10 / 20 / 30 / 40+ kn under it (0 / 20 / 40+ when narrow). */
function Scale() {
  useWindScale(); // redraw when the rider picks another colour scale
  return (
    <div className="relative w-[112px] shrink-0 pr-3 @max-[200px]:w-[88px]" title="Wind speed on the map, knots">
      <i aria-hidden className="block h-1 rounded-full" style={{ background: windGradient() }} />
      <div className="num relative mt-[3px] h-2.5 text-[10px] leading-none text-fg-3">
        {[0, 10, 20, 30, 40].map((v) => (
          <span key={v} className={clsx("absolute", v === 0 ? "" : v === 40 ? "-translate-x-[0.6em] whitespace-nowrap" : "-translate-x-1/2",
            (v === 10 || v === 30) && "@max-[200px]:hidden")}
            style={{ left: `${(v / SCALE_MAX) * 100}%` }}>
            {v === 40 ? <>40+ <span>kn</span></> : v}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Holds the card's place (same height) while the week loads, so nothing jumps when it arrives. */
function TimelinePlaceholder({ size }: { size: StripSize }) {
  const compact = size === "compact";
  return (
    <div className="glass rounded-xl px-3 pb-2 pt-2 md:px-3.5" aria-busy="true">
      <div className="flex h-6 items-center text-caption text-fg-3">Loading the week…</div>
      <div className="mt-1 flex items-center gap-2.5 max-md:gap-2">
        <div className={clsx("grid shrink-0 place-items-center rounded-full bg-surface-3 text-fg-3", compact ? "size-9" : "size-10")}><Play aria-hidden className="ml-0.5 size-4" /></div>
        <div className="@container min-w-0 flex-1">
          {/* the strip's height: day names and bars, or the compact bars */}
          <Skeleton className={clsx("rounded-sm", compact ? "h-5" : size === "tall" ? "h-[100px]" : "h-14")} />
          <div className="mt-0.5 flex h-4 items-center justify-end"><Scale /></div>
        </div>
        <div className="size-9 shrink-0" />
      </div>
    </div>
  );
}

/** The wind field didn't load: say so in the timeline's place (the slider would have nothing to scrub), and offer a retry. */
function TimelineFailed({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="glass flex items-center gap-2.5 rounded-xl py-2 pl-3.5 pr-2" data-testid="timeline-failed">
      <WifiOff aria-hidden className="size-4 shrink-0 text-fg-3" />
      <p className="min-w-0 flex-1 text-caption text-fg-2 md:text-label">
        <b className="font-semibold text-fg">Wind map unavailable.</b> Spot forecasts still work.
      </p>
      {onRetry && <Button size="sm" onClick={() => onRetry()}>Try again</Button>}
    </div>
  );
}
