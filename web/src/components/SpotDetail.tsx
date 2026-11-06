import { AnimatePresence, motion } from "motion/react";
import { memo, startTransition, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useObsHistory, useSpotModelCompare } from "../lib/data";
import { useDesktop } from "../lib/layout";
import { duration, ease, spring, stagger } from "../lib/motion";
import { confidence, NEARBY_WARN_KM, ownStation, sourceLine, type Session } from "../lib/session";
import { useNow } from "../lib/time";
import { useReferenceStation, useSpotNow } from "../lib/useSpotNow";
import type { Hour, Spot } from "../lib/wind";
import { windowFor, type Range } from "./ForecastChart";
import { Skeleton } from "./bits";
import { ScrollFade } from "./ui/ScrollFade";
import { Accuracy } from "./spot/Accuracy";
import { ChartBody, ChartCard, type ChartView } from "./spot/ChartCard";
import { atLine, peakHour } from "./spot/format";
import { FullscreenCharts } from "./spot/FullscreenCharts";
import { HourGrid } from "./spot/HourGrid";
import { Sessions } from "./spot/Sessions";
import { SpotHeader } from "./spot/SpotHeader";
import { SpotHero, type HeroSource } from "./spot/SpotHero";
import { SpotSettings } from "./spot/SpotSettings";
import { useSubLayer } from "./spot/useSubLayer";

const HOUR = 3600e3;
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

// The chart range you last picked, kept for the next spot (a per-device convenience; storage may be unavailable).
const RANGE_KEY = "chartRange";
const savedRange = (): Range => {
  try { const r = localStorage.getItem(RANGE_KEY); return r === "24h" || r === "7d" ? r : "48h"; } catch { return "48h"; }
};

/** Mount the heavy parts (hour grid, charts) a couple of frames after the header and hero, so opening a spot stays smooth. */
function useDeferred() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let b = 0;
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => startTransition(() => setReady(true))); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, []);
  return ready;
}

/** One section of the detail, faded and lifted in on open (opacity/transform only; reduced motion keeps just the fade). */
function Rise({ i, children }: { i: number; children: ReactNode }) {
  return (
    <motion.div className="min-w-0" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: stagger(i), opacity: { duration: duration.base, ease, delay: stagger(i) } }}>
      {children}
    </motion.div>
  );
}

/**
 * A spot: header, the hero (verdict, then the wind now or at the timeline's hour), daylight sessions, the hour grid,
 * the charts and the forecast check. The chart scrub, else the timeline's hour, is the one cursor for all of them.
 */
