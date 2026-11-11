import { expect, test } from "@playwright/test";
import { mockApis } from "./mocks";

// The spot detail on a phone, at the sheet's half-open snap: the answer must be on screen without scrolling.
test.use({ locale: "en-US" });

test("phone: a spot's verdict, wind and source sit above the fold; sessions and settings are thumb-sized", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  // the marker sits outside the sheet, which aria-hides it (CLAUDE.md): find it by class
  await page.locator(".maplibregl-marker button[aria-label^='Fort De Soto,']").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();

  const sheet = page.locator("[data-vaul-drawer]");
  const vh = page.viewportSize()!.height;
  const answer = [
    sheet.locator("[data-verdict]").first(), // the verdict pill
    sheet.getByText(/^Nearby sensor · Middle Tampa Bay · 14 km · (just now|\d+ min ago)$/),
    sheet.getByText(/gusting \d+ · from [NESW]+/),
  ];
  for (const el of answer) {
    await expect(el).toBeVisible();
    await expect.poll(async () => { const b = await el.boundingBox(); return b ? b.y + b.height : Infinity; }, { message: "below the fold" }).toBeLessThanOrEqual(vh);
  }

  // a session is a 44 px row; tapping one marks it and moves the charts' cursor there
  const row = sheet.getByRole("button", { name: /Show on the charts$/ }).nth(1);
  await row.scrollIntoViewIfNeeded();
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await row.tap();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByRole("table", { name: /Hour by hour/ }).locator('th[aria-current="time"]')).toHaveCount(1);

  // settings open in place and close with Done; nothing in them is smaller than a thumb
  await page.getByRole("button", { name: "Spot settings" }).click();
  const done = page.getByRole("button", { name: "Done" });
  await done.scrollIntoViewIfNeeded();
  for (const b of [done, page.getByRole("button", { name: "Delete spot" })]) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Fort De Soto");
  await done.click();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Spot settings" })).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test("phone: the back gesture closes the full-screen charts and keeps the spot open", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  await page.locator(".maplibregl-marker button[aria-label^='Fort De Soto,']").click();
  const expand = page.getByRole("button", { name: "Expand charts to full screen" });
  await expand.scrollIntoViewIfNeeded();
  await expand.click();
  const dialog = page.getByRole("dialog", { name: /Fort De Soto wind charts/ });
  await expect(dialog).toBeVisible();
  // full screen uses the phone's height, not just its width
  const box = (await dialog.locator('svg[aria-label="48 hour wind forecast"]').boundingBox())!;
  expect(box.height).toBeGreaterThan(page.viewportSize()!.height * 0.4);
  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/spot=seed-fort-de-soto/);
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
});

test("phone: the week at a glance is on the spot too, its days scroll sideways and a tap shows that day", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  await page.locator(".maplibregl-marker button[aria-label^='Fort De Soto,']").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  const sheet = page.locator("[data-vaul-drawer]");
  const strip = sheet.getByTestId("week-strip");
  await strip.scrollIntoViewIfNeeded();
  const days = strip.getByRole("button");
  await expect(days).toHaveCount(7);
  await expect(days.nth(1)).toHaveAccessibleName(/^[A-Z][a-z]{2}: \d{1,2}( AM)?–\d{1,2} PM, \d+–\d+ kn SW, (likely|possible|unlikely)/);
  for (const d of await days.all()) {
    const b = (await d.boundingBox())!;
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
  }
  // the seventh day is off to the right: the strip scrolls, the page doesn't
  expect(await strip.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  const day = days.nth(2);
  const label = (await day.getAttribute("aria-label"))!.slice(0, 3);
  await day.tap();
  await expect(day).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByText(new RegExp(`^${label} \\d+ (AM|PM) · SeaSensei forecast$`))).toBeVisible();
  // sessions say how likely they are here as well
  await expect(sheet.getByRole("button", { name: /Show on the charts$/ }).first().getByTestId("chance")).toHaveText(/^(Likely|Possible|Unlikely)$/);
});
