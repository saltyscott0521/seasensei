import { getVersion, setWorkerUrl } from "maplibre-gl";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Map, { GeolocateControl, NavigationControl, useMap, type MapLayerMouseEvent } from "react-map-gl/maplibre";
import { useLiveStations } from "../lib/data";
import { useRankedSpots } from "../lib/useSpotNow";
import type { Bounds, LiveReading, Spot, WindGrid } from "../lib/wind";
import { tuneBasemap } from "./map/basemap";
import { Camera, type Padding } from "./map/Camera";
import { useDeclutter, useOffBand } from "./map/declutter";
import { PinMarker } from "./map/PinMarker";
import { prefersReducedMotion } from "./map/reducedMotion";
import { SpotMarker } from "./map/SpotMarker";
import { StationMarkers } from "./map/StationMarkers";
import { WindParticles } from "./WindParticles";

// MapLibre finds its worker through import.meta.url, which breaks once bundled: point it at the copy that
// scripts/copy-maplibre-worker.mjs puts in public/. Here, not in main.tsx, so maplibre stays out of the entry chunk
// (App lazy-loads this module) and runs before any map is made.
setWorkerUrl(`/maplibre/${getVersion()}/maplibre-gl-worker.mjs`);

export const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

type LatLon = { lat: number; lon: number };

/** What the shell can ask of the map without a pointer on it (adding a spot from the keyboard or by location). */
export type MapApi = {
  /** The map point under a page pixel (e.g. the cross-hair at the middle of the open map). */
  pointAt(x: number, y: number): LatLon | null;
  /** Brings a point into the open map if it isn't there (a short ease; a cut under reduced motion). */
  reveal(p: LatLon): void;
};

type Props = {
  spots: Spot[];
  selectedId: string | null;
  /** A spot whose card is hovered or focused in the list: ringed and named like the selected one. */
  highlightId?: string | null;
  onSelect: (s: Spot) => void;
  addMode: boolean;
  pin: LatLon | null;
  onPin: (p: LatLon) => void;
  onBounds: (b: Bounds) => void;
  grid: WindGrid | undefined;
  /** The map area chrome leaves visible: the camera centres spots in it and particles are born in it. */
  padding: Padding;
  showStations: boolean;
  at: number | null; // null = now; else a forecast hour (ms)
  /** The map is covered (full phone sheet, a dialog, full-screen charts): the wind particles stop. */
  paused?: boolean;
  /** Filled in once the map exists. */
  apiRef?: RefObject<MapApi | null>;
  /** Bottom-right is under the phone sheet, so phones pass top-right. */
  controlPosition?: "top-right" | "bottom-right";
  /** Zoom in / out buttons (desktop). Phones pinch, and their rail stays short. */
  zoomControls?: boolean;
};

const NO_READINGS: LiveReading[] = [];

/**
 * The live wind map: a calm night-sea basemap, the wind field as streamlines, one marker per spot (its wind for the
 * timeline's hour, ringed by its verdict) and, at "now", one chip per live sensor.
 */
export const WindMap = memo(function WindMap({
  spots, selectedId, highlightId = null, onSelect, addMode, pin, onPin, onBounds, grid, padding, showStations, at, paused = false, apiRef,
  controlPosition = "bottom-right", zoomControls = true,
}: Props) {
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

  const [openStation, setOpenStation] = useState<string | null>(null);
  // A station's card goes with the station layer (scrubbing into the future, or turning stations off).
  if (openStation && (at != null || !showStations)) setOpenStation(null);
  // Bumped on every tap in add mode, so a new tap replays the pin's drop and a drag doesn't.
  const [drop, setDrop] = useState(0);

  const onClick = useCallback((e: MapLayerMouseEvent) => {
    if (addMode) { setDrop((d) => d + 1); onPin({ lat: e.lngLat.lat, lon: e.lngLat.lng }); }
    else setOpenStation(null);
  }, [addMode, onPin]);
  const toggleStation = useCallback((id: string) => setOpenStation((o) => (o === id ? null : id)), []);
  const closeStation = useCallback(() => setOpenStation(null), []);

  return (
    <Map
      initialViewState={initial}
      mapStyle={MAP_STYLE}
      style={{ position: "absolute", inset: 0 }}
      onClick={onClick}
      cursor={addMode ? "crosshair" : undefined}
      attributionControl={{ compact: true }}
      dragRotate={false}
      touchPitch={false}
      pitchWithRotate={false}
      maxPitch={0}
    >
      <MapSetup apiRef={apiRef} padding={padding} />
      <WindParticles grid={grid} inset={padding} paused={paused} />
      <BoundsReporter onBounds={onBounds} />
      <Camera spots={spots} selectedId={selectedId} padding={padding} reframe={!addMode} />
      {zoomControls && <NavigationControl position={controlPosition} showCompass={false} />}
      <GeolocateControl position={controlPosition} />
      <Markers spots={spots} selectedId={selectedId} highlightId={highlightId} onSelect={onSelect} addMode={addMode} at={at} padding={padding}
        showStations={showStations} openStation={openStation} onToggleStation={toggleStation} onCloseStation={closeStation} />
      {pin && addMode && <PinMarker pin={pin} drop={drop} onPin={onPin} />}
    </Map>
  );
});

