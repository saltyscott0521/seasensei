import { queryOptions, useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { DiscussionIndex, DiscussionResponse } from "./discussion";
import { useMemo, useSyncExternalStore } from "react";
import { applyNowcast, buildSensei, FALLBACK_CALIBRATION, nowcastQualifies, parseCalibration, type Calibration } from "./sensei";
import { NEARBY_MAX_KM, ownStation, type Sensor } from "./session";
import { useHourNow, useNow } from "./time";
import {
  carryOver, chainFor, chainForecast, compareSeries, DEFAULT_MODEL, distanceKm, gridPoints, IEM_URL, MODEL_INFO, nearestLive, parseField, parseObsSeries, parseSpotModels,
  PRIMARY_MODELS, SPOT_REQUESTS, spotModelsUrl, stationHistoryUrl, inBox, parseIem,
  parseObservation, parseStations, spotsBox, stationUrl, STATIONS_URL, TAMPA_BAY, type Bounds, type Forecast, type LiveReading, type Model, type ModelSeries,
  type Observation, type Spot, type Station,
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
    if (m && (PRIMARY_MODELS as string[]).includes(m)) return m as Model; // a saved choice wins over the default
  } catch { /* storage unavailable */ }
  return DEFAULT_MODEL;
})();
const modelListeners = new Set<() => void>();

export function setPrimaryModel(m: Model) {
  primary = m;
  try { localStorage.setItem(MODEL_KEY, m); } catch { /* storage unavailable */ }
  modelListeners.forEach((l) => l());
}
export const usePrimaryModel = () =>
  useSyncExternalStore((l) => (modelListeners.add(l), () => modelListeners.delete(l)), () => primary);

/* ---------- The calibration SeaSensei is tuned with (our server; the built-in one until, or unless, it arrives) ---------- */

/** Never blocks or blanks a forecast: without the server's file the models are blended as they are. */
export function useCalibration(): Calibration {
  const q = useQuery({
    queryKey: ["calibration"],
    queryFn: () => json("/api/calibration").then(parseCalibration),
    staleTime: 10 * MIN,
    refetchInterval: 30 * MIN,
    retry: 1,
  });
  return q.data ?? FALLBACK_CALIBRATION;
}

/* ---------- A spot's models: two Open-Meteo requests, shared by the forecast and the model comparison ---------- */

/**
 * Every raw model at a spot (see SPOT_REQUESTS for why it's two requests). Whichever primary model is chosen, and
 * for the Models chart too, this is all a spot costs. When one request fails (Open-Meteo rate-limits with 429) the
 * forecast is built from the other: models loaded earlier are carried over, and the query is marked `partial` so it
 * tries again soon. It only fails when nothing arrives at all, and then anything already on screen stays.
 */
export const spotModelsQuery = (spot: Pick<Spot, "lat" | "lon"> | undefined) =>
  queryOptions({
    queryKey: ["spot-models", spot?.lat, spot?.lon] as const,
    queryFn: async ({ client, queryKey }): Promise<ModelSeries> => {
      const res = await Promise.allSettled(SPOT_REQUESTS.map((r) => json(spotModelsUrl(spot!.lat, spot!.lon, r))));
      const failed = res.find((r) => r.status === "rejected");
      if (res.every((r) => r.status === "rejected")) throw failed!.reason;
      const fresh = parseSpotModels(res.map((r, i) => ({ json: r.status === "fulfilled" ? r.value : null, models: SPOT_REQUESTS[i].models })));
      if (!failed) return fresh;
      const prev = client.getQueryData<ModelSeries>(queryKey);
      return { ...(prev ? carryOver(fresh, prev) : fresh), partial: true, error: String(failed.reason?.message ?? failed.reason) };
    },
    enabled: !!spot,
    staleTime: 15 * MIN,
    refetchInterval: (q) => (q.state.data?.partial ? 2 * MIN : 30 * MIN),
    placeholderData: (prev) => prev,
  });

// One built forecast per (payload, model, calibration, hour), shared by every card, marker and chart of a spot.
const built = new WeakMap<ModelSeries, { model: Model; cal: Calibration; hour: number; lat: number; lon: number; forecast: Forecast }[]>();

