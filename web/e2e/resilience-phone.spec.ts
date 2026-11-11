import { expect, test, type Page } from "@playwright/test";
import { alertFeature, mockApis } from "./mocks";

// Phones: the saved board with no signal, and marine alerts inside the sheet (everything outside it is aria-hidden).

const sheet = (page: Page) => page.locator("[data-vaul-drawer]");
const loaded = async (page: Page) => {
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Forecast time" })).toBeVisible();
};

test("phone, no signal on a return visit: the saved board, and the status pill says how old it is", async ({ page, context }) => {
  await mockApis(page);
  await page.goto("/");
  await loaded(page);
  await expect(page.getByTestId("status-pill")).toContainText("Now · SeaSensei forecast");
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("ssq:") && k.includes("spot-models")).length)).toBe(3);
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage).filter((x) => x.startsWith("ssq:"))) {
      const e = JSON.parse(localStorage.getItem(k)!);
      e.t -= 2 * 3600e3;
      localStorage.setItem(k, JSON.stringify(e));
    }
  });
  for (const u of ["https://api.open-meteo.com/**", "https://api.tidesandcurrents.noaa.gov/**", "https://mesonet.agron.iastate.edu/**"]) await page.route(u, (r) => r.abort());
  await page.reload();
  await loaded(page);
  await expect(sheet(page).getByRole("button", { name: /Fort De Soto/ }).first()).toContainText(/\d+ kn/);
  await context.setOffline(true);
  const pill = page.getByTestId("status-pill");
  await expect(pill).toContainText("Updated 2 h ago · offline");
  // the whole line fits the pill
  const text = pill.locator("[data-status]");
  expect(await text.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  // and screen readers hear it from inside the sheet
  await expect(sheet(page).getByRole("status")).toHaveText(/^Updated 2 h ago/);
});

test("phone: a marine alert sits in the sheet above the board; opening it raises the sheet to read", async ({ page }) => {
  await mockApis(page, { alerts: [alertFeature("Special Marine Warning", 1)] });
  await page.goto("/");
  await loaded(page);
  const alerts = sheet(page).getByRole("region", { name: "Weather alerts" });
  const row = alerts.getByRole("button");
  await expect(row).toContainText("Special Marine Warning");
  await expect(row).toContainText(/Until (\w{3} )?\d{1,2}(:\d\d)? [AP]M · Tampa Bay waters/);
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // at rest the board's first spot is still in view under it
  const vp = page.viewportSize()!;
  const card = (await sheet(page).getByRole("button", { name: /Fort De Soto/ }).first().boundingBox())!;
  expect(card.y).toBeLessThan(vp.height - 60);
  await expect(sheet(page)).toHaveAttribute("data-snap", "0");
  await row.tap();
  await expect(sheet(page)).toHaveAttribute("data-snap", "1");
  await expect(alerts.getByText(/Southwest winds 20 to 25 kt/)).toBeVisible();
});
