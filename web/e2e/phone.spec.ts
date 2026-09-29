import { expect, test } from "@playwright/test";
import { mockApis } from "./mocks";

test("phone: bottom sheet, spot detail, timeline; nothing scrolls sideways", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Forecast time" })).toBeVisible();

  await page.getByRole("heading", { name: "Fort De Soto" }).click(); // the peek snap shows the first card; the rest need a drag up
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
