import * as Slider from "@radix-ui/react-slider";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { Pause, Play, RotateCcw, Wind, WifiOff } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useSpots } from "../lib/data";
import { duration, ease, spring } from "../lib/motion";
import { fmtHour, fmtWeekday, isDaylightHour } from "../lib/session";
import { compass, MODEL_INFO, windColor, windGradient, windStops, type Model } from "../lib/wind";
import { fmtWhen, fmtWhenLong, hourOfDay, labelWidth, nightSpans, useSvgId } from "./charts/scale";
import { Skeleton } from "./bits";
import { Button, Chip, IconButton } from "./ui";
import { useChartSize } from "./useChartSize";

type Area = { mean: number; peak: number; dir: number } | null;

// Radix keeps the 20px thumb inside the track, so its centre runs from 10px to width−10px.
// The chart uses the same inset so a point on the chart sits exactly above the thumb for that hour.
const INSET = 10;
const CHART_H = 44;
const HOUR = 3600e3;
const SCALE_MAX = 45; // windGradient() spans 0–45 kn

/**
 * Scrub the map through the week. One line of outlook (tap it to jump there), a chart of the wind across whatever is
 * on screen (filled = typical, line = strongest in view, dashed = your threshold), the slider with the hour and model,
 * and the map's colour scale. Index 0 is now. Slim on purpose: on phones the whole card stays within 132px.
 * Scrubbed (index > 0), the top line describes the chosen hour instead of the outlook from now.
 *
 * The outlook only ever points at daylight, in stretches of two hours or more, like the sessions on the board: a windy
 * night is not "wind on the way". The chip names the forecast the rider chose (`primary`); when that is SeaSensei, a
 * blend made per spot, the map's own wind comes from a single model, named as a detail ("wind map HRRR").
 *
 * `compact`: no chart (the outlook line, the slider and its readout), for a timeline riding inside a short phone's sheet.
 * `failed`: the wind field could not load: a one-line "unavailable" card with Try again (`onRetry`). While loading, a
 * placeholder holds the card's place.
 * `where`: where the night shading is worked out for; defaults to the middle of your spots.
 */
