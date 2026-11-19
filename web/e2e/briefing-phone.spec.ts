import { expect, test } from "@playwright/test";
import { fakePush, mockApis, pushRequests } from "./mocks";

// Phones: the bell sits in the Today header inside the sheet (vaul hides everything outside it), so the briefing
// can be set up by touch and by a screen reader without leaving the resting sheet.
test.use({ locale: "en-US", timezoneId: "America/New_York" });

test("phone: the bell in the resting sheet opens the briefing, and it can be turned on there", async ({ page }) => {
  await fakePush(page);
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  const sheet = page.locator("[data-vaul-drawer]");
  const bell = sheet.getByRole("button", { name: "Morning briefing" });
  await expect(bell).toBeInViewport();
  // the header stays two lines with the bell in it
  const header = await sheet.locator("header").filter({ has: page.getByRole("heading", { name: "Today", exact: true }) }).boundingBox();
  expect(header!.height).toBeLessThanOrEqual(52);

  await bell.tap();
  const sw = sheet.getByRole("switch", { name: "Send me a morning briefing" });
  await sw.scrollIntoViewIfNeeded();
  await sw.tap();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  expect(pushRequests(page).map((c) => c.path)).toEqual(["/api/push/subscribe"]);
  expect(pushRequests(page)[0].body).toMatchObject({ time: "07:00", timeZone: "America/New_York", mode: "daily" });
  await expect(sheet.getByRole("button", { name: "Only when it's on" })).toBeVisible();
});
