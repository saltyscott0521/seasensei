import NumberFlow from "@number-flow/react";
import clsx from "clsx";
import { ArrowUp, ChartSpline, Clock3, MapPin, Navigation2Off, RotateCw, TriangleAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { fmtRange } from "../../lib/sensei";
import { chanceOf, darkWord, isDaylight, isDaylightHour, type NowVerdict } from "../../lib/session";
import type { useSpotNow } from "../../lib/useSpotNow";
import { compass, MODEL_INFO, rideState, windColor, windGradient, type Ride, type Spot } from "../../lib/wind";
import { Dial, Skeleton, WindArrow } from "../bits";
import { Button, Chip, VerdictPill } from "../ui";
import { Dotted } from "./Dotted";
import { errorText } from "./format";
import { OFFSHORE_CAUTION, shoreWord } from "./shore";

type SpotNow = ReturnType<typeof useSpotNow>;

/**
 * Where the big number comes from: the spot's own station (stale = its last reading, over 30 min old), a nearby sensor
 * (far = beyond 8 km), the model now, or a forecast hour.
 */
export type HeroSource = "station" | "stale" | "nearby" | "far" | "model" | "forecast";

const DIAL = 104;
const SCALE = 45; // the wind scale's top (windGradient runs 0–45 kn)

/**
 * The answer first: the verdict, then the wind for the shown hour (now, the timeline's hour, or the chart's cursor)
 * with where it comes from, how it sits in the spot's range, and the dial with the rideable arc. The verdict is about
 * now, checked against the spot's own sensor ("On now · 18 kn at the sensor · till 4 PM"; "Too light now · Forecast
 * says on, sensor reads 9 kn"), with how likely its session is in a word. While the hero shows another hour the pill
 * goes neutral, so only the range line below speaks for that hour. A forecast hour gives the range it is likely to
 * fall in; where the coast can tell, the wind is named onshore, side-shore or offshore (with a caution).
 */
export function SpotHero({ spot, pill, shown, when, source, scrubbing, now, model, loading, forecastError, onRetry, retrying, stationError, seaward }: {
  spot: Spot;
  /** The verdict about now (useSpotNow's `pill`). */
  pill: NowVerdict | null;
  /** The hour to show: the chart's cursor, else the timeline's hour, else the best "now" reading. */
  shown: { speed: number; gust: number; dir: number; t?: number; lo?: number; hi?: number } | null;
  /** The bearing from the spot out over open water, where the coast can tell (see shore.ts). */
  seaward?: number | null;
  /** The source line: "Live · Old Port Tampa · 0.5 km · 4 min ago", "HRRR forecast", "Sat 3 PM · HRRR forecast". */
  when: string;
  source: HeroSource;
  /** The pointer is driving the number: show it straight away, no rolling digits. */
  scrubbing: boolean;
  now: SpotNow["now"];
  model: SpotNow["model"];
  loading: boolean;
  forecastError: Error | null;
  onRetry: () => void;
  /** A retry is in flight. */
  retrying?: boolean;
  stationError: Error | null;
}) {
  const live = source === "station" || source === "stale" || source === "nearby" || source === "far";
  // A forecast hour comes with the range it is likely to fall in; a sensor reading is what it is.
  const range = !live && shown ? fmtRange(shown) : null;
  const shore = shown && seaward != null ? shoreWord(shown.dir, seaward) : null;
  const chance = pill && pill.state !== "strong" ? chanceOf(pill.verdict.session) : null;
  const instant = scrubbing || source === "forecast";
  // Dark at the shown time? A forecast hour counts as daylight only when all of it is (the sessions' rule).
  const clock = Date.now();
  const t = source === "forecast" && shown?.t != null ? shown.t : clock;
  const night = shown ? (source === "forecast" && shown.t != null ? !isDaylightHour(spot.lat, spot.lon, t) : !isDaylight(spot.lat, spot.lon, t)) : false;
  const dark = night ? darkWord(spot.lat, spot.lon, t) : null;
  // Scrubbing changes the numbers silently for screen readers: say where it settled (debounced, so playback stays quiet).
  const settled = useDebounced(source === "forecast" && shown
    ? `${when.split(" · ")[0]}: ${Math.round(shown.speed)} knots, gusting ${Math.round(shown.gust)}, from ${compass(shown.dir)}, ${FIT[rideState(shown.speed, spot, shown.dir)].toLowerCase()}${dark ? `, ${dark}` : ""}.`
    : "", 600);
  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-surface-2 p-4">
      {shown && (
        <div aria-hidden className="pointer-events-none absolute -right-14 -top-16 size-52 rounded-full blur-3xl"
          style={{ background: windColor(shown.speed, 0.16) }} />
      )}

      {/* the verdict: "On at 1 PM · 1–5 PM · 18–22 kn SW" */}
      <div className="relative flex min-h-6 flex-wrap items-center gap-x-2.5 gap-y-1">
        {pill ? (
          <>
            <VerdictPill state={pill.state} label={pill.label} muted={source === "forecast"} />
            {pill.detail && <span className="num text-label text-fg-2">{pill.detail}</span>}
            {chance && <span data-testid="chance" className="text-label font-medium text-fg">{chance}</span>}
          </>
        ) : forecastError ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-soon" />
              <div className="min-w-0">
                <p className="text-label font-medium text-fg">Couldn't load the forecast.</p>
                <p className="text-caption text-fg-3">{errorText(forecastError)}</p>
              </div>
            </div>
            <Button size="sm" onClick={onRetry} disabled={retrying}><RotateCw className={retrying ? "motion-safe:animate-spin" : undefined} /> {retrying ? "Trying…" : "Try again"}</Button>
          </div>
        ) : <Skeleton className="h-6 w-56 rounded-full" />}
      </div>

      {shown ? (
        <>
          <div className="relative mt-3"><SourceLine source={source} text={when} /></div>
          <div className="relative mt-1 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="num flex items-baseline gap-1 text-fg">
                {/* NumberFlow pads 0.25em above and below for its rolling-digit mask; take it back so the lines sit tight */}
                <NumberFlow value={Math.round(shown.speed)} animated={!instant} willChange className="-my-[0.25em] text-display" />
                <span className="text-title font-medium text-fg-3">kn</span>
              </div>
              <p className="num mt-2 text-label text-fg-2">
                {range && <span data-testid="hero-range">likely {range} kn · </span>}
                gusting {Math.round(shown.gust)} · from {compass(shown.dir)}{shore && <span data-testid="shore"> · {shore}</span>}
              </p>
            </div>
            <Dial dir={shown.dir} speed={shown.speed} size={DIAL} arc={spot} />
          </div>
          <RangeFit spot={spot} speed={shown.speed} dir={shown.dir} dark={dark} instant={instant}
            where={source === "nearby" || source === "far" ? "at the nearby sensor" : source === "stale" ? "at the last reading" : null} />
          {shore === "offshore" && (
            <p data-testid="offshore" className="relative mt-3 flex items-start gap-1.5 text-caption font-medium text-wrongdir">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{OFFSHORE_CAUTION}</span>
            </p>
          )}
        </>
      ) : forecastError ? null : (
        <HeroSkeleton busy={loading} />
      )}

      {live && model && now?.source === "live" && (
        <div className="relative mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md bg-ink/30 px-3 py-2 ring-1 ring-inset ring-line">
          <span className="min-w-0 text-caption text-fg-2">{MODEL_INFO[model.model].label} said for this hour</span>
          <span className="num ml-auto flex shrink-0 items-center gap-1.5 text-caption text-fg">
            <WindArrow dir={model.dir} size={12} className="text-fg-2" />
            {Math.round(model.speed)} kn · gust {Math.round(model.gust)}
            <DeltaPill d={now.speed - model.speed} model={MODEL_INFO[model.model].label} />
          </span>
        </div>
      )}

      <p className="sr-only" aria-live="polite">{settled}</p>

      {stationError && (
        <p className="relative mt-3 flex items-start gap-1.5 text-caption text-soon">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>Station {spot.station} isn't answering, so this is the forecast.</span>
        </p>
      )}
    </div>
  );
}

