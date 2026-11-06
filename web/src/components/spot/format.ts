// Small copy helpers for the spot detail (en-US, in the spot's forecast time zone).
import { fmtDay, fmtHour, type Session } from "../../lib/session";
import { compass, MODEL_INFO, type Hour, type Spot } from "../../lib/wind";

/** A forecast hour as the hero's source line: "Sat 3 PM · HRRR forecast", "Today 3 PM · RRFS forecast". */
export const atLine = (h: Hour, tz: string, now = Date.now()) => `${fmtDay(h.t, tz, now)} ${fmtHour(h.t, tz)} · ${MODEL_INFO[h.model].label} forecast`;

/** The session's strongest hour (where picking it puts the charts' cursor). */
export const peakHour = (s: Session): Hour => s.hours.reduce((a, h) => (h.speed > a.speed ? h : a), s.hours[0]);

/** The direction chip: "SW ±45°", or "Any direction". The full arc ("SW ±45° (S–W)") goes in its title. */
export function dirChip(spot: Pick<Spot, "dirC" | "dirW">) {
  if (spot.dirC == null || spot.dirW == null || spot.dirW >= 360) return "Any direction";
  return `${compass(spot.dirC)} ±${Math.round(spot.dirW / 2)}°`;
}

/** "27.853° N, 82.552° W" */
export const fmtCoords = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(3)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(3)}° ${lon >= 0 ? "E" : "W"}`;

/** A failed fetch in plain words: Open-Meteo's daily limit, a server problem, or no connection. */
export function errorText(e: Error | null | undefined) {
  const m = e?.message ?? "";
  if (/\b429\b/.test(m)) return "Open-Meteo is busy (its daily limit). Try again in a few minutes.";
  if (/\b5\d\d\b/.test(m)) return "The forecast service is having trouble. Try again shortly.";
  if ((typeof navigator !== "undefined" && !navigator.onLine) || e instanceof TypeError) return "You look to be offline. Check the connection and try again.";
  return m || "Something went wrong.";
}
