// What the stations measured: hourly wind at the archive's NOAA CO-OPS and airport (IEM) stations, saved to R2
// at  obs/v1/YYYY/MM/DD.json.gz  (UTC day). It's the other half of the forecast-run archive: calibrate.mjs pairs
// the two.
//
// Each cycle asks every station for its last day of readings (6-minute at NOAA, 5-minute at the airports),
// averages them into the forecast's top-of-hour buckets (the readings within 30 minutes of the hour, as the
// app's own forecast check does) and merges the finished hours into the day files. An hour already stored is
// only replaced by one built from more readings, so repeating a cycle changes nothing, and a day of downtime
// is filled in by the next cycle.
import * as r2 from "./r2.mjs";
import { COOPS, IEM, getJson, stationList } from "./archive.mjs";

const HOUR = 3600e3;
const state = { lastCycle: null, lastError: null, stations: 0, stuck: [], hoursSaved: 0, latestHour: null };

/** NOAA sends "" for a missing reading, and Number("") is 0: a blank is no reading, not a calm. */
export const num = (v) => (v === "" || v == null ? NaN : Number(v));

// Sensors that stand in open water rather than on a pier or seawall (science/cells: Middle Tampa Bay).
const WATER = new Set(["coops:8726412"]);
export const kindOf = (id) => (id.startsWith("asos:") ? "airport" : WATER.has(id) ? "water" : "shore");
export const dayKey = (ms) => { const d = new Date(ms).toISOString(); return `obs/v1/${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}.json.gz`; };

/** CO-OPS wind, last 24 h: knots, degrees, times "yyyy-MM-dd HH:mm" GMT, values as strings. A station with no data sends {error}. */
async function coopsReadings(id) {
  const q = new URLSearchParams({ station: id, product: "wind", range: "24", units: "english", time_zone: "gmt", format: "json", application: "SeaSensei" });
  const json = await getJson(`${COOPS()}/api/prod/datagetter?${q}`);
  if (json.error) return []; // nothing to report (many "met" stations have no wind sensor): not a failure
  return (json.data ?? []).map((r) => ({ t: Date.parse(`${String(r.t).replace(" ", "T")}:00Z`), s: num(r.s), g: num(r.g), d: num(r.d) }));
}

/** IEM's observation history for an airport: sknt/gust in knots, drct degrees, utc_valid ISO; null where missing. */
async function airportReadings(code, now) {
  // `date` is the station's local day; the UTC dates of now and of 12 h ago cover the last day's hours either way.
  const dates = [...new Set([now, now - 12 * HOUR].map((t) => new Date(t).toISOString().slice(0, 10)))];
  const out = [];
  for (const date of dates) {
    const json = await getJson(`${IEM()}/api/1/obhistory.json?${new URLSearchParams({ station: code, network: "FL_ASOS", date })}`);
    for (const r of json.data ?? []) out.push({ t: Date.parse(r.utc_valid), s: num(r.sknt), g: num(r.gust), d: num(r.drct) });
  }
  return out;
}

/**
 * A frozen sensor keeps reporting: the same speed and direction, reading after reading. Marks (`stuck`) every
 * reading in a run of identical speed + direction that lasts 6 h or more, or 3 h or more at 0.0 kn. An airport's
 * calm (0 kn, reported as such in the METAR) is a real measurement and is left alone.
 */
export function markStuck(readings, airport = false) {
  const xs = readings.filter((r) => Number.isFinite(r.t) && Number.isFinite(r.s)).sort((a, b) => a.t - b.t);
  const same = (a, b) => a.s === b.s && (a.d === b.d || (Number.isNaN(a.d) && Number.isNaN(b.d)));
  for (let i = 0, j = 0; i < xs.length; i = j) {
    while (j < xs.length && same(xs[i], xs[j])) j++;
    const span = xs[j - 1].t - xs[i].t;
    if (airport && xs[i].s === 0) continue;
    if (span >= 6 * HOUR || (xs[i].s === 0 && span >= 3 * HOUR)) for (let k = i; k < j; k++) xs[k].stuck = true;
  }
  return xs;
}

/**
 * Readings → finished top-of-hour buckets { [unix seconds]: { s, g, d, n } }: mean speed, peak gust, vector-mean
 * direction and how many readings went in. An hour is finished once its half hour after has passed. An hour whose
 * readings are all from a stuck sensor is { s: null, g: null, d: null, n: 0, stuck: true }: no reading.
 */
