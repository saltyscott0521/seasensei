import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
  buildGrid, forecastUrl, gridPoints, parseForecast, parseObservation, parseStations, stationUrl,
  STATIONS_URL, TAMPA_BAY, type Bounds, type Spot,
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

/** HRRR "current" wind for a grid of points covering the map view — one request, many points. */
export const useWindGrid = (bounds: Bounds | null) => {
  const g = bounds ? gridPoints(bounds) : null;
  return useQuery({
    queryKey: ["grid", g?.lats[0], g?.lons[0], g?.lats.length, g && g.lats[1] - g.lats[0]],
    enabled: !!g,
    staleTime: 10 * MIN,
    refetchInterval: 15 * MIN,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { lats, lons } = g!;
      const la: number[] = [], lo: number[] = [];
      lats.forEach((lat) => lons.forEach((lon) => { la.push(lat); lo.push(lon); }));
      const q = new URLSearchParams({
        latitude: la.join(","), longitude: lo.join(","),
        current: "wind_speed_10m,wind_direction_10m", wind_speed_unit: "kn", models: "gfs_hrrr",
      });
      const res = await json(`https://api.open-meteo.com/v1/forecast?${q}`);
      const arr = Array.isArray(res) ? res : [res];
      const pts = arr.map((r: any) => ({ speed: r.current?.wind_speed_10m ?? 0, dir: r.current?.wind_direction_10m ?? 0 }));
      return { grid: buildGrid(lats, lons, pts), time: arr[0]?.current?.time as string | undefined };
    },
  });
};

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
