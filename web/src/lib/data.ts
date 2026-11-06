import { queryOptions, useQuery } from "@tanstack/react-query";
import type { DiscussionIndex, DiscussionResponse } from "./discussion";
import { useSyncExternalStore } from "react";
import {
  chainFor, forecastUrl, gridPoints, IEM_URL, MODEL_INFO, modelsUrl, parseField, parseModels, parseObsSeries, PRIMARY_MODELS, stationHistoryUrl, inBox, parseForecast, parseIem,
  parseObservation, parseStations, spotsBox, stationUrl, STATIONS_URL, TAMPA_BAY, type Bounds, type LiveReading, type Model, type Spot,
} from "./wind";

async function json(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const MIN = 60_000;

/* ---------- Primary model: which forecast leads everywhere (kept in localStorage) ---------- */

const MODEL_KEY = "primaryModel";
let primary: Model = (() => {
  try {
    const m = localStorage.getItem(MODEL_KEY);
    if (m && (PRIMARY_MODELS as string[]).includes(m)) return m as Model;
  } catch { /* storage unavailable */ }
  return "hrrr";
})();
const modelListeners = new Set<() => void>();

export function setPrimaryModel(m: Model) {
  primary = m;
  try { localStorage.setItem(MODEL_KEY, m); } catch { /* storage unavailable */ }
  modelListeners.forEach((l) => l());
}
export const usePrimaryModel = () =>
  useSyncExternalStore((l) => (modelListeners.add(l), () => modelListeners.delete(l)), () => primary);

/** One spot's forecast for a primary model. Shared by useForecast and useRankedSpots so their queries dedupe. */
export const forecastQuery = (model: Model, spot: Pick<Spot, "lat" | "lon"> | undefined) =>
  queryOptions({
    queryKey: ["forecast", model, spot?.lat, spot?.lon],
    queryFn: () => json(forecastUrl(spot!.lat, spot!.lon, model)).then((j) => parseForecast(j, model)),
    enabled: !!spot,
    staleTime: 15 * MIN,
    refetchInterval: 30 * MIN,
    placeholderData: (prev) => prev,
  });

export const useForecast = (spot: Spot | undefined) => {
  const model = usePrimaryModel();
  return useQuery(forecastQuery(model, spot));
};

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
 * A week of hourly wind for a grid over the map view, in ONE request (the primary model's chain, e.g. HRRR → RRFS → NBM).
 * Scrubbing time is then local and instant. (Fetching hour by hour would cost ~50 Open-Meteo
 * "calls" per step — a single play-through would blow the free daily quota.)
 */
export const useWindField = (bounds: Bounds | null) => {
  const model = usePrimaryModel();
  const g = bounds ? gridPoints(bounds, 5) : null;
  return useQuery({
    queryKey: ["field", model, g?.lats[0], g?.lons[0], g?.lats.length, g && g.lats[1] - g.lats[0]],
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
        models: chainFor(model).map((m) => MODEL_INFO[m].key).join(","), wind_speed_unit: "kn", timeformat: "unixtime", forecast_days: "7",
      });
      const res = await json(`https://api.open-meteo.com/v1/forecast?${q}`);
      return parseField(Array.isArray(res) ? res : [res], lats, lons, model);
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

/** Last 24 h of 6-minute readings from one NOAA station. */
export const useObsHistory = (station: string | undefined) =>
  useQuery({
    queryKey: ["obs-history", station],
    queryFn: () => json(stationHistoryUrl(station!, 24)).then(parseObsSeries),
    enabled: !!station,
    staleTime: 5 * MIN,
    refetchInterval: 10 * MIN,
    retry: 1,
  });

/** HRRR, RRFS, NBM, ECMWF and GFS side by side for one spot (one request). */
export const useModelCompare = (spot: Spot | undefined, enabled = true) =>
  useQuery({
    queryKey: ["models", spot?.lat, spot?.lon],
    queryFn: () => json(modelsUrl(spot!.lat, spot!.lon)).then(parseModels),
    enabled: !!spot && enabled,
    staleTime: 20 * MIN,
  });

/**
 * The model comparison for the open spot detail, fetched as soon as it opens (not only on the Models tab) so
 * session confidence (`confidence()` in session.ts) is ready. Call it only where one spot is open: it costs an
 * Open-Meteo request per spot.
 */
export const useSpotModelCompare = (spot: Spot | undefined) => useModelCompare(spot, true);

/**
 * The daily wind discussion (written once a day on the server, see server/publish.mjs). Without a date it
 * is the latest one. It changes at most daily, so this is cheap to keep fresh.
 */
async function api<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
export const useDiscussion = (date?: string | null) =>
  useQuery<DiscussionResponse>({
    queryKey: ["discussion", date ?? "latest"],
    queryFn: () => api(`/api/discussion${date ? `?date=${encodeURIComponent(date)}` : ""}`),
    staleTime: 15 * MIN,
    refetchInterval: 30 * MIN,
    retry: 1,
  });

export const useDiscussionIndex = (enabled: boolean) =>
  useQuery<DiscussionIndex>({ queryKey: ["discussions"], queryFn: () => api("/api/discussions"), enabled, staleTime: 15 * MIN });

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
  // Stable ids for the seed spots, so a ?spot= link or a reload finds the same spot before anything is saved.
  return TAMPA_BAY.map((s) => ({ ...s, id: `seed-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` }));
}
function commit(next: Spot[]) {
  spots = next;
  try { localStorage.setItem(KEY, JSON.stringify(spots)); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}

export const spotStore = {
  add: (s: Omit<Spot, "id">) => { const spot = { ...s, id: uid() }; commit([...spots, spot]); return spot; },
  update: (id: string, patch: Partial<Spot>) => commit(spots.map((s) => (s.id === id ? { ...s, ...patch } : s))),
  /** Removes a spot and returns where it was, so `restore` can put it back in the same place. */
  remove: (id: string) => { const i = spots.findIndex((s) => s.id === id); commit(spots.filter((s) => s.id !== id)); return i; },
  /** Puts a removed spot back (same id, same position): the Undo after a delete. */
  restore: (spot: Spot, index = spots.length) => {
    if (spots.some((s) => s.id === spot.id)) return;
    const next = [...spots];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, spot);
    commit(next);
  },
};

export const useSpots = () =>
  useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => spots);
