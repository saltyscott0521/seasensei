import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import Map, { GeolocateControl, Marker, NavigationControl, useMap, type MapLayerMouseEvent } from "react-map-gl/maplibre";
import clsx from "clsx";
import { useLiveStations } from "../lib/data";
import { ago, useSpotNow } from "../lib/useSpotNow";
import type { Bounds, LiveReading, Spot, WindGrid } from "../lib/wind";
import { compass, nearestHour, rideState, windColor } from "../lib/wind";
import { useState } from "react";
import { WindArrow } from "./bits";
import { WindParticles } from "./WindParticles";

export const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

type Props = {
  spots: Spot[];
  selectedId: string | null;
  onSelect: (s: Spot) => void;
  addMode: boolean;
  pin: { lat: number; lon: number } | null;
  onPin: (p: { lat: number; lon: number }) => void;
  onBounds: (b: Bounds) => void;
  grid: WindGrid | undefined;
  padding: { top: number; bottom: number; left: number; right: number };
  showStations: boolean;
  at: number | null; // null = now; else a forecast hour (ms)
  /** Bottom-right is under the phone sheet, so phones pass top-right. */
  controlPosition?: "top-right" | "bottom-right";
};

export function WindMap({ spots, selectedId, onSelect, addMode, pin, onPin, onBounds, grid, padding, showStations, at, controlPosition = "bottom-right" }: Props) {
  const initial = useMemo(() => {
    if (!spots.length) return { longitude: -82.6, latitude: 27.75, zoom: 9.5 };
    const lats = spots.map((s) => s.lat), lons = spots.map((s) => s.lon);
    const pad = 0.12;
    return {
      bounds: [[Math.min(...lons) - pad, Math.min(...lats) - pad], [Math.max(...lons) + pad, Math.max(...lats) + pad]] as [[number, number], [number, number]],
      fitBoundsOptions: { padding },
    };
    // only on first render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Map
      initialViewState={initial}
      mapStyle={MAP_STYLE}
      style={{ position: "absolute", inset: 0 }}
      onClick={(e: MapLayerMouseEvent) => addMode && onPin({ lat: e.lngLat.lat, lon: e.lngLat.lng })}
      cursor={addMode ? "crosshair" : undefined}
      attributionControl={{ compact: true }}
      dragRotate={false}
      maxPitch={0}
    >
      <WindParticles grid={grid} />
      <BoundsReporter onBounds={onBounds} />
      <FlyTo spots={spots} selectedId={selectedId} padding={padding} />
      <NavigationControl position={controlPosition} showCompass={false} />
      <GeolocateControl position={controlPosition} />
      {/* Live meters are "right now". Scrubbing the timeline (at != null) hides them. */}
      {showStations && at == null && <StationMarkers />}
      {spots.map((s) => (
        <SpotMarker key={s.id} spot={s} selected={s.id === selectedId} onClick={() => onSelect(s)} dim={addMode} at={at} />
      ))}
      <AnimatePresence>
        {pin && (
          <Marker key={`${pin.lat},${pin.lon}`} longitude={pin.lon} latitude={pin.lat} anchor="bottom">
            <motion.div initial={{ y: -40, opacity: 0, scale: 0.6 }} animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 420, damping: 18 }} className="relative flex flex-col items-center">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-cyan-300 to-emerald-400 text-slate-950 shadow-xl shadow-cyan-500/40 ring-4 ring-white/20">
                <span className="text-lg font-bold">+</span>
              </div>
              <div className="h-3 w-0.5 bg-white/80" />
              <span className="ping-soft absolute -bottom-1.5 h-3 w-3 rounded-full bg-cyan-300" />
            </motion.div>
          </Marker>
        )}
      </AnimatePresence>
    </Map>
  );
}

/** Reports the visible area on mount and after every move (drives the wind-field request). */
function BoundsReporter({ onBounds }: { onBounds: (b: Bounds) => void }) {
  const { current } = useMap();
  const cb = useRef(onBounds);
  cb.current = onBounds;
  useEffect(() => {
    const map = current?.getMap();
    if (!map) return;
    const report = () => {
      const b = map.getBounds();
      cb.current({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    };
    report();
    map.on("moveend", report);
    map.on("load", report);
    return () => { map.off("moveend", report); map.off("load", report); };
  }, [current]);
  return null;
}

function FlyTo({ spots, selectedId, padding }: { spots: Spot[]; selectedId: string | null; padding: Props["padding"] }) {
  const { current: map } = useMap();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!map || !selectedId || last.current === selectedId) return;
    last.current = selectedId;
    const s = spots.find((x) => x.id === selectedId);
    if (s) map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 11.2), padding, duration: 1400, essential: true });
  }, [map, selectedId, spots, padding]);
  useEffect(() => { if (!selectedId) last.current = null; }, [selectedId]);
  return null;
}

