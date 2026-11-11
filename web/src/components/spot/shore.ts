// Which way the wind blows relative to the shore at a spot: information for the rider, never a filter. The shore's
// facing comes from lib/coast.ts (water polygons around the pin); where that can't tell, nothing is said.
import { useQuery } from "@tanstack/react-query";
import { analyzeCoast, type Fetch } from "../../lib/coast";
import type { Spot } from "../../lib/wind";

const RAD = Math.PI / 180;

export type ShoreWord = "onshore" | "side-shore" | "offshore";

/** What riders need to know about an offshore wind, in one line. */
export const OFFSHORE_CAUTION = "Offshore: wind blows out to sea";

/**
 * The bearing from the spot out over open water (degrees), from the coastline rays: the mean of the bearings with
 * 3 km or more of water upwind. Null when the coast doesn't say: water all round (a pin out in the bay), no open
 * water, or open water on so many sides that none of them is "the sea".
 */
export function seawardBearing(fetch: Fetch[]): number | null {
  const open = fetch.filter((f) => f.kind === "open");
  if (!open.length || fetch.length - open.length < 3) return null;
  const u = open.reduce((a, f) => a + Math.sin(f.dir * RAD), 0), v = open.reduce((a, f) => a + Math.cos(f.dir * RAD), 0);
  if (Math.hypot(u, v) / open.length < 0.5) return null;
  return (Math.atan2(u, v) / RAD + 360) % 360;
}

/**
 * The wind (the direction it comes FROM) against the shore: from the water within 50° of straight in is onshore, up
 * to a little past along the beach (112°) side-shore, beyond that it blows off the land: offshore.
 */
export function shoreWord(dirFrom: number, seaward: number): ShoreWord {
  const d = Math.abs(((dirFrom - seaward + 540) % 360) - 180);
  return d <= 50 ? "onshore" : d <= 112.5 ? "side-shore" : "offshore";
}

// Worked out once per pin and kept on the device, so the board can say it without asking for map tiles.
const key = (s: Pick<Spot, "lat" | "lon">) => `shore:${s.lat.toFixed(3)},${s.lon.toFixed(3)}`;

/** The seaward bearing remembered for this pin: a number, null (the coast can't tell), or undefined (not worked out yet). */
export function rememberedShore(spot: Pick<Spot, "lat" | "lon">): number | null | undefined {
  try {
    const raw = localStorage.getItem(key(spot));
    if (raw == null) return undefined;
    return raw === "none" ? null : Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  } catch { return undefined; }
}

/**
 * The spot's seaward bearing, or null while unknown or when the coast can't tell. `work` lets it read the coastline
 * (a few map tiles, once per pin): the spot view does, the board only uses what is remembered.
 */
export function useShore(spot: Pick<Spot, "lat" | "lon"> | undefined, work = false): number | null {
  const known = spot ? rememberedShore(spot) : undefined;
  const q = useQuery({
    queryKey: ["shore", spot?.lat, spot?.lon],
    enabled: !!spot && work && known === undefined,
    staleTime: Infinity, gcTime: Infinity, retry: false,
    queryFn: async () => {
      const seaward = seawardBearing((await analyzeCoast(spot!.lat, spot!.lon)).fetch);
      try { localStorage.setItem(key(spot!), seaward == null ? "none" : seaward.toFixed(0)); } catch { /* storage unavailable */ }
      return seaward;
    },
  });
  return known !== undefined ? known : q.data ?? null;
}
