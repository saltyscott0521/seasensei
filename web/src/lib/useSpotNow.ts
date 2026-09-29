import { useForecast, useObservation } from "./data";
import { nearestHour, rideState, rideableWindows, type Spot } from "./wind";

/** Everything a card or marker needs: best "now" reading, ride state, next window. */
export function useSpotNow(spot: Spot | undefined) {
  const fc = useForecast(spot);
  const ob = useObservation(spot?.station);
  const hours = fc.data?.hours ?? [];
  const model = nearestHour(hours, Date.now());
  // Prefer a fresh station reading (< 90 min) over the model for "now".
  const fresh = ob.data && Date.now() - ob.data.t < 90 * 60_000 ? ob.data : null;
  const now = fresh ? { ...fresh, source: "live" as const } : model ? { ...model, source: "hrrr" as const } : null;
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
