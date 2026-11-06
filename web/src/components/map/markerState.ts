import { isDaylightHour, type Session, type Verdict } from "../../lib/session";
import { rideState, type Hour, type Spot } from "../../lib/wind";

/**
 * What a spot marker's ring says, in the app's one verdict colour mapping (the same as the verdict pills). It is
 * always paired with a glyph on the marker and a word in its label and accessible name, never colour alone.
 *   go       rideable: On now (solid, a check), a full session later today (hollow, a clock), or the shown hour is
 *            inside a session
 *   soon     marginal: in range in daylight but too short a window to count (scrubbed hours only)
 *   strong   too strong (now, or at the shown hour)
 *   wrongdir the right speed from outside the spot's directions (at the shown hour)
 *   off      nothing to ride today: next session another day (a calendar), too light, after dark, or no data yet
 */
export type MarkerTone = "go" | "soon" | "strong" | "wrongdir" | "off";
export type MarkerGlyph = "check" | "clock" | "calendar" | "up" | "offdir" | "short" | null;

export type MarkerState = {
  tone: MarkerTone;
  word: string;
  /** A few soft pulses: the spot is on right now. */
  pulse: boolean;
  glyph: MarkerGlyph;
  /** The outline treatment: the right tone, but not on yet (on later today). */
  hollow: boolean;
};

const HOUR = 3600e3;
const state = (tone: MarkerTone, word: string, glyph: MarkerGlyph, extra: Partial<MarkerState> = {}): MarkerState =>
  ({ tone, word, glyph, pulse: false, hollow: false, ...extra });

/**
 * Now (at == null): the session engine's verdict, except that wind that is too strong right now is flagged as such,
 * even inside a forecast session (a live sensor reading over the spot's max must never read as a green "On now").
 * Scrubbed (at != null): the shown forecast hour on its own terms, so the ring always matches the number beside it.
 */
export function markerState(spot: Spot, shown: Pick<Hour, "speed" | "dir"> | null, opts: {
  at: number | null; hour: Hour | null; verdict: Verdict | null; sessions: Session[];
}): MarkerState {
  const { at, hour, verdict, sessions } = opts;
  if (at != null) {
    if (!hour) return state("off", "no forecast for this hour", null);
    if (sessions.some((s) => hour.t >= s.start && hour.t < s.end + HOUR)) return state("go", "rideable", "check");
    const ride = rideState(hour.speed, spot, hour.dir);
    if (ride === "above") return state("strong", "too strong", "up");
    if (ride === "offdir") return state("wrongdir", "wrong direction", "offdir");
    if (ride === "below") return state("off", "too light", null);
    // In range but not a session: after dark, or too short a window to count.
    return isDaylightHour(spot.lat, spot.lon, hour.t) ? state("soon", "short window", "short") : state("off", "after dark", null);
  }
  if (!verdict) return state("off", "loading", null);
  if (shown && rideState(shown.speed, spot) === "above") return state("strong", "Too strong now", "up");
  if (verdict.state === "on") return state("go", verdict.label, "check", { pulse: true });
  if (verdict.state === "today") return state("go", verdict.label, "clock", { hollow: true });
  if (verdict.state === "upcoming") return state("off", verdict.label, "calendar");
  return state("off", verdict.label, null);
}

/** Ring + pointer colour per tone (literal class names, so Tailwind sees them). */
export const TONE_RING: Record<MarkerTone, string> = {
  go: "ring-go",
  soon: "ring-soon",
  strong: "ring-strong",
  wrongdir: "ring-wrongdir",
  off: "ring-off",
};
export const TONE_TIP: Record<MarkerTone, string> = {
  go: "border-t-go",
  soon: "border-t-soon",
  strong: "border-t-strong",
  wrongdir: "border-t-wrongdir",
  off: "border-t-off",
};
export const TONE_BG: Record<MarkerTone, string> = {
  go: "bg-go",
  soon: "bg-soon",
  strong: "bg-strong",
  wrongdir: "bg-wrongdir",
  off: "bg-off",
};
/** Text in the verdict colour; `off` is too dark for text, so it reads in fg-3. */
export const TONE_TEXT: Record<MarkerTone, string> = {
  go: "text-go",
  soon: "text-soon",
  strong: "text-strong",
  wrongdir: "text-wrongdir",
  off: "text-fg-3",
};

/** The word, with its first letter capitalised, for the visible label. */
export const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
