import { compass, TAMPA_BAY, forecastUrl, stationUrl, parseForecast, parseObservation, rideableWindows, nearestHour } from "./lib.js";

const $ = (s) => document.querySelector(s);
const view = $("#view"), title = $("#title"), back = $("#back");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- spots (localStorage) ----
const load = () => {
  try { const s = JSON.parse(localStorage.getItem("spots")); if (Array.isArray(s)) return s; } catch {}
  return TAMPA_BAY.map((s) => ({ ...s, id: crypto.randomUUID() }));
};
let spots = load();
const save = () => { try { localStorage.setItem("spots", JSON.stringify(spots)); } catch {} };
save();

// ---- data ----
const json = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const getForecast = (s) => json(forecastUrl(s.lat, s.lon)).then(parseForecast);
const getObs = (s) => json(stationUrl(s.station)).then(parseObservation);

// ---- formatting ----
const fmt = (tz, opts) => new Intl.DateTimeFormat([], { timeZone: tz, ...opts });
const kn = (n) => Math.round(n);
const arrow = (dir) => `<span class="arrow" style="transform:rotate(${dir + 180}deg)" title="from ${compass(dir)}">↑</span>`;
const windowText = (w, tz) => {
  const d = fmt(tz, { weekday: "short" }), t = fmt(tz, { hour: "numeric" });
  return `${d.format(w.start)} ${t.format(w.start)}–${t.format(w.end + 3600e3)}`;
};
const ageText = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

