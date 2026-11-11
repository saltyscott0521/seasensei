import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useSyncExternalStore } from "react";
import { useNow } from "./time";

/**
 * How old the forecast on screen is, and whether it is being refreshed. The board can come from the saved cache
 * (lib/persist.ts) or from before the signal dropped: whenever it is older than it would normally be, the status
 * line says so ("Updated 3 h ago · offline") instead of calling it "Now".
 */
export type Freshness = {
  /** When the oldest forecast on screen was fetched (ms), or null with none loaded. */
  updatedAt: number | null;
  /** Older than a normal refresh cycle. */
  old: boolean;
  /** The browser has a connection. */
  online: boolean;
  /** A refresh is under way: the first attempt, or another after one failed. */
  trying: "refreshing" | "retrying" | null;
};

/** Forecasts refresh every 30 min; past this they are older than they should be. */
export const FRESH_FOR = 45 * 60_000;
/** The queries whose age is "the board's age": every spot's models and the map's wind field. */
const KINDS = new Set(["spot-models", "field"]);

type Snap = { updatedAt: number | null; fetching: boolean; failing: boolean };

function read(client: QueryClient): Snap {
  let updatedAt: number | null = null, fetching = false, failing = false;
  for (const q of client.getQueryCache().getAll()) {
    if (!KINDS.has(String(q.queryKey[0])) || !q.getObserversCount()) continue; // only what is on screen
    const s = q.state;
    if (s.data !== undefined && s.dataUpdatedAt) updatedAt = updatedAt == null ? s.dataUpdatedAt : Math.min(updatedAt, s.dataUpdatedAt);
    if (s.fetchStatus === "fetching") fetching = true;
    if (s.status === "error" || s.fetchFailureCount > 0) failing = true;
  }
  return { updatedAt, fetching, failing };
}

const subscribeOnline = (l: () => void) => {
  window.addEventListener("online", l);
  window.addEventListener("offline", l);
  return () => { window.removeEventListener("online", l); window.removeEventListener("offline", l); };
};
/** navigator.onLine, live. False is reliable (no network at all); true only means there is a link. */
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine);

export function useFreshness(): Freshness {
  const client = useQueryClient();
  const snap = useRef<Snap>({ updatedAt: null, fetching: false, failing: false });
  const get = useCallback(() => {
    const next = read(client), cur = snap.current;
    if (next.updatedAt !== cur.updatedAt || next.fetching !== cur.fetching || next.failing !== cur.failing) snap.current = next;
    return snap.current;
  }, [client]);
  // The cache also reports from inside other components' renders (a query being created): pass it on a beat later,
  // and once for a burst of events.
  const subscribe = useCallback((l: () => void) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = client.getQueryCache().subscribe(() => { timer ??= setTimeout(() => { timer = undefined; l(); }, 0); });
    return () => { off(); clearTimeout(timer); };
  }, [client]);
  const { updatedAt, fetching, failing } = useSyncExternalStore(subscribe, get);
  const online = useOnline();
  useNow(); // re-read the age as the minutes pass
  const old = updatedAt != null && Date.now() - updatedAt > FRESH_FOR;
  return { updatedAt, old, online, trying: !online ? null : failing ? "retrying" : fetching ? "refreshing" : null };
}

/** "3 h ago", "50 min ago" (never "just now": this is only said of data that is old). */
export function fmtAge(t: number, now = Date.now()) {
  const m = Math.max(1, Math.round((now - t) / 60_000));
  return m < 90 ? `${m} min ago` : m < 36 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}
