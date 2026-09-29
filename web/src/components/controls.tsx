import * as Slider from "@radix-ui/react-slider";
import clsx from "clsx";
import { Check } from "lucide-react";
import { useObservation, useStations } from "../lib/data";
import { ago } from "../lib/useSpotNow";
import { compass, nearestStations } from "../lib/wind";
import { Skeleton, WindArrow } from "./bits";

export function RangeSlider({ value, onChange }: { value: [number, number]; onChange: (v: [number, number]) => void }) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-white/45">Wind range</span>
        <span className="num text-sm text-white/90">{value[0]}–{value[1]} kn</span>
      </div>
      <Slider.Root className="relative flex h-6 w-full touch-none select-none items-center" min={5} max={45} step={1}
        minStepsBetweenThumbs={2} value={value} onValueChange={(v) => onChange([v[0], v[1]])}>
        <Slider.Track className="relative h-1.5 grow overflow-hidden rounded-full"
          style={{ background: "linear-gradient(90deg,#3c5a8c,#388cdc 20%,#22d3ee 32%,#34d399 45%,#a3e635 57%,#facc15 70%,#fb7124 82%,#ec4899)" }}>
          <Slider.Range className="absolute h-full rounded-full ring-2 ring-white/70" />
        </Slider.Track>
        {[0, 1].map((i) => (
          <Slider.Thumb key={i} aria-label={i ? "Maximum knots" : "Minimum knots"}
            className="block h-6 w-6 rounded-full border-2 border-white bg-[#0b1220] shadow-lg outline-none transition focus-visible:ring-4 focus-visible:ring-cyan-300/40" />
        ))}
      </Slider.Root>
      <div className="num mt-1.5 flex justify-between text-[10px] text-white/30"><span>5</span><span>15</span><span>25</span><span>35</span><span>45</span></div>
    </div>
  );
}

/** Nearest NOAA stations to a point, each showing its live reading so you can see which actually report wind. */
export function StationPicker({ lat, lon, value, onChange }: { lat: number; lon: number; value?: string; onChange: (id?: string) => void }) {
  const st = useStations();
  const near = st.data ? nearestStations(st.data, lat, lon, 5) : [];
  return (
    <div>
      <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/45">Live wind from</span>
      <div className="flex flex-col gap-1.5">
        {st.isPending && [0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}
        {st.isError && <p className="text-xs text-rose-300">Couldn't load NOAA stations.</p>}
        {near.map((s) => <StationRow key={s.id} id={s.id} name={s.name} km={s.km} selected={value === s.id} onClick={() => onChange(s.id)} />)}
        <button onClick={() => onChange(undefined)}
          className={clsx("flex items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm ring-1 transition",
            !value ? "bg-white/10 ring-white/25" : "ring-white/[.07] hover:bg-white/5")}>
          <span className="text-white/70">No station — forecast only</span>
          {!value && <Check className="h-4 w-4 text-cyan-300" />}
        </button>
      </div>
    </div>
  );
}

function StationRow({ id, name, km, selected, onClick }: { id: string; name: string; km: number; selected: boolean; onClick: () => void }) {
  const ob = useObservation(id);
  return (
    <button onClick={onClick}
      className={clsx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 transition",
        selected ? "bg-cyan-400/10 ring-cyan-300/40" : "ring-white/[.07] hover:bg-white/5")}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="num text-[11px] text-white/40">#{id} · {km < 10 ? km.toFixed(1) : Math.round(km)} km</div>
      </div>
      <div className="text-right text-xs">
        {ob.isPending ? <Skeleton className="h-4 w-14" /> : ob.data ? (
          <span className="inline-flex items-center gap-1.5 text-white/80">
            <WindArrow dir={ob.data.dir} size={12} /> <span className="num">{Math.round(ob.data.speed)} kn {compass(ob.data.dir)}</span>
            <span className="text-white/35">· {ago(ob.data.t)}</span>
          </span>
        ) : <span className="text-white/35">no wind data</span>}
      </div>
      {selected && <Check className="h-4 w-4 shrink-0 text-cyan-300" />}
    </button>
  );
}
