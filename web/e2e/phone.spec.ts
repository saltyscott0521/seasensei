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

  // the sheet's peek leads with the wind discussion; open a spot from its map marker, as you would on a phone
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
  // the summary is tappable from the sheet's low resting position, no need to expand it first
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