/**
 * "Live · Old Port Tampa · 0.5 km · 4 min ago" with its glyph. Never truncated: it wraps. A nearby sensor beyond 8 km
 * keeps the text neutral and says so with a small amber pin (and its title).
 */
function SourceLine({ source, text }: { source: HeroSource; text: string }) {
  const icon: Record<HeroSource, ReactNode> = {
    station: (
      <span aria-hidden className="relative mt-[5px] flex size-2 shrink-0">
        <span className="halo absolute inset-0 rounded-full bg-accent" />
        <span className="relative size-2 rounded-full bg-accent" />
      </span>
    ),
    stale: <Clock3 aria-hidden className="mt-0.5 size-3.5 shrink-0" />,
    nearby: <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0" />,
    far: <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0 text-soon" strokeWidth={2.5} />,
    model: <ChartSpline aria-hidden className="mt-0.5 size-3.5 shrink-0" />,
    forecast: <Clock3 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-accent" />,
  };
  return (
    <p data-source={source} className={clsx("flex items-start gap-1.5 text-caption", source === "station" ? "text-fg" : "text-fg-2")}
      title={source === "far" ? "This sensor is more than 8 km from the spot, so the wind there may differ." : undefined}>
      {icon[source]}
      <span className="min-w-0"><Dotted text={text} /></span>
    </p>
  );
}