// ---- chart ----
function chart(f, spot) {
  const W = 600, H = 200, L = 30, B = 22, hs = f.hours;
  if (!hs.length) return "";
  const t0 = hs[0].t, t1 = hs[hs.length - 1].t || t0 + 1;
  const top = Math.max(spot.max + 5, ...hs.map((h) => h.gust)), y = (v) => H - B - (v / top) * (H - B - 6);
  const x = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - 6);
  const line = (k) => hs.map((h, i) => `${i ? "L" : "M"}${x(h.t).toFixed(1)},${y(h[k]).toFixed(1)}`).join("");
  const bands = rideableWindows(hs, spot.min, spot.max).map((w) => `<rect x="${x(w.start)}" width="${Math.max(x(w.end + 3600e3) - x(w.start), 3)}" y="6" height="${H - B - 6}" fill="var(--good)" opacity=".15"/>`).join("");
  const ticks = [0, 10, 20, 30, 40].filter((v) => v < top).map((v) => `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 4}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--dim)">${v}</text>`).join("");
  const hf = fmt(f.timeZone, { hour: "numeric" });
  const xl = hs.filter((h, i) => i % 6 === 0).map((h) => `<text x="${x(h.t)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--dim)">${hf.format(h.t)}</text>`).join("");
  const nowX = Date.now() >= t0 && Date.now() <= t1 ? `<line x1="${x(Date.now())}" x2="${x(Date.now())}" y1="6" y2="${H - B}" stroke="var(--dim)" stroke-dasharray="3"/>` : "";
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wind forecast chart">${ticks}${bands}${nowX}
    <path d="${line("gust")}" fill="none" stroke="var(--dim)" stroke-width="1.5" stroke-dasharray="4 3"/>
    <path d="${line("speed")}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>${xl}</svg>
    <p class="dim">Solid: sustained · dashed: gusts · green: your ${spot.min}–${spot.max} kn range · knots</p>`;
}

// ---- views ----
async function list() {
  title.textContent = "SeaSensei"; back.hidden = true;
  view.innerHTML = spots.map((s) => `<a class="card" href="#/spot/${s.id}" data-id="${s.id}"><h2>${esc(s.name)}</h2><div class="dim">${s.min}–${s.max} kn${s.station ? " · live station" : ""}</div><div class="summary dim">Loading…</div></a>`).join("")
    || `<p class="dim">No spots yet. Tap + to add one.</p>`;
  spots.forEach(async (s) => {
    const el = view.querySelector(`[data-id="${s.id}"] .summary`);
    try {
      const f = await getForecast(s), w = rideableWindows(f.hours, s.min, s.max)[0], n = f.hours[0];
      if (el) el.innerHTML = (w ? `<span class="good">Rideable ${windowText(w, f.timeZone)}</span>` : "No rideable wind in the next 48 h") + (n ? ` · now ${kn(n.speed)} kn` : "");
    } catch (e) { if (el) el.innerHTML = `<span class="err">Forecast failed: ${esc(e.message)}</span>`; }
  });
}

async function detail(id) {
  const s = spots.find((x) => x.id === id);
  if (!s) return (location.hash = "");
  title.textContent = s.name; back.hidden = false;
  view.innerHTML = `<div class="card" id="now"></div><div class="card" id="fc">Loading forecast…</div>
    <div class="actions"><button id="edit">Edit range</button><button id="del">Delete spot</button></div>`;
  $("#del").onclick = () => { if (confirm(`Delete ${s.name}?`)) { spots = spots.filter((x) => x !== s); save(); location.hash = ""; } };
  $("#edit").onclick = () => {
    const r = prompt("Wind range in knots, min-max", `${s.min}-${s.max}`)?.match(/^\s*(\d+)\s*[-–]\s*(\d+)\s*$/);
    if (r && +r[1] <= +r[2]) { s.min = +r[1]; s.max = +r[2]; save(); detail(id); }
  };
  const [fc, ob] = await Promise.allSettled([getForecast(s), s.station ? getObs(s) : Promise.resolve(null)]);
  if (location.hash !== `#/spot/${id}`) return;
  const nowEl = $("#now");
  if (ob.status === "fulfilled" && ob.value) {
    const o = ob.value, h = fc.status === "fulfilled" ? nearestHour(fc.value.hours, o.t) : null;
    nowEl.innerHTML = `<h3>Now · ${esc(o.name)}</h3><div class="now"><div><span class="big">${kn(o.speed)}</span> kn ${arrow(o.dir)} ${compass(o.dir)}<div class="dim">gusting ${kn(o.gust)} · ${ageText(o.t)}</div></div>
      ${h ? `<div class="dim">HRRR said<br>${kn(h.speed)} kn ${arrow(h.dir)} ${compass(h.dir)}<br>gust ${kn(h.gust)}</div>` : ""}</div>`;
  } else if (ob.status === "rejected") nowEl.innerHTML = `<h3>Now</h3><div class="err">Station ${esc(s.station)}: ${esc(ob.reason.message)}</div>`;
  else nowEl.remove();
  if (fc.status === "rejected") { $("#fc").innerHTML = `<div class="err">Forecast failed: ${esc(fc.reason.message)}</div>`; return; }
  const f = fc.value, wins = rideableWindows(f.hours, s.min, s.max);
  const dayF = fmt(f.timeZone, { weekday: "long", month: "short", day: "numeric" }), hourF = fmt(f.timeZone, { hour: "numeric" });
  let html = `<h3>HRRR forecast</h3>${wins.length ? wins.map((w) => `<div class="good">Rideable ${windowText(w, f.timeZone)}</div>`).join("") : `<div class="dim">No rideable wind in the next 48 h</div>`}${chart(f, s)}`;
  let lastDay = "";
  for (const h of f.hours) {
    const d = dayF.format(h.t); if (d !== lastDay) { html += `<div class="day">${d}</div>`; lastDay = d; }
    const ok = h.speed >= s.min && h.speed <= s.max;
    html += `<div class="hr${ok ? " ok" : ""}"><span>${hourF.format(h.t)}</span><span><b>${kn(h.speed)}</b> kn <span class="dim">g${kn(h.gust)}</span></span><span>${arrow(h.dir)} ${compass(h.dir)}</span></div>`;
  }
  $("#fc").innerHTML = html + `<p class="dim">Open-Meteo · model gfs_hrrr</p>`;
}

const route = () => { const m = location.hash.match(/^#\/spot\/(.+)$/); m ? detail(m[1]) : list(); };
addEventListener("hashchange", route);
back.onclick = () => (location.hash = "");
route();

// ---- add spot ----
const dlg = $("#addDlg"), form = $("#addForm"); let map, pin;
$("#add").onclick = () => {
  form.reset(); pin?.remove(); pin = null; dlg.showModal();
  if (!map && window.L) {
    map = L.map("map").setView([27.75, -82.65], 9);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(map);
    map.on("click", (e) => { pin ? pin.setLatLng(e.latlng) : (pin = L.marker(e.latlng).addTo(map)); });
  }
  if (map) { setTimeout(() => map.invalidateSize(), 50); }
};
form.addEventListener("submit", (e) => {
  if (e.submitter?.value !== "ok") return;
  if (!pin) { e.preventDefault(); alert("Tap the map to drop a pin first."); return; }
  const f = new FormData(form), ll = pin.getLatLng();
  if (+f.get("min") > +f.get("max")) { e.preventDefault(); alert("Min must be ≤ max."); return; }
  spots.push({ id: crypto.randomUUID(), name: f.get("name").trim(), lat: +ll.lat.toFixed(4), lon: +ll.lng.toFixed(4), min: +f.get("min"), max: +f.get("max"), ...(f.get("station") ? { station: f.get("station") } : {}) });
  pin.remove(); save(); route();
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
