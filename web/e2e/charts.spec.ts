import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockApis } from "./mocks";

// The spot charts and the map timeline, driven like a person: sessions and nights on the chart, scrubbing by
// pointer and keyboard, the timeline's hour on the charts, the model comparison, and what screen readers get.

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
});

const openSpot = async (page: Page, name: string) => {
  await page.locator("aside").getByRole("button", { name: new RegExp(name) }).first().click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
};
/** Left/right page x of every element matching `sel` inside `root`. */
const spans = (root: Locator, sel: string) => root.locator(sel).evaluateAll((els) => els.map((e) => {
  const r = e.getBoundingClientRect();
  return [r.left, r.right] as [number, number];
}));

test("the line chart bands the rider's daylight sessions, shades the nights and keeps the gust line dashed", async ({ page }) => {
  await openSpot(page, "Fort De Soto");
  await page.getByRole("button", { name: "7 days" }).click();
  const line = page.locator('svg[aria-label="7 day wind forecast"]');
  await expect(line).toBeVisible();

  // the mock wind is rideable every day from the SW: one band a day, and none of them reaches into the night
  const sessions = await spans(line, "[data-session] > rect:first-child");
  const nights = await spans(line, "[data-night]");
  expect(sessions.length).toBeGreaterThanOrEqual(5);
  expect(nights.length).toBeGreaterThanOrEqual(6);
  for (const [a, b] of sessions) for (const [c, d] of nights) expect(Math.min(b, d) - Math.max(a, c)).toBeLessThan(1);

  // under a band, the bar chart's readout calls the hour rideable
  const bars = page.locator('svg[aria-label^="Hourly wind bars"]');
  await bars.scrollIntoViewIfNeeded();
  const box = (await bars.boundingBox())!;
  const [a, b] = (await spans(line, "[data-session] > rect:first-child"))[1];
  await page.mouse.move((a + b) / 2, box.y + box.height / 2);
  await expect(bars.getByText(/· rideable$/)).toBeVisible();
  await page.mouse.move(0, 0);

  // gusts are a thin dashed line, and the dashes survive the draw-in
  const gust = line.locator("path.stroke-fg-2");
  await expect(gust).toHaveCount(1);
  expect(await gust.evaluate((el) => getComputedStyle(el).strokeDasharray)).toMatch(/^3(px)?,? 3(px)?$/);
});

