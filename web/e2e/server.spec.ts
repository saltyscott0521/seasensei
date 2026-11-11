import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { expect, test } from "@playwright/test";

/**
 * The daily wind discussion, end to end on the real Node server (server/server.mjs): it fetches the NWS
 * products and pressure trend from stand-in upstreams, calls a stand-in Anthropic API, then publishes,
 * archives and serves the result. Then the forecast side: the run archive, the station observations and the
 * learning behind /api/calibration, against stand-in Open-Meteo, NOAA, IEM and R2. No real network, no real key.
 */

const serverDir = fileURLToPath(new URL("../server", import.meta.url));
const TZ = "America/New_York";
const dayKey = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
const today = () => dayKey(Date.now());
const plus = (n: number) => dayKey(Date.now() + n * 864e5);

/* ---------------- stand-in upstreams ---------------- */

const AFD = `000
FXUS62 KTBW 291231
AFDTBW

Area Forecast Discussion
National Weather Service Tampa Bay Ruskin FL

.KEY MESSAGES...
Issued at 829 AM EDT Tue Sep 29 2026

- Moderate rain chances return today.

&&

.DISCUSSION...
Issued at 230 AM EDT Tue Sep 29 2026

A weak front extending through the Florida Straits will slowly lift northward, and high pressure over the Atlantic builds in by Thursday, bringing east to southeasterly flow.

&&

.AVIATION...
Ignore this aviation section.

&&

.MARINE...
Issued at 230 AM EDT Tue Sep 29 2026

Easterly flow becomes onshore each afternoon.

&&
`;
const PRODUCTS: Record<string, { office: string; type: string; text: string }> = {
  afd1: { office: "KTBW", type: "AFD", text: AFD },
  cwf1: { office: "KTBW", type: "CWF", text: "Coastal Waters Forecast\nGulf waters: east winds becoming southeast, seas slight." },
  spd1: { office: "KWBC", type: "PMD", text: "000\nFXUS01 KWBC 291938\nPMDSPD\n\nShort Range Forecast Discussion\nA cold front over the Tennessee Valley sags south." },
  epd1: { office: "KWBC", type: "PMD", text: "000\nFXUS02 KWBC 291954\nPMDEPD\n\nExtended Forecast Discussion\nA trailing frontal boundary meanders through the Southeast, then progresses south toward the Gulf by mid-next week." },
  tab1: { office: "KWNH", type: "PMD", text: "000\nFXUS06 KWNH 291726\nPMDEP6\nDAY 6 FORECAST\nSTATION TABLE THAT MUST NOT BE USED" },
  two1: { office: "KNHC", type: "TWO", text: "Tropical Weather Outlook\nNorth Atlantic...Caribbean Sea and the Gulf of America: no tropical cyclones expected." },
};

type Anthropic = { headers: http.IncomingHttpHeaders; body: any };
type Put = { path: string; headers: http.IncomingHttpHeaders; body: Buffer };
type Stubs = {
  url: string; calls: Anthropic[]; failNhc: boolean; leakFirst: boolean;
  runs: Record<string, number>; puts: Put[]; metaHits: number; archiveAsks: URLSearchParams[]; close: () => Promise<void>;
  /** R2: every object by path (PUTs land here; tests can plant some). */
  objects: Map<string, Buffer>;
  /** One Open-Meteo server answering the metadata out of turn: these runs are served first, one per request. */
  metaQueue: Record<string, number[]>;
  /** The run the *data* servers hold, when they lag behind (or run ahead of) the metadata. */
  dataRuns: Record<string, number>;
  /** PUTs to refuse (HTTP 403) for keys matching this, and how many were refused. */
  failPuts: { match: RegExp; left: number } | null; refused: number;
  /** Old Port Tampa's sensor is frozen at 0.0 kn from 066°, and the airport reports a calm. */
  frozen: boolean;
};
const DATASET: Record<string, string> = { gfs_hrrr: "ncep_hrrr_conus", gfs_global: "ncep_gfs013" };
// The stand-in Open-Meteo's current run per dataset (unix seconds). 01Z NBM isn't a 3-hourly run, so it's skipped.
const HOUR_S = 3600;
const RUN0 = Math.floor(Date.now() / 1000 / (6 * HOUR_S)) * 6 * HOUR_S - 6 * HOUR_S; // a recent 00/06/12/18Z
// The stand-in stations' readings are pinned to the hour the tests started in and stop 36 minutes before it, so every
// hour they cover is already finished: nothing shifts if the clock passes :00 or :30 mid-run.
const HOUR0 = Math.floor(Date.now() / 1000 / HOUR_S) * HOUR_S;
const initialRuns = () => ({ ncep_hrrr_conus: RUN0 + 5 * HOUR_S, ncep_rrfs_conus: RUN0, ncep_nbm_conus: RUN0 + HOUR_S, ecmwf_ifs025: RUN0, ncep_gfs013: RUN0 });

function draft(over: Record<string, unknown> = {}) {
  const detail = { detail: "Why it matters in a sentence or two.", timing: "Thursday", windImpact: "Winds turn easterly and offshore on the Gulf beaches." };
  return {
    headline: "A stalled front & Atlantic high hand the wind to the east this week.",
    bottomLine: "A weak boundary lifts north while high pressure builds, so the flow turns easterly and steady.",
    regime: "Easterly flow, humid",
    drivers: [
      { kind: "front", title: "Front stalls", ...detail, sources: ["AFD", "WPC_EXT"] },
      { kind: "pressure", title: "Invented feature", ...detail, sources: ["MADE_UP"] }, // cites nothing real: dropped
      { kind: "storms", title: "Afternoon storms", ...detail, sources: ["CWF", "MADE_UP"] }, // keeps only what's real
    ],
    days: [-1, 0, 1, 2, 3, 3].map((n, i) => ({ date: plus(n), label: "Day", pattern: `Pattern ${i}.`, windTrend: "steady", flow: "E", kiterTakeaway: "Takeaway.", confidence: "medium" })), // yesterday and a repeat get dropped
    watch: [{ what: "Where the front stalls", when: "Wednesday night" }],
    uncertainty: "The back half of the week depends on the front's timing.",
    ...over,
  };
}

