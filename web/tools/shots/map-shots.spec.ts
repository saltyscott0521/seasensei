import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { mockApis } from "../../e2e/mocks";

// Screenshots of the map over the real basemap, for judging land/sea contrast and how the wind reads.
// Not an assertion suite: look at the pictures in SHOTS_OUT. SHOTS_TAG prefixes the file names (before / after).

const OUT = process.env.SHOTS_OUT ?? "test-results/shots";
const CACHE = process.env.SHOTS_CACHE ?? path.join(OUT, ".cache");
const TAG = process.env.SHOTS_TAG ?? "shot";
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

const TYPES: Record<string, string> = { pbf: "application/x-protobuf", png: "image/png", json: "application/json" };

/** OpenFreeMap through an on-disk cache (curl honours the sandbox proxy; the browser's own requests would not). */
async function realBasemap(page: Page) {
  await page.route("https://tiles.openfreemap.org/**", (route) => {
    const url = route.request().url();
    const file = path.join(CACHE, createHash("sha1").update(url).digest("hex"));
    if (!fs.existsSync(file)) {
      try { execFileSync("curl", ["-sS", "-f", "--compressed", "-m", "30", "-o", file, url]); }
      catch { fs.rmSync(file, { force: true }); return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" }); }
    }
    const ext = url.split("?")[0].split(".").pop() ?? "";
    return route.fulfill({ contentType: TYPES[ext] ?? "application/json", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(file) });
  });
}

const HIDE = "canvas[data-wind-particles], .maplibregl-marker, [data-view-target] { visibility: hidden !important; }";

test("the map over the real basemap", async ({ page }, info) => {
  const name = (s: string) => path.join(OUT, `${TAG}-${info.project.name}-${s}.png`);
  await mockApis(page);
  await realBasemap(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await page.waitForFunction(() => (window as any).__wind?.ready?.(), null, { timeout: 60_000 });
  await page.waitForTimeout(9000); // tiles in, trails grown
  await page.screenshot({ path: name("home") });

  // The basemap by itself: no wind, no markers.
  const hide = await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(500);
  await page.screenshot({ path: name("basemap") });
  await hide.evaluate((el) => (el as HTMLStyleElement).remove());

  // A spot open: the coast close up.
  await page.getByRole("button", { name: /Fort De Soto/ }).first().click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await page.waitForTimeout(9000);
  await page.screenshot({ path: name("spot") });
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(500);
  await page.screenshot({ path: name("spot-basemap") });

  // Closer still: beaches, and the names of parks and beaches (the map is exposed as window.__map in dev).
  await page.evaluate(() => (window as any).__map.jumpTo({ center: [-82.735, 27.63], zoom: 13.2 }));
  await page.waitForTimeout(8000);
  await page.screenshot({ path: name("beach-basemap") });
});