/** A spot's forecast for a primary model from its models: SeaSensei's blend, or a raw model's chain. */
export function forecastFrom(series: ModelSeries, model: Model, cal: Calibration, spot: Pick<Spot, "lat" | "lon">, hour: number): Forecast {
  let list = built.get(series);
  if (!list) built.set(series, (list = []));
  const hit = list.find((e) => e.model === model && (model !== "sensei" || (e.cal === cal && e.hour === hour && e.lat === spot.lat && e.lon === spot.lon)));
  if (hit) return hit.forecast;
  const forecast = model === "sensei"
    ? { timeZone: series.timeZone, hours: buildSensei(series, cal, spot, hour) }
    : chainForecast(series, model);
  if (list.length > 12) list.length = 0;
  list.push({ model, cal, hour, lat: spot.lat, lon: spot.lon, forecast });
  return forecast;
}

/**
 * The sensor behind a spot's "now": its own station; in auto mode (no station set) the nearest live sensor within
 * 16 km; nothing for "none" (forecast only). Not necessarily fresh: callers check its age.
 */
export function sensorFor(spot: Spot | undefined, ob: Observation | undefined, live: LiveReading[] | undefined, stations: Station[] | undefined): Sensor | null {
  if (!spot) return null;
  const own = ownStation(spot);
  if (own && ob) {
    const at = stations?.find((s) => s.id === own) ?? live?.find((r) => r.id === own);
    return { kind: "station", id: own, name: ob.name, t: ob.t, speed: ob.speed, gust: ob.gust, dir: ob.dir, km: at ? distanceKm(spot.lat, spot.lon, at.lat, at.lon) : null };
  }
  if (!spot.station && live) {
    const n = nearestLive(live, spot.lat, spot.lon, NEARBY_MAX_KM);
    if (n) return { kind: "nearby", id: n.id, name: n.name, t: n.t, speed: n.speed, gust: n.gust, dir: n.dir, km: n.km };
  }
  return null;
}

/** SeaSensei hours bent toward a qualifying sensor reading (see sensei.ts); any other forecast comes back as it is. */
function withNowcast(fc: Forecast, sensor: Sensor | null, cal: Calibration, hour: number): Forecast {
  if (!sensor || fc.hours[0]?.model !== "sensei" || !nowcastQualifies(sensor)) return fc;
  const hours = applyNowcast(fc.hours, sensor, cal.nowcast, Math.max(sensor.t, hour));
  return hours === fc.hours ? fc : { ...fc, hours };
}

export type ForecastResult = {
  /** The forecast as shown: for SeaSensei, bent toward a fresh sensor reading. */
  data: Forecast | undefined;
  /** The same forecast before the sensor's correction (what the model said). */
  base: Forecast | undefined;
  /** No forecast yet. */
  isPending: boolean;
  /** Nothing to show: every request failed and nothing was loaded before. */
  isError: boolean;
  error: Error | null;
  isFetching: boolean;
  status: "pending" | "error" | "success";
  refetch: () => unknown;
};

type QueryBits = { data: ModelSeries | undefined; error: Error | null; isFetching: boolean; refetch: () => unknown };

function toResult(q: QueryBits, spot: Spot | undefined, model: Model, cal: Calibration, sensor: Sensor | null, hour: number): ForecastResult {
  let base = q.data && spot ? forecastFrom(q.data, model, cal, spot, hour) : undefined;
  let error = q.error;
  // A raw model whose request failed, with nothing loaded earlier: say so instead of drawing an empty forecast.
  if (base && !base.hours.length) { base = undefined; error ??= new Error(q.data?.error ?? "No forecast data"); }
  const isError = !base && !!error;
  return {
    base, data: base && withNowcast(base, sensor, cal, hour),
    isPending: !base && !isError, isError, error: isError ? error : null, isFetching: q.isFetching,
    status: base ? "success" : isError ? "error" : "pending", refetch: q.refetch,
  };
}

/** One spot's forecast for a given model, with the nowcast. Memoised, so `data` keeps its identity between renders. */
function useSpotForecast(spot: Spot | undefined, model: Model, enabled = true): ForecastResult {
  const cal = useCalibration();
  const hour = useHourNow();
  const minute = useNow(); // a reading stops qualifying as it ages
  const { data, error, isFetching, refetch } = useQuery({ ...spotModelsQuery(spot), enabled: !!spot && enabled });
  const sensor = useSensor(enabled ? spot : undefined);
  const live = nowcastQualifies(sensor, minute) ? sensor : null;
  const [kind, t, speed, km] = [live?.kind, live?.t, live?.speed, live?.km];
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the sensor by its values, not its identity
  return useMemo(() => toResult({ data, error, isFetching, refetch }, spot, model, cal, live, hour), [data, error, isFetching, refetch, spot, model, cal, hour, kind, t, speed, km]);
}

