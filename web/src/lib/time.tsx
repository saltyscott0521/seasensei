import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

// One clock: the timeline's selected hour (ms epoch), or null for now. Anything showing "the wind" for a
// time reads `useAt() ?? Date.now()`.
const AtContext = createContext<number | null>(null);

export function AtProvider({ at, children }: { at: number | null; children: ReactNode }) {
  return <AtContext.Provider value={at}>{children}</AtContext.Provider>;
}

export const useAt = (): number | null => useContext(AtContext);

// The wall clock to the minute, so verdicts ("On now", "On at 1 PM") move on without waiting for a refetch.
// One interval for every subscriber; the snapshot is a number, so it stays the same within a minute.
const MINUTE = 60_000;
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | undefined;
function subscribeClock(l: () => void) {
  clockListeners.add(l);
  clockTimer ??= setInterval(() => clockListeners.forEach((f) => f()), 15_000); // checked often, changes once a minute
  return () => {
    clockListeners.delete(l);
    if (!clockListeners.size && clockTimer) { clearInterval(clockTimer); clockTimer = undefined; }
  };
}
const minuteNow = () => Math.floor(Date.now() / MINUTE) * MINUTE;
const HOUR = 60 * MINUTE;
const hourNow = () => Math.floor(Date.now() / HOUR) * HOUR;

/** Date.now() floored to the minute; re-renders the caller when the minute changes. */
export const useNow = (): number => useSyncExternalStore(subscribeClock, minuteNow);

/** Date.now() floored to the hour; re-renders the caller once an hour (the timeline's "now" moves on with it). */
export const useHourNow = (): number => useSyncExternalStore(subscribeClock, hourNow);
