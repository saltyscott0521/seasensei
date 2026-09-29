// Pure logic (no DOM) — shared by the page and the node tests.
const POINTS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];

export const compass = (deg) => POINTS[Math.floor((((deg % 360) + 360) % 360) / 22.5 + 0.5) % 16];

export const TAMPA_BAY = [
  { name: "Fort De Soto", lat: 27.640, lon: -82.739, min: 15, max: 30 },
  { name: "Skyway", lat: 27.628, lon: -82.660, min: 15, max: 30 },
  { name: "Picnic Island", lat: 27.853, lon: -82.552, min: 15, max: 30, station: "8726607" },
];

export function forecastUrl(lat, lon) {
  const q = new URLSearchParams({
    latitude: lat, longitude: lon,
    hourly: "wind_speed_10m,wind_gusts_10m,wind_direction_10m",
    models: "gfs_hrrr", wind_speed_unit: "kn", timeformat: "unixtime",
    timezone: "auto", forecast_days: "3",
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

export function stationUrl(station) {
  const q = new URLSearchParams({
    station, product: "wind", date: "latest", units: "english",
    time_zone: "gmt", format: "json", application: "SeaSensei",
  });
  return `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${q}`;
}

// Open-Meteo response -> { timeZone, hours:[{t(ms), speed, gust, dir}] }; null hours (past HRRR's horizon) dropped.
export function parseForecast(json) {
  const h = json.hourly, hours = [];
  for (let i = 0; i < h.time.length; i++) {
    const s = h.wind_speed_10m[i], g = h.wind_gusts_10m[i], d = h.wind_direction_10m[i];
    if (s == null || g == null || d == null) continue;
    hours.push({ t: h.time[i] * 1000, speed: s, gust: g, dir: d });
  }
  return { timeZone: json.timezone, hours };
}

// CO-OPS wind response -> observation. Values are strings, times "yyyy-MM-dd HH:mm" GMT; stations without data return {error}.
export function parseObservation(json) {
  if (json.error) throw new Error(json.error.message);
  const row = json.data?.[json.data.length - 1];
  const t = row && Date.parse(row.t.replace(" ", "T") + ":00Z");
  const [speed, gust, dir] = row ? [row.s, row.g, row.d].map(Number) : [];
  if (!row || [t, speed, gust, dir].some(Number.isNaN)) throw new Error("Station returned no wind reading");
  return { name: json.metadata?.name ?? "NOAA station", t, speed, gust, dir };
}

// Runs of consecutive hours with sustained wind in [min,max] -> [{start,end}] (ms, start of first to start of last hour).
export function rideableWindows(hours, min, max) {
  const out = []; let cur = null;
  for (const h of hours) {
    if (h.speed >= min && h.speed <= max) { cur ? (cur.end = h.t) : (cur = { start: h.t, end: h.t }); }
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

export const nearestHour = (hours, t) =>
  hours.reduce((best, h) => (!best || Math.abs(h.t - t) < Math.abs(best.t - t) ? h : best), null);
