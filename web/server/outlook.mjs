// The LLM outlook: the server pulls four forecast models for the requested spots itself, then asks
// Claude to write a kite-rider's multi-day outlook as structured JSON. The browser only ever sends
// spot definitions (validated below), never forecast numbers.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";
const DAYS = 5;
const MODELS = [
  ["gfs_hrrr", "HRRR"],       // 3 km, to 48 h
  ["ncep_nbm_conus", "NBM"],  // NOAA's blend, to 7 days
  ["ecmwf_ifs025", "ECMWF"],
  ["gfs_global", "GFS"],     // pure GFS (gfs_seamless swaps in HRRR for the first 48 h)
];

/* ---------------- input ---------------- */

const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** Returns clean spots or throws a 422-worthy message. HRRR/NBM only cover the contiguous US. */
export function validateSpots(body) {
  const list = body && Array.isArray(body.spots) ? body.spots : null;
  if (!list || list.length < 1 || list.length > 6) throw new Error("send 1–6 spots");
  return list.map((s, i) => {
    const lat = num(s?.lat, 20, 55), lon = num(s?.lon, -130, -60);
    const min = num(s?.min, 0, 60), max = num(s?.max, 0, 80);
    if (lat == null || lon == null) throw new Error(`spot ${i + 1}: outside the US forecast area`);
    if (min == null || max == null || min >= max) throw new Error(`spot ${i + 1}: bad wind range`);
    const name = String(s?.name ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) || `Spot ${i + 1}`;
    const dirC = num(s?.dirC, 0, 360), dirW = num(s?.dirW, 1, 360);
    return { name, lat: +lat.toFixed(3), lon: +lon.toFixed(3), min, max, ...(dirC != null && dirW != null && dirW < 360 ? { dirC, dirW } : {}) };
  });
}

/** Same spots → same key; the 3-hour slot follows the model update cycle. */
export function cacheKey(spots, now = Date.now()) {
  const slot = Math.floor(now / (3 * 3600e3));
  const sig = spots.map((s) => [s.name, s.lat.toFixed(2), s.lon.toFixed(2), s.min, s.max, s.dirC ?? "", s.dirW ?? ""].join("|")).sort().join(";");
  return `${slot}:${sig}`;
}

/* ---------------- data ---------------- */

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (d) => COMPASS[Math.floor((((d % 360) + 360) % 360) / 22.5 + 0.5) % 16];

async function fetchModels(spots) {
  const q = new URLSearchParams({
    latitude: spots.map((s) => s.lat).join(","), longitude: spots.map((s) => s.lon).join(","),
    hourly: "wind_speed_10m,wind_gusts_10m,wind_direction_10m", models: MODELS.map(([k]) => k).join(","),
    wind_speed_unit: "kn", timeformat: "unixtime", timezone: "auto", forecast_days: String(DAYS + 1),
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`forecast data HTTP ${r.status}`);
  const j = await r.json();
  return Array.isArray(j) ? j : [j];
}

/**
 * Compact daylight table per spot per day: every 2 h from 7 AM to 7 PM local, one line per model,
 * "speed/gust dir". Around 1.5k tokens per spot for 5 days — enough for judgment, cheap to send.
 */
function describe(spots, data) {
  const tz = data[0].timezone;
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const dayName = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" });
  const hourOf = (ms) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(ms));
  const today = dayKey.format(Date.now());
  const lines = [`Local time zone: ${tz}. Now: ${new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" }).format(Date.now())}.`];

  spots.forEach((s, si) => {
    const h = data[si].hourly;
    const dir = s.dirC != null ? `works with wind FROM ${compass(s.dirC)} ±${Math.round(s.dirW / 2)}° (${compass(s.dirC - s.dirW / 2)} to ${compass(s.dirC + s.dirW / 2)})` : "any wind direction works";
    lines.push("", `## ${s.name} (${s.lat}, ${s.lon}) — rideable ${s.min}–${s.max} kn sustained; ${dir}`);
    const byDay = new Map();
    h.time.forEach((t, i) => {
      const ms = t * 1000, d = dayKey.format(ms), hr = hourOf(ms);
      if (d < today || hr < 7 || hr > 19 || hr % 2 === 0) return; // 7,9,…,19
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(i);
    });
    [...byDay.keys()].slice(0, DAYS).forEach((d) => {
      const idx = byDay.get(d);
      lines.push(`### ${dayName.format(Date.parse(d + "T12:00:00Z"))} (${d}); hours: ${idx.map((i) => hourOf(h.time[i] * 1000)).join(", ")}`);
      for (const [key, label] of MODELS) {
        const sp = h[`wind_speed_10m_${key}`], gu = h[`wind_gusts_10m_${key}`], di = h[`wind_direction_10m_${key}`];
        if (!sp) continue;
        const cells = idx.map((i) => (sp[i] == null ? "–" : `${Math.round(sp[i])}/${Math.round(gu[i] ?? sp[i])} ${compass(di[i] ?? 0)}`));
        if (cells.every((c) => c === "–")) continue;
        lines.push(`${label.padEnd(5)} ${cells.join("  ")}`);
      }
    });
  });
  return { text: lines.join("\n"), timeZone: tz };
}

