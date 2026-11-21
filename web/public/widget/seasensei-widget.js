// SeaSensei home-screen widget for Scriptable (https://scriptable.app, free).
//
// What it shows: the wind at a NOAA station right now (speed, gust, which way it blows, how old the reading is) and
// SeaSensei's forecast at the station: one bar per hour, the past 6 h dimmed and the next 24 h, coloured on the app's
// wind scale, with the likely range as a faint cap, nights shaded, a dashed line at MIN knots and a "now" marker.
// Medium: both. Small: the wind now. Large: a bigger chart and today's and tomorrow's sessions.
//
// Install (once):
//   1. Install Scriptable from the App Store and open it.
//   2. Tap +, paste this whole file (it lives at https://seasensei.com/widget/seasensei-widget.js), name it SeaSensei.
//      Tap ▶ once to preview it.
//   3. Long-press the Home Screen → Edit → Add Widget → Scriptable → Medium (or Small / Large) → Add Widget.
//   4. Long-press the new widget → Edit Widget → Script: SeaSensei. "When Interacting": Open URL (opens the app).
// iOS decides how often widgets refresh (roughly every 15–30 min); the data is cached on the server, so frequent
// refreshes cost nothing. Without a connection it shows the last data it had, marked "offline".
//
// Data: GET {BASE}/api/widget?station=STATION&min=MIN (public JSON; the server builds it with the app's own engine).

const STATION = "8726412"; // NOAA CO-OPS: Middle Tampa Bay
const BASE = "https://seasensei.com";
const MIN = 15; // knots: the dashed line, and the lightest wind a session counts
const SPOT = ""; // optional: a spot id to open on tap (e.g. "seed-fort-de-soto"); empty opens the board

/* ---------------- look ---------------- */

const C = {
  bg: "#0b1220", panel: "#111a2c", night: "#070b15", fg: "#f1f5f9", fg2: "#a7b0c0", fg3: "#6b7486",
  grid: "#ffffff", warn: "#f5b544", now: "#ffffff",
};
const SCALE = 30; // the chart's fixed top, knots
const HOUR = 3600e3;

/* ---------------- pure helpers (no Scriptable APIs) ---------------- */

function ago(t, now) {
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return "just now";
  if (m < 90) return m + " min ago";
  const h = Math.round(m / 60);
  return h < 36 ? h + " h ago" : Math.round(h / 24) + " d ago";
}

/** The hour (0–23) at t in the station's zone, falling back to the phone's. */
function localHour(t, tz) {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(t));
    const h = p.find((x) => x.type === "hour");
    if (h) return Number(h.value) % 24;
  } catch (e) { /* no Intl time zones: the phone's clock */ }
  return new Date(t).getHours();
}

/** The calendar day at t in the station's zone ("11/21/2026"), falling back to the phone's. */
function localDay(t, tz) {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date(t)); }
  catch (e) { return new Date(t).toDateString(); }
}

const hourLabel = (h) => (h === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? h + "a" : (h - 12) + "p");
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round = (x) => Math.round(x);

/** An arrow (a dart) centred at (cx, cy), pointing along a compass bearing (0 = up/north, clockwise). */
function dart(cx, cy, r, bearing) {
  const b = (bearing * Math.PI) / 180;
  const at = (ang, len) => [cx + Math.sin(b + ang) * len, cy - Math.cos(b + ang) * len];
  return [at(0, r), at((140 * Math.PI) / 180, r * 0.95), at(Math.PI, r * 0.38), at((-140 * Math.PI) / 180, r * 0.95)];
}

/**
 * The widget as a list of primitive draw ops, from the /api/widget payload. Coordinates in points, origin top-left.
 *   { k: "rect", x, y, w, h, c, a?, r? }           filled (rounded) rectangle
 *   { k: "line", x1, y1, x2, y2, c, a?, w? }        stroked line
 *   { k: "poly", pts: [[x, y], …], c, a? }          filled polygon
 *   { k: "ring", x, y, r, c, a?, w? }               stroked circle
 *   { k: "text", t, x, y, w, h, size, weight, c, a?, align? }   weight: regular|medium|semibold|bold|heavy|rounded
 * `status`: { now (ms), offlineSince (ms of the cached data) | null, failed (no data at all) }.
 */