function Markers({ spots, selectedId, highlightId, onSelect, addMode, at, padding, showStations, openStation, onToggleStation, onCloseStation }: {
  spots: Spot[]; selectedId: string | null; highlightId: string | null; onSelect: (s: Spot) => void; addMode: boolean; at: number | null;
  padding: Padding; showStations: boolean; openStation: string | null; onToggleStation: (id: string) => void; onCloseStation: () => void;
}) {
  const live = useLiveStations();
  // Live sensors are "right now": scrubbing the timeline (at != null) takes them off the map.
  const readings = showStations && at == null ? live.data ?? NO_READINGS : NO_READINGS;
  // The board's order (best first): the best spot's marker keeps its name and stacks on top.
  const ranked = useRankedSpots();
  const rankKey = ranked.map((r) => r.spot.id).join(",");
  const rank = useMemo(() => (rankKey ? rankKey.split(",") : []), [rankKey]);
  const { hidden, labelled } = useDeclutter(spots, readings, { selectedId, highlightId, rank });
  const offBand = useOffBand(spots, readings, padding);
  return (
    <>
      {readings.length > 0 && (
        <StationMarkers readings={readings} hidden={hidden} offBand={offBand} open={openStation} onToggle={onToggleStation} onClose={onCloseStation} dim={addMode} />
      )}
      {spots.map((s) => (
        <SpotMarker key={s.id} spot={s} selected={s.id === selectedId} highlighted={s.id === highlightId} onSelect={onSelect} dim={addMode}
          offscreen={offBand.has(`s:${s.id}`) && s.id !== selectedId} at={at} labels={labelled.has(s.id)} rank={rank.indexOf(s.id)} />
      ))}
    </>
  );
}

/** One-time map setup: the night-sea basemap, north-up only (no touch or keyboard rotation), and the shell's MapApi. */
function MapSetup({ apiRef, padding }: { apiRef?: RefObject<MapApi | null>; padding: Padding }) {
  const { current } = useMap();
  const pad = useRef(padding);
  pad.current = padding;
  useEffect(() => {
    const map = current?.getMap();
    if (!map) return;
    if (import.meta.env.DEV) (window as unknown as { __map?: unknown }).__map = map; // for tests and tools/shots
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    // The canvas takes keyboard focus (arrows pan, +/− zoom). The app's focus ring sits outside an element, where the
    // map would clip it; draw it inside the canvas instead.
    map.getCanvas().classList.add("focus-visible:-outline-offset-2");
    const tune = () => tuneBasemap(map);
    // MapLibre opens the credits as soon as the sources name them and keeps them open until the first drag: a
    // full-width strip over a phone's small map. Start as the small "i" instead (one tap away, as OpenStreetMap
    // asks); after this first time it opens and closes as usual.
    const collapseCredits = () => {
      const credits = map.getContainer().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show");
      if (!credits) return;
      credits.classList.remove("maplibregl-compact-show");
      credits.removeAttribute("open");
      map.off("sourcedata", collapseCredits);
    };
    map.on("sourcedata", collapseCredits);
    map.on("style.load", tune);
    try { if (map.getStyle()?.layers?.length) tune(); } catch { /* style not parsed yet: style.load will tune it */ }
    if (apiRef) {
      (apiRef as { current: MapApi | null }).current = {
        pointAt(x, y) {
          const r = map.getContainer().getBoundingClientRect();
          const ll = map.unproject([x - r.left, y - r.top]);
          return Number.isFinite(ll.lat) && Number.isFinite(ll.lng) ? { lat: ll.lat, lon: ll.lng } : null;
        },
        reveal({ lat, lon }) {
          const el = map.getContainer(), p = map.project([lon, lat]), q = pad.current;
          const inside = p.x >= q.left && p.x <= el.clientWidth - q.right && p.y >= q.top + 40 && p.y <= el.clientHeight - q.bottom;
          if (inside) return;
          const opts = { center: [lon, lat] as [number, number], padding: q, zoom: Math.max(map.getZoom(), 11) };
          if (prefersReducedMotion()) map.jumpTo(opts); else map.easeTo({ ...opts, duration: 600 });
        },
      };
    }
    return () => {
      map.off("style.load", tune);
      map.off("sourcedata", collapseCredits);
      if (apiRef) (apiRef as { current: MapApi | null }).current = null;
    };
  }, [current, apiRef]);
  return null;
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
