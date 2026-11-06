import { expect, test } from "@playwright/test";
import { mockApis } from "./mocks";

test("phone: bottom sheet, spot detail, timeline; nothing scrolls sideways", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Forecast time" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Wind in view over the next week" })).toBeVisible();
  // the timeline card sits fully above the sheet, not under it
  const card = (await page.getByTestId("outlook").locator("xpath=ancestor::div[contains(@class,'glass')][1]").boundingBox())!;
  const sheet = (await page.locator("[data-vaul-drawer]").boundingBox())!;
  expect(card.y).toBeGreaterThan(0);
  expect(card.y + card.height).toBeLessThanOrEqual(sheet.y);
  // the cross spans the screen; its intersection stays in the open map, above the timeline
  const cross = await page.getByTestId("view-target").evaluate((el) => ({
    x: parseFloat(getComputedStyle(el).getPropertyValue("--cx")),
    y: parseFloat(getComputedStyle(el).getPropertyValue("--cy")),
  }));
  expect(cross.y).toBeGreaterThan(80);
  expect(cross.y).toBeLessThan(card.y);

  // the sheet's peek leads with the Today board (the wind discussion follows the spots); open a spot from its map marker, as you would on a phone
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeInViewport();
  await expect(page.getByRole("region", { name: "Wind discussion" })).toBeVisible();
  // (the marker sits outside the sheet, which aria-hides it — see CLAUDE.md — so find it by class, not role)
  await page.locator(".maplibregl-marker button[aria-label^='Fort De Soto,']").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  // the chart is a usable size on a phone, with the bar chart beneath it
  const line = page.locator('svg[aria-label="48 hour wind forecast"]');
  await line.scrollIntoViewIfNeeded();
  expect((await line.boundingBox())!.height).toBeGreaterThan(240);
  await expect(page.locator('svg[aria-label^="Hourly wind bars"]')).toBeVisible();

  await page.getByRole("button", { name: "Spot settings" }).click();
  await expect(page.getByRole("button", { name: "Suggest from coastline" })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // every control the sheet exposes is thumb-sized
  const tiny = await page.evaluate(() => [...document.querySelectorAll("[data-vaul-drawer] button")]
    .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 32 || r.width < 32); }).map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim()));
  expect(tiny, `undersized controls in the sheet: ${JSON.stringify(tiny)}`).toEqual([]);
});

test("phone: the wind discussion opens as a full dialog, scrolls, and closes", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  // the discussion follows the spots: raise the sheet, then tap its summary
  await raiseSheet(page);
  await page.getByRole("region", { name: "Wind discussion" }).getByRole("button", { name: "Read the full wind discussion" }).click();
  const dialog = page.getByRole("dialog", { name: "Wind discussion" });
  await expect(dialog.getByTestId("discussion-driver").first()).toBeVisible();
  const box = (await dialog.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y).toBeGreaterThan(0); // leaves a sliver of map above; never taller than the screen
  // long content scrolls inside the dialog, down to the sources and the AI disclaimer
  await dialog.getByText(/Written by AI/).scrollIntoViewIfNeeded();
  await expect(dialog.getByText(/Written by AI/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  // thumb-sized controls
  const tiny = await dialog.evaluate((el) => [...el.querySelectorAll("button, select")]
    .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 32 || r.width < 32); }).map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim()));
  expect(tiny, `undersized controls: ${JSON.stringify(tiny)}`).toEqual([]);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});

/** Drag the sheet up by its top edge, as a thumb would, to its highest snap (the discussion sits below the spots). */
async function raiseSheet(page: import("@playwright/test").Page) {
  const sh = (await page.locator("[data-vaul-drawer]").boundingBox())!;
  await page.mouse.move(sh.x + sh.width / 2, sh.y + 12);
  await page.mouse.down();
  await page.mouse.move(sh.x + sh.width / 2, 40, { steps: 12 });
  await page.mouse.up();
}

/** The control under the pointer, walking up to its button so an icon span still counts. */
async function hitLabel(page: import("@playwright/test").Page, box: { x: number; y: number; width: number; height: number }) {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest("button")?.getAttribute("aria-label") ?? el?.getAttribute("aria-label") ?? null;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

test("phone: the rail (add, stations, locate) sits above the sheet, on the resting peek and after opening a spot; pinch zooms", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  // The rail sits outside the sheet, which aria-hides it — same as the markers — so locate by aria-label.
  const control = (label: string) => page.locator(`button[aria-label="${label}"]`);
  const RAIL = ["Add a spot", "Show live stations", "Find my location"];
  for (const label of RAIL) {
    const box = (await control(label).boundingBox())!;
    expect(await hitLabel(page, box), label).toBe(label);
  }
  // no zoom buttons on phones (a "+" next to "Add a spot" was one tap from the wrong one)
  await expect(control("Zoom in")).toHaveCount(0);
  await expect(control("Zoom out")).toHaveCount(0);
  await page.locator(".maplibregl-marker button[aria-label^='Fort De Soto,']").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  for (const label of RAIL) {
    const box = (await control(label).boundingBox())!;
    expect(await hitLabel(page, box), label).toBe(label);
  }
});

test("phone: a short screen does not lay the timeline over the status pill or the control rail", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  // Markers stack on a narrow map, and the sheet aria-hides them; hit the button itself.
  await page.locator(".maplibregl-marker button[aria-label^='Fort De Soto,']").click({ force: true });
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  const timeline = (await page.getByTestId("outlook").locator("xpath=ancestor::div[contains(@class,'glass')][1]").boundingBox())!;
  // The top chrome that replaced the legend: the status pill, the Add / Stations group and the map controls under it.
  for (const chrome of [page.getByTestId("status-pill"), page.getByTestId("control-rail"), page.locator('button[aria-label="Find my location"]')]) {
    const box = (await chrome.boundingBox())!;
    const overlaps = timeline.x < box.x + box.width && timeline.x + timeline.width > box.x
      && timeline.y < box.y + box.height && timeline.y + timeline.height > box.y;
    expect(overlaps, `timeline ${JSON.stringify(timeline)} chrome ${JSON.stringify(box)}`).toBe(false);
  }
});

test("phone: the discussion close button stays on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mockApis(page);
  await page.goto("/");
  await raiseSheet(page);
  await page.getByRole("button", { name: "Read the full wind discussion" }).click();
  const close = page.getByRole("dialog", { name: "Wind discussion" }).getByRole("button", { name: "Close" });
  await expect(close).toBeVisible();
  const box = (await close.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  await close.click();
  await expect(page.getByRole("dialog", { name: "Wind discussion" })).toBeHidden();
});

test("phone: full-screen charts keep the spot name visible", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await page.locator(".maplibregl-marker button[aria-label^='Fort De Soto,']").click();
  await page.getByRole("button", { name: "Expand charts to full screen" }).click();
  const title = page.getByRole("dialog", { name: /Fort De Soto wind charts/ }).getByRole("heading", { name: /Fort De Soto/ });
  await expect(title).toBeVisible();
  expect((await title.boundingBox())!.width).toBeGreaterThan(80);
});
