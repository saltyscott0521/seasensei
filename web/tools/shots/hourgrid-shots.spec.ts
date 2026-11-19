import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { mockApis } from "../../e2e/mocks";

// Screenshots of a spot's hour grid and its Forecast chart readout, for judging how "when is good" reads.
// Not an assertion suite: look at the pictures in SHOTS_OUT. SHOTS_TAG prefixes the file names (before / after).
//   E2E_PORT=4196 SHOTS_TAG=after SHOTS_OUT=/some/dir npx playwright test -c tools/shots/playwright.config.ts hourgrid
const OUT = process.env.SHOTS_OUT ?? "test-results/shots";
const TAG = process.env.SHOTS_TAG ?? "shot";
fs.mkdirSync(OUT, { recursive: true });

const H = 3600;
const now = Math.floor(Date.now() / 1000 / H) * H;
// A mix: 12–20 kn from the SW quadrant, so the mock's 8–24 kn day is too light, marginal, rideable and too strong;
// the day after tomorrow the wind swings north (wrong direction).
const SPOT = { id: "seed-fort-de-soto", name: "Fort De Soto", lat: 27.64, lon: -82.739, min: 12, max: 20, dirC: 225, dirW: 120, station: "none" };
const dir = (t: number) => (t > now + 40 * H && t < now + 64 * H ? 10 : 225);

async function open(page: Page, phone: boolean) {
  await mockApis(page, { dir });
  await page.addInitScript((s) => { localStorage.setItem("spots", JSON.stringify([s])); localStorage.setItem("primaryModel", "hrrr"); }, SPOT);
  await page.goto("/?spot=seed-fort-de-soto");
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  if (phone) {
    const grabber = page.getByRole("button", { name: "Expand spots" });
    if (await grabber.count()) await grabber.click();
    await page.waitForTimeout(800);
  }
}

test("the hour grid and the chart readout", async ({ page }, info) => {
  const phone = info.project.name === "phone";
  if (phone) await page.setViewportSize({ width: 390, height: 844 }); else await page.setViewportSize({ width: 1440, height: 900 });
  const name = (s: string) => path.join(OUT, `${TAG}-${info.project.name}-${s}.png`);
  await open(page, phone);
  const grid = page.locator('section[aria-labelledby="hours-h"]');
  await grid.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: name("page") });
  await grid.screenshot({ path: name("grid") });
  // further along: the evening run, tomorrow, and the north-wind day
  const region = page.getByRole("region", { name: /Hour by hour, scrolls sideways/ });
  for (const [i, h] of [[2, 14], [3, 40]]) {
    await region.evaluate((el, x) => { el.scrollLeft = x; }, h * 28);
    await page.waitForTimeout(200);
    await grid.screenshot({ path: name(`grid-${i}`) });
  }

  // the readout at the NBM handoff (where the yellow label sits)
  await page.getByRole("button", { name: "7 days" }).first().click();
  const chart = page.locator('svg[aria-label="7 day wind forecast"]').first();
  await chart.scrollIntoViewIfNeeded();
  const line = chart.locator('[data-handoff="NBM"] line');
  if (await line.count()) {
    const lb = (await line.boundingBox())!, cb = (await chart.boundingBox())!;
    await page.mouse.move(lb.x + 2, cb.y + cb.height / 2);
  }
  await page.waitForTimeout(300);
  await chart.screenshot({ path: name("chart") });
});
