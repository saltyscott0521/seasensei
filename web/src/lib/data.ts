import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
  forecastUrl, gridPoints, IEM_URL, parseField, inBox, parseForecast, parseIem, parseObservation, parseStations, spotsBox,
  stationUrl, STATIONS_URL, TAMPA_BAY, type Bounds, type LiveReading, type Spot,
} from "./wind";

async function json(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const MIN = 60_000;

export const useForecast = (spot: Spot | undefined) =>
  useQuery({
    queryKey: ["forecast", spot?.lat, spot?.lon],
    queryFn: () => json(forecastUrl(spot!.lat, spot!.lon)).then(parseForecast),
    enabled: !!spot,
    staleTime: 15 * MIN,
    refetchInterval: 30 * MIN,
  });

export const useObservation = (station: string | undefined) =>
  useQuery({
    queryKey: ["obs", station],
    queryFn: () => json(stationUrl(station!)).then(parseObservation),
    enabled: !!station,
    staleTime: 2 * MIN,
    refetchInterval: 6 * MIN,
    retry: 1,
  });

export const useStations = () =>
  useQuery({ queryKey: ["stations"], queryFn: () => json(STATIONS_URL).then(parseStations), staleTime: Infinity, gcTime: Infinity });

/**
 * A week of hourly wind for a grid over the map view, in ONE request (HRRR to 48 h, then NBM).
 * Scrubbing time is then local and instant. (Fetching hour by hour would cost ~50 Open-Meteo
 * "calls" per step — a single play-through would blow the free daily quota.)
 */
export const useWindField = (bounds: Bounds | null) => {
  const g = bounds ? gridPoints(bounds, 5) : null;
  return useQuery({
    queryKey: ["field", g?.lats[0], g?.lons[0], g?.lats.length, g && g.lats[1] - g.lats[0]],
    enabled: !!g,
    staleTime: 20 * MIN,
    refetchInterval: 30 * MIN,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { lats, lons } = g!;
      const la: number[] = [], lo: number[] = [];
      lats.forEach((lat) => lons.forEach((lon) => { la.push(lat); lo.push(lon); }));
      const q = new URLSearchParams({
        latitude: la.join(","), longitude: lo.join(","), hourly: "wind_speed_10m,wind_direction_10m",
        models: "gfs_hrrr,ncep_nbm_conus", wind_speed_unit: "kn", timeformat: "unixtime", forecast_days: "7",
      });
      const res = await json(`https://api.open-meteo.com/v1/forecast?${q}`);
      return parseField(Array.isArray(res) ? res : [res], lats, lons);
    },
  });
};

/**
 * Every live wind reading around the spots: NOAA CO-OPS/PORTS sensors (6-minute) and airport
 * ASOS/AWOS via the Iowa Environmental Mesonet (about hourly). Both allow browser requests.
 */
export function useLiveStations() {
  const all = useSpots();
  const stations = useStations();
  const box = spotsBox(all);
  const coops = (stations.data ?? []).filter((s) => inBox(s.lat, s.lon, box));
  return useQuery({
    queryKey: ["live", box.west.toFixed(2), box.south.toFixed(2), box.east.toFixed(2), box.north.toFixed(2), coops.length],
    enabled: stations.isSuccess,
    staleTime: 3 * MIN,
    refetchInterval: 6 * MIN,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<LiveReading[]> => {
      const noaa = await Promise.allSettled(coops.map((s) =>
        json(stationUrl(s.id)).then(parseObservation).then((o): LiveReading => ({
          id: s.id, source: "noaa", name: s.name, lat: s.lat, lon: s.lon, speed: o.speed, gust: o.gust, dir: o.dir, t: o.t,
        }))));
      const air = await json(IEM_URL("FL_ASOS")).then(parseIem).catch(() => [] as LiveReading[]);
      const fresh = (r: LiveReading) => Date.now() - r.t < 6 * 3600e3;
      return [
        ...noaa.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
        ...air.filter((r) => inBox(r.lat, r.lon, box)),
      ].filter(fresh);
    },
  });
}

/* ---------- Spots: localStorage, same key/shape as v1 so saved spots carry over ---------- */

const KEY = "spots";
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
let spots: Spot[] = load();
const listeners = new Set<() => void>();

function load(): Spot[] {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (Array.isArray(s)) return s;
  } catch { /* private mode or corrupt: fall back to the seed */ }
  return TAMPA_BAY.map((s) => ({ ...s, id: uid() }));
}
function commit(next: Spot[]) {
  spots = next;
  try { localStorage.setItem(KEY, JSON.stringify(spots)); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}

export const spotStore = {
  add: (s: Omit<Spot, "id">) => { const spot = { ...s, id: uid() }; commit([...spots, spot]); return spot; },
  update: (id: string, patch: Partial<Spot>) => commit(spots.map((s) => (s.id === id ? { ...s, ...patch } : s))),
  remove: (id: string) => commit(spots.filter((s) => s.id !== id)),
};

export const useSpots = () =>
  useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => spots);