function SpotMarker({ spot, selected, onClick, dim, at }: { spot: Spot; selected: boolean; onClick: () => void; dim: boolean; at: number | null }) {
  const live = useSpotNow(spot);
  const future = at != null ? nearestHour(live.fc.data?.hours ?? [], at) : null;
  const now = at != null ? future : live.now;
  const ride = now ? rideState(now.speed, spot, now.dir) : null;
  const ring = ride === "good" ? "ring-emerald-400/80" : ride === "above" ? "ring-rose-400/80" : ride === "offdir" ? "ring-amber-300/70" : "ring-white/20";
  return (
    <Marker longitude={spot.lon} latitude={spot.lat} anchor="bottom" onClick={(e) => { e.originalEvent.stopPropagation(); onClick(); }}
      style={{ zIndex: selected ? 10 : 1 }}>
      <motion.button initial={{ scale: 0, y: 10 }} animate={{ scale: selected ? 1.12 : 1, y: 0, opacity: dim ? 0.45 : 1 }}
        whileHover={{ scale: selected ? 1.14 : 1.06 }} transition={{ type: "spring", stiffness: 400, damping: 22 }}
        aria-label={`${spot.name}${now ? `, ${Math.round(now.speed)} knots` : ""}`}
        className="group relative flex flex-col items-center">
        {ride === "good" && <span className="ping-soft absolute left-1/2 top-3 -z-10 h-7 w-7 -translate-x-1/2 rounded-full bg-emerald-400/60" />}
        <div className={clsx("glass flex items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2.5 ring-2", ring, selected && "!bg-slate-900/90")}>
          <span className="grid h-6 w-6 place-items-center rounded-full" style={{ background: now ? windColor(now.speed, 0.22) : "rgb(255 255 255 / .06)", color: now ? windColor(now.speed) : "#94a3b8" }}>
            {now ? <WindArrow dir={now.dir} size={14} /> : <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/50" />}
          </span>
          <span className="num text-sm font-semibold">{now ? Math.round(now.speed) : "–"}</span>
          <span className="text-[10px] text-white/50">kn</span>
        </div>
        <span className="mt-0.5 max-w-[9rem] truncate rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur">{spot.name}</span>
        <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_8px_white]" />
      </motion.button>
    </Marker>
  );
}

/** Every live sensor as a compact marker; tap one for its name, gust and age. */
function StationMarkers() {
  const live = useLiveStations();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {(live.data ?? []).map((r) => (
        <StationMarker key={r.id} r={r} open={open === r.id} onToggle={() => setOpen((o) => (o === r.id ? null : r.id))} />
      ))}
    </>
  );
}

function StationMarker({ r, open, onToggle }: { r: LiveReading; open: boolean; onToggle: () => void }) {
  const c = windColor(r.speed);
  return (
    <Marker longitude={r.lon} latitude={r.lat} anchor="center" style={{ zIndex: open ? 9 : 0 }}
      onClick={(e) => { e.originalEvent.stopPropagation(); onToggle(); }}>
      <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }} whileHover={{ scale: 1.1 }}
        aria-label={`${r.name}: ${Math.round(r.speed)} knots from ${compass(r.dir)}`}
        className="relative flex items-center gap-1 rounded-lg border border-white/10 bg-slate-950/75 px-1.5 py-0.5 backdrop-blur">
        <span style={{ color: c }}>{r.speed > 0.5 ? <WindArrow dir={r.dir} size={11} /> : <span className="block h-1.5 w-1.5 rounded-full bg-current" />}</span>
        <span className="num text-[11px] font-semibold" style={{ color: c }}>{Math.round(r.speed)}</span>
        <AnimatePresence>
          {open && (
            <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
              className="glass absolute bottom-full left-1/2 mb-1.5 w-max max-w-[14rem] -translate-x-1/2 rounded-xl px-2.5 py-1.5 text-left text-[11px] leading-snug">
              <span className="block font-semibold text-white">{r.name}</span>
              <span className="num block text-white/70">{Math.round(r.speed)} kn{r.gust != null ? ` · g${Math.round(r.gust)}` : ""} · {compass(r.dir)}</span>
              <span className="block text-white/40">{r.source === "airport" ? "Airport (hourly)" : "NOAA PORTS (6-min)"} · {ago(r.t)}</span>
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </Marker>
  );
}
