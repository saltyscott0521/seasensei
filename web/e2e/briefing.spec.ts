import { expect, test, type Page } from "@playwright/test";
import { fakePush, mockApis, pushRequests } from "./mocks";

// The morning briefing, set up from the bell in the Today header: permission is asked only on the switch's tap, the
// server gets the spots, time, zone, mode and model, and every change (time, mode, model, a deleted spot) is re-sent.
test.use({ locale: "en-US", timezoneId: "America/Chicago" });

const SWITCH = "Send me a morning briefing";
const subscribes = (page: Page) => pushRequests(page).filter((c) => c.path === "/api/push/subscribe");
const lastSubscribe = (page: Page) => subscribes(page).at(-1)?.body;
const pushState = (page: Page) => page.evaluate(() => (window as any).__push);

async function open(page: Page) {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  const bell = page.getByRole("button", { name: "Morning briefing" });
  await bell.click();
  await expect(bell).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "Morning briefing" })).toBeVisible();
}

test("turning it on asks for permission on the tap and sends the spots, time, zone, mode and model; changes are re-sent", async ({ page }) => {
  await fakePush(page);
  await open(page);
  const sw = page.getByRole("switch", { name: SWITCH });
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(page.getByLabel("Briefing time")).toHaveValue("07:00");
  // what the next one would say, from the board's forecasts
  await expect(page.getByText(/^(Today|Mon|Tue|Wed|Thu|Fri|Sat|Sun) 7:00 AM · /)).toBeVisible();
  expect((await pushState(page)).asked).toBe(0); // opening the panel asks nothing

  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  expect((await pushState(page)).asked).toBe(1);
  expect(subscribes(page)).toHaveLength(1);
  const body = lastSubscribe(page);
  expect(body).toMatchObject({ time: "07:00", timeZone: "America/Chicago", mode: "daily", model: "sensei" });
  expect(body.subscription.endpoint).toMatch(/^https:\/\/fcm\.googleapis\.com\//);
  expect(body.subscription.keys).toEqual({ p256dh: expect.any(String), auth: expect.any(String) });
  expect(body.spots).toEqual([
    { id: "seed-fort-de-soto", name: "Fort De Soto", lat: 27.64, lon: -82.739, min: 15, max: 30 },
    { id: "seed-skyway", name: "Skyway", lat: 27.628, lon: -82.66, min: 15, max: 30 },
    { id: "seed-picnic-island", name: "Picnic Island", lat: 27.853, lon: -82.552, min: 15, max: 30, station: "8726607" },
  ]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("morningBriefing")!))).toEqual({ on: true, time: "07:00", mode: "daily" });
  await expect(page.getByRole("button", { name: "Morning briefing" })).toHaveClass(/text-accent/); // the bell says it's on

  // a new time, a new mode, another primary model: each re-sent (a moment after the change)
  await page.getByLabel("Briefing time").fill("06:30");
  await expect.poll(() => lastSubscribe(page)?.time).toBe("06:30");
  await page.getByRole("button", { name: "Only when it's on" }).click();
  await expect.poll(() => lastSubscribe(page)?.mode).toBe("windy");
  await page.getByLabel("Forecast model").selectOption("gfs");
  await expect.poll(() => lastSubscribe(page)?.model).toBe("gfs");
  expect(subscribes(page)).toHaveLength(4);
  expect((await pushState(page)).asked).toBe(1);

  // remembered for the next visit
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("morningBriefing")!))).toEqual({ on: true, time: "06:30", mode: "windy" });
});

test("deleting a spot re-sends the briefing without it; turning it off unsubscribes", async ({ page }) => {
  await fakePush(page);
  await open(page);
  await page.getByRole("switch", { name: SWITCH }).click();
  await expect.poll(() => subscribes(page).length).toBe(1);

  await page.locator("aside").getByRole("button", { name: /Skyway/ }).first().click();
  await page.getByRole("button", { name: "Spot settings" }).click();
  await page.getByRole("button", { name: "Delete spot" }).click();
  await page.getByRole("button", { name: /(Click|Tap) again to delete/ }).click();
  await expect.poll(() => lastSubscribe(page)?.spots.map((s: any) => s.name)).toEqual(["Fort De Soto", "Picnic Island"]);

  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Morning briefing" }).click();
  const sw = page.getByRole("switch", { name: SWITCH });
  await expect(sw).toHaveAttribute("aria-checked", "true");
  const endpoint = lastSubscribe(page).subscription.endpoint;
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  expect(pushRequests(page).at(-1)).toEqual({ path: "/api/push/unsubscribe", body: { endpoint } });
  expect((await pushState(page)).unsubscribed).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("morningBriefing")!).on)).toBe(false);
  // nothing more is sent once it's off
  await page.getByLabel("Briefing time").fill("08:00");
  await page.waitForTimeout(2000);
  expect(pushRequests(page).at(-1)!.path).toBe("/api/push/unsubscribe");
});

test("blocked notifications are explained, and nothing is subscribed", async ({ page }) => {
  await fakePush(page, { answer: "denied" });
  await open(page);
  await page.getByRole("switch", { name: SWITCH }).click();
  await expect(page.getByRole("alert")).toHaveText(/Notifications are blocked for SeaSensei/);
  await expect(page.getByRole("switch", { name: SWITCH })).toHaveAttribute("aria-checked", "false");
  expect(pushRequests(page)).toHaveLength(0);
});

test("a browser without Web Push says so plainly", async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).PushManager; });
  await open(page);
  await expect(page.getByText("This browser can't show notifications from SeaSensei, so the morning briefing isn't available here.")).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0);
});

test.describe("on an iPhone, in Safari", () => {
  test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1" });
  test("it asks to add SeaSensei to the Home Screen first", async ({ page }) => {
    await fakePush(page);
    await open(page);
    await expect(page.getByText("On iPhone, add SeaSensei to your Home Screen first (Share → Add to Home Screen), then turn this on.")).toBeVisible();
    await expect(page.getByRole("switch")).toHaveCount(0);
  });
});
