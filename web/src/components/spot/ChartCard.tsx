import { Maximize2, RotateCw } from "lucide-react";
import type { ReactNode, Ref } from "react";
import type { Confidence } from "../../lib/session";
import type { Forecast, Hour, ModelCompare, Obs, Spot } from "../../lib/wind";
import { ModelPicker, Skeleton } from "../bits";
import { BarChart } from "../BarChart";
import { ForecastChart, type Range } from "../ForecastChart";
import { ModelChart } from "../ModelChart";
import { Button, ConfidenceDots, IconButton, Segmented } from "../ui";
import { errorText } from "./format";

export type ChartView = "forecast" | "models";

/** How to read an hour off the charts on this device: touch, or a mouse (and the keys, which nothing else mentions). */
const scrubHint = () => (typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches
  ? "Hover, or use ← → on the chart, to read any hour"
  : "Tap or drag across to read any hour");

/** The inline charts card: Forecast / Models, the range, full screen, how well the models agree, and the model picker. */
export function ChartCard({ view, setView, range, setRange, onExpand, expandRef, confidence, children }: {
  view: ChartView; setView: (v: ChartView) => void; range: Range; setRange: (r: Range) => void;
  onExpand: () => void; expandRef?: Ref<HTMLButtonElement>; confidence: Confidence | null; children: ReactNode;
}) {
  return (
    <section aria-label="Charts" className="rounded-lg border border-line bg-surface-2 p-3">
      <ChartHeader view={view} setView={setView} range={range} setRange={setRange} onExpand={onExpand} expandRef={expandRef} confidence={confidence} />
      <div className="mt-3 min-w-0">{children}</div>
      <div className="mt-3 flex flex-col gap-2 px-1">
        {/* the one "Forecast model" picker in this view (the list has its own), with what it means in plain words */}
        {view === "forecast" && (
          <div className="flex min-h-8 items-center gap-2.5">
            <ModelPicker captionClass="min-w-0 flex-1 text-caption leading-[15px] text-fg-3" />
          </div>
        )}
        <p className="min-w-0 text-micro text-fg-3">
          {view === "forecast" ? scrubHint() : "Every model at this spot"} · <span className="whitespace-nowrap">via Open-Meteo</span>
        </p>
      </div>
    </section>
  );
}

/**
 * Forecast / Models, the range switch, the models' agreement over the next 48 h, and (inline only) full screen.
 * `layout="bar"` puts everything on one row (the full-screen header); `idSuffix` keeps the switches' layoutIds unique.
 */
export function ChartHeader({ view, setView, range, setRange, onExpand, expandRef, confidence, idSuffix = "", layout = "card" }: {
  view: ChartView; setView: (v: ChartView) => void; range: Range; setRange: (r: Range) => void;
  onExpand?: () => void; expandRef?: Ref<HTMLButtonElement>; confidence?: Confidence | null; idSuffix?: string; layout?: "card" | "bar";
}) {
  const viewSwitch = <Segmented value={view} onChange={setView} id={`view-pill${idSuffix}`} label="Chart" options={[["forecast", "Forecast"], ["models", "Models"]]} />;
  const rangeSwitch = <Segmented value={range} onChange={setRange} id={`range-pill${idSuffix}`} label="Range" options={[["24h", "Past 24 h"], ["48h", "48 h"], ["7d", "7 days"]]} />;
  // The Models view says the same thing in its own chip.
  const agree = view === "forecast" && confidence
    ? <ConfidenceDots level={confidence.level} label={confidence.label} showLabel />
    : null;
  if (layout === "bar") {
    return (
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        {viewSwitch}
        {rangeSwitch}
        {agree && <span className="px-1">{agree}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {viewSwitch}
        {agree}
      </div>
      <div className="flex items-center justify-between gap-2">
        {rangeSwitch}
        {onExpand && (
          <IconButton ref={expandRef} aria-label="Expand charts to full screen" title="Full screen" size="sm" variant="tonal" onClick={onExpand}>
            <Maximize2 />
          </IconButton>
        )}
      </div>
    </div>
  );
}

/** The charts for the current view: the forecast line over the bars, or the model comparison. Shared by the card and full screen. */
export function ChartBody({ view, spot, forecast, forecastError, onRetryForecast, obs, models, modelsError, onRetryModels, range, tz, maxH, fill = false, scrubT, onScrub }: {
  view: ChartView;
  spot: Spot;
  forecast?: Forecast;
  forecastError: Error | null;
  onRetryForecast: () => void;
  /** The reference station's last 24 h of readings. */
  obs?: Obs[];
  models?: ModelCompare;
  modelsError: boolean;
  onRetryModels: () => void;
  range: Range;
  tz: string;
  maxH: number;
  /** Full screen: the chart takes maxH whatever its width (a phone's tall screen, not its narrow width, sets it). */
  fill?: boolean;
  /** The cursor: the chart scrub, else the timeline's hour. */
  scrubT?: number;
  onScrub: (h: Hour | null) => void;
}) {
  if (view === "forecast") {
    return forecast ? (
      <div className="flex min-w-0 flex-col gap-1">
        <ForecastChart forecast={forecast} spot={spot} onScrub={onScrub} scrubT={scrubT} range={range} obs={obs} maxH={maxH} minH={fill ? maxH : undefined} />
        <BarChart forecast={forecast} spot={spot} onScrub={onScrub} scrubT={scrubT} range={range} obs={obs} />
      </div>
    ) : forecastError ? <Failed what="the forecast" detail={errorText(forecastError)} onRetry={onRetryForecast} />
      : <Skeleton className="h-[474px] rounded-md" />;
  }
  if (models) return <ModelChart data={models} spot={spot} range={range} tz={tz} maxH={maxH} minH={fill ? maxH : undefined} />;
  if (modelsError) return <Failed what="the model comparison" onRetry={onRetryModels} />;
  return <Skeleton className="h-[474px] rounded-md" />;
}

/** A chart that couldn't load: what, why in plain words, and a retry. Holds the charts' height so nothing jumps. */
function Failed({ what, detail, onRetry }: { what: string; detail?: string; onRetry: () => void }) {
  return (
    <div className="flex h-[250px] flex-col items-center justify-center gap-3 px-6 text-center">
      <div>
        <p className="text-label font-medium text-fg-2">Couldn't load {what}.</p>
        {detail && <p className="mt-0.5 text-caption text-fg-3">{detail}</p>}
      </div>
      <Button size="sm" onClick={() => onRetry()}><RotateCw /> Try again</Button>
    </div>
  );
}
