// The primary sources the daily discussion is written from. Everything here is public-domain NWS/NOAA
// text plus a pressure trend from the forecast models. Fetched by the server; nothing comes from a browser.
//
// Base URLs are overridable (NWS_BASE, OPENMETEO_BASE) so end-to-end tests can point at stand-ins.

const NWS = () => process.env.NWS_BASE ?? "https://api.weather.gov";
const OPENMETEO = () => process.env.OPENMETEO_BASE ?? "https://api.open-meteo.com";
const UA = "SeaSensei daily wind discussion (seasensei.com)";

// The region: the Tampa Bay office (TBW) and its Gulf marine zones (Tampa Bay, and coastal waters out to 20 and 60 nm).
export const REGION = {
  name: "Tampa Bay and west-central Florida Gulf coast",
  office: "TBW",
  marineZones: ["GMZ830", "GMZ850", "GMZ853", "GMZ870"],
  point: { lat: 27.75, lon: -82.6 },
  timeZone: "America/New_York",
};

async function getJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/ld+json" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${new URL(url).pathname} → HTTP ${r.status}`);
  return r.json();
}

// Human-readable pages for each source (the API URLs below are JSON); shown as the citations.
const PAGES = {
  AFD: "https://forecast.weather.gov/product.php?site=NWS&issuedby=TBW&product=AFD",
  WPC_SHORT: "https://www.wpc.ncep.noaa.gov/discussions/hpcdiscussions.php?disc=pmdspd",
  WPC_EXT: "https://www.wpc.ncep.noaa.gov/discussions/hpcdiscussions.php?disc=pmdepd",
  CWF: "https://forecast.weather.gov/product.php?site=NWS&issuedby=TBW&product=CWF",
  NHC: "https://www.nhc.noaa.gov/gtwo.php?basin=atlc",
  ALERTS: "https://www.weather.gov/tbw/",
  MODEL: "https://open-meteo.com/en/docs/ecmwf-api",
};

/** Latest product of a type (optionally per office); `match` picks the right one when a type is shared. */
async function latestProduct(type, { office, issuer, match, max = 12 } = {}) {
  const list = await getJson(`${NWS()}/products/types/${type}${office ? `/locations/${office}` : ""}`);
  const cands = (list["@graph"] ?? []).filter((p) => !issuer || p.issuingOffice === issuer).slice(0, max);
  for (const c of cands) {
    const p = await getJson(`${NWS()}/products/${c.id}`);
    if (!match || match.test(p.productText ?? "")) return p;
  }
  return null;
}

/* ---------------- text extraction: keep the analysis, drop the boilerplate ---------------- */

const squash = (s) => s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const cap = (s, n) => (s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + " […]");

/** AFD sections look like ".KEY MESSAGES..." then text, ending at "&&". */
function afdSections(text, names) {
  const out = [];
  for (const name of names) {
    const m = text.match(new RegExp(`^\\.${name}[^\\n]*\\n([\\s\\S]*?)(?=^&&|^\\.[A-Z][A-Z /-]+\\.\\.\\.|$(?![\\s\\S]))`, "m"));
    if (m) out.push(`[${name}]\n${squash(m[1].replace(/^Issued at [^\n]*\n/, ""))}`);
  }
  return out.join("\n\n");
}

/* ---------------- the bundle ---------------- */

/**
 * Returns { docs: [{id, name, issued, url, text}], missing: [id], clues }.
 * A missing source doesn't fail the run; the model is told what it doesn't have.
 */
