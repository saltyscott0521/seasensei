import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { alertsUrl, parseAlerts, sortAlerts, type MarineAlert } from "./marine";
import { useNow } from "./time";
import type { Spot } from "./wind";

export { fmtUntil, parseAlerts, type MarineAlert } from "./marine";

const MIN = 60_000;

/** Marine alerts in force around the spots. Empty while loading, when there are none, and when NWS can't be reached. */
export function useMarineAlerts(spots: Spot[]): MarineAlert[] {
  const points = useMemo(() => {
    if (!spots.length) return [];
    const mid = { lat: spots.reduce((a, s) => a + s.lat, 0) / spots.length, lon: spots.reduce((a, s) => a + s.lon, 0) / spots.length };
    const all = [mid, spots[0]].map((p) => [+p.lat.toFixed(3), +p.lon.toFixed(3)] as const);
    return all.filter((p, i) => all.findIndex((q) => q[0] === p[0] && q[1] === p[1]) === i);
  }, [spots]);
  const q = useQuery({
    queryKey: ["alerts", points.map((p) => p.join(",")).join(";")],
    enabled: points.length > 0,
    staleTime: 5 * MIN,
    refetchInterval: 10 * MIN,
    retry: 0, // it comes round again in ten minutes; nothing on screen waits for it
    queryFn: async (): Promise<MarineAlert[]> => {
      const res = await Promise.allSettled(points.map(([lat, lon]) =>
        fetch(alertsUrl(lat, lon), { headers: { Accept: "application/geo+json" } }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))));
      if (res.every((r) => r.status === "rejected")) throw (res[0] as PromiseRejectedResult).reason;
      return sortAlerts(res.flatMap((r) => (r.status === "fulfilled" ? parseAlerts(r.value) : [])));
    },
  });
  const now = useNow(); // an alert drops off the minute it ends, without waiting for a refetch (or when read from the saved cache)
  return useMemo(() => (q.data ?? []).filter((a) => a.ends == null || a.ends > now), [q.data, now]);
}

