import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Radio, Settings2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { spotStore } from "../lib/data";
import { ago, fmtWindow, useSpotNow } from "../lib/useSpotNow";
import { compass, nearestHour, rideState, windColor, type Hour, type Spot } from "../lib/wind";
import { Dial, Knots, RideBadge, Skeleton, WindArrow } from "./bits";
import { RangeSlider, StationPicker } from "./controls";
import { ForecastChart } from "./ForecastChart";

export function SpotDetail({ spot, onBack }: { spot: Spot; onBack: () => void }) {
  const { fc, ob, model, now, windows } = useSpotNow(spot);
  const [scrub, setScrub] = useState<Hour | null>(null);
  const [editing, setEditing] = useState(false);
  const tz = fc.data?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const shown = scrub ?? now;
  const ride = shown ? rideState(shown.speed, spot) : null;
  const when = scrub
    ? new Intl.DateTimeFormat([], { timeZone: tz, weekday: "short", hour: "numeric" }).format(scrub.t) + " · HRRR"
    : now?.source === "live" ? `Live · ${ob.data!.name} · ${ago(ob.data!.t)}` : "Now · HRRR model";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} aria-label="Back to spots" className="-ml-1.5 grid h-10 w-10 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold tracking-tight">{spot.name}</h2>
          <p className="num text-xs text-white/40">{spot.lat.toFixed(3)}, {spot.lon.toFixed(3)} · {spot.min}–{spot.max} kn</p>
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
              className="shrink-0 rounded-full bg-emerald-400/12 px-3 py-1.5 text-xs font-medium text-emerald-200 ring-1 ring-emerald-400/25">
              {fmtWindow(w, tz)}
            </motion.span>
          )) : <span className="text-xs text-white/40">No rideable window in the next 48 h.</span>}
        </div>
      )}

      {/* Chart */}
      <div className="rounded-3xl border border-white/[.07] bg-white/[.025] p-3">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-xs font-medium uppercase tracking-wider text-white/45">48 h forecast</span>
          <span className="flex items-center gap-3 text-[10px] text-white/40">
            <span className="flex items-center gap-1"><i className="h-0.5 w-3 rounded bg-gradient-to-r from-cyan-400 to-lime-300" />wind</span>
            <span className="flex items-center gap-1"><i className="w-3 border-t border-dashed border-white/50" />gust</span>
            <span className="flex items-center gap-1"><i className="h-2 w-3 rounded-sm bg-emerald-400/20" />your range</span>
          </span>
        </div>
        {fc.data ? <ForecastChart forecast={fc.data} spot={spot} onScrub={setScrub} /> : <Skeleton className="h-44" />}
        <p className="px-1 pt-1 text-[10px] text-white/30">Drag across the chart to scrub · NOAA HRRR via Open-Meteo</p>
      </div>

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
        const good = h.speed >= spot.min && h.speed <= spot.max;
        const isNow = h === nowH;
        const label = hf.format(h.t);
        const midnight = /^12\s?AM$/i.test(label) || label === "0";
        return (
          <div key={h.t} data-now={isNow || undefined}
            className={`flex w-14 shrink-0 snap-start flex-col items-center gap-1 rounded-2xl py-2.5 ring-1 ${good ? "bg-emerald-400/10 ring-emerald-400/25" : "ring-white/[.06]"} ${isNow ? "!ring-white/50" : ""}`}>
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