test("scrubbing a chart with the keyboard steps an hour at a time, and Escape clears the cursor without leaving the spot", async ({ page }) => {
  await openSpot(page, "Picnic Island");
  const line = page.locator('svg[aria-label="48 hour wind forecast"]');
  await line.focus();
  await expect(line).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const readout = line.getByText(/^\w{3} \d{1,2} (AM|PM) · \d+ kn \(\d+–\d+\) [NESW]+ · gusts \d+/); // SeaSensei: the speed and its range
  await expect(readout).toBeVisible();
  const first = (await readout.textContent())!;
  await page.keyboard.press("ArrowRight");
  await expect(readout).not.toHaveText(first);
  // the other chart follows the same cursor
  await expect(page.locator('svg[aria-label^="Hourly wind bars"]').getByText(/\d+ kn \(\d+–\d+\) [NESW]+/)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(readout).toBeHidden();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible(); // still on the spot
});

test.describe("in the spots' time zone", () => {
  test.use({ timezoneId: "America/New_York" }); // the mocks' forecast zone, so the timeline and the charts name the same hour
  test("the timeline's hour is the charts' cursor until you scrub them yourself", async ({ page }) => {
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await slider.focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
  const when = (await page.getByTestId("timeline-when").textContent())!;
  expect(when).toMatch(/^\w{3} \d{1,2} (AM|PM)$/);
  await expect(slider).toHaveAttribute("aria-valuetext", /^\w+day \d{1,2} (AM|PM), SeaSensei forecast/);

  await openSpot(page, "Picnic Island");
  const line = page.locator('svg[aria-label="48 hour wind forecast"]');
  await expect(line.getByText(when, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Models" }).click();
  await expect(page.locator('svg[aria-label="Wind forecast by model"]').getByText(when, { exact: true })).toBeVisible();
  });
});

test("the model chart draws the primary model bold over the spread, and a tile brings another model forward", async ({ page }) => {
  await openSpot(page, "Fort De Soto");
  await page.getByRole("button", { name: "Models" }).click();
  const chart = page.locator('svg[aria-label="Wind forecast by model"]');
  await expect(chart).toBeVisible();
  const line = (color: string) => chart.locator(`path[stroke="${color}"]`);
  const SENSEI = "#f1f5f9", HRRR = "#22d3ee", RRFS = "#f472b6";
  await expect(line(SENSEI)).toHaveAttribute("stroke-width", "2.75"); // SeaSensei leads by default
  await expect(line(HRRR)).toHaveAttribute("stroke-width", "1.25");
  await expect(line(RRFS)).toHaveAttribute("stroke-width", "1.25");
  await expect(line(RRFS)).toHaveAttribute("stroke-opacity", "0.6");

  const tile = page.getByRole("button", { name: /^RRFS/ });
  await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await expect(line(RRFS)).toHaveAttribute("stroke-width", "2.75");
  await expect(line(HRRR)).toHaveAttribute("stroke-width", "1.25");
  await expect(line(SENSEI)).toHaveAttribute("stroke-width", "1.25");
  // and with a raw model picked to lead, that one is bold from the start
  await page.getByRole("button", { name: "Forecast", exact: true }).click();
  await page.getByRole("combobox", { name: "Forecast model" }).selectOption("hrrr");
  await page.getByRole("button", { name: "Models" }).click();
  await expect(line(HRRR)).toHaveAttribute("stroke-width", "2.75");
  await expect(line(SENSEI)).toHaveAttribute("stroke-width", "1.25");
  await expect(page.getByText(/Next 48 h: .*(agree|disagree)/i)).toBeVisible();
});

test("every chart tells a screen reader what it shows", async ({ page }) => {
  await expect(page.getByRole("img", { name: /^Wind in view over the next week: strongest \d+ kn \w{3} \d{1,2} (AM|PM)/ })).toBeVisible();
  await openSpot(page, "Picnic Island");
  await expect(page.locator('svg[aria-label="48 hour wind forecast"]')).toHaveAccessibleDescription(/^Peaks at \d+ knots [NESW]+, gusts \d+, .*Rideable /);
  await expect(page.locator('svg[aria-label^="Hourly wind bars"]')).toHaveAccessibleDescription(/^\d+ hours: \d+ rideable by speed and direction/);
  await page.getByRole("button", { name: "Past 24 h" }).click();
  await expect(page.locator('svg[aria-label*="forecast versus actual"]')).toHaveAccessibleDescription(/The station measured up to \d+ knots/);
  await page.getByRole("button", { name: "Models" }).click();
  await expect(page.locator('svg[aria-label="Wind forecast by model"]')).toHaveAccessibleDescription(/SeaSensei \d+, HRRR \d+, RRFS \d+, NBM \d+, ECMWF \d+, GFS \d+/);
});

test("one key names every mark on the charts; wrong direction is hatched in the strip, as on the ribbons", async ({ page }) => {
  // Fort De Soto for NE winds only: the mock's SW wind is in range but from the wrong direction
  await page.evaluate(() => localStorage.setItem("spots", JSON.stringify([{ id: "fds", name: "Fort De Soto", lat: 27.64, lon: -82.739, min: 15, max: 30, dirC: 45, dirW: 90 }])));
  await page.reload();
  await openSpot(page, "Fort De Soto");
  const key = page.getByRole("list", { name: /^Chart key/ });
  for (const w of ["Wind", "Gusts", "Session", "Night"]) await expect(key.getByText(w, { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "The strip under the bars" })).toContainText("Wrong direction");
  const bars = page.locator('svg[aria-label^="Hourly wind bars"]');
  await expect(bars.locator("rect[height='7'][fill^='url(#']").first()).toBeAttached();
  // the arrow keys are mentioned where a keyboard user will find them
  await expect(page.getByRole("region", { name: "Charts" })).toContainText("← →");
  await expect(page.locator('svg[aria-label="48 hour wind forecast"]')).toHaveAccessibleDescription(/arrow keys read each hour/);
});
