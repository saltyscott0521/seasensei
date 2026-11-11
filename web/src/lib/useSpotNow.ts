import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useForecast, useForecasts, useLiveStations, useObservation, useSensor, useSpots, useStations } from "./data";
import { FRESH_MS, LIVE_MS, nowVerdict, ownStation, rankSpots, sessions, verdict, type NowSource, type OwnReading, type Session, type Verdict } from "./session";
import { useAt, useNow } from "./time";
import { distanceKm, nearestHour, nearestLive, rideState, type Forecast, type Hour, type Observation, type Spot } from "./wind";

export { ago, fmtWindow } from "./session";

const HOUR = 3600e3;
const EMPTY: Hour[] = [];

/** Did the forecast, before any sensor bent it, have a session in progress at `now`? */
const sessionAt = (hours: Hour[], spot: Spot, now: number) => sessions(hours, spot, { from: now }).some((s) => s.start <= now);

/**
 * The engine's verdict checked against the wind right now (see nowVerdict): `shown` is the forecast as shown, `base`
 * the same before the sensor's correction, `reading` the spot's own station (nothing else may overrule the forecast).
 */
function checked(spot: Spot, shown: Forecast, base: Forecast | undefined, list: Session[], reading: OwnReading | null | undefined, now: number) {
  const v = verdict(spot, shown.hours, list, now, shown.timeZone);
  const live = reading && now - reading.t <= LIVE_MS ? reading : null;
  const hour = nearestHour(base?.hours ?? shown.hours, now);
  return nowVerdict(v, {
    spot, hours: shown.hours, now, tz: shown.timeZone, reading: live,
    forecastOn: live ? sessionAt((base ?? shown).hours, spot, now) : v.state === "on",
    forecastSpeed: hour && Math.abs(hour.t - now) <= HOUR ? hour.speed : null,
  });
}

/**
 * Everything a card, marker or the detail needs about one spot: the best "now" reading and where it came from,
 * its daylight sessions from now on, and the verdict. Called by every card, marker and the detail; queries dedupe.
 * `fc.data` is the forecast as shown (SeaSensei bends toward a fresh sensor reading); `model` is what the forecast
 * said for this hour before that, so it can be compared with the reading.
 */
export function useSpotNow(spot: Spot | undefined) {
  const clock = useNow();
  const at = useAt();
  const fc = useForecast(spot);
  const ob = useObservation(ownStation(spot));
  const hours = fc.data?.hours ?? EMPTY;
  const model = nearestHour(fc.base?.hours ?? EMPTY, Date.now());

  // The sensor behind "now": the spot's own station; in auto mode (no station set) the nearest live sensor
  // within 16 km; nothing for "none" (forecast only).
  const sensor = useSensor(spot);
  // Prefer a fresh reading (< 90 min) over the model for "now".
  const fresh = sensor && Date.now() - sensor.t < FRESH_MS ? sensor : null;
  const source: NowSource = fresh ? fresh.kind : "model";
  // `now.source` stays "live" | "model" for existing callers ("live" = any fresh sensor); `source` tells station from nearby.
  const now = fresh
    ? { speed: fresh.speed, gust: fresh.gust ?? fresh.speed, dir: fresh.dir, t: fresh.t, source: "live" as const, stationName: fresh.name, km: fresh.km }
    : model ? { ...model, source: "model" as const, stationName: undefined, km: null } : null;

  const all = useMemo(() => (spot ? sessions(hours, spot) : []), [hours, spot]);
  const upcoming = useMemo(() => all.filter((s) => s.end + HOUR > clock), [all, clock]);
  // The verdict, checked against the spot's own station (a nearby sensor never changes it).
  const own = fresh?.kind === "station" ? fresh : null;
  const [ownT, ownSpeed, ownDir] = [own?.t, own?.speed, own?.dir];
  const shownFc = fc.data, baseFc = fc.base;
  const pill = useMemo(
    () => (spot && shownFc ? checked(spot, shownFc, baseFc, upcoming, ownT != null ? { t: ownT, speed: ownSpeed!, dir: ownDir! } : null, clock) : null),
    [spot, shownFc, baseFc, upcoming, ownT, ownSpeed, ownDir, clock]);
  const v = pill?.verdict ?? null;

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
    /** The answer in the engine's four states, already checked against the spot's own station (ranking, the map). */
    verdict: v,
    /** The same answer as the card and the hero say it: "On now · 18 kn at the sensor · till 4 PM", "Too light now · …". */
    pill,
    /** Is `now` a reading fresh enough (≤ 30 min) to be called live? An older one is shown with its age. */
    live: !!fresh && Date.now() - fresh.t <= LIVE_MS,
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
  /** null until the forecast arrives. Checked against the spot's own station: a sensor that reads rideable makes it "on". */
  verdict: Verdict | null;
};

// The spots' own stations as the cards already fetch them: observers of the same cache entries that never fetch themselves.
const pickObs = (rs: { data: unknown }[]) => rs.map((r) => r.data as Observation | undefined);

/** Every spot with its sessions and verdict, best first (see rankSpots). Shares each spot's forecast queries with its card. */
export function useRankedSpots(): RankedSpot[] {
  const spots = useSpots();
  const clock = useNow();
  const results = useForecasts(spots);
  const own = useMemo(() => [...new Set(spots.flatMap((s) => ownStation(s) ?? []))], [spots]);
  const obs = useQueries({ queries: own.map((id) => ({ queryKey: ["obs", id], enabled: false })), combine: pickObs });
  return useMemo(() => rankSpots(spots.map((spot, i): RankedSpot => {
    const forecast = results[i]?.data;
    const list = forecast ? sessions(forecast.hours, spot, { from: clock }) : [];
    const id = ownStation(spot);
    return {
      spot, forecast, status: results[i]?.status ?? "pending", sessions: list,
      verdict: forecast ? checked(spot, forecast, results[i]?.base, list, id ? obs[own.indexOf(id)] : null, clock).verdict : null,
    };
  })), [spots, results, own, obs, clock]);
}
