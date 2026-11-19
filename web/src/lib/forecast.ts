// A spot's forecast for the chosen primary model, from its raw models: pure (no React, no fetch), shared by the app
// (data.ts) and the server's morning briefing (scripts/build-engine.mjs bundles it).
import { buildSensei, type Calibration } from "./sensei";
import { chainForecast, type Forecast, type Model, type ModelSeries, type Spot } from "./wind";

// One built forecast per (payload, model, calibration, hour), shared by every card, marker and chart of a spot.
const built = new WeakMap<ModelSeries, { model: Model; cal: Calibration; hour: number; station: string | undefined; forecast: Forecast }[]>();

/** A spot's forecast for a primary model from its models: SeaSensei's blend, or a raw model's chain. */
export function forecastFrom(series: ModelSeries, model: Model, cal: Calibration, spot: Pick<Spot, "station">, hour: number): Forecast {
  let list = built.get(series);
  if (!list) built.set(series, (list = []));
  const hit = list.find((e) => e.model === model && (model !== "sensei" || (e.cal === cal && e.hour === hour && e.station === spot.station)));
  if (hit) return hit.forecast;
  const forecast = model === "sensei"
    ? { timeZone: series.timeZone, hours: buildSensei(series, cal, spot, hour) }
    : chainForecast(series, model);
  if (list.length > 12) list.length = 0;
  list.push({ model, cal, hour, station: spot.station, forecast });
  return forecast;
}