export const SpotDetail = memo(function SpotDetail({ spot, onBack }: { spot: Spot; onBack: () => void }) {
  const { fc, ob, model, now, sessions, verdict, source, sensor, at, shown } = useSpotNow(spot);
  const clock = useNow();
  const desktop = useDesktop();
  const [scrub, setScrub] = useState<Hour | null>(null);
  // The settings and the full-screen charts are history entries of their own: back closes them, not the spot.
  const settings = useSubLayer("settings", spot.id);
  const charts = useSubLayer("charts", spot.id);
  const editing = settings.open, expanded = charts.open;
  const [range, setRange] = useState<Range>(savedRange);
  const [view, setView] = useState<ChartView>("forecast");
  const ready = useDeferred();
  const refStation = useReferenceStation(spot);
  const history = useObsHistory(refStation?.id);
  const models = useSpotModelCompare(spot);
  const tz = fc.data?.timeZone ?? LOCAL_TZ;

  const titleRef = useRef<HTMLHeadingElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const hoursRef = useRef<HTMLDivElement>(null);

  // A new view: its heading takes focus, so screen readers announce the spot and Tab starts at the top of it.
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, []);

  // The hero shows the hour you're scrubbing on a chart, else the timeline's hour, else now.
  const scrubT = scrub?.t ?? at ?? undefined;
  const forecastAt = scrub != null || at != null;
  const heroHour = scrub ?? shown;
  const when = forecastAt && heroHour ? atLine(heroHour as Hour, tz, clock) : sourceLine({ source, sensor, model: model?.model }, clock);
  const heroSource: HeroSource = forecastAt ? "forecast"
    : source === "model" ? "model"
    : source === "station" ? "station"
    : sensor?.km != null && sensor.km > NEARBY_WARN_KM ? "far" : "nearby";

  const pickRange = useCallback((r: Range) => {
    setRange(r);
    try { localStorage.setItem(RANGE_KEY, r); } catch { /* private mode */ }
  }, []);
  const { show: showSettings, hide: hideSettings, back: backFromSettings } = settings;
  const closeSettings = useCallback(() => { hideSettings(); settingsRef.current?.focus({ preventScroll: true }); }, [hideSettings]);
  const toggleEditing = useCallback(() => (editing ? hideSettings() : showSettings()), [editing, hideSettings, showSettings]);
  const openFullscreen = charts.show;
  const closeFullscreen = charts.hide;
  // Back to the list from inside the settings goes back through the settings' entry first.
  const back = useCallback(() => { if (!backFromSettings(onBack)) onBack(); }, [backFromSettings, onBack]);
  // A deleted spot can't be shown, even for a moment: leave its entries in one step (two back if the list is behind
  // it; one, onto the spot's own entry, when the spot was opened by a link — the shell then shows the list).
  const leaveDeleted = useCallback(() => {
    const st = window.history.state as { sub?: string; ss?: number } | null;
    if (!st?.sub) return onBack();
    window.history.go((st.ss ?? 0) > 0 ? -2 : -1);
  }, [onBack]);
  // Back from full screen, focus returns to the button that opened it (the inline card remounts).
  const wasExpanded = useRef(false);
  useEffect(() => {
    if (wasExpanded.current && !expanded) expandRef.current?.focus({ preventScroll: true });
    wasExpanded.current = expanded;
  }, [expanded]);

  // Escape closes the settings before the spot (App listens in the bubble phase). Dialogs on top (the full-screen
  // charts, the discussion) are aria-modal and handle their own Escape first.
  useEffect(() => {
    if (!editing || expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector('[aria-modal="true"]')) return;
      e.stopPropagation();
      closeSettings();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editing, expanded, closeSettings]);

  // Picking a session puts the charts' cursor on its strongest hour, widening the range if needed (pick it again to let
  // go), and brings the hour grid just below into view with that hour marked. Not the charts: scrolling them under a
  // resting mouse would hand the cursor straight to the chart's hover.
  const pickSession = useCallback((s: Session) => {
    const peak = peakHour(s);
    setScrub((cur) => (cur && cur.t >= s.start && cur.t <= s.end ? null : peak));
    setView("forecast");
    setRange((r) => (r === "24h" || (r === "48h" && peak.t > Date.now() + 47 * HOUR) ? "7d" : r));
    requestAnimationFrame(() => hoursRef.current?.scrollIntoView({
      block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    }));
  }, []);

  const { refetch } = fc;
  const retry = useCallback(() => { refetch(); }, [refetch]);
  const chartConfidence = models.data ? confidence(models.data, clock, clock + 48 * HOUR) : null;
  // Full screen: the forecast leaves room for the bar chart under the line chart; the models (no bars) take the height,
  // less on a phone, whose full-screen header wraps to more lines.
  const maxH = expanded ? Math.max(250, Math.round(window.innerHeight * (view === "models" ? (desktop ? 0.66 : 0.55) : 0.44))) : 560;
  const chartBody = (
    <ChartBody view={view} spot={spot} forecast={fc.data} forecastError={fc.isError ? (fc.error as Error) : null} onRetryForecast={retry} obs={history.data} models={models.data} modelsError={models.isError}
      onRetryModels={models.refetch} range={range} tz={tz} maxH={maxH} fill={expanded} scrubT={scrubT} onScrub={setScrub} />
  );

  return (
    <>
    <div className="flex flex-col gap-4 md:gap-5 md:pb-10">
      <SpotHeader spot={spot} onBack={back} editing={editing} onToggleEditing={toggleEditing} titleRef={titleRef} settingsRef={settingsRef} />

      <AnimatePresence initial={false}>
        {editing && (
          <motion.div key="settings" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: duration.fast } }} transition={{ duration: duration.base, ease }}>
            <SpotSettings spot={spot} onDeleted={leaveDeleted} onDone={closeSettings} source={source} sensor={sensor} />
          </motion.div>
        )}
      </AnimatePresence>

      <Rise i={0}>
        <SpotHero spot={spot} verdict={verdict} shown={heroHour} when={when} source={heroSource} scrubbing={scrub != null}
          now={now} model={model} loading={fc.isPending} forecastError={fc.isError ? (fc.error as Error) : null} onRetry={retry} retrying={fc.isFetching}
          stationError={ownStation(spot) && ob.isError ? (ob.error as Error) : null} />
      </Rise>

      {!fc.isError && (
        <Rise i={1}>
          <Sessions sessions={sessions} tz={tz} models={models.data} loading={fc.isPending}
            best={verdict?.state === "none" ? verdict.best : null} scrubT={scrub?.t} atT={at} onPick={pickSession} />
        </Rise>
      )}

      {!fc.isError && (
        <Rise i={2}>
          <div ref={hoursRef} className="scroll-my-4">
            {fc.data && ready ? <HourGrid hours={fc.data.hours} tz={tz} spot={spot} highlightT={scrubT} /> : <HourGrid.Placeholder />}
          </div>
        </Rise>
      )}

      <Rise i={3}>
        {!expanded && (
          <ChartCard view={view} setView={setView} range={range} setRange={pickRange} onExpand={openFullscreen} expandRef={expandRef} confidence={chartConfidence}>
            {/* the inline line chart (250) + the bars (172) and their key (~48) + the gap, so nothing moves when they arrive */}
            {ready ? chartBody : <Skeleton className="h-[474px] rounded-md" />}
          </ChartCard>
        )}
      </Rise>

      {!fc.isError && <Rise i={4}>
        <Accuracy hours={fc.data ? windowFor(fc.data.hours, "24h") : undefined} obs={history.data}
          loading={fc.isPending || (history.isPending && !!refStation)} refName={refStation?.name} km={refStation?.km} />
      </Rise>}

      {expanded && (
        <FullscreenCharts spot={spot} view={view} setView={setView} range={range} setRange={pickRange} shown={heroHour} when={when}
          confidence={chartConfidence} onClose={closeFullscreen}>
          {chartBody}
        </FullscreenCharts>
      )}
    </div>
    <ScrollFade />
    </>
  );
});