function layout(data, family, W, H, status) {
  const ops = [];
  const now = status.now;
  const text = (t, x, y, w, h, size, weight, c, extra) => ops.push(Object.assign({ k: "text", t: String(t), x, y, w, h, size, weight, c }, extra || {}));
  ops.push({ k: "rect", x: 0, y: 0, w: W, h: H, c: C.bg });

  if (!data) {
    text("SeaSensei", 14, 14, W - 28, 18, 13, "semibold", C.fg);
    text(status.failed ? "Can't reach seasensei.com yet" : "Loading…", 14, H / 2 - 10, W - 28, 20, 12, "regular", C.fg2);
    text("Tap to open the app", 14, H - 26, W - 28, 16, 10, "regular", C.fg3);
    return ops;
  }
  const P = family === "small" ? 13 : 14;
  const lw = family === "small" ? W - 2 * P : family === "large" ? W * 0.42 : W * 0.33;

  // ---- the wind now (left column; the whole small widget; the top-left block of the large one)
  const n = data.now;
  const big = family === "large" ? 52 : family === "small" ? 50 : 46;
  let y = P - 4;
  if (family !== "medium") { text(data.station ? data.station.name : "", P, y + 2, lw, 14, 11, "semibold", C.fg2); y += 16; }
  if (n) {
    text(String(round(n.speed)), P, y, lw * 0.62, big * 1.15, big, "rounded", n.color || C.fg);
    const gx = P + lw * 0.6;
    text("kn", gx, y + big * 0.22, lw * 0.4, 14, 12, "medium", C.fg2);
    text(n.gust != null ? "g " + round(n.gust) : "", gx, y + big * 0.22 + 15, lw * 0.4, 16, 14, "semibold", C.fg);
    y += big * 1.12;
    const ar = family === "small" ? 10 : 10;
    ops.push({ k: "ring", x: P + ar, y: y + ar + 1, r: ar + 1, c: C.fg3, a: 0.6, w: 1 });
    // The station reports where the wind comes FROM; the arrow points where it blows TO.
    ops.push({ k: "poly", pts: dart(P + ar, y + ar + 1, ar - 2, (n.dir + 180) % 360), c: C.fg });
    text(n.compass + "  " + round(n.dir) + "°", P + 2 * ar + 7, y + 3, lw - 2 * ar - 7, 16, 13, "semibold", C.fg);
    y += 2 * ar + 7;
    const age = now - n.t;
    text(ago(n.t, now), P, y, lw, 14, 11, "regular", age > 30 * 60e3 ? C.warn : C.fg2);
  } else {
    text("–", P, y, lw, big * 1.15, big, "rounded", C.fg3);
    y += big * 1.12;
    text("No reading", P, y + 3, lw, 16, 13, "semibold", C.fg2);
    text("station quiet", P, y + 23, lw, 14, 11, "regular", C.fg3);
  }
  const off = status.offlineSince != null ? "offline · " + ago(status.offlineSince, now) : null;
  const foot = family === "medium" ? (data.station ? data.station.name : "") : "";
  if (family === "medium") text(foot, P, H - P - 13, lw, 13, 10, "medium", C.fg3);
  if (off) text(off, P, family === "medium" ? H - P - 26 : H - P - 13, family === "small" ? lw : W - 2 * P, 13, 10, "semibold", C.warn);
  if (family === "small") {
    if (data.headline && !off) text(data.headline, P, H - P - 28, lw, 30, 11, "semibold", C.fg2);
    return ops;
  }

  // ---- the forecast chart
  const gutter = family === "large" ? 16 : 0; // the knots scale, left of the large chart
  const cx = (family === "large" ? P : P + lw + 6) + gutter, cw = W - cx - P;
  let top, bottom;
  if (family === "large") {
    const rx = P + lw + 4, rw = W - P - rx;
    text(data.headline || "", rx, P + 14, rw, 40, 14, "semibold", C.fg);
    // the strongest hour still ahead today (daylight), from the chart's own hours
    const day = (data.forecast || []).filter((h) => h.t + HOUR > now && !h.night && localDay(h.t, data.tz) === localDay(now, data.tz));
    const peak = day.reduce((b, h) => (!b || h.speed > b.speed ? h : b), null);
    if (peak) {
      text("Peak today", rx, P + 60, rw, 14, 11, "medium", C.fg2);
      text(round(peak.speed) + " kn", rx, P + 74, rw, 24, 20, "bold", peak.color);
      text("at " + hourLabel(localHour(peak.t, data.tz)).replace("a", " AM").replace("p", " PM") + (peak.hi != null ? " · up to " + round(peak.hi) : ""), rx, P + 98, rw, 14, 11, "regular", C.fg2);
    }
    top = P + 128; bottom = H - P - 92;
  } else {
    const hl = data.headline || "";
    text(hl, cx, P - 3, cw, 16, hl.length > 34 ? 11 : 12, "semibold", C.fg);
    top = P + 18; bottom = H - P - 12;
  }
  const hours = data.forecast || [];
  const chartH = bottom - top;
  ops.push({ k: "rect", x: cx, y: top, w: cw, h: chartH, c: C.panel, r: 5 });
  if (!hours.length) {
    text(data.error ? "Forecast unavailable" : "No forecast", cx, top + chartH / 2 - 8, cw, 16, 12, "medium", C.fg3, { align: "center" });
  } else {
    const t0 = hours[0].t, n = hours.length, bw = cw / n;
    const xOf = (t) => cx + ((t - t0) / HOUR) * bw;
    const yOf = (kn) => bottom - (clamp(kn, 0, SCALE) / SCALE) * (chartH - 4);
    // nights, as darker bands
    for (let i = 0; i < n; ) {
      if (!hours[i].night) { i++; continue; }
      let j = i;
      while (j < n && hours[j].night) j++;
      ops.push({ k: "rect", x: xOf(hours[i].t), y: top, w: (j - i) * bw, h: chartH, c: C.night, a: 0.9 });
      i = j;
    }
    // the rider's minimum, dashed
    const ly = yOf(MIN);
    for (let x = cx + 2; x < cx + cw - 2; x += 6) ops.push({ k: "line", x1: x, y1: ly, x2: Math.min(x + 3, cx + cw - 2), y2: ly, c: C.grid, a: 0.35, w: 1 });
    if (!gutter) text(String(MIN), cx + 2, ly - 11, 17, 11, 8, "semibold", C.fg2);
    const gap = bw > 6 ? 1.5 : bw > 3.5 ? 1 : 0.5;
    for (const h of hours) {
      const x = xOf(h.t) + gap / 2, w = Math.max(1, bw - gap), past = h.t + HOUR <= now;
      const a = past ? 0.32 : 1;
      if (h.lo != null && h.hi != null && h.hi > h.speed) {
        ops.push({ k: "rect", x, y: yOf(h.hi), w, h: Math.max(1, yOf(h.speed) - yOf(h.hi)), c: h.color, a: a * 0.28, r: Math.min(2, w / 2) });
      }
      const yt = yOf(h.speed);
      ops.push({ k: "rect", x, y: yt, w, h: Math.max(1.5, bottom - yt), c: h.color, a, r: Math.min(2, w / 2) });
    }
    // now
    const nx = clamp(xOf(now), cx, cx + cw);
    ops.push({ k: "line", x1: nx, y1: top + 4, x2: nx, y2: bottom, c: C.now, a: 0.85, w: 1 });
    ops.push({ k: "poly", pts: [[nx - 3.5, top], [nx + 3.5, top], [nx, top + 4.5]], c: C.now });
    // hour labels every 6 h, in the station's zone
    for (const h of hours) {
      const lh = localHour(h.t, data.tz);
      if (lh % 6) continue;
      const x = xOf(h.t);
      if (x < cx + 4 || x > cx + cw - 4) continue;
      ops.push({ k: "line", x1: x, y1: bottom, x2: x, y2: bottom + 2.5, c: C.fg3, w: 1 });
      text(hourLabel(lh), x - 14, bottom + 2, 28, 11, 9, "medium", C.fg3, { align: "center" });
    }
    if (family === "large") {
      // the scale
      for (const k of [10, 20, 30]) text(k + "", cx - gutter - 2, yOf(k) - 5, gutter, 11, 8, "medium", C.fg3, { align: "right" });
      text(String(MIN), cx - gutter - 2, ly - 5, gutter, 11, 8, "semibold", C.fg2, { align: "right" });
    }
  }

  // ---- large: the sessions
  if (family === "large") {
    let sy = bottom + 20;
    text("Sessions · " + (data.min || MIN) + "–" + (data.max || 30) + " kn", P, sy, W - 2 * P, 14, 11, "semibold", C.fg2);
    sy += 17;
    const list = data.sessions || [];
    if (!list.length) text("None today or tomorrow", P, sy, W - 2 * P, 16, 12, "regular", C.fg3);
    for (const s of list.slice(0, 3)) {
      const col = s.chance === "Likely" ? "#34d399" : s.chance === "Possible" ? C.warn : C.fg3;
      ops.push({ k: "rect", x: P, y: sy + 4, w: 7, h: 7, c: col, r: 3.5 });
      text(s.text, P + 13, sy, W - 2 * P - 13, 16, 12, "medium", C.fg);
      sy += 18;
    }
    text(data.station ? "SeaSensei forecast at " + data.station.name : "", P, H - P - 12, W - 2 * P, 12, 9, "regular", C.fg3, { align: "right" });
  }
  return ops;
}

