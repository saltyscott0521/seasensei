import { expect, test } from "@playwright/test";
import { fakePush, mockApis, pushRequests } from "./mocks";

// Phones: the bell is map chrome beside the status pill, never in the sheet; it opens the briefing as a popover over
// the map. Vaul aria-hides everything outside the sheet (the bell too), so the sheet carries the bell's twin for
// keyboards and screen readers, out of sight until focused; the popover itself is outside vaul's reach and stays readable.
test.use({ locale: "en-US", timezoneId: "America/New_York" });

test("phone: the bell beside the status pill opens the briefing over the map, and it can be turned on there", async ({ page }) => {
  await fakePush(page);
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  const sheet = page.locator("[data-vaul-drawer]");
  const bell = page.getByTestId("briefing-bell");
  await expect(bell).toBeInViewport();
  await expect(page.getByTestId("status-pill")).toContainText("Now · SeaSensei forecast"); // the pill's settled width
  await expect(sheet.getByTestId("briefing-bell")).toHaveCount(0); // not in the sheet
  const [b, pill] = [(await bell.boundingBox())!, (await page.getByTestId("status-pill").boundingBox())!];
  expect(b.width).toBeGreaterThanOrEqual(44);
  expect(Math.abs(b.y - pill.y)).toBeLessThanOrEqual(1); // in the pill's row
  expect(b.x).toBeGreaterThanOrEqual(pill.x + pill.width);
  // the Today header no longer carries it, and stays two lines
  await expect(sheet.locator("header").getByRole("button", { name: "Morning briefing" })).toHaveCount(0);

  await bell.tap();
  const pop = page.getByRole("dialog", { name: "Morning briefing" });
  await expect(pop).toBeVisible();
  expect(await pop.evaluate((el) => !!el.closest("[data-vaul-drawer]"))).toBe(false);
  await expect(sheet).toHaveAttribute("data-snap", "rest"); // the sheet didn't move
  const sw = pop.getByRole("switch", { name: "Send me a morning briefing" });
  await sw.tap();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  expect(pushRequests(page).map((c) => c.path)).toEqual(["/api/push/subscribe"]);
  expect(pushRequests(page)[0].body).toMatchObject({ time: "07:00", timeZone: "America/New_York", mode: "daily" });
  await expect(pop.getByRole("button", { name: "Only when it's on" })).toBeVisible();
  await pop.getByRole("button", { name: "Close briefing settings" }).tap();
  await expect(pop).toHaveCount(0);
});

test("phone: keyboards and screen readers reach the briefing from inside the sheet, and Escape brings focus back", async ({ page }) => {
  await fakePush(page);
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  const sheet = page.locator("[data-vaul-drawer]");
  // the one "Morning briefing" button a screen reader finds is in the sheet (the map's bell is aria-hidden by vaul)
  const entry = page.getByRole("button", { name: "Morning briefing" });
  await expect(entry).toHaveCount(1);
  expect(await entry.evaluate((el) => !!el.closest("[data-vaul-drawer]"))).toBe(true);
  await entry.focus();
  await page.keyboard.press("Enter");
  const pop = page.getByRole("dialog", { name: "Morning briefing" });
  await expect(pop).toBeVisible();
  await expect(entry).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("switch", { name: "Send me a morning briefing" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(entry).toBeFocused();
  await expect(sheet).toHaveAttribute("data-snap", "rest");
});
