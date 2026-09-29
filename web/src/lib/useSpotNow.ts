import { useForecast, useLiveStations, useObservation } from "./data";
import { distanceKm, nearestHour, nearestLive, rideState, rideableWindows, type Spot } from "./wind";

/** Everything a card or marker needs: best "now" reading, ride state, next window. */
export function useSpotNow(spot: Spot | undefined) {
  const fc = useForecast(spot);
  const ob = useObservation(spot?.station);
  const hours = fc.data?.hours ?? [];
  const model = nearestHour(hours, Date.now());
  const live = useLiveStations();
  // The spot's own station if it has one, else the nearest live sensor (within 16 km).
  const own = spot?.station ? live.data?.find((r) => r.id === spot.station) : undefined;
  const station = spot?.station && ob.data
    ? { name: ob.data.name, t: ob.data.t, speed: ob.data.speed, gust: ob.data.gust, dir: ob.data.dir,
        km: own ? distanceKm(spot.lat, spot.lon, own.lat, own.lon) : null }
    : spot && !spot.station && live.data ? nearestLive(live.data, spot.lat, spot.lon) : null;
  // Prefer a fresh station reading (< 90 min) over the model for "now".
  const fresh = station && Date.now() - station.t < 90 * 60_000 ? station : null;
  const now = fresh
    ? { speed: fresh.speed, gust: fresh.gust ?? fresh.speed, dir: fresh.dir, t: fresh.t, source: "live" as const, stationName: fresh.name, km: fresh.km }
    : model ? { ...model, source: "hrrr" as const, stationName: undefined, km: null } : null;
  const windows = spot ? rideableWindows(hours.filter((h) => h.t >= Date.now() - 3600e3), spot.min, spot.max) : [];
  return {
    fc, ob, model, now,
    ride: now && spot ? rideState(now.speed, spot) : null,
    next: windows[0] ?? null,
    windows,
  };
}

export function fmtWindow(w: { start: number; end: number }, tz: string) {
  const d = new Intl.DateTimeFormat([], { timeZone: tz, weekday: "short" });
  const t = new Intl.DateTimeFormat([], { timeZone: tz, hour: "numeric" });
  const today = d.format(Date.now()) === d.format(w.start);
  return `${today ? "Today" : d.format(w.start)} ${t.format(w.start)}–${t.format(w.end + 3600e3)}`;
}

export function ago(t: number) {
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  return m < 1 ? "just now" : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
