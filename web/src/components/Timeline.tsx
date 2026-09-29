import * as Slider from "@radix-ui/react-slider";
import { AnimatePresence, motion } from "motion/react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import type { Model } from "../lib/wind";

/**
 * Scrub the map's wind animation through the week. `hours` are hourly timestamps from the
 * current hour forward; index 0 is "now" (live stations + current field).
 */
export function Timeline({ hours, models, index, onIndex, playing, onPlaying, tz }: {
  hours: number[]; models: Model[]; index: number; onIndex: (i: number) => void;
  playing: boolean; onPlaying: (p: boolean) => void; tz: string;
}) {
  const last = Math.max(0, hours.length - 1);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => onIndex(index >= last ? 0 : index + 1), 450);
    return () => clearInterval(id);
  }, [playing, index, last, onIndex]);

  if (hours.length < 2) return null;
  const t = hours[index];
  const label = index === 0 ? "Now" : new Intl.DateTimeFormat([], { timeZone: tz, weekday: "short", hour: "numeric" }).format(t);
  const dayFmt = new Intl.DateTimeFormat([], { timeZone: tz, weekday: "short" });
  const hourOf = (x: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(x));
  const midnights = hours.map((h, i) => ({ h, i })).filter(({ h, i }) => i > 0 && hourOf(h) === 0);
  const nbmFrom = models.findIndex((m) => m === "nbm");

  return (
    <div className="glass flex items-center gap-3 rounded-2xl px-3 py-2.5">
      <motion.button whileTap={{ scale: 0.9 }} onClick={() => onPlaying(!playing)} aria-label={playing ? "Pause" : "Play the week"}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-400 to-emerald-400 text-slate-950 shadow-lg shadow-cyan-500/30">
        {playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" />}
      </motion.button>

      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={label} initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -6, opacity: 0 }}
              transition={{ duration: 0.15 }} className="num truncate text-sm font-semibold">
              {label}
            </motion.span>
          </AnimatePresence>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${index === 0 ? "bg-emerald-400/15 text-emerald-300"
            : models[index] === "nbm" ? "bg-amber-400/15 text-amber-200" : "bg-cyan-400/15 text-cyan-200"}`}>
            {index === 0 ? "LIVE" : models[index] === "nbm" ? "NBM · lower confidence" : "HRRR"}
          </span>
        </div>
        <Slider.Root className="relative flex h-5 w-full touch-none select-none items-center" min={0} max={last} step={1}
          value={[index]} onValueChange={([v]) => { onPlaying(false); onIndex(v); }} >
          <Slider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-white/10">
            {nbmFrom > 0 && (
              <span className="absolute inset-y-0 right-0 bg-amber-300/15" style={{ left: `${(nbmFrom / last) * 100}%` }} />
            )}
            <Slider.Range className="absolute h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" />
          </Slider.Track>
          <Slider.Thumb aria-label="Forecast time" className="block h-5 w-5 rounded-full border-2 border-white bg-[#0b1220] shadow-lg outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/40" />
        </Slider.Root>
        <div className="relative mt-1 h-3 text-[9px] text-white/40">
          {midnights.map(({ h, i }) => (
            <span key={h} className="absolute -translate-x-1/2" style={{ left: `${(i / last) * 100}%` }}>{dayFmt.format(h)}</span>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {index > 0 && (
          <motion.button initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
            onClick={() => { onPlaying(false); onIndex(0); }} aria-label="Back to now"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/70 ring-1 ring-white/15 hover:bg-white/10">
            <RotateCcw className="h-4 w-4" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
