import { motion } from "motion/react";
import { ChevronRight, Radio } from "lucide-react";
import { useSpots } from "../lib/data";
import { fmtWindow, useSpotNow } from "../lib/useSpotNow";
import type { Spot } from "../lib/wind";
import { Knots, RideBadge, Skeleton, Sparkline, WindArrow } from "./bits";

export function SpotList({ onSelect }: { onSelect: (s: Spot) => void }) {
  const spots = useSpots();
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-sm font-semibold tracking-wide text-white/80">Your spots</h2>
        <span className="text-xs text-white/40">HRRR · 3 km · hourly</span>
      </div>
      {spots.length === 0 && (
        <p className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-white/50">
          No spots yet. Tap <b className="text-white/80">+</b> and drop a pin where you launch.
        </p>
      )}
      {spots.map((s, i) => (
        <motion.div key={s.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, type: "spring", stiffness: 260, damping: 26 }}>
          <SpotCard spot={s} onClick={() => onSelect(s)} />
        </motion.div>
      ))}
    </div>
  );
}

function SpotCard({ spot, onClick }: { spot: Spot; onClick: () => void }) {
  const { fc, now, ride, next } = useSpotNow(spot);
  const spark = (fc.data?.hours ?? []).filter((h) => h.t >= Date.now() - 3600e3).slice(0, 36).map((h) => h.speed);
  return (
    <motion.button whileTap={{ scale: 0.985 }} whileHover={{ y: -1 }} onClick={onClick}
      className="group w-full rounded-2xl border border-white/[.07] bg-white/[.035] p-3.5 text-left transition-colors hover:border-white/15 hover:bg-white/[.06]">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold">{spot.name}</h3>
            {spot.station && <Radio className="h-3.5 w-3.5 shrink-0 text-cyan-300/70" aria-label="Live station" />}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-white/50">
            <span className="num">{spot.min}–{spot.max} kn</span>
            {ride && <RideBadge ride={ride} className="!py-0.5 !text-[11px]" />}
          </div>
        </div>
        {now ? (
          <div className="flex items-center gap-2">
            <WindArrow dir={now.dir} size={18} className="text-white/70" />
            <div className="text-right">
              <div className="text-2xl font-semibold leading-none"><Knots value={now.speed} /><span className="ml-0.5 text-xs font-medium text-white/40">kn</span></div>
              <div className="num mt-1 text-[11px] text-white/45">gust {Math.round(now.gust)}</div>
            </div>
          </div>
        ) : fc.isError ? <span className="text-xs text-rose-300">Forecast failed</span> : <Skeleton className="h-9 w-16" />}
        <ChevronRight className="h-4 w-4 text-white/25 transition group-hover:translate-x-0.5 group-hover:text-white/50" />
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <span className={next ? "text-xs font-medium text-emerald-300" : "text-xs text-white/40"}>
          {fc.data ? (next ? `Rideable ${fmtWindow(next, fc.data.timeZone)}` : "No rideable window in the next 48 h") : " "}
        </span>
        <Sparkline values={spark} min={spot.min} max={spot.max} width={110} height={26} />
      </div>
    </motion.button>
  );
}
