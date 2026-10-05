import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Maximize2, Radio, Settings2, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { spotStore, useModelCompare, useObsHistory } from "../lib/data";
import { ago, fmtWindow, useReferenceStation, useSpotNow } from "../lib/useSpotNow";
import { arcLabel, compass, isRideable, nearestHour, rideState, scoreForecast, windColor, type Hour, type Spot } from "../lib/wind";
import { Dial, Knots, RideBadge, Skeleton, WindArrow } from "./bits";
import { DirectionPicker, RangeSlider, StationPicker } from "./controls";
import { ForecastChart, windowFor, type Range } from "./ForecastChart";
import { BarChart } from "./BarChart";
import { ModelChart } from "./ModelChart";

export function SpotDetail({ spot, onBack }: { spot: Spot; onBack: () => void }) {
  const { fc, ob, model, now, windows } = useSpotNow(spot);
  const [scrub, setScrub] = useState<Hour | null>(null);
  const [editing, setEditing] = useState(false);
  const [range, setRange] = useState<Range>("48h");
  const [view, setView] = useState<"forecast" | "models">("forecast");
  const [expanded, setExpanded] = useState(false);
  const ref = useReferenceStation(spot);
  const history = useObsHistory(ref?.id);
  const models = useModelCompare(spot, view === "models");
  const nbmStart = fc.data?.hours.find((h) => h.model === "nbm")?.t ?? Infinity;
  const tz = fc.data?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const shown = scrub ?? now;
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setExpanded(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [expanded]);
  const ride = shown ? rideState(shown.speed, spot, shown.dir) : null;
  const when = scrub
    ? new Intl.DateTimeFormat([], { timeZone: tz, weekday: "short", hour: "numeric" }).format(scrub.t) + (scrub.model === "nbm" ? " · NBM" : " · HRRR")
    : now?.source === "live" ? `Live · ${now.stationName}${now.km != null ? ` (${now.km < 10 ? now.km.toFixed(1) : Math.round(now.km)} km)` : ""} · ${ago(now.t)}` : "Now · HRRR model";

  // In the full-screen view, leave room for the bar chart and readout below the line chart.
  const maxH = expanded ? Math.max(250, Math.round(window.innerHeight * 0.44)) : 560;
  const chartBody = view === "forecast" ? (
    fc.data ? (
      <div className="flex flex-col gap-1">
        <ForecastChart forecast={fc.data} spot={spot} onScrub={setScrub} scrubT={scrub?.t} range={range} obs={history.data} maxH={maxH} />
        <BarChart forecast={fc.data} spot={spot} onScrub={setScrub} scrubT={scrub?.t} range={range} obs={history.data} />
        <Accuracy hours={windowFor(fc.data.hours, "24h")} obs={history.data} loading={history.isPending && !!ref} refName={ref?.name} km={ref?.km} />
      </div>
    ) : <Skeleton className="h-72" />
  ) : models.data ? <ModelChart data={models.data} spot={spot} range={range} tz={tz} maxH={maxH} />
    : models.isError ? <p className="p-4 text-sm text-rose-300">Couldn't load the model comparison.</p> : <Skeleton className="h-72" />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} aria-label="Back to spots" className="-ml-1.5 grid h-10 w-10 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold tracking-tight">{spot.name}</h2>
          <p className="num text-xs text-white/40">{spot.lat.toFixed(3)}, {spot.lon.toFixed(3)} · {spot.min}–{spot.max} kn · {arcLabel(spot)}</p>
        </div>
        <button onClick={() => setEditing((e) => !e)} aria-label="Spot settings" aria-pressed={editing}
          className={`grid h-10 w-10 place-items-center rounded-full transition ${editing ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10"}`}>
          <Settings2 className="h-5 w-5" />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {editing && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <SpotSettings spot={spot} onDeleted={onBack} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-white/[.07] bg-gradient-to-br from-white/[.06] to-white/[.02] p-4">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl transition-colors duration-700"
          style={{ background: shown ? windColor(shown.speed, 0.25) : "transparent" }} />
        {shown ? (
          <div className="relative flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="mb-1 flex items-center gap-1.5 truncate text-[11px] font-medium uppercase tracking-wider text-white/45">
                {!scrub && now?.source === "live" && <Radio className="h-3 w-3 text-cyan-300" />}{when}
              </p>
              <div className="flex items-baseline gap-1">
                <span className="text-6xl font-semibold leading-none tracking-tighter"><Knots value={shown.speed} /></span>
                <span className="text-lg text-white/40">kn</span>
              </div>
              <p className="num mt-1.5 text-sm text-white/60">gusting {Math.round(shown.gust)} · from {compass(shown.dir)}</p>
              {ride && <RideBadge ride={ride} className="mt-3" />}
            </div>
            <Dial dir={shown.dir} speed={shown.speed} />
          </div>
        ) : fc.isError ? <p className="text-sm text-rose-300">Forecast failed: {(fc.error as Error).message}</p> : <Skeleton className="h-32" />}

        {!scrub && now?.source === "live" && model && (
          <div className="relative mt-4 flex items-center justify-between rounded-xl bg-black/20 px-3 py-2 text-xs">
            <span className="text-white/50">HRRR said for this hour</span>
            <span className="num flex items-center gap-1.5 text-white/80"><WindArrow dir={model.dir} size={12} />{Math.round(model.speed)} kn · g{Math.round(model.gust)}
              <DeltaPill d={now.speed - model.speed} /></span>
          </div>
        )}
        {spot.station && ob.isError && <p className="relative mt-3 text-xs text-amber-300/90">Station #{spot.station}: {(ob.error as Error).message}</p>}
      </div>

      {/* Windows */}
      {fc.data && (
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
          {windows.length ? windows.map((w, i) => (
            <motion.span key={w.start} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.05 * i }}
              title={w.start >= nbmStart ? "NBM (days 3–7): lower confidence" : "HRRR"}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${w.start >= nbmStart
                ? "border border-dashed border-emerald-400/35 text-emerald-200/75"
                : "bg-emerald-400/12 text-emerald-200 ring-1 ring-emerald-400/25"}`}>
              {fmtWindow(w, tz)}
            </motion.span>
          )) : <span className="text-xs text-white/40">No rideable window this week.</span>}
        </div>
      )}

      {/* Charts */}
      {!expanded && (
        <div className="rounded-3xl border border-white/[.07] bg-white/[.025] p-3">
          <ChartHeader view={view} setView={setView} range={range} setRange={setRange} onExpand={() => setExpanded(true)} />
          {chartBody}
          <p className="px-1 pt-1 text-[10px] text-white/30">Drag to scrub · white = what the station measured · HRRR to 48 h, then NOAA NBM · via Open-Meteo</p>
        </div>
      )}
      {expanded && createPortal(
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="dialog" aria-modal="true" aria-label={`${spot.name} wind charts`}
          className="fixed inset-0 z-[60] flex flex-col bg-[#05080f]/96 backdrop-blur-xl">
          <div className="safe-t flex flex-wrap items-center gap-x-2 gap-y-2 px-4 pb-2 md:flex-nowrap md:gap-3 md:px-8">
            <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{spot.name}<span className="ml-2 text-sm font-normal text-white/40">{spot.min}–{spot.max} kn · {arcLabel(spot)}</span></h2>
            <button onClick={() => setExpanded(false)} aria-label="Close full-screen chart" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/70 ring-1 ring-white/15 hover:bg-white/10 md:order-last"><X className="h-5 w-5" /></button>
            <div className="w-full md:w-auto"><ChartHeader view={view} setView={setView} range={range} setRange={setRange} idSuffix="-x" /></div>
          </div>
          <div className="mx-auto w-full max-w-[1400px] flex-1 overflow-y-auto px-4 pb-6 md:px-8">
            <div className="mb-3 flex items-end justify-between gap-4">
              {shown && <div className="num"><span className="text-5xl font-semibold tracking-tighter" style={{ color: windColor(shown.speed) }}>{Math.round(shown.speed)}</span><span className="ml-1 text-lg text-white/40">kn</span>
                <span className="ml-3 text-sm text-white/55">gust {Math.round(shown.gust)} · {compass(shown.dir)} · {when}</span></div>}
            </div>
            {chartBody}
          </div>
        </motion.div>, document.body)}

      {fc.data && <HourStrip hours={fc.data.hours} tz={tz} spot={spot} />}
    </div>
  );
}

function DeltaPill({ d }: { d: number }) {
  const r = Math.round(d);
  if (!r) return <span className="rounded-full bg-white/10 px-1.5 text-[10px] text-white/60">on</span>;
  return <span className={`rounded-full px-1.5 text-[10px] ${r > 0 ? "bg-cyan-400/15 text-cyan-200" : "bg-amber-400/15 text-amber-200"}`}>
    live {r > 0 ? "+" : ""}{r}</span>;
}

function HourStrip({ hours, tz, spot }: { hours: Hour[]; tz: string; spot: Spot }) {
  const ref = useRef<HTMLDivElement>(null);
  const nowH = nearestHour(hours, Date.now());
  const hf = new Intl.DateTimeFormat([], { timeZone: tz, hour: "numeric" });
  const df = new Intl.DateTimeFormat([], { timeZone: tz, weekday: "short" });
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>("[data-now]");
    if (el && ref.current) ref.current.scrollLeft = el.offsetLeft - 8;
  }, [hours]);
  return (
    <div ref={ref} className="no-scrollbar -mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1">
      {hours.map((h) => {
        const good = isRideable(h, spot);
        const isNow = h === nowH;
        const label = hf.format(h.t);
        const midnight = /^12\s?AM$/i.test(label) || label === "0";
        return (
          <div key={h.t} data-now={isNow || undefined}
            className={`flex w-14 shrink-0 snap-start flex-col items-center gap-1 rounded-2xl py-2.5 ring-1 ${h.model === "nbm" ? "opacity-70" : ""} ${good ? "bg-emerald-400/10 ring-emerald-400/25" : "ring-white/[.06]"} ${isNow ? "!ring-white/50" : ""}`}>
            <span className={`text-[10px] ${midnight ? "font-semibold text-white/80" : "text-white/45"}`}>{midnight ? df.format(h.t) : isNow ? "Now" : label}</span>
            <WindArrow dir={h.dir} size={14} className="text-white/70" />
            <span className="num text-base font-semibold" style={{ color: windColor(h.speed) }}>{Math.round(h.speed)}</span>
            <span className="num text-[10px] text-white/40">g{Math.round(h.gust)}</span>
          </div>
        );
      })}
    </div>
  );
}

function SpotSettings({ spot, onDeleted }: { spot: Spot; onDeleted: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <div className="flex flex-col gap-5 rounded-3xl border border-white/[.07] bg-white/[.03] p-4">
      <RangeSlider value={[spot.min, spot.max]} onChange={([min, max]) => spotStore.update(spot.id, { min, max })} />
      <DirectionPicker dirC={spot.dirC} dirW={spot.dirW} lat={spot.lat} lon={spot.lon} onChange={(v) => spotStore.update(spot.id, v)} />
      <StationPicker lat={spot.lat} lon={spot.lon} value={spot.station} onChange={(station) => spotStore.update(spot.id, { station })} />
      <button
        onClick={() => {
          if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
          spotStore.remove(spot.id); toast(`Deleted ${spot.name}`); onDeleted();
        }}
        className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition ${armed ? "bg-rose-500 text-white" : "text-rose-300 ring-1 ring-rose-400/25 hover:bg-rose-400/10"}`}>
        <Trash2 className="h-4 w-4" />{armed ? "Tap again to delete" : "Delete spot"}
      </button>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options, id }: { value: T; onChange: (v: T) => void; options: [T, string][]; id: string }) {
  return (
    <div className="relative flex rounded-full bg-white/[.06] p-0.5 text-[11px] font-medium">
      {options.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} aria-pressed={value === k} className="relative rounded-full px-2.5 py-1 max-md:px-3 max-md:py-2.5">
          {value === k && <motion.span layoutId={id} className="absolute inset-0 rounded-full bg-white/15" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
          <span className={`relative whitespace-nowrap ${value === k ? "text-white" : "text-white/50"}`}>{label}</span>
        </button>
      ))}
    </div>
  );
}

/** "How did the model do over the last day?" — bias and average miss against the nearest NOAA sensor. */
function Accuracy({ hours, obs, loading, refName, km }: { hours: Hour[]; obs?: import("../lib/wind").Obs[]; loading: boolean; refName?: string; km?: number }) {
  if (!refName) return <p className="px-1 pt-2 text-[11px] text-white/35">No NOAA sensor within 25 km, so there's nothing to check the forecast against here.</p>;
  if (loading) return <Skeleton className="mt-2 h-10" />;
  const sc = obs ? scoreForecast(hours, obs) : null;
  if (!sc) return <p className="px-1 pt-2 text-[11px] text-white/35">Not enough recent readings from {refName} to score the forecast.</p>;
  const b = sc.bias, tone = Math.abs(b) < 1 ? "text-emerald-300" : Math.abs(b) < 3 ? "text-amber-200" : "text-rose-300";
  return (
    <div className="mt-2 flex items-center gap-3 rounded-2xl bg-white/[.04] px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${tone}`}>
          {Math.abs(b) < 1 ? "Forecast has been on the money" : `Model ran ${Math.abs(b).toFixed(1)} kn ${b < 0 ? "low" : "high"}`}
        </div>
        <div className="num text-[11px] text-white/45">avg miss {sc.mae.toFixed(1)} kn · direction {Math.round(sc.dirErr)}° off · {sc.n} h vs {refName}{km != null ? ` (${km < 10 ? km.toFixed(1) : Math.round(km)} km)` : ""}</div>
      </div>
      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/70">last 24 h</span>
    </div>
  );
}

function ChartHeader({ view, setView, range, setRange, onExpand, idSuffix = "" }: {
  view: "forecast" | "models"; setView: (v: "forecast" | "models") => void; range: Range; setRange: (r: Range) => void; onExpand?: () => void; idSuffix?: string;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
      <Segmented value={view} onChange={setView} id={`view-pill${idSuffix}`} options={[["forecast", "Forecast"], ["models", "Models"]]} />
      <div className="flex items-center gap-2">
        <Segmented value={range} onChange={setRange} id={`range-pill${idSuffix}`} options={[["24h", "Past 24 h"], ["48h", "48 h"], ["7d", "7 days"]]} />
        {onExpand && (
          <button onClick={onExpand} aria-label="Expand charts to full screen" title="Full screen"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[.06] text-white/70 hover:bg-white/15 max-md:h-11 max-md:w-11"><Maximize2 className="h-4 w-4" /></button>
        )}
      </div>
    </div>
  );
}