/** The forecast for a spot with the rider's primary model: SeaSensei unless they picked a raw one. */
export const useForecast = (spot: Spot | undefined) => useSpotForecast(spot, usePrimaryModel());

/** Every spot's forecast at once (the board's ranking); shares each spot's queries with its card. */
export function useForecasts(spots: Spot[]): ForecastResult[] {
  const model = usePrimaryModel();
  const cal = useCalibration();
  const hour = useHourNow();
  const minute = useNow();
  const live = useLiveStations().data;
  const stations = useStations().data;
  const series = useQueries({ queries: spots.map((s) => spotModelsQuery(s)), combine: pickSeries });
  // One query per station (two spots may share one; spots without one ask nothing).
  const own = useMemo(() => [...new Set(spots.flatMap((s) => ownStation(s) ?? []))], [spots]);
  const obs = useQueries({ queries: own.map((id) => observationQuery(id)), combine: pickData });
  return useMemo(() => spots.map((spot, i) => {
    const id = ownStation(spot);
    const sensor = sensorFor(spot, id ? obs[own.indexOf(id)] : undefined, live, stations);
    return toResult(series[i], spot, model, cal, nowcastQualifies(sensor, minute) ? sensor : null, hour);
  }), [spots, series, own, obs, live, stations, model, cal, hour, minute]);
}

// Stable combiners, so useQueries hands back the same array until a result changes.
const pickSeries = (rs: UseQueryResult<ModelSeries>[]) => rs.map((r): QueryBits => ({ data: r.data, error: r.error, isFetching: r.isFetching, refetch: r.refetch }));
const pickData = (rs: UseQueryResult<Observation>[]) => rs.map((r) => r.data);

const observationQuery = (station: string | undefined) =>
  queryOptions({
    queryKey: ["obs", station],
    queryFn: () => json(stationUrl(station!)).then(parseObservation),
    enabled: !!station,
    staleTime: 2 * MIN,
    refetchInterval: 6 * MIN,
    retry: 1,
  });

export const useObservation = (station: string | undefined) => useQuery(observationQuery(station));

/** The sensor behind a spot's "now" (see sensorFor). */
export function useSensor(spot: Spot | undefined): Sensor | null {
  const ob = useObservation(ownStation(spot)).data;
  const live = useLiveStations().data;
  const stations = useStations().data;
  return useMemo(() => sensorFor(spot, ob, live, stations), [spot, ob, live, stations]);
}

export const useStations = () =>
  useQuery({ queryKey: ["stations"], queryFn: () => json(STATIONS_URL).then(parseStations), staleTime: Infinity, gcTime: Infinity });

/**
 * A week of hourly wind for a grid over the map view, in ONE request (the primary model's chain, e.g. HRRR → RRFS → NBM;
 * SeaSensei is a per-spot blend, so under it the map draws HRRR's chain).
 * Scrubbing time is then local and instant. (Fetching hour by hour would cost ~50 Open-Meteo
 * "calls" per step — a single play-through would blow the free daily quota.)
 */
export const useWindField = (bounds: Bounds | null) => {
  const model = usePrimaryModel();
  const g = bounds ? gridPoints(bounds, 5) : null;
  return useQuery({
    queryKey: ["field", chainFor(model).join(), g?.lats[0], g?.lons[0], g?.lats.length, g && g.lats[1] - g.lats[0]],
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

/**
 * SeaSensei and the five raw models side by side for one spot. No request of its own: it reads the spot's models
 * (the same two requests as its forecast), so the board's confidence and the Models chart come for free.
 */
export function useModelCompare(spot: Spot | undefined, enabled = true) {
  const on = !!spot && enabled;
  const q = useQuery({ ...spotModelsQuery(spot), enabled: on });
  const sensei = useSpotForecast(spot, "sensei", on).data;
  const series = on ? q.data : undefined;
  const data = useMemo(() => (series ? compareSeries(series, sensei?.hours) : undefined), [series, sensei]);
  return { data, isPending: !data && !q.isError, isError: !data && q.isError, refetch: q.refetch };
}

/** The model comparison for the open spot detail (session confidence, the Models chart). */
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
