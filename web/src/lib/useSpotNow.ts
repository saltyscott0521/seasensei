import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import { forecastQuery, useForecast, useLiveStations, useObservation, usePrimaryModel, useSpots, useStations } from "./data";
import { FRESH_MS, NEARBY_MAX_KM, ownStation, rankSpots, sessions, verdict, type NowSource, type Sensor, type Session, type Verdict } from "./session";
import { useAt, useNow } from "./time";
import { distanceKm, nearestHour, nearestLive, rideState, type Forecast, type Hour, type Spot } from "./wind";

export { ago, fmtWindow } from "./session";

const HOUR = 3600e3;
const EMPTY: Hour[] = [];

/**
 * Everything a card, marker or the detail needs about one spot: the best "now" reading and where it came from,
 * its daylight sessions from now on, and the verdict. Called by every card, marker and the detail; queries dedupe.
 */
export function useSpotNow(spot: Spot | undefined) {
  const clock = useNow();
  const at = useAt();
  const fc = useForecast(spot);
  const own = ownStation(spot);
  const ob = useObservation(own);
  const live = useLiveStations();
  const stations = useStations();
  const hours = fc.data?.hours ?? EMPTY;
  const model = nearestHour(hours, Date.now());

  // The sensor behind "now": the spot's own station; in auto mode (no station set) the nearest live sensor
  // within 16 km; nothing for "none" (forecast only).
  const ownAt = own ? (stations.data?.find((s) => s.id === own) ?? live.data?.find((r) => r.id === own)) : undefined;
  let sensor: Sensor | null = null;
  if (spot && own && ob.data) {
    sensor = { kind: "station", id: own, name: ob.data.name, t: ob.data.t, speed: ob.data.speed, gust: ob.data.gust, dir: ob.data.dir,
      km: ownAt ? distanceKm(spot.lat, spot.lon, ownAt.lat, ownAt.lon) : null };
  } else if (spot && !spot.station && live.data) {
    const n = nearestLive(live.data, spot.lat, spot.lon, NEARBY_MAX_KM);
    if (n) sensor = { kind: "nearby", id: n.id, name: n.name, t: n.t, speed: n.speed, gust: n.gust, dir: n.dir, km: n.km };
  }
  // Prefer a fresh reading (< 90 min) over the model for "now".
  const fresh = sensor && Date.now() - sensor.t < FRESH_MS ? sensor : null;
  const source: NowSource = fresh ? fresh.kind : "model";
  // `now.source` stays "live" | "model" for existing callers ("live" = any fresh sensor); `source` tells station from nearby.
  const now = fresh
    ? { speed: fresh.speed, gust: fresh.gust ?? fresh.speed, dir: fresh.dir, t: fresh.t, source: "live" as const, stationName: fresh.name, km: fresh.km }
    : model ? { ...model, source: "model" as const, stationName: undefined, km: null } : null;

  const all = useMemo(() => (spot ? sessions(hours, spot) : []), [hours, spot]);
  const upcoming = useMemo(() => all.filter((s) => s.end + HOUR > clock), [all, clock]);
  const tz = fc.data?.timeZone;
  const v = useMemo(() => (spot && tz ? verdict(spot, hours, upcoming, clock, tz) : null), [spot, tz, hours, upcoming, clock]);

  // The timeline's hour (one clock): the forecast at `at`, else now.
  const atHour = at != null ? nearestHour(hours, at) : null;
  return {
    fc, ob, model, now,
    ride: now && spot ? rideState(now.speed, spot, now.dir) : null,
    /** The session in progress, else the next one. */
    next: upcoming[0] ?? null,
    /** Same as `sessions` (Session extends Window), kept for existing callers. */
    windows: upcoming,
    /** Daylight sessions ≥ 2 h that haven't ended, chronological. */
    sessions: upcoming,
    verdict: v,
    /** Where `now` came from: the spot's own station, a nearby sensor (auto), or the model. */
    source,
    /** The fresh sensor reading behind `now` (null when source is "model"). */
    sensor: fresh,
    km: fresh?.km ?? null,
    ageMs: fresh ? Math.max(0, Date.now() - fresh.t) : null,
    at, atHour,
    /** What to show for the timeline's hour: the forecast hour at `at`, else `now`. */
    shown: at != null ? atHour : now,
  };
}

/**
 * The NOAA sensor to judge a spot's forecast against: its own station, else (auto or forecast-only) the nearest NOAA
 * sensor within 25 km. It only scores the model; it is never shown as "now". Airports report hourly, so they aren't used.
 */
export function useReferenceStation(spot: Spot | undefined) {
  const live = useLiveStations();
  const stations = useStations();
  if (!spot) return null;
  const own = ownStation(spot);
  if (own) {
    const at = stations.data?.find((s) => s.id === own) ?? live.data?.find((r) => r.id === own);
    const name = live.data?.find((r) => r.id === own)?.name ?? at?.name ?? `Station ${own}`;
    return { id: own, name, km: at ? distanceKm(spot.lat, spot.lon, at.lat, at.lon) : 0 };
  }
  const near = nearestLive((live.data ?? []).filter((r) => r.source === "noaa"), spot.lat, spot.lon, 25);
  return near ? { id: near.id, name: near.name, km: near.km } : null;
}

export type RankedSpot = {
  spot: Spot;
  forecast: Forecast | undefined;
  status: "pending" | "error" | "success";
  /** Daylight sessions that haven't ended. */
  sessions: Session[];
  /** null until the forecast arrives. */
  verdict: Verdict | null;
};

const pick = (rs: UseQueryResult<Forecast>[]) => rs.map((r) => ({ data: r.data, status: r.status }));

/** Every spot with its sessions and verdict, best first (see rankSpots). Shares each spot's forecast query with its card. */
export function useRankedSpots(): RankedSpot[] {
  const spots = useSpots();
  const model = usePrimaryModel();
  const clock = useNow();
  const results = useQueries({ queries: spots.map((s) => forecastQuery(model, s)), combine: pick });
  return useMemo(() => rankSpots(spots.map((spot, i): RankedSpot => {
    const forecast = results[i]?.data;
    const list = forecast ? sessions(forecast.hours, spot, { from: clock }) : [];
    return { spot, forecast, status: results[i]?.status ?? "pending", sessions: list, verdict: forecast ? verdict(spot, forecast.hours, list, clock, forecast.timeZone) : null };
  })), [spots, results, clock]);
}
