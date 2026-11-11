import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * "Night sea" basemap: near-black navy water and a clearly lighter slate land with a thin lit coastline, so the
 * shore reads at a glance (land against water is 1.5:1 in luminance; the first version was 1.09:1 and the bay
 * vanished under the wind). Bridges and main roads are a quiet lighter line, and labels stay background detail: town
 * names in soft slate, water names in sea blue.
 * Works on any OpenMapTiles-schema style (OpenFreeMap's included): it keys on layer type and source layer, never on
 * the style's layer ids, and skips anything the style doesn't have.
 */
export const BASEMAP = {
  land: "#273142",
  water: "#040b16",
  waterway: "#0a1626",
  coast: "#54719a",
  /** Parks, woods, residential blocks: barely there, a shade off the land. */
  landuse: "#232d3c",
  building: "#202938",
  road: "#3a475c",
  label: "#9aa9be",
  waterLabel: "#5f80a8",
} as const;

type Tweak = Record<string, unknown>;

function tweakFor(type: string, sourceLayer: string | undefined): { paint?: Tweak; hide?: boolean } | null {
  const sl = sourceLayer ?? "";
  if (type === "background") return { paint: { "background-color": BASEMAP.land } };
  if (sl === "water" && type === "fill") return { paint: { "fill-color": BASEMAP.water, "fill-opacity": 1, "fill-antialias": true } };
  if (sl === "waterway" && type === "line") return { paint: { "line-color": BASEMAP.waterway, "line-opacity": 0.9 } };
  // Land cover in the stock style is near-black, which would punch holes in the lighter land: one faint tone, no texture.
  if ((sl === "landcover" || sl === "landuse" || sl === "park") && type === "fill") return { paint: { "fill-color": BASEMAP.landuse, "fill-opacity": 0.55, "fill-pattern": undefined } };
  if (sl === "building" && (type === "fill" || type === "fill-extrusion")) return { paint: { [`${type}-color`]: BASEMAP.building, [`${type}-opacity`]: 0.5 } };
  if (sl === "aeroway" && type === "fill") return { paint: { "fill-color": BASEMAP.landuse, "fill-opacity": 0.6 } };
  if (sl === "transportation" && type === "fill") return { paint: { "fill-color": BASEMAP.land } }; // piers
  // Roads and bridges: one quiet tone a step above the land, so a causeway shows over the water without the
  // motorways outshouting the coast.
  if ((sl === "transportation" || sl === "aeroway") && type === "line") return { paint: { "line-color": BASEMAP.road, "line-opacity": 0.55 } };
  if (sl === "boundary" && type === "line") return { paint: { "line-color": BASEMAP.road, "line-opacity": 0.5 } };
  if (type === "symbol") {
    // Points of interest and house numbers are noise on a wind map; place and water names stay, quieter.
    if (sl === "poi" || sl === "housenumber" || sl === "mountain_peak" || sl === "aerodrome_label") return { hide: true };
    if (sl === "water_name") return { paint: { "text-color": BASEMAP.waterLabel, "text-opacity": 0.9, "text-halo-color": BASEMAP.water, "text-halo-width": 1.2, "text-halo-blur": 0 } };
    if (sl === "transportation_name") return { paint: { "text-color": BASEMAP.label, "text-opacity": 0.4, "icon-opacity": 0.35, "text-halo-color": BASEMAP.land, "text-halo-width": 1 } };
    return { paint: { "text-color": BASEMAP.label, "text-opacity": 0.72, "icon-opacity": 0.5, "text-halo-color": "rgba(4, 11, 22, 0.75)", "text-halo-width": 1.2, "text-halo-blur": 0.5 } };
  }
  return null;
}

const COAST = "seasensei-coast";

/** Our own layer over the style's vector source: the coastline, a thin lit edge on every water polygon. */
function addShore(map: MapLibreMap) {
  const layers = map.getStyle()?.layers ?? [];
  const water = layers.find((l) => l.type === "fill" && "source-layer" in l && l["source-layer"] === "water");
  if (!water || !("source" in water) || map.getLayer(COAST)) return;
  const after = layers[layers.indexOf(water) + 1]?.id; // right above the water fill, under everything else
  map.addLayer({
    id: COAST, type: "line", source: water.source as string, "source-layer": "water",
    // Rivers and lakes keep a fainter edge than the sea.
    paint: {
      "line-color": BASEMAP.coast,
      "line-opacity": ["match", ["get", "class"], ["ocean"], 0.75, 0.4],
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.4, 9, 0.8, 13, 1.3],
    },
  }, after);
}

/** Applies the night-sea tweaks to the loaded style. Safe to call more than once; every change is best-effort. */
export function tuneBasemap(map: MapLibreMap) {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (layer.id.startsWith("seasensei-")) continue;
    const t = tweakFor(layer.type, "source-layer" in layer ? (layer["source-layer"] as string | undefined) : undefined);
    if (!t) continue;
    if (t.hide) { try { map.setLayoutProperty(layer.id, "visibility", "none"); } catch { /* leave it */ } continue; }
    for (const [k, v] of Object.entries(t.paint ?? {})) {
      // A property this layer type doesn't take: leave that one as the style drew it.
      try { map.setPaintProperty(layer.id, k as Parameters<MapLibreMap["setPaintProperty"]>[1], v as Parameters<MapLibreMap["setPaintProperty"]>[2]); } catch { /* next */ }
    }
  }
  try { addShore(map); } catch { /* a style without the layers we build on: the tweaks above still hold */ }
}