async function startStubs(): Promise<Stubs> {
  const stubs = {
    calls: [] as Anthropic[], failNhc: false, leakFirst: false, runs: initialRuns(), puts: [] as Put[], metaHits: 0, archiveAsks: [] as URLSearchParams[],
    objects: new Map(), metaQueue: {}, dataRuns: {}, failPuts: null, refused: 0, frozen: false,
  } as unknown as Stubs;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const p = url.pathname;

    // R2 (S3 API): keep what was PUT, hand it back, list it
    if (req.method === "PUT" && p.startsWith("/kite-archive/")) {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (stubs.failPuts?.left && stubs.failPuts.match.test(p)) { stubs.failPuts.left--; stubs.refused++; res.writeHead(403); return res.end("<Error><Code>AccessDenied</Code></Error>"); }
        const body = Buffer.concat(chunks);
        stubs.puts.push({ path: p, headers: req.headers, body });
        stubs.objects.set(p, body);
        res.writeHead(200); res.end();
      });
      return;
    }
    if (p === "/kite-archive" && url.searchParams.get("list-type") === "2") {
      const prefix = `/kite-archive/${url.searchParams.get("prefix") ?? ""}`;
      const keys = [...stubs.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      res.writeHead(200, { "content-type": "application/xml" });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated>${keys.map((k) => `<Contents><Key>${k.slice("/kite-archive/".length)}</Key></Contents>`).join("")}</ListBucketResult>`);
    }
    if (p.startsWith("/kite-archive/")) {
      const body = stubs.objects.get(p);
      res.writeHead(body ? 200 : 404);
      return res.end(body ?? "<Error><Code>NoSuchKey</Code></Error>");
    }
    // Open-Meteo run metadata
    const meta = p.match(/^\/data\/(\w+)\/static\/meta\.json$/);
    if (meta && stubs.runs[meta[1]] != null) {
      stubs.metaHits++;
      const run = stubs.metaQueue[meta[1]]?.shift() ?? stubs.runs[meta[1]];
      return send(200, { last_run_initialisation_time: run, last_run_availability_time: run + 1800, data_end_time: run + 48 * HOUR_S, temporal_resolution_seconds: 3600 });
    }
    // Stations for the archive's points: two NOAA sensors in the bay, one far away; one airport
    if (p === "/mdapi/prod/webapi/stations.json") return send(200, { stations: [
      { id: "8726607", name: "Old Port Tampa", lat: 27.8578, lng: -82.5528 },
      { id: "8726724", name: "Clearwater Beach", lat: 27.9783, lng: -82.8317 },
      { id: "8518750", name: "The Battery", lat: 40.7006, lng: -74.0142 },
    ] });
    if (p === "/api/1/currents.json") return send(200, { data: [{ station: "SPG", name: "ST PETERSBURG", lat: 27.765, lon: -82.627, sknt: 8 }] });
    // NOAA wind, 6-minute readings as strings. Clearwater has no wind sensor. In the hour two before this one,
    // Old Port Tampa's sensor was down but for two readings: the rest are "" (which Number() would read as 0 kn).
    if (p === "/api/prod/datagetter") {
      if (url.searchParams.get("station") !== "8726607") return send(200, { error: { message: "No data was found." } });
      const hour = HOUR0 * 1000, data = [];
      for (let t = hour - 4 * 3600e3; t < hour - 1800e3; t += 360e3) {
        const at = t - (hour - 2 * 3600e3), gap = at >= -1800e3 && at < 1800e3, kept = at === 0 || at === 360e3;
        const stamp = new Date(t).toISOString().slice(0, 16).replace("T", " ");
        if (stubs.frozen) data.push({ t: stamp, s: "0.0", d: "66.0", dr: "ENE", g: ((t / 360e3) % 3 * 0.39).toFixed(2), f: "0,0" });
        else data.push(gap && !kept ? { t: stamp, s: "", d: "", dr: "", g: "", f: "1,1" } : gap ? { t: stamp, s: "12.0", d: "90.0", dr: "E", g: "15.0", f: "0,0" } : { t: stamp, s: "10.0", d: (t / 360e3) % 2 ? "350.0" : "10.0", dr: "N", g: "13.0", f: "0,0" });
      }
      return send(200, { metadata: { id: "8726607", name: "Old Port Tampa" }, data });
    }
    // IEM: an airport's 5-minute history for a day; gusts are null when there are none
    if (p === "/api/1/obhistory.json") {
      const data = [];
      for (let t = HOUR0 * 1000 - 4 * 3600e3; t < HOUR0 * 1000 - 1800e3; t += 300e3)
        if (new Date(t).toISOString().slice(0, 10) === url.searchParams.get("date")) data.push({ utc_valid: `${new Date(t).toISOString().slice(0, 16)}Z`, sknt: stubs.frozen ? 0 : 8, drct: stubs.frozen ? 0 : 60, gust: null });
      return send(200, { data });
    }
    // The archive's forecast request: one model, wind + temperature + pressure, many points
    if (p === "/v1/forecast" && url.searchParams.get("hourly")?.includes("wind_gusts_10m")) {
      stubs.archiveAsks.push(url.searchParams);
      const lats = url.searchParams.get("latitude")!.split(","), lons = url.searchParams.get("longitude")!.split(",");
      const start = Math.floor(Date.now() / 86400e3) * 86400 - 86400; // past_days=1
      const time = Array.from({ length: 24 * 4 }, (_, i) => start + i * HOUR_S);
      const vars = url.searchParams.get("hourly")!.split(",");
      // Each run's numbers differ, so a response can be told from the previous run's.
      const model = url.searchParams.get("models")!, dataset = DATASET[model] ?? model;
      const run = stubs.dataRuns[dataset] ?? stubs.runs[dataset];
      return send(200, lats.map((la, i) => ({
        latitude: +la + 0.01, longitude: +lons[i] - 0.01, elevation: 0,
        hourly_units: { time: "unixtime", wind_speed_10m: "kn" },
        hourly: { time, ...Object.fromEntries(vars.map((v) => [v, time.map((t) => (t % 7) + i + ((run / HOUR_S) % 5))])) },
      })));
    }

    if (req.method === "POST" && p === "/v1/messages") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        stubs.calls.push({ headers: req.headers, body: JSON.parse(raw) });
        const leaky = stubs.leakFirst && stubs.calls.length === 1;
        const out = leaky ? draft({ bottomLine: "Winds of 20 knots and gusts to 30 mph are likely." }) : draft();
        send(200, { id: "msg_test", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text: JSON.stringify(out) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 4321, output_tokens: 987 } });
      });
      return;
    }

    const list = p.match(/^\/products\/types\/([A-Z]+)(?:\/locations\/([A-Z]+))?$/);
    if (list) {
      if (list[1] === "TWO" && stubs.failNhc) return send(503, { title: "down" });
      const graph = Object.entries(PRODUCTS).filter(([, v]) => v.type === list[1]).map(([id, v]) => ({ id, issuingOffice: v.office, issuanceTime: "2026-09-29T12:31:00+00:00", productName: v.type }));
      return send(200, { "@graph": graph });
    }
    const prod = p.match(/^\/products\/(\w+)$/);
    if (prod && PRODUCTS[prod[1]]) return send(200, { id: prod[1], issuanceTime: "2026-09-29T12:31:00+00:00", productText: PRODUCTS[prod[1]].text });
    if (p === "/alerts/active") return send(200, { "@graph": [] });

    if (p === "/v1/forecast") {
      const start = Math.floor(Date.now() / 86400e3) * 86400;
      const time = Array.from({ length: 7 * 24 }, (_, i) => start + i * 3600);
      const hourly = { time, pressure_msl: time.map(() => 1015), wind_direction_10m: time.map(() => 100) };
      return send(200, [0, 1, 2].map(() => ({ timezone: TZ, hourly })));
    }
    send(404, { error: `no stub for ${p}` });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  stubs.url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  stubs.close = () => new Promise<void>((r) => server.close(() => r()));
  return stubs;
}

/* ---------------- the real server under test ---------------- */

const freePort = () => new Promise<number>((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });

type Running = { base: string; dataDir: string; logs: () => string; stop: () => Promise<void> };

async function startServer(stubs: Stubs, env: Record<string, string> = {}): Promise<Running> {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "seasensei-data-"));
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "seasensei-dist-"));
  fs.writeFileSync(path.join(distDir, "index.html"), "<!doctype html><title>SeaSensei</title>");
  let logs = "";
  const child: ChildProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, PORT: String(port), DIST_DIR: distDir, DATA_DIR: dataDir,
      NWS_BASE: stubs.url, OPENMETEO_BASE: stubs.url, COOPS_BASE: stubs.url, IEM_BASE: stubs.url, ANTHROPIC_BASE_URL: stubs.url, ANTHROPIC_API_KEY: "test-key",
      DISCUSSION_HOUR: "0", DISCUSSION_BOOT_DELAY_MS: "50", SITE_URL: "https://example.test", ...env,
    },
  });
  child.stdout!.on("data", (c) => (logs += c));
  child.stderr!.on("data", (c) => (logs += c));
  const base = `http://127.0.0.1:${port}`;
  await expect.poll(async () => fetch(`${base}/healthz`).then((r) => r.ok).catch(() => false), { timeout: 15_000 }).toBe(true);
  return { base, dataDir, logs: () => logs, stop: async () => { child.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(distDir, { recursive: true, force: true }); } };
}

const latest = async (base: string) => (await (await fetch(`${base}/api/discussion`)).json()) as { discussion: any; configured: boolean };
const published = (base: string) => expect.poll(async () => (await latest(base)).discussion?.date ?? null, { timeout: 20_000 }).toBe(today());

/* ---------------- tests ---------------- */

test("publishes the day's discussion on boot: Sonnet, grounded in the NWS text, citations checked, archived and in the feed", async () => {
  const stubs = await startStubs();
  const app = await startServer(stubs);
  try {
    await published(app.base);
    const { discussion: d, configured } = await latest(app.base);
    expect(configured).toBe(true);

    // what we asked for
    expect(stubs.calls).toHaveLength(1);
    const { headers, body } = stubs.calls[0];
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.system).toMatch(/why, not the numbers/);
    expect(body.system).toMatch(/No numbers for wind/);
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.fallbacks).toBe("default");
    expect(String(headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    expect(body.tools).toBeUndefined(); // it reads the sources we hand it; it doesn't go browsing
    const prompt = body.messages[0].content as string;
    for (const id of ["AFD", "WPC_SHORT", "WPC_EXT", "CWF", "NHC", "ALERTS", "MODEL"]) expect(prompt).toContain(`<source id="${id}"`);
    expect(prompt).toContain("high pressure over the Atlantic builds in by Thursday"); // the AFD discussion, verbatim
    expect(prompt).toContain("Easterly flow becomes onshore each afternoon"); // its marine section
    expect(prompt).not.toContain("Ignore this aviation section"); // sections we don't need are dropped
    expect(prompt).not.toContain("MUST NOT BE USED"); // the WPC station tables share the PMD type but aren't the discussion
    expect(prompt).toContain("trailing frontal boundary meanders");

    // what we published: drivers that cite nothing real are dropped, real citations kept, past and repeat days gone
    expect(d.model).toBe("claude-sonnet-5-5");
    expect(d.drivers.map((x: any) => [x.title, x.sources])).toEqual([["Front stalls", ["AFD", "WPC_EXT"]], ["Afternoon storms", ["CWF"]]]);
    expect(d.days.map((x: any) => x.date)).toEqual([plus(0), plus(1), plus(2), plus(3)]);
    // the server, not the model, attaches the sources (names, issue times, human-readable links)
    expect(d.sources.map((s: any) => s.id)).toEqual(["AFD", "WPC_SHORT", "WPC_EXT", "CWF", "NHC", "ALERTS", "MODEL"]);
    expect(d.sources[0]).toMatchObject({ name: expect.stringContaining("Tampa Bay"), url: expect.stringContaining("weather.gov") });
    expect(d.missing).toEqual([]);
    expect(d.usage).toEqual({ input: 4321, output: 987 });

    // the inputs are kept beside it, so a published call can be audited
    const inputs = JSON.parse(fs.readFileSync(path.join(app.dataDir, "inputs", `${today()}.json`), "utf8"));
    expect(inputs.docs.map((x: any) => x.id)).toContain("AFD");

    // archive + RSS
    const idx = await (await fetch(`${app.base}/api/discussions`)).json();
    expect(idx.items.map((i: any) => i.date)).toEqual([today()]);
    const feed = await fetch(`${app.base}/feed.xml`);
    expect(feed.headers.get("content-type")).toContain("application/rss+xml");
    const xml = await feed.text();
    expect(xml).toContain("<rss version=\"2.0\">");
    expect(xml).toContain(`<link>https://example.test/?discussion=${today()}</link>`);
    expect(xml).toContain("<title>A stalled front &amp; Atlantic high hand the wind to the east this week.</title>"); // escaped
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);

    // one discussion per day: a repeat request doesn't call the model again
    expect(stubs.calls).toHaveLength(1);
  } finally { await app.stop(); await stubs.close(); }
});

