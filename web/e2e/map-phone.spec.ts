import { expect, test } from "@playwright/test";
import { mockApis } from "./mocks";

// The map on a phone (Pixel 7). Markers live outside the bottom sheet, which aria-hides them (see CLAUDE.md), so
// they are found by class and data attributes.

const spotMarker = (page: import("@playwright/test").Page, name: string) => page.locator(`.maplibregl-marker button[aria-label^='${name},']`);

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  await expect(spotMarker(page, "Fort De Soto")).toBeVisible();
});

test("phone: compact markers, named wherever the names fit, on a particle canvas capped at 1.5× pixels", async ({ page }) => {
  for (const name of ["Fort De Soto", "Skyway", "Picnic Island"]) {
    const m = spotMarker(page, name);
    const pill = (await m.locator("[data-marker-pill]").boundingBox())!;
    expect(pill.height).toBeLessThanOrEqual(30);
    expect(pill.width).toBeLessThanOrEqual(64);
  }
  // zoomed out, the map still says which pill is which: names show where they fit (never over another name or pill)
  await expect(spotMarker(page, "Picnic Island").locator("[data-marker-label]")).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const r = (el: Element) => el.getBoundingClientRect();
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const markers = [...document.querySelectorAll("[data-spot-marker]")];
    const names = markers.map((m) => m.querySelector("[data-marker-label]")!).filter((l) => getComputedStyle(l).visibility === "visible");
    return names.length >= 2 && names.every((l, i) => names.every((o, j) => i === j || !hit(r(l), r(o)))
      && markers.every((m) => m.contains(l) || !hit(r(l), r(m.querySelector("[data-marker-pill]")!))));
  })).toBe(true);
  // Fort De Soto and Skyway are ~7 km apart: zoomed out, their pills are nudged apart instead of stacking, and each
  // pointer still sits under its own pill, on the spot
  const pills = await Promise.all(["Fort De Soto", "Skyway"].map(async (name) => ({
    pill: (await spotMarker(page, name).locator("[data-marker-pill]").boundingBox())!,
    point: await spotMarker(page, name).evaluate((b) => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height }; }),
  })));
  const [a, b] = pills;
  const overlap = a.pill.x < b.pill.x + b.pill.width && a.pill.x + a.pill.width > b.pill.x && a.pill.y < b.pill.y + b.pill.height && a.pill.y + a.pill.height > b.pill.y;
  expect(overlap, JSON.stringify(pills)).toBe(false);
  for (const { pill, point } of pills) {
    expect(point.x).toBeGreaterThan(pill.x + 6);
    expect(point.x).toBeLessThan(pill.x + pill.width - 6);
  }
  // a 2.6× screen still draws the wind at 1.5×
  const ratio = await page.locator("canvas[data-wind-particles]").evaluate((c: HTMLCanvasElement) => c.width / c.clientWidth);
  expect(ratio).toBeLessThanOrEqual(1.5);
  expect(ratio).toBeGreaterThan(1.4);
});

test("phone: tapping a marker opens its spot, rings it and names it, clear of the sheet", async ({ page }) => {
  const fds = spotMarker(page, "Fort De Soto");
  await fds.click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await expect(fds).toHaveAttribute("data-selected", "true");
  await expect(fds.locator("[data-marker-label]")).toBeVisible();
  await expect(fds.locator("[data-marker-label]")).toContainText("Fort De Soto");
  const sheet = (await page.locator("[data-vaul-drawer]").boundingBox())!;
  await expect.poll(async () => { const b = (await fds.boundingBox())!; return b.y + b.height; }).toBeLessThan(sheet.y);
});

const SEEDS = [["Fort De Soto", "seed-fort-de-soto"], ["Skyway", "seed-skyway"], ["Picnic Island", "seed-picnic-island"]] as const;

/** No two spot pills overlap, and no shown name sits under the status pill or the rail. */
const tidy = (page: import("@playwright/test").Page) => expect.poll(() => page.evaluate(() => {
  const r = (el: Element) => el.getBoundingClientRect();
  const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const pills = [...document.querySelectorAll("[data-marker-pill]")].map(r);
  const names = [...document.querySelectorAll("[data-marker-label]")].filter((l) => getComputedStyle(l).visibility === "visible").map(r);
  const chrome = [...document.querySelectorAll("[data-map-chrome]")].map(r);
  return pills.length === 3 && pills.every((a, i) => pills.every((b, j) => i === j || !hit(a, b))) && names.every((n) => chrome.every((c) => !hit(n, c)));
}), { message: "pills apart, names clear of the chrome" }).toBe(true);

for (const size of [{ width: 412, height: 839 }, { width: 375, height: 667 }, { width: 320, height: 568 }]) {
  test(`phone (${size.width}×${size.height}) at rest: the best spot is named on the map, no pill sits on another, and each pill opens its own spot`, async ({ page }) => {
    await page.setViewportSize(size);
    // the board's first card is the best spot; its marker keeps its name
    const best = (await page.locator("[data-vaul-drawer] button:has(h3) h3").first().textContent())!.trim();
    await expect(spotMarker(page, best).locator("[data-marker-label]")).toBeVisible();
    await tidy(page);
    // a tap on a pill's number opens that pill's spot
    for (const [name, id] of SEEDS) {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
      await expect(spotMarker(page, best).locator("[data-marker-label]")).toBeVisible();
      await tidy(page);
      const n = (await spotMarker(page, name).locator("[data-marker-pill] .num").boundingBox())!;
      await page.mouse.click(n.x + n.width / 2, n.y + n.height / 2);
      await expect(page, `tapping ${name}'s pill`).toHaveURL(new RegExp(`\\?spot=${id}$`));
    }
  });
}