export function hourly(readings, now = Date.now()) {
  const by = new Map(), stuck = new Set();
  for (const r of readings) {
    if (!Number.isFinite(r.t) || !Number.isFinite(r.s) || r.s < 0) continue;
    const k = Math.round(r.t / HOUR) * HOUR;
    if (k + HOUR / 2 > now) continue;
    if (r.stuck) { stuck.add(k); continue; }
    (by.get(k) ?? by.set(k, []).get(k)).push(r);
  }
  const out = {};
  for (const k of stuck) if (!by.has(k)) out[k / 1000] = { s: null, g: null, d: null, n: 0, stuck: true };
  for (const [k, xs] of by) {
    const gusts = xs.map((x) => x.g).filter(Number.isFinite), dirs = xs.map((x) => x.d).filter(Number.isFinite);
    const u = dirs.reduce((a, d) => a + Math.sin((d * Math.PI) / 180), 0), v = dirs.reduce((a, d) => a + Math.cos((d * Math.PI) / 180), 0);
    out[k / 1000] = {
      s: +(xs.reduce((a, x) => a + x.s, 0) / xs.length).toFixed(2),
      g: gusts.length ? +Math.max(...gusts).toFixed(2) : null,
      d: dirs.length ? Math.round((Math.atan2(u, v) * 180 / Math.PI + 360) % 360) : null,
      n: xs.length,
    };
  }
  return out;
}

/**
 * Adds a station's hours to a day document. Returns how many hours were new or better than what was there.
 * A stuck hour replaces a reading saved before the sensor was seen to be frozen, and stays stuck.
 */
export function merge(doc, station, hours) {
  let changed = 0;
  for (const [t, h] of Object.entries(hours)) {
    const st = (doc.stations[station.id] ??= { name: station.name, lat: station.lat, lon: station.lon, kind: kindOf(station.id), hours: {} });
    const old = st.hours[t];
    if (old && (old.stuck || (!h.stuck && old.n >= h.n))) continue;
    st.hours[t] = h;
    changed++;
  }
  return changed;
}

let busy = false;
export async function tick(now = Date.now()) {
  if (!r2.configured() || busy) return;
  busy = true;
  try {
    const stations = await stationList(now);
    const byDay = new Map(); // day key → [station, hours of that day]
    let withData = 0, error = null, latest = 0;
    const stuck = [];
    for (const st of stations) {
      try {
        const readings = st.id.startsWith("coops:") ? await coopsReadings(st.id.slice(6)) : await airportReadings(st.id.slice(6), now);
        const hours = hourly(markStuck(readings, st.id.startsWith("asos:")), now);
        if (Object.values(hours).some((h) => !h.stuck)) withData++;
        if (Object.values(hours).some((h) => h.stuck)) stuck.push(st.id);
        for (const [t, h] of Object.entries(hours)) {
          latest = Math.max(latest, +t);
          const day = dayKey(t * 1000), list = byDay.get(day) ?? byDay.set(day, []).get(day);
          let entry = list.find((e) => e.station === st);
          if (!entry) list.push((entry = { station: st, hours: {} }));
          entry.hours[t] = h;
        }
      } catch (e) { error = `${st.id}: ${e.message}`; } // one silent station doesn't stop the rest
    }
    for (const [key, entries] of byDay) {
      const doc = (await r2.getJsonGz(key).catch((e) => { if (e instanceof SyntaxError || e.code?.startsWith?.("Z_")) return null; throw e; }))
        ?? { version: 1, day: key.slice(7, 17).replaceAll("/", "-"), stations: {} };
      doc.stations ??= {};
      const changed = entries.reduce((a, e) => a + merge(doc, e.station, e.hours), 0);
      if (!changed) continue;
      doc.updatedAt = new Date(now).toISOString();
      await r2.putJsonGz(key, doc);
      state.hoursSaved += changed;
    }
    Object.assign(state, { lastCycle: new Date(now).toISOString(), lastError: error, stations: withData, stuck, latestHour: latest ? new Date(latest * 1000).toISOString() : state.latestHour });
    if (error) console.error(`[observations] ${error}`);
  } catch (e) {
    state.lastError = e.message;
    console.error(`[observations] ${e.message}`);
  } finally { busy = false; }
}

/** For /api/archive. */
export const status = () => ({ ...state });