/* ---------------- Claude ---------------- */

const SYSTEM = `You are SeaSensei's kiteboarding forecaster. You write a short multi-day wind outlook for a rider's own spots from raw forecast model output.

How to read the data: each row is one model; each cell is "sustained/gust direction" in knots, direction = where the wind blows FROM. HRRR is the best short-range model but stops after ~48 h; NBM is NOAA's calibrated blend; ECMWF and GFS are global models. Where they disagree, say so and lower your confidence rather than averaging it away. Sea breezes are common on coasts in the afternoon and global models often under-forecast them; HRRR and NBM usually handle them better.

A spot is rideable when sustained wind is inside its range AND the direction is inside its workable arc (if given). Gusts far above sustained (a gust factor above ~1.5) mean gusty, harder conditions — mention it. Be concrete: name days, hours and knots. Don't invent data you weren't given (tides, rain, temperature). Keep it tight: riders skim.`;

const SPOT = {
  type: "object", additionalProperties: false,
  required: ["name", "verdict", "window", "wind", "note"],
  properties: {
    name: { type: "string", description: "Spot name exactly as given" },
    verdict: { type: "string", enum: ["go", "maybe", "no"] },
    window: { type: "string", description: "Best hours, e.g. '1–6 PM', or '' if none" },
    wind: { type: "string", description: "e.g. '16–20 kn SW, gusts 24'" },
    note: { type: "string", description: "One short clause: why, or what to watch" },
  },
};
export const OUTLOOK_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["headline", "bestBet", "days"],
  properties: {
    headline: { type: "string", description: "One sentence: the week at a glance" },
    bestBet: {
      anyOf: [
        { type: "null" },
        { type: "object", additionalProperties: false, required: ["date", "spot", "window", "why"],
          properties: { date: { type: "string", format: "date" }, spot: { type: "string" }, window: { type: "string" }, why: { type: "string" } } },
      ],
    },
    days: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["date", "summary", "rating", "confidence", "spots"],
        properties: {
          date: { type: "string", format: "date" },
          summary: { type: "string", description: "One or two sentences for the day" },
          rating: { type: "string", enum: ["go", "maybe", "no"], description: "Best verdict across spots that day" },
          confidence: { type: "string", enum: ["high", "medium", "low"], description: "From model agreement and lead time" },
          spots: { type: "array", items: SPOT },
        },
      },
    },
  },
};

/** Light structural check — the API enforces the schema, this guards against a truncated reply. */
function checkOutlook(o, spots) {
  if (!o || typeof o.headline !== "string" || !Array.isArray(o.days) || !o.days.length) throw new Error("outlook came back malformed");
  const names = new Set(spots.map((s) => s.name));
  for (const d of o.days) d.spots = (d.spots ?? []).filter((s) => names.has(s.name));
  return o;
}

let client = null;
export const configured = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export async function generateOutlook(spots) {
  client ??= new Anthropic();
  const data = await fetchModels(spots);
  const { text, timeZone } = describe(spots, data);
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: OUTLOOK_SCHEMA } },
    // If a safety classifier ever declines, Anthropic re-runs it on its recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content: `Write the next ${DAYS} days' outlook for these spots, one entry per day starting today.\n\n${text}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("the model declined to write this outlook");
  if (response.stop_reason === "max_tokens") throw new Error("the outlook was cut off");
  const out = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const outlook = checkOutlook(JSON.parse(out), spots);
  return {
    ...outlook,
    timeZone,
    generatedAt: new Date().toISOString(),
    model: response.model,
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  };
}
