import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * The last known board, kept in localStorage: a return visit (or a reload with no signal) paints what the rider saw
 * last, with its real age, and then refreshes. One storage entry per query, written when a fetch succeeds; errors and
 * loading states are never written. Restored data keeps its original fetch time, so the status line can say how old
 * it is (lib/freshness.ts), and it is marked as due: a page load always asks for fresh data behind the saved board
 * (a reload means "show me the latest"). The one exception is the NOAA station list, which doesn't change.
 *
 * localStorage, not IndexedDB: it reads synchronously, so the cache is back before the first render. The whole board
 * is a few hundred KB at most (see KEEP).
 */

/** Bump when the shape of any persisted query's data changes: older entries are dropped on the next visit. */
export const CACHE_VERSION = 1;
/** Nothing older than this is restored (or kept). */
export const MAX_AGE = 24 * 3600e3;

const NS = "ssq:";
const PREFIX = `${NS}${CACHE_VERSION}:`;

const READING_AGE = 6 * 3600e3; // a sensor reading older than this says nothing about now

/** What is kept, by the first element of the query key: how many entries of each (the newest win) and for how long. */
const KEEP: Record<string, { n: number; maxAge?: number; settled?: boolean }> = {
  "spot-models": { n: 24 }, // one per spot
  calibration: { n: 1 },
  stations: { n: 1, settled: true }, // where the sensors are: used as saved, not refetched on every visit
  live: { n: 2, maxAge: READING_AGE },
  obs: { n: 24, maxAge: READING_AGE },
  field: { n: 3 }, // one per map view: the last few
  discussion: { n: 4 },
  discussions: { n: 1 },
  alerts: { n: 2 },
};

type Entry = { k: QueryKey; t: number; d: unknown };

// NaN and ±Infinity don't survive JSON (they come back as null, which reads as 0 kn): keep them as tagged strings.
const NUM = "\u0000n:";
const encode = (_: string, v: unknown) => (typeof v === "number" && !Number.isFinite(v) ? NUM + String(v) : v);
const decode = (_: string, v: unknown) => (typeof v === "string" && v.startsWith(NUM) ? Number(v.slice(NUM.length)) : v);

const kind = (key: QueryKey) => String(key[0]);
const storageKey = (key: QueryKey) => PREFIX + JSON.stringify(key);

function ourKeys(storage: Storage) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k?.startsWith(NS)) keys.push(k); }
  return keys;
}

/**
 * Puts the saved queries back into the client (before the first render) and keeps saving from then on.
 * Returns a function that stops saving. Does nothing where storage is unavailable (private mode, quota of zero).
 */
export function persistQueries(client: QueryClient, now = Date.now()): () => void {
  let storage: Storage;
  try { storage = window.localStorage; storage.getItem(PREFIX); } catch { return () => {}; }

  // When each stored entry was fetched, per kind: decides which to drop once a kind is over its limit.
  const stored = new Map<string, Map<string, number>>();
  const note = (k: string, sk: string, t: number) => { let m = stored.get(k); if (!m) stored.set(k, (m = new Map())); m.set(sk, t); };

  for (const sk of ourKeys(storage)) {
    try {
      if (!sk.startsWith(PREFIX)) { storage.removeItem(sk); continue; } // another version's
      const e = JSON.parse(storage.getItem(sk)!, decode) as Entry;
      const k = kind(e.k);
      if (!KEEP[k] || !(now - e.t < (KEEP[k].maxAge ?? MAX_AGE)) || e.d === undefined) { storage.removeItem(sk); continue; }
      client.setQueryData(e.k, e.d, { updatedAt: e.t });
      if (!KEEP[k].settled) void client.invalidateQueries({ queryKey: e.k, exact: true, refetchType: "none" });
      note(k, sk, e.t);
    } catch {
      try { storage.removeItem(sk); } catch { /* leave it */ }
    }
  }

  const write = (sk: string, value: string) => {
    try { storage.setItem(sk, value); return true; } catch { return false; }
  };
  const save = (q: Query) => {
    const k = kind(q.queryKey), limit = KEEP[k]?.n;
    if (!limit || q.state.status !== "success" || q.state.data === undefined) return;
    const sk = storageKey(q.queryKey);
    const t = q.state.dataUpdatedAt;
    if (stored.get(k)?.get(sk) === t) return; // already saved (a restore, or a refetch that changed nothing)
    let value: string;
    try { value = JSON.stringify({ k: q.queryKey, t, d: q.state.data } satisfies Entry, encode); } catch { return; }
    if (!write(sk, value)) {
      // Full: let go of everything we hold and keep just this one.
      for (const old of ourKeys(storage)) { try { storage.removeItem(old); } catch { /* leave it */ } }
      stored.clear();
      if (!write(sk, value)) return;
    }
    note(k, sk, t);
    const m = stored.get(k)!;
    if (m.size > limit) {
      const oldest = [...m].sort((a, b) => a[1] - b[1]).slice(0, m.size - limit);
      for (const [old] of oldest) { m.delete(old); try { storage.removeItem(old); } catch { /* leave it */ } }
    }
  };

  // Only a finished, successful fetch is written; setQueryData from our own restore above happened before this.
  return client.getQueryCache().subscribe((ev) => {
    if (ev.type === "updated" && ev.action.type === "success") save(ev.query);
  });
}