test("the admin endpoint: off without a token, locked with one, idempotent unless forced", async () => {
  const stubs = await startStubs();
  const off = await startServer(stubs);
  try {
    expect((await fetch(`${off.base}/api/discussion/generate`, { method: "POST" })).status).toBe(404); // no DISCUSSION_ADMIN_TOKEN, no endpoint
  } finally { await off.stop(); }

  const app = await startServer(stubs, { DISCUSSION_ADMIN_TOKEN: "s3cret" });
  try {
    await published(app.base);
    const post = (headers: Record<string, string> = {}, q = "") => fetch(`${app.base}/api/discussion/generate${q}`, { method: "POST", headers });
    expect((await post()).status).toBe(401);
    expect((await post({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await fetch(`${app.base}/api/discussion/generate`)).status).toBe(405);

    const before = stubs.calls.length;
    const again = await post({ authorization: "Bearer s3cret" });
    expect(await again.json()).toMatchObject({ status: "exists", date: today() });
    expect(stubs.calls).toHaveLength(before); // nothing was spent

    const forced = await post({ authorization: "Bearer s3cret" }, "?force=1");
    expect(await forced.json()).toMatchObject({ status: "published", date: today() });
    expect(stubs.calls).toHaveLength(before + 1);
  } finally { await app.stop(); await stubs.close(); }
});

test("a draft that quotes wind numbers is sent back once, and only the clean rewrite is published", async () => {
  const stubs = await startStubs();
  stubs.leakFirst = true;
  const app = await startServer(stubs);
  try {
    await published(app.base);
    expect(stubs.calls).toHaveLength(2);
    expect(stubs.calls[1].body.messages[0].content).toMatch(/Your previous draft quoted numbers \(.*knots/);
    const { discussion } = await latest(app.base);
    expect(discussion.bottomLine).not.toMatch(/knots|mph/);
    expect(discussion.usage.input).toBe(2 * 4321); // both calls are accounted for
  } finally { await app.stop(); await stubs.close(); }
});

test("a source that's down is named to the model and to readers; the rest still publishes", async () => {
  const stubs = await startStubs();
  stubs.failNhc = true;
  const app = await startServer(stubs);
  try {
    await published(app.base);
    expect(stubs.calls[0].body.messages[0].content).toMatch(/could not be retrieved today.*NHC/);
    expect(stubs.calls[0].body.messages[0].content).not.toContain('<source id="NHC"');
    const { discussion } = await latest(app.base);
    expect(discussion.missing).toEqual(["NHC"]);
    expect(discussion.sources.map((s: any) => s.id)).not.toContain("NHC");
  } finally { await app.stop(); await stubs.close(); }
});

const R2 = {
  R2_ENDPOINT: "", R2_BUCKET: "kite-archive", R2_ACCESS_KEY_ID: "test-access", R2_SECRET_ACCESS_KEY: "test-secret",
  ARCHIVE_CHECK_MS: "300", ARCHIVE_BOOT_DELAY_MS: "50", LEARN_CHECK_MS: "400", LEARN_BOOT_DELAY_MS: "100",
};
const iso = (s: number) => new Date(s * 1000).toISOString();
/** HRRR and ECMWF are archived at sea cells, under their own folder; the rest as before. */
const keyOf = (model: string, s: number) => { const d = iso(s); return `/kite-archive/forecasts/v1/${model}/${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(11, 13)}z.json.gz`; };
const obsKeyOf = (s: number) => { const d = iso(s); return `/kite-archive/obs/v1/${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}.json.gz`; };
const gunzipJson = (b: Buffer) => JSON.parse(zlib.gunzipSync(b).toString());
const archiveStatus = async (base: string) => (await (await fetch(`${base}/api/archive`)).json()) as any;
const forecastPuts = (stubs: Stubs) => stubs.puts.map((x) => x.path).filter((k) => k.includes("/forecasts/")).sort();

/* ---------------- the contract for GET /api/calibration ---------------- */

const KNOTS = [0, 4, 8, 12, 16, 20, 25, 35];
const FIVE = ["ecmwf", "gfs", "hrrr", "nbm", "rrfs"];
function expectContract(c: any) {
  const model = (x: any, where: string) => {
    expect(x.n, where).toBeGreaterThanOrEqual(0);
    expect(x.qm.map((k: number[]) => k[0]), where).toEqual(KNOTS); // the fixed raw speeds
    x.qm.forEach(([raw, cal]: number[], i: number) => {
      expect(Math.abs(cal - raw), `${where} clamp at ${raw}`).toBeLessThanOrEqual(Math.min(0.4 * raw, 6) + 0.011);
      if (i) expect(cal, `${where} rises at ${raw}`).toBeGreaterThanOrEqual(x.qm[i - 1][1]);
    });
    expect(x.mae, where).toHaveLength(4);
    for (const v of x.mae) expect(v, where).toBeGreaterThan(0);
    expect(x.gf, where).toBeGreaterThanOrEqual(1);
    expect(x.gf, where).toBeLessThanOrEqual(3);
  };
  expect(c.version).toBe(1);
  expect(Date.parse(c.updated)).not.toBeNaN();
  expect(["seed", "learned"]).toContain(c.source);
  expect(c.leadBuckets).toEqual([12, 36, 72, 9999]);
  expect(Object.keys(c.pooled.models).sort()).toEqual(FIVE); // always all five
  for (const m of FIVE) model(c.pooled.models[m], `pooled.${m}`);
  for (const s of c.stations) {
    expect(s).toMatchObject({ id: expect.any(String), name: expect.any(String), lat: expect.any(Number), lon: expect.any(Number), kind: expect.stringMatching(/^(water|shore|airport)$/) });
    for (const [m, x] of Object.entries(s.models)) { expect(FIVE).toContain(m); model(x, `${s.id}.${m}`); }
  }
  for (const b of [0, 1, 2, 3]) { expect(c.residual.q10[b]).toBeLessThanOrEqual(0); expect(c.residual.q90[b]).toBeGreaterThanOrEqual(0); }
  expect(c.residual.q10).toHaveLength(4);
  expect(c.residual.q90).toHaveLength(4);
  expect(c.nowcast.tauHours).toBeGreaterThan(0);
  expect(c.nowcast.maxHours).toBeGreaterThanOrEqual(0);
  if (c.score !== null) {
    expect(c.score).toMatchObject({ days: 30, from: expect.any(String), to: expect.any(String) });
    expect(c.score.models.sensei).toMatchObject({ mae: expect.any(Number), n: expect.any(Number) });
    for (const m of Object.keys(c.score.models)) expect(["sensei", ...FIVE]).toContain(m);
  }
}

test("the forecast archive saves each new model run to R2, once, signed, with every point", async () => {
  const stubs = await startStubs();
  const app = await startServer(stubs, { ...R2, R2_ENDPOINT: stubs.url, ANTHROPIC_API_KEY: "" });
  try {
    const keys = () => forecastPuts(stubs);
    // one run each, except NBM: its 01Z run isn't one of the 3-hourly ones we keep
    const first = [keyOf("ecmwf-sea", RUN0), keyOf("gfs", RUN0), keyOf("hrrr-sea", RUN0 + 5 * HOUR_S), keyOf("rrfs", RUN0)].sort();
    await expect.poll(keys, { timeout: 15_000 }).toEqual(first);
    expect(app.logs()).toMatch(/forecast archive to R2 bucket kite-archive/);

    // signed for R2 (SigV4, region "auto"), stored gzipped
    const hrrr = stubs.puts.find((x) => x.path.includes("/hrrr-sea/"))!;
    expect(String(hrrr.headers.authorization)).toMatch(/^AWS4-HMAC-SHA256 Credential=test-access\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*, Signature=[0-9a-f]{64}$/);
    expect(hrrr.headers["content-type"]).toBe("application/gzip");
    const doc = JSON.parse(zlib.gunzipSync(hrrr.body).toString());
    expect(doc).toMatchObject({ version: 2, model: "hrrr", openMeteoModel: "gfs_hrrr", cell: "sea", run: iso(RUN0 + 5 * HOUR_S) });
    expect(doc.times[0]).toBe(RUN0 + 5 * HOUR_S); // trimmed to the run's own hours
    // the points: seed spots, the in-bay stations (not New York) and the airport, then a 9 × 9 grid
    const ids: string[] = doc.points.map((x: any) => x.id);
    expect(ids.slice(0, 6)).toEqual(["spot:fort-de-soto", "spot:skyway", "spot:picnic-island", "coops:8726607", "coops:8726724", "asos:KSPG"]);
    expect(ids.filter((i) => i.startsWith("grid:"))).toHaveLength(81);
    expect(doc.points[0]).toMatchObject({ lat: 27.64, lon: -82.739, gridLat: expect.closeTo(27.65, 6), gridLon: expect.closeTo(-82.749, 6) }); // where the model's cell is
    for (const v of ["wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "temperature_2m", "pressure_msl"]) {
      expect(doc.values[v]).toHaveLength(ids.length);
      expect(doc.values[v][0]).toHaveLength(doc.times.length);
    }
    // one request per run, one model at a time
    expect(stubs.archiveAsks.map((q) => q.get("models")).sort()).toEqual(["ecmwf_ifs025", "gfs_global", "gfs_hrrr", "ncep_rrfs_conus"]);
    expect(stubs.archiveAsks.find((q) => q.get("models") === "gfs_hrrr")!.get("latitude")!.split(",")).toHaveLength(ids.length);
    // HRRR and ECMWF at sea cells, as the browser asks for them at a spot; the others at Open-Meteo's default cell.
    // Each file says which, and the sea-cell ones live apart from the older default-cell files.
    expect(Object.fromEntries(stubs.archiveAsks.map((q) => [q.get("models"), q.get("cell_selection")]))).toEqual({ gfs_hrrr: "sea", ecmwf_ifs025: "sea", ncep_rrfs_conus: null, gfs_global: null });
    expect(Object.fromEntries(stubs.puts.filter((x) => x.path.includes("/forecasts/")).map((x) => { const d = gunzipJson(x.body); return [d.model, [d.version, d.cell]]; })))
      .toEqual({ hrrr: [2, "sea"], ecmwf: [2, "sea"], rrfs: [2, "land"], gfs: [2, "land"] });

    // checking again with nothing new saves nothing
    const hits = stubs.metaHits;
    await expect.poll(() => stubs.metaHits).toBeGreaterThan(hits + 10);
    expect(keys()).toEqual(first);

    // a new HRRR run and NBM's 03Z run are picked up
    stubs.runs.ncep_hrrr_conus += HOUR_S;
    stubs.runs.ncep_nbm_conus += 2 * HOUR_S;
    await expect.poll(keys).toEqual([...first, keyOf("hrrr-sea", RUN0 + 6 * HOUR_S), keyOf("nbm", RUN0 + 3 * HOUR_S)].sort());
    expect(stubs.archiveAsks.find((q) => q.get("models") === "ncep_nbm_conus")!.get("cell_selection")).toBeNull();

    const status = await archiveStatus(app.base);
    expect(status).toMatchObject({ configured: true, lastError: null, discarded: {} });
    expect(status.models.hrrr).toMatchObject({ run: iso(RUN0 + 6 * HOUR_S), points: ids.length, cell: "sea" });
    expect(JSON.stringify(status)).not.toContain("test-secret");
  } finally { await app.stop(); await stubs.close(); }
});

test("a run is never saved under a label its data can't back: Open-Meteo servers that disagree, and a failed save", async () => {
  const stubs = await startStubs();
  const app = await startServer(stubs, { ...R2, R2_ENDPOINT: stubs.url, ANTHROPIC_API_KEY: "" });
  try {
    const count = (key: string) => stubs.puts.filter((x) => x.path === key).length;
    const discarded = async (model: string) => (await archiveStatus(app.base)).discarded[model];
    await expect.poll(() => forecastPuts(stubs)).toHaveLength(4);
    const NEXT = RUN0 + 6 * HOUR_S;

    // 1. The metadata says GFS has a new run, but the data servers still hold the old one.
    //    Saved as the new run, that would be old data under a newer label: it's thrown away instead.
    stubs.dataRuns.ncep_gfs013 = RUN0;
    stubs.runs.ncep_gfs013 = NEXT;
    await expect.poll(async () => (await discarded("gfs"))?.count ?? 0).toBeGreaterThanOrEqual(1);
    expect(await discarded("gfs")).toMatchObject({ last: { run: iso(NEXT), why: expect.stringContaining(`still the ${iso(RUN0)} run`) } });
    expect(count(keyOf("gfs", NEXT))).toBe(0);
    expect((await archiveStatus(app.base)).models.gfs.run).toBe(iso(RUN0)); // not marked saved either
    // …and once the data catches up, the run is saved, with the new run's numbers
    delete stubs.dataRuns.ncep_gfs013;
    await expect.poll(() => count(keyOf("gfs", NEXT))).toBe(1);
    const [older, newer] = [keyOf("gfs", RUN0), keyOf("gfs", NEXT)].map((k) => gunzipJson(stubs.objects.get(k)!));
    expect(newer.run).toBe(iso(NEXT));
    expect(newer.values.wind_speed_10m[0][0]).not.toBe(older.values.wind_speed_10m[0][older.times.indexOf(newer.times[0])]);

    // 2. One server announces a new ECMWF run while the next still reports the old one: the fetch in between
    //    could be either run, so nothing is saved under the new label.
    stubs.metaQueue.ecmwf_ifs025 = [NEXT, RUN0];
    await expect.poll(async () => (await discarded("ecmwf"))?.count ?? 0).toBe(1);
    expect(await discarded("ecmwf")).toMatchObject({ last: { run: iso(NEXT), why: expect.stringContaining("metadata changed during the fetch") } });
    expect(count(keyOf("ecmwf-sea", NEXT))).toBe(0);
    //    When they agree, it's saved once.
    stubs.runs.ecmwf_ifs025 = NEXT;
    await expect.poll(() => count(keyOf("ecmwf-sea", NEXT))).toBe(1);
    //    A straggler still announcing the old run afterwards doesn't get the old run fetched and written again.
    const asks = stubs.archiveAsks.length;
    stubs.metaQueue.ecmwf_ifs025 = [RUN0, RUN0, RUN0];
    await expect.poll(() => stubs.metaQueue.ecmwf_ifs025.length).toBe(0);
    expect(stubs.archiveAsks).toHaveLength(asks);
    expect(count(keyOf("ecmwf-sea", RUN0))).toBe(1);

    // 3. R2 refuses a save: the run isn't marked saved, and the next check saves it.
    stubs.failPuts = { match: /\/rrfs\//, left: 1 };
    stubs.runs.ncep_rrfs_conus = NEXT;
    await expect.poll(() => stubs.refused).toBe(1);
    await expect.poll(() => count(keyOf("rrfs", NEXT))).toBe(1);
    await expect.poll(async () => (await archiveStatus(app.base)).models.rrfs.run).toBe(iso(NEXT));
    expect(app.logs()).toMatch(/\[archive\] rrfs: R2 PUT .* HTTP 403/);

    // every file is labelled with the run its key says
    for (const [key, body] of stubs.objects) if (key.includes("/forecasts/")) expect(key).toBe(keyOf(key.split("/")[4], Date.parse(gunzipJson(body).run) / 1000));
  } finally { await app.stop(); await stubs.close(); }
});

test("a restart picks up from the runs already in R2 instead of fetching and saving them again", async () => {
  const stubs = await startStubs();
  const env = { ...R2, R2_ENDPOINT: stubs.url, ANTHROPIC_API_KEY: "" };
  const first = await startServer(stubs, env);
  try { await expect.poll(() => forecastPuts(stubs)).toHaveLength(4); } finally { await first.stop(); }
  const asks = stubs.archiveAsks.length;
  stubs.dataRuns.ncep_hrrr_conus = RUN0 + 5 * HOUR_S; // the data servers lag one run behind the metadata…
  stubs.runs.ncep_hrrr_conus += HOUR_S;
  const app = await startServer(stubs, env);
  try {
    // …which the new process can tell, because it compares against the last file in R2, not its own memory
    await expect.poll(async () => (await archiveStatus(app.base)).discarded.hrrr?.count ?? 0).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await archiveStatus(app.base)).models.gfs?.run).toBe(iso(RUN0)); // known from R2, not refetched
    expect(forecastPuts(stubs)).toHaveLength(4);
    expect(stubs.archiveAsks.slice(asks).map((q) => q.get("models"))).not.toContain("gfs_global"); // already saved: not asked for again
  } finally { await app.stop(); await stubs.close(); }
});

test("station observations are saved hourly to R2: blanks are not calms, hours merge, repeats change nothing", async () => {
  const stubs = await startStubs();
  const hour = HOUR0;
  // An earlier cycle already saved an hour from a station that has since gone quiet: it must survive the merge.
  const day = obsKeyOf(hour - 2 * HOUR_S);
  stubs.objects.set(day, zlib.gzipSync(JSON.stringify({ version: 1, day: iso(hour - 2 * HOUR_S).slice(0, 10), stations: { "coops:1234567": { name: "Gone Quiet", lat: 27.6, lon: -82.7, kind: "shore", hours: { [hour - 2 * HOUR_S]: { s: 7, g: 9, d: 180, n: 10 } } } } })));
  const app = await startServer(stubs, { ...R2, R2_ENDPOINT: stubs.url, ANTHROPIC_API_KEY: "" });
  try {
    const obs = async () => (await archiveStatus(app.base)).observations;
    await expect.poll(async () => (await obs()).lastCycle).not.toBeNull();
    const saved = () => gunzipJson(stubs.objects.get(day)!);
    const port = saved().stations["coops:8726607"];
    expect(port).toMatchObject({ name: "Old Port Tampa", lat: 27.8578, lon: -82.5528, kind: "shore" });
    // the hour with only two real readings: their mean, not an average dragged down by eight zeros
    expect(port.hours[hour - 2 * HOUR_S]).toEqual({ s: 12, g: 15, d: 90, n: 2 });
    // a full hour: mean speed, peak gust, and 350° with 10° averages to north, not south
    const full = (gunzipJson(stubs.objects.get(obsKeyOf(hour - HOUR_S))!)).stations["coops:8726607"].hours[hour - HOUR_S];
    expect(full).toMatchObject({ s: 10, g: 13, n: 10 });
    expect(Math.min(full.d, 360 - full.d)).toBeLessThanOrEqual(1);
    // the airport, with no gusts reported; the station without a wind sensor is simply absent
    const allStations = [...stubs.objects].filter(([k]) => k.includes("/obs/v1/")).flatMap(([, b]) => Object.entries(gunzipJson(b).stations) as [string, any][]);
    const spg = allStations.find(([id, st]) => id === "asos:KSPG" && st.hours[hour - HOUR_S])![1];
    expect(spg).toMatchObject({ kind: "airport", lat: 27.765 });
    expect(spg.hours[hour - HOUR_S]).toMatchObject({ s: 8, g: null, d: 60 });
    expect(allStations.map(([id]) => id)).not.toContain("coops:8726724");
    expect(saved().stations["coops:1234567"].hours[hour - 2 * HOUR_S]).toEqual({ s: 7, g: 9, d: 180, n: 10 });
    expect((await obs()).lastError).toBeNull();

    // more cycles: every hour is still stored exactly once
    const cycle = (await obs()).lastCycle;
    await expect.poll(async () => (await obs()).lastCycle).not.toBe(cycle);
    await expect.poll(async () => (await obs()).lastCycle, { intervals: [900] }).not.toBe(cycle);
    const hours = [...stubs.objects].filter(([k]) => k.includes("/obs/v1/")).flatMap(([, b]) => Object.values(gunzipJson(b).stations) as any[]).reduce((a, st) => a + Object.keys(st.hours).length, 0);
    expect(hours).toBe(1 + 4 + 4); // the planted hour, and four finished hours each from the sensor and the airport
    expect(await obs()).toMatchObject({ hoursSaved: 8, stuck: [] }); // each written once
  } finally { await app.stop(); await stubs.close(); }
});

test("a frozen sensor's hours are no reading: marked stuck, even ones saved before it showed; an airport's calm is kept", async () => {
  const stubs = await startStubs();
  stubs.frozen = true;
  // The first two hours of the freeze were saved as ordinary calm readings by earlier cycles.
  const early = [HOUR0 - 4 * HOUR_S, HOUR0 - 3 * HOUR_S];
  for (const t of early) {
    const doc = stubs.objects.has(obsKeyOf(t)) ? gunzipJson(stubs.objects.get(obsKeyOf(t))!) : { version: 1, day: iso(t).slice(0, 10), stations: { "coops:8726607": { name: "Old Port Tampa", lat: 27.8578, lon: -82.5528, kind: "shore", hours: {} } } };
    doc.stations["coops:8726607"].hours[t] = { s: 0, g: 1.17, d: 66, n: 10 };
    stubs.objects.set(obsKeyOf(t), zlib.gzipSync(JSON.stringify(doc)));
  }
  const app = await startServer(stubs, { ...R2, R2_ENDPOINT: stubs.url, ANTHROPIC_API_KEY: "" });
  try {
    const obs = async () => (await archiveStatus(app.base)).observations;
    await expect.poll(async () => (await obs()).lastCycle).not.toBeNull();
    const hoursOf = (id: string) => Object.assign({}, ...[...stubs.objects].filter(([k]) => k.includes("/obs/v1/")).map(([, b]) => gunzipJson(b).stations[id]?.hours ?? {})) as Record<string, any>;
    // 0.0 kn from an unchanging 066° for over three hours (the gusts still flicker): every hour of it is no reading
    const port = hoursOf("coops:8726607");
    expect(Object.keys(port).map(Number).sort()).toEqual([4, 3, 2, 1].map((h) => HOUR0 - h * HOUR_S));
    for (const h of Object.values(port)) expect(h).toEqual({ s: null, g: null, d: null, n: 0, stuck: true });
    expect(await obs()).toMatchObject({ stuck: ["coops:8726607"], stations: 1, lastError: null });
    // the airport's calm is what the METAR said: kept
    expect(hoursOf("asos:KSPG")[HOUR0 - HOUR_S]).toMatchObject({ s: 0, d: 0 });
    // when the sensor comes back, an hour marked stuck is not quietly un-marked by a shorter look at the same readings
    stubs.frozen = false;
    const cycle = (await obs()).lastCycle;
    await expect.poll(async () => (await obs()).lastCycle).not.toBe(cycle);
    await expect.poll(async () => (await obs()).lastCycle, { intervals: [900] }).not.toBe(cycle);
    expect(hoursOf("coops:8726607")[HOUR0 - HOUR_S]).toMatchObject({ stuck: true, s: null });
  } finally { await app.stop(); await stubs.close(); }
});

test("learning: runs paired with observations move each model's map the right way, once, and /api/calibration serves it", async () => {
  const stubs = await startStubs();
  const hour = HOUR0; // everything planted is at least 13 h old, so it is settled whatever the clock does next
  const PORT = { id: "coops:8726607", name: "Old Port Tampa", lat: 27.8578, lon: -82.5528 };
  // Ten days of wind at one shore sensor, 2–18 kn; HRRR runs 20 % light, GFS 3 kn too windy.
  const wind = (t: number) => { const h = t / HOUR_S; return +(10 + 6 * Math.sin((2 * Math.PI * h) / 24) + 2 * Math.sin(h / 7)).toFixed(2); };
  const days: Record<string, any> = {};
  for (let t = hour - 10 * 86400; t <= hour - 13 * HOUR_S; t += HOUR_S) {
    const doc = (days[obsKeyOf(t)] ??= { version: 1, day: iso(t).slice(0, 10), stations: { [PORT.id]: { ...PORT, id: undefined, kind: "shore", hours: {} } } });
    doc.stations[PORT.id].hours[t] = { s: wind(t), g: +(1.3 * wind(t)).toFixed(2), d: 90, n: 10 };
  }
  // A second sensor was frozen all along: its hours are marked stuck and must teach nothing.
  for (const doc of Object.values(days)) doc.stations["coops:8726724"] = { name: "Clearwater Beach", lat: 27.9783, lon: -82.8317, kind: "shore", hours: Object.fromEntries(Object.keys(doc.stations[PORT.id].hours).map((t) => [t, { s: null, g: null, d: null, n: 0, stuck: true }])) };
  for (const [key, doc] of Object.entries(days)) stubs.objects.set(key, zlib.gzipSync(JSON.stringify(doc)));
  const plant = (dir: string, model: string, cell: string, run: number, hours: number, f: (t: number) => number) => {
    const times = Array.from({ length: hours + 1 }, (_, i) => run + i * HOUR_S), speeds = times.map((t) => +f(t).toFixed(2));
    stubs.objects.set(keyOf(dir, run), zlib.gzipSync(JSON.stringify({
      version: 2, model, cell, run: iso(run), dataEnd: null, times, points: [{ id: "spot:skyway", lat: 27.628, lon: -82.66 }, PORT, { id: "coops:8726724", lat: 27.9783, lon: -82.8317 }],
      values: { wind_speed_10m: [times.map(() => 30), speeds, times.map(() => 30)], wind_gusts_10m: [times.map(() => 40), speeds.map((s) => +(1.2 * s).toFixed(2)), times.map(() => 40)], wind_direction_10m: [times.map(() => 0), times.map(() => 100), times.map(() => 0)] },
    })));
  };
  const six = Math.floor(hour / (6 * HOUR_S)) * 6 * HOUR_S;
  for (let run = six - 18 * 86400; run <= six; run += 6 * HOUR_S) {
    plant("hrrr-sea", "hrrr", "sea", run, 48, (t) => 0.8 * wind(t));
    plant("gfs", "gfs", "land", run, 168, (t) => wind(t) + 3);
  }
  // A file in the sea-cell folder that isn't sea-cell data (wildly wrong, too) must not be learned from.
  plant("hrrr-sea", "hrrr", "land", six - 5 * 86400 + HOUR_S, 18, () => 45);
  const paired = Object.values(days).reduce((a, d) => a + Object.keys(d.stations[PORT.id].hours).length, 0);

  const env = { ...R2, R2_ENDPOINT: stubs.url, ANTHROPIC_API_KEY: "", ARCHIVE_BOOT_DELAY_MS: "3600000", OPENMETEO_BASE: "http://127.0.0.1:9" }; // the archive itself stays out of this one
  const app = await startServer(stubs, env);
  const cal = async (base: string) => (await (await fetch(`${base}/api/calibration`)).json()) as any;
  const learning = async (base: string) => (await archiveStatus(base)).learning;
  const stateKey = "/kite-archive/calibration/v1/state.json";
  let before: any;
  try {
    await expect.poll(async () => (await learning(app.base)).pairedHours, { timeout: 30_000 }).toBe(paired);
    const res = await fetch(`${app.base}/api/calibration`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=600");
    const c = await res.json();
    expectContract(c);
    expect(c.source).toBe("learned");
    expect(Date.now() - Date.parse(c.updated)).toBeLessThan(60_000);
    const st = c.stations.find((s: any) => s.id === PORT.id);
    expect(st).toMatchObject({ name: "Old Port Tampa", kind: "shore", lat: PORT.lat, lon: PORT.lon });
    expect(Object.keys(st.models).sort()).toEqual(["gfs", "hrrr"]); // nothing invented for models that were never paired
    expect(c.stations.map((s: any) => s.id)).toEqual([PORT.id]); // the frozen sensor taught nothing
    const at = (m: string, raw: number, from = st) => from.models[m].qm.find((k: number[]) => k[0] === raw)[1];
    // The hand-over is gradual: the learned share is n / (n + 300), n the (fading) count of paired hours.
    const n = st.models.hrrr.n, w = n / (n + 300);
    expect(n).toBeGreaterThan(180);
    expect(n).toBeLessThanOrEqual(paired);
    // HRRR reads 8 kn when the sensor reads 10, 12 when it reads 15: the map lifts it, by that share of the way
    // (the station starts from the pooled map, which this one sensor has already lifted by the same share)
    const pooledLift = (raw: number) => at("hrrr", raw, c.pooled) - raw;
    expect(pooledLift(8)).toBeGreaterThan(w * 1.4);
    expect(pooledLift(8)).toBeLessThan(w * 2.6);
    expect(at("hrrr", 8) - 8).toBeGreaterThan(pooledLift(8) + w * (1.4 - pooledLift(8)));
    expect(at("hrrr", 8) - 8).toBeLessThan(pooledLift(8) + w * (2.6 - pooledLift(8)));
    expect(at("hrrr", 12)).toBeGreaterThan(at("hrrr", 12, c.pooled));
    expect(at("hrrr", 12)).toBeLessThan(15.6);
    // GFS reads 12 when the sensor reads 9: the map lowers it (and the decoy's 45 kn never got in)
    expect(12 - at("gfs", 12, c.pooled)).toBeGreaterThan(w * 2.4);
    expect(12 - at("gfs", 12, c.pooled)).toBeLessThan(w * 3.6);
    expect(at("gfs", 12)).toBeLessThan(at("gfs", 12, c.pooled));
    expect(at("gfs", 12)).toBeGreaterThan(9);
    expect(at("gfs", 16)).toBeLessThan(at("gfs", 16, c.pooled));
    expect(at("hrrr", 35)).toBeLessThanOrEqual(41); // beyond what was seen, the correction is carried, within ±6 kn
    // the misses mix too: HRRR's short-lead miss sits between the seed's 1.9 and what was measured
    expect(st.models.hrrr.mae[0]).toBeLessThan(1.9);
    // the sensor's gusts were 1.3 × its speed
    expect(st.models.hrrr.gf).toBeCloseTo(1.3, 2);
    // models with no pairs keep the seed
    expect(c.pooled.models.nbm).toMatchObject({ n: 0, qm: KNOTS.map((k) => [k, k]) });
    // the blend is scored against each raw model over the same hours, and beats both of these
    expect(c.score.models.sensei.n).toBeGreaterThan(300);
    expect(c.score.models.sensei.mae).toBeLessThan(c.score.models.hrrr.mae);
    expect(c.score.models.sensei.mae).toBeLessThan(c.score.models.gfs.mae);
    expect(c.score.models.gfs.mae).toBeCloseTo(3, 1);
    expect(c.score.models.hrrr.senseiMae).toBeLessThan(c.score.models.hrrr.mae);

    const status = await learning(app.base);
    expect(status).toMatchObject({ lastError: null, errors: 0, stationsLearned: 1, source: "learned", seedError: null });
    expect(status.runsSkipped).toBe(1); // the decoy
    expect(status.runsRead).toBeLessThan(150); // a bounded number of run files, never the whole archive
    expect(stubs.metaHits).toBe(0); // and not one call to Open-Meteo
    expect(stubs.archiveAsks).toHaveLength(0);

    // more cycles count nothing twice
    before = { c, status, state: JSON.parse(stubs.objects.get(stateKey)!.toString()) };
    await expect.poll(async () => (await learning(app.base)).cycles).toBeGreaterThanOrEqual(status.cycles + 3);
    const again = await cal(app.base);
    expect((await learning(app.base)).pairedHours).toBe(paired);
    expect(again.stations).toEqual(c.stations);
    expect(again.score).toEqual(c.score);
    expect((await learning(app.base)).runsRead).toBe(status.runsRead);
  } finally { await app.stop(); }

  // …and neither does a restart: the watermark lives in R2 with the state
  const next = await startServer(stubs, env);
  try {
    await expect.poll(async () => (await learning(next.base)).cycles).toBeGreaterThanOrEqual(2);
    const status = await learning(next.base);
    expect(status).toMatchObject({ pairedHours: paired, stationsLearned: 1, runsRead: 0, lastError: null });
    const c = await cal(next.base);
    expect(c.stations).toEqual(before.c.stations);
    expect(c.score).toEqual(before.c.score);
    expect(JSON.parse(stubs.objects.get(stateKey)!.toString()).stations[PORT.id].models.hrrr.f).toEqual(before.state.stations[PORT.id].models.hrrr.f);
  } finally { await next.stop(); }

  // a state file that can't be read doesn't stop the server: it starts over from the archive
  stubs.objects.set(stateKey, Buffer.from("{ not json"));
  const third = await startServer(stubs, env);
  try {
    await expect.poll(async () => (await learning(third.base)).pairedHours, { timeout: 30_000 }).toBe(paired);
    expect((await cal(third.base)).stations).toEqual(before.c.stations);
    expect(third.logs()).toMatch(/saved state is unreadable/);
  } finally { await third.stop(); await stubs.close(); }
});

test("security headers on every response; without R2 the calibration is the seed, and a broken seed file falls back", async () => {
  const stubs = await startStubs();
  const app = await startServer(stubs, { ANTHROPIC_API_KEY: "" });
  try {
    for (const path of ["/", "/some/spa/route", "/api/discussion", "/api/calibration", "/api/archive", "/feed.xml", "/healthz", "/assets/app-nope123.js", "/api/discussion?date=nope"]) {
      const r = await fetch(`${app.base}${path}`);
      const h = (name: string) => r.headers.get(name);
      expect(h("x-content-type-options"), path).toBe("nosniff");
      expect(h("referrer-policy"), path).toBe("strict-origin-when-cross-origin");
      expect(h("strict-transport-security"), path).toMatch(/^max-age=\d{8,}/);
      expect(h("permissions-policy"), path).toContain("geolocation=(self)");
      expect(h("x-frame-options"), path).toBe("DENY");
      const csp = h("content-security-policy")!;
      for (const part of ["default-src 'self'", "script-src 'self'", "worker-src 'self' blob:", "frame-ancestors 'none'", "object-src 'none'", "https://tiles.openfreemap.org", "https://api.open-meteo.com", "https://api.tidesandcurrents.noaa.gov", "https://mesonet.agron.iastate.edu", "https://fonts.gstatic.com"]) expect(csp, path).toContain(part);
      expect(csp.match(/script-src[^;]*/)![0], path).not.toMatch(/unsafe-inline|unsafe-eval|\*/); // scripts only from us (and the analytics beacon)
    }
    const post = await fetch(`${app.base}/api/discussion`, { method: "POST" }); // refusals carry them too
    expect(post.status).toBe(405);
    expect(post.headers.get("x-content-type-options")).toBe("nosniff");

    // no bucket: the seed, in the contract's shape, cacheable for ten minutes; nothing is learning
    const res = await fetch(`${app.base}/api/calibration`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=600");
    const c = await res.json();
    expectContract(c);
    expect(c).toMatchObject({ source: "seed", score: null });
    expect((await archiveStatus(app.base)).learning).toMatchObject({ lastCycle: null, source: "seed", seedError: null });
  } finally { await app.stop(); }

  // CSP_REPORT_ONLY=1 is the switch if the policy ever blocks something real
  const bad = path.join(os.tmpdir(), `seasensei-seed-${process.pid}.json`);
  fs.writeFileSync(bad, JSON.stringify({ version: 1, leadBuckets: [12, 36, 72, 9999], stations: [], pooled: { models: { hrrr: { n: 0, qm: [[0, 0], [35, 20]], mae: [0, 1, 1, 1], gf: 1.3 } } } }));
  const soft = await startServer(stubs, { ANTHROPIC_API_KEY: "", CSP_REPORT_ONLY: "1", CALIBRATION_SEED_FILE: bad });
  try {
    const r = await fetch(`${soft.base}/`);
    expect(r.headers.get("content-security-policy")).toBeNull();
    expect(r.headers.get("content-security-policy-report-only")).toContain("default-src 'self'");
    // a seed that doesn't validate is not served: the built-in identity maps are
    const c = await (await fetch(`${soft.base}/api/calibration`)).json();
    expectContract(c);
    expect(c.pooled.models.hrrr.qm).toEqual(KNOTS.map((k) => [k, k]));
    expect((await archiveStatus(soft.base)).learning.seedError).toMatch(/pooled\.hrrr/);
    expect(soft.logs()).toMatch(/seed file not usable/);
  } finally { await soft.stop(); fs.rmSync(bad, { force: true }); await stubs.close(); }
});

test("without an API key nothing is generated and the API says so; bad dates are rejected", async () => {
  const stubs = await startStubs();
  const app = await startServer(stubs, { ANTHROPIC_API_KEY: "" });
  try {
    const r = await latest(app.base);
    expect(r).toMatchObject({ discussion: null, configured: false });
    await new Promise((r) => setTimeout(r, 500));
    expect(stubs.calls).toHaveLength(0);
    expect(app.logs()).toMatch(/discussion disabled/);
    // no R2 settings: the forecast archive stays off and asks nothing of Open-Meteo
    expect(await (await fetch(`${app.base}/api/archive`)).json()).toMatchObject({ configured: false });
    expect(app.logs()).toMatch(/forecast archive off/);
    expect(stubs.metaHits).toBe(0);

    for (const bad of ["../etc/passwd", "2026-9-1", "today"]) {
      expect((await fetch(`${app.base}/api/discussion?date=${encodeURIComponent(bad)}`)).status, bad).toBe(400);
    }
    expect(await (await fetch(`${app.base}/api/discussion?date=1999-01-01`)).json()).toMatchObject({ discussion: null });
    expect((await fetch(`${app.base}/some/spa/route`)).headers.get("content-type")).toContain("text/html"); // the app still serves
    // a missing hashed asset is a 404 that can't be cached, not index.html served as "immutable" JavaScript
    const gone = await fetch(`${app.base}/assets/app-nope123.js`);
    expect(gone.status).toBe(404);
    expect(gone.headers.get("cache-control")).toBe("no-store");
    expect(await (await fetch(`${app.base}/feed.xml`)).text()).toContain("<channel>"); // an empty feed is still a valid feed
    // malformed URLs get a 400 and the server keeps running (they used to crash the process)
    const raw = (target: string) => new Promise<number>((resolve, reject) => {
      const u = new URL(app.base);
      const sock = net.connect(Number(u.port), u.hostname, () => sock.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
      let buf = ""; sock.on("data", (c) => (buf += c)); sock.on("error", reject);
      sock.on("close", () => resolve(Number(buf.split(" ")[1])));
    });
    expect(await raw("/%E0%A4%A")).toBe(400);
    expect(await raw("//")).toBe(400);
    expect((await fetch(`${app.base}/healthz`)).status).toBe(200);
  } finally { await app.stop(); await stubs.close(); }
});