/* ---------------- Scriptable ---------------- */

// Widget sizes in points, by screen width × height (Apple's published sizes); the closest screen wins.
const SIZES = [
  [430, 932, 170, 364, 170, 382], [428, 926, 170, 364, 170, 382], [440, 956, 170, 364, 170, 382],
  [414, 896, 169, 360, 169, 379], [414, 736, 159, 348, 157, 357], [402, 874, 162, 345, 162, 364],
  [393, 852, 158, 338, 158, 354], [390, 844, 158, 338, 158, 354], [375, 812, 155, 329, 155, 345],
  [360, 780, 155, 329, 155, 345], [375, 667, 148, 321, 148, 324], [320, 568, 141, 292, 141, 311],
];
function sizeFor(family) {
  let s = SIZES[7];
  try {
    const d = Device.screenSize(), w = Math.min(d.width, d.height), h = Math.max(d.width, d.height);
    s = SIZES.reduce((b, x) => (Math.abs(x[0] - w) + Math.abs(x[1] - h) < Math.abs(b[0] - w) + Math.abs(b[1] - h) ? x : b), SIZES[0]);
  } catch (e) { /* default */ }
  if (family === "small") return { w: s[2], h: s[2] };
  if (family === "large") return { w: s[3], h: s[5] };
  return { w: s[3], h: s[4] };
}

