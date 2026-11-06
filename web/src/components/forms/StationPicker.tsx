import clsx from "clsx";
import { MapPin, RotateCw } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useLiveStations, useObservation, usePrimaryModel, useStations } from "../../lib/data";
import { ago, fmtKm, FRESH_MS, NEARBY_MAX_KM, NEARBY_WARN_KM, NO_STATION } from "../../lib/session";
import { compass, MODEL_INFO, nearestLive, nearestStations } from "../../lib/wind";
import { Skeleton, WindArrow } from "../bits";
import { Button } from "../ui";
import { FieldHeader } from "./Field";

/** How many nearby NOAA stations to offer. */
const SHOW = 4;

/**
 * Where a spot's "now" reading comes from, as one radio list (native radios: arrow keys move the choice):
 * - "Auto — nearest sensor (≤ 16 km)": `station` undefined, the nearest live sensor at the time;
 * - each nearby NOAA station, with its distance and current reading, so you can see which actually report wind;
 * - "No station — forecast only": NO_STATION ("none"), the model and never a sensor.
 * `onChange` gets undefined for Auto.
 */
export function StationPicker({ lat, lon, value, onChange }: { lat: number; lon: number; value?: string; onChange: (id?: string) => void }) {
  const id = useId();
  const st = useStations();
  const near = st.data ? nearestStations(st.data, lat, lon, SHOW) : [];
  const live = useLiveStations();
  const auto = live.data ? nearestLive(live.data, lat, lon, NEARBY_MAX_KM) : null;
  const model = MODEL_INFO[usePrimaryModel()].label;
  // A station id that isn't in the nearby list (picked long ago, or far away) still shows as chosen.
  const other = value && value !== NO_STATION && st.data && !near.some((s) => s.id === value)
    ? (st.data.find((s) => s.id === value) ?? { id: value, name: `Station ${value}`, lat, lon }) : null;

  return (
    <div role="radiogroup" aria-labelledby={id}>
      <FieldHeader id={id} title="Live wind from" />
      <div className="mt-2 overflow-hidden rounded-lg border border-line bg-surface-2">
        <Option name={id} checked={value === undefined} onSelect={() => onChange(undefined)}
          title={<>Auto — nearest sensor <span className="whitespace-nowrap">(≤ {NEARBY_MAX_KM} km)</span></>}
          detail={auto
            ? <>Now {auto.km > NEARBY_WARN_KM && <MapPin aria-hidden className="-mt-px mr-0.5 inline size-3 text-soon" strokeWidth={2.5} />}<span className="text-fg-2"
                title={auto.km > NEARBY_WARN_KM ? "This sensor is more than 8 km from the spot, so the wind there may differ." : undefined}>{auto.name} · {fmtKm(auto.km)}</span></>
            : live.isSuccess ? `None within ${NEARBY_MAX_KM} km now, so the ${model} forecast` : "The closest live reading, else the forecast"} />
        {st.isPending && [0, 1, 2].map((i) => (
          <div key={i} className="flex min-h-15 items-center gap-3 border-t border-line px-3.5">
            <Skeleton className="size-5 rounded-full" /><Skeleton className="h-4 flex-1" /><Skeleton className="h-4 w-16" />
          </div>
        ))}
        {st.isError && (
          <div className="flex min-h-15 items-center justify-between gap-3 border-t border-line px-3.5 text-caption text-fg-2">
            Couldn't load NOAA stations.
            <Button size="sm" variant="ghost" onClick={() => st.refetch()}><RotateCw /> Retry</Button>
          </div>
        )}
        {[...near, ...(other ? [{ ...other, km: NaN }] : [])].map((s) => (
          <StationOption key={s.id} name={id} station={s} checked={value === s.id} onSelect={() => onChange(s.id)} />
        ))}
        <Option name={id} checked={value === NO_STATION} onSelect={() => onChange(NO_STATION)}
          title="No station — forecast only" detail={`Uses the ${model} forecast, never a sensor`} />
      </div>
    </div>
  );
}

function StationOption({ name, station, checked, onSelect }: {
  name: string; station: { id: string; name: string; km: number }; checked: boolean; onSelect: () => void;
}) {
  const ob = useObservation(station.id);
  const stale = ob.data && Date.now() - ob.data.t > FRESH_MS;
  return (
    <Option name={name} checked={checked} onSelect={onSelect} title={station.name}
      detail={<span className="num"><span className="whitespace-nowrap">{Number.isFinite(station.km) ? fmtKm(station.km) : "Chosen earlier"} ·</span> #{station.id}</span>}
      aside={ob.isPending ? <Skeleton className="h-4 w-16" /> : ob.data ? (
        <span className="flex flex-col items-end gap-0.5">
          <span className="num inline-flex items-center gap-1 text-label font-medium text-fg">
            <span aria-hidden className="contents"><WindArrow dir={ob.data.dir} size={12} className="text-fg-2" /></span>
            {Math.round(ob.data.speed)} <span className="font-normal text-fg-3">kn {compass(ob.data.dir)}</span>
          </span>
          <span className={clsx("text-micro", stale ? "text-soon" : "text-fg-3")}>{ago(ob.data.t)}</span>
        </span>
      ) : <span className="text-caption text-fg-3">Not reporting</span>} />
  );
}

/**
 * One row: a native radio, invisible but covering the whole row (so the row is its 60 px tap target), named by its
 * title and described by the rest. The ring and dot are drawn; keyboard focus rings the row.
 */
function Option({ name, checked, onSelect, title, detail, aside }: {
  name: string; checked: boolean; onSelect: () => void; title: ReactNode; detail?: ReactNode; aside?: ReactNode;
}) {
  const id = useId();
  return (
    <label className={clsx(
      "group relative flex min-h-15 cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors duration-150 not-first:border-t not-first:border-line",
      "has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-accent",
      checked ? "bg-surface-3" : "hover:bg-surface-3/60",
    )}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} aria-labelledby={`${id}-t`}
        className="absolute inset-0 z-10 m-0 cursor-pointer appearance-none opacity-0"
        aria-describedby={[detail && `${id}-d`, aside && `${id}-a`].filter(Boolean).join(" ") || undefined} />
      <span aria-hidden className={clsx("grid size-5 shrink-0 place-items-center rounded-full ring-2 ring-inset transition-colors duration-150",
        checked ? "ring-accent" : "ring-line-strong group-hover:ring-fg-3")}>
        <span className={clsx("size-2.5 rounded-full bg-accent transition-transform duration-150 ease-ui motion-reduce:transition-none", checked ? "scale-100" : "scale-0")} />
      </span>
      <span className="min-w-0 flex-1">
        {/* Wrapped, never cut: at 320 px "None within 16 km now, so the HRRR forecast" needs its second line */}
        <span id={`${id}-t`} className="block text-label font-medium text-fg">{title}</span>
        {detail && <span id={`${id}-d`} className="mt-0.5 block text-caption text-fg-3">{detail}</span>}
      </span>
      {aside && <span id={`${id}-a`} className="shrink-0 text-right">{aside}</span>}
    </label>
  );
}
