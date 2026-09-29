import { motion } from "motion/react";
import { MapPin, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { spotStore, useStations } from "../lib/data";
import { nearestStations, type Spot } from "../lib/wind";
import { RangeSlider, StationPicker } from "./controls";

export function AddSpot({ pin, onCancel, onSaved }: { pin: { lat: number; lon: number } | null; onCancel: () => void; onSaved: (s: Spot) => void }) {
  const [name, setName] = useState("");
  const [range, setRange] = useState<[number, number]>([15, 30]);
  const [station, setStation] = useState<string | undefined>();
  const stations = useStations();

  // Default to the nearest station within 15 km; the picker shows whether it actually reports wind.
  useEffect(() => {
    if (!pin || !stations.data) return;
    const n = nearestStations(stations.data, pin.lat, pin.lon, 1)[0];
    setStation(n && n.km < 15 ? n.id : undefined);
  }, [pin?.lat, pin?.lon, stations.data]);

  function save() {
    if (!pin || !name.trim()) return;
    const s = spotStore.add({ name: name.trim(), lat: +pin.lat.toFixed(4), lon: +pin.lon.toFixed(4), min: range[0], max: range[1], ...(station ? { station } : {}) });
    toast.success(`${s.name} added`);
    onSaved(s);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">New spot</h2>
        <button onClick={onCancel} aria-label="Cancel" className="grid h-10 w-10 place-items-center rounded-full text-white/60 hover:bg-white/10"><X className="h-5 w-5" /></button>
      </div>
      {!pin ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-2xl border border-dashed border-cyan-300/30 bg-cyan-400/5 p-4 text-sm text-cyan-100">
          <MapPin className="h-5 w-5 shrink-0 animate-bounce text-cyan-300" />
          Tap the map where you launch. Zoom in for accuracy — the forecast grid is 3 km.
        </motion.div>
      ) : (
        <>
          <label className="block">
            <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/45">Title</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Davis Islands" autoFocus
              autoComplete="off" autoCorrect="off" enterKeyHint="done" onKeyDown={(e) => e.key === "Enter" && save()}
              className="w-full rounded-xl bg-white/[.06] px-3.5 py-3 text-base outline-none ring-1 ring-white/10 placeholder:text-white/25 focus:ring-2 focus:ring-cyan-300/50" />
          </label>
          <RangeSlider value={range} onChange={setRange} />
          <StationPicker lat={pin.lat} lon={pin.lon} value={station} onChange={setStation} />
          <motion.button whileTap={{ scale: 0.98 }} onClick={save} disabled={!name.trim()}
            className="rounded-2xl bg-gradient-to-r from-cyan-400 to-emerald-400 py-3.5 text-[15px] font-semibold text-slate-950 shadow-lg shadow-cyan-500/20 transition disabled:opacity-40">
            Save spot
          </motion.button>
        </>
      )}
    </div>
  );
}