export async function gatherSources() {
  const want = [
    ["AFD", "NWS Tampa Bay Area Forecast Discussion", async () => {
      const p = await latestProduct("AFD", { office: REGION.office });
      if (!p) return null;
      // TBW's sections are KEY MESSAGES / DISCUSSION / AVIATION / MARINE; other offices use SHORT/LONG TERM.
      const body = afdSections(p.productText, ["KEY MESSAGES", "DISCUSSION", "SHORT TERM", "UPDATE", "LONG TERM", "MARINE"]) || p.productText;
      return { p, text: cap(body, 9000) };
    }],
    ["CWF", "NWS Tampa Bay Coastal Waters Forecast", async () => {
      const p = await latestProduct("CWF", { office: REGION.office });
      return p && { p, text: cap(squash(p.productText), 5000) };
    }],
    // The Weather Prediction Center's national discussions: short range (days 1–3) and extended (days 3–7).
    // They share the PMD product type with dozens of unrelated products, so pick by the AWIPS id line.
    ["WPC_SHORT", "NWS Weather Prediction Center Short Range Discussion (days 1–3)", async () => {
      const p = await latestProduct("PMD", { match: /^PMDSPD\b/m, max: 40 });
      return p && { p, text: cap(squash(p.productText), 6000) };
    }],
    ["WPC_EXT", "NWS Weather Prediction Center Extended Discussion (days 3–7)", async () => {
      const p = await latestProduct("PMD", { match: /^PMDEPD\b/m, max: 40 });
      return p && { p, text: cap(squash(p.productText), 7000) };
    }],
    ["NHC", "NHC Atlantic Tropical Weather Outlook", async () => {
      const p = await latestProduct("TWO", { issuer: "KNHC", match: /North Atlantic|Gulf of (America|Mexico)/i, max: 24 });
      return p && { p, text: cap(squash(p.productText), 3500) };
    }],
  ];

  const docs = [], missing = [];
  await Promise.all(want.map(async ([id, name, fn]) => {
    try {
      const r = await fn();
      if (r) docs.push({ id, name, issued: r.p.issuanceTime, url: PAGES[id], productUrl: `${NWS()}/products/${r.p.id}`, text: r.text });
      else missing.push(id);
    } catch (e) { console.error(`[sources] ${id}: ${e.message}`); missing.push(id); }
  }));

  // Live watches/warnings/advisories for the land zone and marine zones.
  try {
    const q = new URLSearchParams({ zone: REGION.marineZones.join(",") });
    const [marine, land] = await Promise.all([
      getJson(`${NWS()}/alerts/active?${q}`),
      getJson(`${NWS()}/alerts/active?point=${REGION.point.lat},${REGION.point.lon}`),
    ]);
    const seen = new Set(), lines = [];
    for (const a of [...(marine["@graph"] ?? []), ...(land["@graph"] ?? [])]) {
      if (seen.has(a.id)) continue; seen.add(a.id);
      lines.push(`- ${a.event} (${a.severity ?? "?"}) — ${String(a.headline ?? "").slice(0, 200)}${a.ends ? ` [ends ${a.ends}]` : ""}`);
    }
    docs.push({ id: "ALERTS", name: "NWS active alerts for the area", issued: new Date().toISOString(), url: PAGES.ALERTS, productUrl: `${NWS()}/alerts/active`, text: lines.length ? lines.join("\n") : "No active watches, warnings or advisories for the region right now." });
  } catch (e) { console.error(`[sources] ALERTS: ${e.message}`); missing.push("ALERTS"); }

  let clues = null;
  try { clues = await modelClues(); } catch (e) { console.error(`[sources] MODEL: ${e.message}`); missing.push("MODEL"); }
  if (clues) docs.push({ id: "MODEL", name: "Forecast-model pressure and wind-direction trend (cross-check only)", issued: new Date().toISOString(), url: PAGES.MODEL, productUrl: OPENMETEO(), text: clues });

  if (!docs.some((d) => ["AFD", "WPC_EXT", "WPC_SHORT", "CWF"].includes(d.id))) throw new Error("no forecast discussions were available; not publishing");
  const order = ["AFD", "WPC_SHORT", "WPC_EXT", "CWF", "NHC", "ALERTS", "MODEL"];
  docs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { docs, missing };
}

/* ---------------- model clues: pressure and flow, not wind speeds ---------------- */

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (d) => COMPASS[Math.floor((((d % 360) + 360) % 360) / 22.5 + 0.5) % 16];

/** Sea-level pressure at the region and two upstream points (so the gradient is visible), plus the flow direction. */
async function modelClues() {
  const pts = [
    ["Tampa Bay", REGION.point.lat, REGION.point.lon],
    ["north Florida / Georgia", 30.6, -83.0],
    ["central Gulf", 26.0, -87.0],
  ];
  const q = new URLSearchParams({
    latitude: pts.map((p) => p[1]).join(","), longitude: pts.map((p) => p[2]).join(","),
    hourly: "pressure_msl,wind_direction_10m", models: "ecmwf_ifs025", timeformat: "unixtime", timezone: REGION.timeZone, forecast_days: "7",
  });
  const r = await fetch(`${OPENMETEO()}/v1/forecast?${q}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`open-meteo HTTP ${r.status}`);
  const j = await r.json();
  const arr = Array.isArray(j) ? j : [j];
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: REGION.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const names = new Intl.DateTimeFormat("en-US", { timeZone: REGION.timeZone, weekday: "short" });
  const pick = (h, k) => h[`${k}_ecmwf_ifs025`] ?? h[k] ?? [];

  const days = new Map();
  arr[0].hourly.time.forEach((t, i) => {
    const key = dayKey(dayFmt, t * 1000);
    if (!days.has(key)) days.set(key, { label: names.format(t * 1000), idx: [] });
    days.get(key).idx.push(i);
  });
  const lines = ["Daily mean sea-level pressure (hPa) and the prevailing wind direction at Tampa Bay, from the ECMWF model. Use only to cross-check the discussions above (a pressure fall then rise with a wind shift suggests a front); don't quote these numbers."];
  let prev = null;
  for (const [date, d] of [...days].slice(0, 7)) {
    const mean = (h) => d.idx.reduce((a, i) => a + pick(h, "pressure_msl")[i], 0) / d.idx.length;
    const p0 = mean(arr[0].hourly), pN = mean(arr[1].hourly), pG = mean(arr[2].hourly);
    const u = d.idx.reduce((a, i) => a + Math.sin((pick(arr[0].hourly, "wind_direction_10m")[i] * Math.PI) / 180), 0);
    const v = d.idx.reduce((a, i) => a + Math.cos((pick(arr[0].hourly, "wind_direction_10m")[i] * Math.PI) / 180), 0);
    const dir = compass((Math.atan2(u, v) * 180) / Math.PI);
    const trend = prev == null ? "" : p0 - prev > 1.5 ? " rising" : p0 - prev < -1.5 ? " falling" : " steady";
    lines.push(`${date} ${d.label}: Tampa ${p0.toFixed(0)}${trend}; N.FL/GA ${(pN - p0 >= 0 ? "+" : "") + (pN - p0).toFixed(1)} vs Tampa; central Gulf ${(pG - p0 >= 0 ? "+" : "") + (pG - p0).toFixed(1)} vs Tampa; flow from ${dir}`);
    prev = p0;
  }
  return lines.join("\n");
}
const dayKey = (fmt, ms) => fmt.format(ms);
