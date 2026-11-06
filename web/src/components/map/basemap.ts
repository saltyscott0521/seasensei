import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * "Night sea" basemap: a deep navy sea a step darker than the land, so the coastline reads at a glance and the
 * wind particles and markers sit on a calm ground. Roads, land use and labels are turned down to background
 * detail. Works on any OpenMapTiles-schema style (OpenFreeMap's included): it keys on layer type and source
 * layer, never on layer ids, and skips anything the style doesn't have.
 */
export const BASEMAP = {
  land: "#141b25",
  water: "#06101d",
  waterway: "#0a1729",
} as const;

type Tweak = Record<string, string | number>;

function tweakFor(type: string, sourceLayer: string | undefined): { paint?: Tweak; hide?: boolean } | null {
  const sl = sourceLayer ?? "";
  if (type === "background") return { paint: { "background-color": BASEMAP.land } };
  if (sl === "water" && type === "fill") return { paint: { "fill-color": BASEMAP.water, "fill-opacity": 1, "fill-outline-color": BASEMAP.water } };
  if (sl === "waterway" && type === "line") return { paint: { "line-color": BASEMAP.waterway, "line-opacity": 0.9 } };
  if ((sl === "landcover" || sl === "landuse" || sl === "park") && type === "fill") return { paint: { "fill-opacity": 0.35 } };
  if (sl === "building" && (type === "fill" || type === "fill-extrusion")) return { paint: { [`${type}-opacity`]: 0.3 } };
  if ((sl === "transportation" || sl === "aeroway") && type === "line") return { paint: { "line-opacity": 0.45 } };
  if (sl === "boundary" && type === "line") return { paint: { "line-opacity": 0.4 } };
  if (type === "symbol") {
    // Points of interest and house numbers are noise on a wind map; place and water names stay, quieter.
    if (sl === "poi" || sl === "housenumber" || sl === "mountain_peak" || sl === "aerodrome_label") return { hide: true };
    const quiet = sl === "transportation_name" ? 0.5 : sl === "water_name" ? 0.6 : 0.78;
    return { paint: { "text-opacity": quiet, "icon-opacity": quiet * 0.8, "text-halo-color": BASEMAP.land, "text-halo-width": 1.2 } };
  }
  return null;
}

/** Applies the night-sea tweaks to the loaded style. Safe to call more than once; every change is best-effort. */
export function tuneBasemap(map: MapLibreMap) {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    const t = tweakFor(layer.type, "source-layer" in layer ? (layer["source-layer"] as string | undefined) : undefined);
    if (!t) continue;
    try {
      if (t.hide) { map.setLayoutProperty(layer.id, "visibility", "none"); continue; }
      for (const [k, v] of Object.entries(t.paint ?? {})) map.setPaintProperty(layer.id, k as Parameters<MapLibreMap["setPaintProperty"]>[1], v);
    } catch {
      // A property this layer type doesn't take: leave the layer as the style drew it.
    }
  }
}