function font(weight, size) {
  switch (weight) {
    case "rounded": return Font.boldRoundedSystemFont(size);
    case "heavy": return Font.heavySystemFont(size);
    case "bold": return Font.boldSystemFont(size);
    case "semibold": return Font.semiboldSystemFont(size);
    case "medium": return Font.mediumSystemFont(size);
    default: return Font.systemFont(size);
  }
}

function paint(ops, W, H) {
  const ctx = new DrawContext();
  ctx.size = new Size(W, H);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  for (const o of ops) {
    const col = new Color(o.c, o.a == null ? 1 : o.a);
    if (o.k === "rect") {
      ctx.setFillColor(col);
      const r = new Rect(o.x, o.y, o.w, o.h);
      if (o.r) { const p = new Path(); p.addRoundedRect(r, o.r, o.r); ctx.addPath(p); ctx.fillPath(); }
      else ctx.fillRect(r);
    } else if (o.k === "line") {
      const p = new Path();
      p.move(new Point(o.x1, o.y1));
      p.addLine(new Point(o.x2, o.y2));
      ctx.addPath(p);
      ctx.setStrokeColor(col);
      ctx.setLineWidth(o.w || 1);
      ctx.strokePath();
    } else if (o.k === "poly") {
      const p = new Path();
      p.addLines(o.pts.map((q) => new Point(q[0], q[1])));
      p.closeSubpath();
      ctx.addPath(p);
      ctx.setFillColor(col);
      ctx.fillPath();
    } else if (o.k === "ring") {
      ctx.setStrokeColor(col);
      ctx.setLineWidth(o.w || 1);
      ctx.strokeEllipse(new Rect(o.x - o.r, o.y - o.r, 2 * o.r, 2 * o.r));
    } else if (o.k === "text") {
      ctx.setFont(font(o.weight, o.size));
      ctx.setTextColor(col);
      if (o.align === "center") ctx.setTextAlignedCenter();
      else if (o.align === "right") ctx.setTextAlignedRight();
      else ctx.setTextAlignedLeft();
      ctx.drawTextInRect(o.t, new Rect(o.x, o.y, o.w, o.h));
    }
  }
  return ctx.getImage();
}

async function load() {
  const fm = FileManager.local();
  const file = fm.joinPath(fm.cacheDirectory(), "seasensei-widget-" + STATION + ".json");
  try {
    const req = new Request(BASE + "/api/widget?station=" + encodeURIComponent(STATION) + "&min=" + MIN);
    req.timeoutInterval = 15;
    const data = await req.loadJSON();
    if (!data || !data.station) throw new Error((data && data.error) || "bad answer");
    try { fm.writeString(file, JSON.stringify({ savedAt: Date.now(), data })); } catch (e) { /* cache is best effort */ }
    return { data, offlineSince: null };
  } catch (e) {
    try {
      if (fm.fileExists(file)) {
        const saved = JSON.parse(fm.readString(file));
        return { data: saved.data, offlineSince: saved.savedAt };
      }
    } catch (e2) { /* unreadable cache */ }
    return { data: null, offlineSince: null, failed: true };
  }
}

async function main() {
  const family = config.widgetFamily || "medium";
  const { data, offlineSince, failed } = await load();
  const { w, h } = sizeFor(family);
  const widget = new ListWidget();
  widget.setPadding(0, 0, 0, 0);
  widget.backgroundColor = new Color(C.bg);
  try {
    widget.backgroundImage = paint(layout(data, family, w, h, { now: Date.now(), offlineSince, failed: !!failed }), w, h);
  } catch (e) {
    const t = widget.addText("SeaSensei: " + e.message);
    t.font = Font.systemFont(11);
    t.textColor = new Color(C.fg2);
  }
  widget.url = SPOT ? BASE + "/?spot=" + encodeURIComponent(SPOT) : BASE + "/";
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60e3);
  if (config.runsInWidget) Script.setWidget(widget);
  else if (family === "small") await widget.presentSmall();
  else if (family === "large") await widget.presentLarge();
  else await widget.presentMedium();
  Script.complete();
}

await main();
