import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * The daily wind discussion, end to end on the real Node server (server/server.mjs): it fetches the NWS
 * products and pressure trend from stand-in upstreams, calls a stand-in Anthropic API, then publishes,
 * archives and serves the result. No real network, no real key.
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
type Stubs = { url: string; calls: Anthropic[]; failNhc: boolean; leakFirst: boolean; close: () => Promise<void> };

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
  const stubs = { calls: [] as Anthropic[], failNhc: false, leakFirst: false } as Stubs;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const p = url.pathname;

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
      NWS_BASE: stubs.url, OPENMETEO_BASE: stubs.url, ANTHROPIC_BASE_URL: stubs.url, ANTHROPIC_API_KEY: "test-key",
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

test("without an API key nothing is generated and the API says so; bad dates are rejected", async () => {
  const stubs = await startStubs();
  const app = await startServer(stubs, { ANTHROPIC_API_KEY: "" });
  try {
    const r = await latest(app.base);
    expect(r).toMatchObject({ discussion: null, configured: false });
    await new Promise((r) => setTimeout(r, 500));
    expect(stubs.calls).toHaveLength(0);
    expect(app.logs()).toMatch(/discussion disabled/);

    for (const bad of ["../etc/passwd", "2026-9-1", "today"]) {
      expect((await fetch(`${app.base}/api/discussion?date=${encodeURIComponent(bad)}`)).status, bad).toBe(400);
    }
    expect(await (await fetch(`${app.base}/api/discussion?date=1999-01-01`)).json()).toMatchObject({ discussion: null });
    expect((await fetch(`${app.base}/some/spa/route`)).headers.get("content-type")).toContain("text/html"); // the app still serves
    expect(await (await fetch(`${app.base}/feed.xml`)).text()).toContain("<channel>"); // an empty feed is still a valid feed
  } finally { await app.stop(); await stubs.close(); }
});