export const Timeline = memo(function Timeline({ hours, models, area, threshold, index, onIndex, playing, onPlaying, tz, failed, onRetry, where, compact, primary }: {
  hours: number[]; models: Model[]; area: Area[]; threshold: number; index: number; onIndex: (i: number) => void;
  /** The forecast the rider chose. Defaults to the map's own model for each hour. */
  primary?: Model;
  playing: boolean; onPlaying: (p: boolean) => void; tz: string; failed?: boolean; onRetry?: () => void;
  where?: { lat: number; lon: number }; compact?: boolean;
}) {
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

  if (hours.length < 2) return failed ? <TimelineFailed onRetry={onRetry} /> : <TimelinePlaceholder compact={compact} />;

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
    <div className="glass rounded-xl px-3 pb-2 pt-2 md:px-3.5" data-compact={compact || undefined}>
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

        <div className="@container min-w-0 flex-1">
          {!compact && <AreaChart area={area} index={index} threshold={threshold} nbmFrom={nbmFrom} days={days} nights={nights} onSeek={seek} summary={summary} />}
          <Slider.Root className="relative flex h-5 w-full touch-none select-none items-center before:absolute before:inset-x-0 before:-inset-y-2"
            min={0} max={last} step={1} value={[index]} onValueChange={([v]) => seek(v)}>
            <Slider.Track className="relative h-1 grow overflow-hidden rounded-full bg-line-strong">
              {nbmFrom > 0 && (
                <span aria-hidden className="absolute inset-y-0 right-0"
                  style={{ left: `${(nbmFrom / last) * 100}%`, background: "repeating-linear-gradient(135deg, var(--color-fg-3) 0 1.5px, transparent 1.5px 4px)", opacity: 0.45 }} />
              )}
              <Slider.Range className="absolute h-full rounded-full bg-accent" />
            </Slider.Track>
            <Slider.Thumb ref={thumbRef} aria-label="Forecast time" aria-valuetext={valueText}
              className="block size-5 cursor-grab rounded-full border-[3px] border-accent bg-fg shadow-raised active:cursor-grabbing" />
          </Slider.Root>
          <div className="mt-0.5 flex h-4 items-center gap-3">
            <span className="num min-w-0 flex-1 truncate text-micro text-fg-2">
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
function TimelinePlaceholder({ compact }: { compact?: boolean }) {
  return (
    <div className="glass rounded-xl px-3 pb-2 pt-2 md:px-3.5" aria-busy="true">
      <div className="flex h-6 items-center text-caption text-fg-3">Loading the week…</div>
      <div className="mt-1 flex items-center gap-2.5 max-md:gap-2">
        <div className={clsx("grid shrink-0 place-items-center rounded-full bg-surface-3 text-fg-3", compact ? "size-9" : "size-10")}><Play aria-hidden className="ml-0.5 size-4" /></div>
        <div className="@container min-w-0 flex-1">
          {!compact && <Skeleton className="h-11 rounded-sm" />}
          <div className="flex h-5 items-center"><i className="block h-1 w-full rounded-full bg-line-strong" /></div>
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

/**
 * The week in view. Exactly two <path>s (typical as a fill, strongest as a line); everything else is a line, rect,
 * circle or text. The x scale shares INSET with the slider, so a tap seeks to the hour under it.
 */
function AreaChart({ area, index, threshold, nbmFrom, days, nights, onSeek, summary }: {
  area: Area[]; index: number; threshold: number; nbmFrom: number; days: { i: number; label: string }[]; nights: [number, number][];
  onSeek: (i: number) => void; summary: string;
}) {
  const [ref, { w: W }] = useChartSize(CHART_H, 0, CHART_H);
  const H = CHART_H;
  const svgRef = useRef<SVGSVGElement>(null);
  const last = Math.max(1, area.length - 1);
  const gradId = useSvgId("area");

  const m = useMemo(() => {
    const vals = area.flatMap((a) => (a ? [a.peak] : []));
    const top = Math.max(25, Math.ceil((Math.max(threshold, ...vals) + 2) / 5) * 5);
    const x = (i: number) => INSET + (i / last) * (W - 2 * INSET);
    const y = (v: number) => H - 2 - (v / top) * (H - 10);
    return { top, x, y };
  }, [area, threshold, W, H, last]);

  function seekAt(e: React.PointerEvent) {
    const r = svgRef.current!.getBoundingClientRect();
    onSeek(Math.round(((e.clientX - r.left - INSET) / (r.width - 2 * INSET)) * last));
  }

  const a = area[index];
  const cx = m.x(index);
  return (
    <div ref={ref} style={{ height: H }}>
      {W > 0 && (
        <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block cursor-pointer touch-pan-y select-none" role="img"
          aria-label={`Wind in view over the next week${summary ? `: ${summary}` : ""}`}
          onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); seekAt(e); }}
          onPointerMove={(e) => e.buttons && seekAt(e)}>
          <AreaLayer area={area} m={m} W={W} H={H} threshold={threshold} nbmFrom={nbmFrom} days={days} nights={nights} gradId={gradId} />
          <line x1={cx} x2={cx} y1={0} y2={H} className="stroke-fg" strokeOpacity=".85" />
          {a && <circle cx={cx} cy={m.y(a.peak)} r="3.5" fill={windColor(a.peak)} strokeWidth="1.5" className="stroke-ink" />}
        </svg>
      )}
    </div>
  );
}

/** Everything in the chart that doesn't move with the cursor. Memoised: scrubbing only redraws the cursor. */
const AreaLayer = memo(function AreaLayer({ area, m, W, H, threshold, nbmFrom, days, nights, gradId }: {
  area: Area[]; m: { top: number; x: (i: number) => number; y: (v: number) => number }; W: number; H: number; threshold: number;
  nbmFrom: number; days: { i: number; label: string }[]; nights: [number, number][]; gradId: string;
}) {
  const last = Math.max(1, area.length - 1);
  const line = (k: "mean" | "peak") => {
    let d = "", pen = false;
    area.forEach((a, i) => { if (!a) { pen = false; return; } d += `${pen ? "L" : "M"}${m.x(i).toFixed(1)},${m.y(a[k]).toFixed(1)}`; pen = true; });
    return d;
  };
  const mean = line("mean"), peak = line("peak");
  const fill = mean ? `${mean}L${m.x(last).toFixed(1)},${H}L${m.x(0).toFixed(1)},${H}Z` : "";
  return (
    <g>
      <defs>
        <linearGradient id={gradId} x1="0" y1={m.y(0)} x2="0" y2={m.y(m.top)} gradientUnits="userSpaceOnUse">
          {windStops(m.top).map((st, i) => <stop key={i} offset={st.offset} stopColor={st.color} />)}
        </linearGradient>
      </defs>
      {nights.map(([a, b]) => (
        <rect key={a} x={m.x(Math.max(0, a))} width={Math.max(0, m.x(Math.min(last, b)) - m.x(Math.max(0, a)))} y={0} height={H} rx={2} className="fill-ink/40" />
      ))}
      {days.map(({ i, label }, k) => {
        const next = days[k + 1]?.i ?? last;
        return (
          <g key={i}>
            <line x1={m.x(i)} x2={m.x(i)} y1={0} y2={H} className="stroke-line-strong" />
            {/* every day's name that fits inside its day (the threshold tag keeps clear of them) */}
            {m.x(next) - m.x(i) >= labelWidth(label) + 6 && <text x={m.x(i) + 4} y={10} fontSize="10" fontWeight="600" className="fill-fg-3">{label}</text>}
          </g>
        );
      })}
      {nbmFrom > 0 && <line x1={m.x(nbmFrom)} x2={m.x(nbmFrom)} y1={12} y2={H} stroke={MODEL_INFO.nbm.color} strokeOpacity=".5" strokeDasharray="2 3" />}
      {fill && <path d={fill} fill={`url(#${gradId})`} fillOpacity=".3" />}
      {peak && <path d={peak} fill="none" stroke={`url(#${gradId})`} strokeWidth="1.75" strokeLinejoin="round" />}
      <line x1={INSET} x2={W - INSET} y1={m.y(threshold)} y2={m.y(threshold)} strokeDasharray="3 3" className="stroke-fg-3" />
      <ThresholdTag area={area} m={m} W={W} H={H} threshold={threshold} days={days} />
    </g>
  );
});

/**
 * The threshold's "15 kn" tag, on a solid chip so nothing shows through it, at the first place along its line where it
 * clears the strongest-wind line, the day ticks and their names: the right end, then the left, then along the line from
 * the right, under or over it (inside the chart). Where the line runs everywhere, the first place clear of the days.
 */
function ThresholdTag({ area, m, W, H, threshold, days }: {
  area: Area[]; m: { x: (i: number) => number; y: (v: number) => number }; W: number; H: number; threshold: number;
  days: { i: number; label: string }[];
}) {
  const text = `${threshold} kn`;
  const w = Math.ceil(labelWidth(text)) + 6, h = 12, ly = m.y(threshold);
  const last = Math.max(1, area.length - 1);
  // the ends first, then along the line from the right
  const xs = [W - INSET - w, INSET + 2];
  for (let x = W - INSET - w - 8; x > INSET + 2; x -= 8) xs.push(x);
  const ys = [ly + 2, ly - 2 - h].filter((y) => y >= 0 && y + h <= H);
  const clear = (x0: number, y0: number, curve: boolean) => {
    const x1 = x0 + w, y1 = y0 + h;
    // day ticks and the names written along the top
    for (const { i, label } of days) {
      const dx = m.x(i);
      if (dx >= x0 - 1 && dx <= x1 + 1) return false;
      if (y0 < 12 && dx + 4 < x1 && dx + 4 + labelWidth(label) > x0) return false;
    }
    // the strongest-wind line, between the hours either side of the chip
    if (curve) for (let i = 0; i <= last; i++) {
      const a = area[i];
      if (!a || m.x(i) < x0 - 6 || m.x(i) > x1 + 6) continue;
      const y = m.y(a.peak);
      if (y >= y0 - 2 && y <= y1 + 2) return false;
    }
    return true;
  };
  // Clear of everything; else at least of the days (the chip then hides a stretch of the line, never a day's name).
  let at: [number, number] = [xs[0], ys[0] ?? Math.max(0, Math.min(H - h, ly + 2))];
  outer: for (const curve of [true, false]) for (const x of xs) for (const y of ys) if (clear(x, y, curve)) { at = [x, y]; break outer; }
  return (
    <g data-threshold-tag transform={`translate(${at[0]},${at[1]})`}>
      <rect width={w} height={h} rx={3} className="fill-ink" />
      <text x={w / 2} y={9} textAnchor="middle" fontSize="10" fontWeight="600" className="num fill-fg-2">{text}</text>
    </g>
  );
}