/** How the shown wind sits in the spot's range, in the app's words. */
const FIT: Record<Ride, string> = { good: "In range", below: "Too light", above: "Too strong", offdir: "Wrong direction" };
const FIT_TONE: Record<Ride, string> = { good: "text-fg", below: "text-fg-2", above: "text-strong", offdir: "text-wrongdir" };

/**
 * How the shown wind sits in the spot's range: a plain line (the hero's one verdict is the pill above), how far off
 * it is or that it is dark, and a read-only gauge on the wind scale: the spot's range lit and labelled, and a caret
 * for the wind. Nothing here looks like a control.
 */
function RangeFit({ spot, speed, dir, dark, instant, where }: {
  spot: Spot; speed: number; dir: number; dark: string | null; instant: boolean;
  /** The reading isn't the spot's own, or isn't fresh: say whose word this is ("at the nearby sensor"). */
  where?: string | null;
}) {
  const ride = rideState(speed, spot, dir);
  // Off by less than half a knot rounds to 0: say "just under" rather than "0 kn under".
  const under = Math.round(spot.min - speed), over = Math.round(speed - spot.max);
  const detail = ride === "below" ? `${under ? `${under} kn` : "just"} under your ${spot.min}`
    : ride === "above" ? `${over ? `${over} kn` : "just"} over your ${spot.max}`
    : ride === "offdir" ? `from ${compass(dir)}, outside your directions`
    : dark ?? "";
  const says = [detail, where].filter(Boolean).join(", ");
  const pct = (v: number) => Math.min(100, Math.max(0, (v / SCALE) * 100));
  const move = clsx("absolute inset-0", !instant && "transition-transform duration-(--dur-slow) ease-ui motion-reduce:transition-none");
  return (
    <div className="relative mt-4">
      <p className="flex flex-wrap items-center gap-x-1.5 text-label">
        {ride === "offdir" && <Navigation2Off aria-hidden className="size-3.5 shrink-0 text-wrongdir" strokeWidth={2.25} />}
        {ride === "above" && <ArrowUp aria-hidden className="size-3.5 shrink-0 text-strong" strokeWidth={2.5} />}
        <span className={clsx("font-semibold", FIT_TONE[ride])}>{FIT[ride]}</span>
        {says && <span className="num text-fg-2">· {says}</span>}
      </p>
      <div aria-hidden className="relative mt-2 h-[26px]">
        {/* the scale, faint, with the spot's range lit */}
        <div className="absolute inset-x-0 top-[7px] h-1 rounded-full opacity-25" style={{ background: windGradient() }} />
        <div className="absolute inset-x-0 top-[7px] h-1 rounded-full"
          style={{ background: windGradient(), clipPath: `inset(0 ${100 - pct(spot.max)}% 0 ${pct(spot.min)}% round 999px)` }} />
        {/* the wind: a caret pointing at the scale */}
        <div className={move} style={{ transform: `translateX(${pct(speed)}%)` }}>
          <span className="absolute left-0 top-0 size-0 -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-fg" />
        </div>
        {/* the range's ends, named */}
        {[spot.min, spot.max].map((v) => (
          <span key={v} className="num absolute top-3.5 -translate-x-1/2 text-micro leading-3 text-fg-3" style={{ left: `${pct(v)}%` }}>{v}</span>
        ))}
      </div>
    </div>
  );
}

/** Stands in for the number, dial and gauge while the forecast loads, at their size, so nothing jumps. */
function HeroSkeleton({ busy }: { busy: boolean }) {
  return (
    <div className="relative mt-3" aria-busy={busy} aria-label="Loading the wind">
      <Skeleton className="h-[18px] w-56" />
      <div className="mt-1 flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Skeleton className="h-14 w-28" />
          <Skeleton className="h-4 w-36" />
        </div>
        <Skeleton className="size-[104px] rounded-full" />
      </div>
      <Skeleton className="mt-4 h-5 w-40" />
      <Skeleton className="mt-[15px] h-1 w-full rounded-full" />
      <div className="h-[15px]" />
    </div>
  );
}

/** How far the live reading is from the model this hour, in a neutral chip: "sensor +3 kn", "sensor −2 kn", "match". */
export function DeltaPill({ d, model = "the model" }: { d: number; model?: string }) {
  const r = Math.round(d);
  const title = r ? `The sensor reads ${Math.abs(r)} kn ${r > 0 ? "more" : "less"} than ${model}` : `The sensor matches ${model}`;
  return <Chip size="sm" title={title}>{r ? `sensor ${r > 0 ? "+" : "−"}${Math.abs(r)} kn` : "match"}</Chip>;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
