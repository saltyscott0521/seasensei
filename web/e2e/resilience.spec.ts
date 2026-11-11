import { expect, test, type Page } from "@playwright/test";
import { alertFeature, mockApis } from "./mocks";

// What the shell does when things are not ideal: a return visit with no signal (the saved board and its honest
// age), one name for the forecast on screen, a headline that agrees with the board, and NWS marine alerts.

const panel = (page: Page) => page.locator("aside");
const UPSTREAMS = ["https://api.open-meteo.com/**", "https://api.tidesandcurrents.noaa.gov/**", "https://mesonet.agron.iastate.edu/**", "**/api/calibration", "**/api/discussion*"];
const loaded = async (page: Page) => {
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Forecast time" })).toBeVisible(); // the wind field is in
};
/** The saved queries by kind, with when each was fetched. */
const saved = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("ssq:"))
  .map((k) => { const e = JSON.parse(localStorage.getItem(k)!); return { kind: String(e.k[0]), t: e.t as number }; }));
/** Makes everything saved look `hours` older, as if the rider came back later. */
const age = (page: Page, hours: number) => page.evaluate((ms) => {
  for (const k of Object.keys(localStorage).filter((x) => x.startsWith("ssq:"))) {
    const e = JSON.parse(localStorage.getItem(k)!);
    e.t -= ms;
    localStorage.setItem(k, JSON.stringify(e));
  }
}, hours * 3600e3);

test("a return visit with the network failing shows the last board at once, says how old it is, and recovers", async ({ page, context }) => {
  await mockApis(page);
  await page.goto("/");
  await loaded(page);
  await expect(panel(page).getByText("Now · SeaSensei forecast")).toBeVisible();
  const verdict = await panel(page).getByRole("button", { name: /Fort De Soto/ }).first().textContent();

  // the board was saved as it loaded: forecasts, the wind field, stations, the discussion
  await expect.poll(async () => new Set((await saved(page)).map((e) => e.kind))).toEqual(new Set(["spot-models", "field", "calibration", "stations", "live", "obs", "discussion", "alerts"]));
  expect((await saved(page)).filter((e) => e.kind === "spot-models")).toHaveLength(3);

  // three hours later every provider is failing
  await age(page, 3);
  const before = await saved(page);
  for (const u of UPSTREAMS) await page.route(u, (r) => r.abort());
  await page.reload();
  // the same board, straight from the saved copy: no skeleton wait, no error card
  await loaded(page);
  await expect(panel(page).getByRole("button", { name: /Fort De Soto/ }).first()).toContainText(verdict!.match(/\d+ kn/)![0]);
  await expect(panel(page).getByText("Couldn't load the forecast")).toHaveCount(0);
  // and the status says what it is, never "Now"
  await expect(panel(page).getByText(/^Updated 3 h ago · (refreshing|retrying)$/)).toBeVisible();
  await expect(panel(page).getByText("Updated 3 h ago · retrying")).toBeVisible({ timeout: 20_000 });
  await expect(panel(page).getByText(/^Now · /)).toHaveCount(0);
  // scrubbed, the hour still carries the age
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(panel(page).getByText(/^\w{3} \d{1,2} [AP]M · updated 3 h ago$/)).toBeVisible();
  await page.keyboard.press("Home");
  // failures are never saved over the good copy
  expect((await saved(page)).filter((e) => e.kind === "spot-models")).toEqual(before.filter((e) => e.kind === "spot-models"));

  // no connection at all
  await context.setOffline(true);
  await expect(panel(page).getByText("Updated 3 h ago · offline")).toBeVisible();

  // back in range, the providers answer again: the board refreshes by itself and is "Now" again
  for (const u of UPSTREAMS) await page.unroute(u);
  await mockApis(page);
  await context.setOffline(false);
  await expect(panel(page).getByText("Now · SeaSensei forecast")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await saved(page)).filter((e) => e.kind === "spot-models").every((e) => Date.now() - e.t < 60_000)).toBe(true);
});

test("a saved board from another version of the app, or older than a day, is dropped", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await loaded(page);
  await expect.poll(async () => (await saved(page)).length).toBeGreaterThan(5);
  await page.evaluate(() => localStorage.setItem("ssq:0:[\"spot-models\",1,2]", JSON.stringify({ k: ["spot-models", 1, 2], t: Date.now(), d: { junk: true } })));
  await age(page, 25);
  for (const u of UPSTREAMS) await page.route(u, (r) => r.abort());
  await page.reload();
  // nothing to show: the cards say so, and nothing claims to be current
  await expect(panel(page).getByText("Couldn't load the forecast").first()).toBeVisible({ timeout: 30_000 });
  expect((await saved(page)).filter((e) => e.kind !== "alerts")).toEqual([]); // (NWS still answered)
});

test("one name for what's on screen: the chip and the status follow the chosen forecast, the map's own model is a detail", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await loaded(page);
  const slider = page.getByRole("slider", { name: "Forecast time" });
  const dock = page.getByTestId("outlook").locator("xpath=ancestor::div[contains(@class,'glass')][1]");
  // at now: SeaSensei in the status, and the map's model named quietly beside the reading
  await expect(panel(page).getByText("Now · SeaSensei forecast")).toBeVisible();
  await expect(page.getByTestId("map-model")).toHaveText("· wind map HRRR");
  // scrubbed: the chip says SeaSensei (it used to say HRRR while every card said SeaSensei)
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(dock.getByText("SeaSensei", { exact: true })).toBeVisible();
  await expect(dock.getByText("HRRR", { exact: true })).toHaveCount(0);
  await expect(slider).toHaveAttribute("aria-valuetext", /^\w+day \d{1,2} (AM|PM), SeaSensei forecast, .*wind map from HRRR$/);
  // late in the week the map runs on NOAA's blend, and says so
  await page.keyboard.press("End");
  await expect(dock.getByText("SeaSensei", { exact: true })).toBeVisible();
  await expect(page.getByTestId("map-model")).toHaveText("· wind map NBM");
  await page.keyboard.press("Home");

  // a raw model picked to lead: the map and the spots are the same model, so there is nothing to add
  await page.getByLabel("Forecast model").selectOption("hrrr");
  await expect(panel(page).getByText("Now · HRRR forecast")).toBeVisible();
  await expect(page.getByTestId("map-model")).toHaveCount(0);
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(dock.getByText("HRRR", { exact: true })).toBeVisible();
  await expect(slider).toHaveAttribute("aria-valuetext", /^\w+day \d{1,2} (AM|PM), HRRR forecast, typical \d+, up to \d+ knots in view$/);
});

test("the timeline's headline only points at daylight, like the sessions on the board", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await loaded(page);
  // The stand-in wind blows 15+ kn from about 3:30 AM to 4:30 PM local, every day: before sunrise the headline used
  // to announce "Wind on the way" for an hour in the dark while the cards said "On at 7 AM".
  const outlook = page.getByTestId("outlook");
  await expect(outlook).toHaveText(/^(Windy now|Wind on the way)/);
  const text = (await outlook.textContent())!;
  const hourNY = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  const way = text.match(/^Wind on the way: \w{3} (\d{1,2}) (AM|PM)\s*· up to \d+ kn [NESW]+\s*for (\d+) h$/);
  if (way) {
    const h = (Number(way[1]) % 12) + (way[2] === "PM" ? 12 : 0);
    expect(h, text).toBeGreaterThanOrEqual(6); // never before the sun is up …
    expect(h, text).toBeLessThanOrEqual(9);
    expect(Number(way[3]), text).toBeGreaterThanOrEqual(2); // … and for as long as a session lasts
    expect(Number(way[3]), text).toBeLessThanOrEqual(12);
    // the board's next session starts at that same hour
    await expect(panel(page).getByRole("button", { name: /Fort De Soto/ }).first()).toContainText(new RegExp(`${way[1]} ${way[2]}`));
  } else {
    expect(text).toMatch(/^Windy now: up to \d+ kn in view\s*· (easing by \w{3} \d{1,2} [AP]M|till dark, \d{1,2} [AP]M)$/);
    expect(hourNY, text).toBeGreaterThanOrEqual(5);
    expect(hourNY, text).toBeLessThanOrEqual(18);
  }
});

test("marine alerts: one quiet row with the alert and when it ends; tap to read it; other alerts and failures stay out of the way", async ({ page }) => {
  await mockApis(page, { alerts: [
    alertFeature("Small Craft Advisory", 6),
    alertFeature("Heat Advisory", 6), // not about the water
    alertFeature("Gale Warning", -1), // over
    alertFeature("Rip Current Statement", 30, { parameters: {} }),
  ] });
  await page.goto("/");
  await loaded(page);
  const alerts = panel(page).getByRole("region", { name: "Weather alerts" });
  const row = alerts.getByRole("button");
  await expect(row).toContainText("Small Craft Advisory");
  await expect(row).toContainText(/Until (\w{3} )?\d{1,2}(:\d\d)? [AP]M · \+1 more/);
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await expect(alerts.getByText(/Southwest winds/)).toHaveCount(0);
  // it sits above the board, in the panel
  const first = (await panel(page).getByRole("button", { name: /Fort De Soto/ }).first().boundingBox())!;
  expect((await alerts.boundingBox())!.y).toBeLessThan(first.y);

  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  // the forecaster's words, unwrapped from NWS's 70-column lines; its capitals calmed down
  await expect(alerts.getByText("* WHAT...Southwest winds 20 to 25 kt with gusts up to 30 kt and seas 4 to 6 ft.").first()).toBeVisible();
  await expect(alerts.getByText("Small craft advisory in effect until this evening")).toBeVisible();
  await expect(alerts.getByRole("heading", { name: "Rip Current Statement" })).toBeVisible();
  await expect(alerts.getByText(/Heat Advisory|Gale Warning/)).toHaveCount(0);
  await expect(alerts.getByText(/National Weather Service/)).toBeVisible();
  await row.click();
  await expect(alerts.getByText(/Southwest winds/)).toHaveCount(0);

  // it stays with an open spot, and steps aside for the add form
  await panel(page).getByRole("button", { name: /Fort De Soto/ }).first().click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await expect(alerts).toBeVisible();
  await page.goBack();
  await page.getByRole("button", { name: "Add a spot" }).click();
  await expect(alerts).toHaveCount(0);
});

test("marine alerts fail silently: no row, no error, the board as usual", async ({ page }) => {
  await mockApis(page);
  await page.route("https://api.weather.gov/**", (r) => r.fulfill({ status: 503, body: "busy" }));
  await page.goto("/");
  await loaded(page);
  await expect(page.getByRole("region", { name: "Weather alerts" })).toHaveCount(0);
  await expect(panel(page).getByText("Now · SeaSensei forecast")).toBeVisible();
  expect((await saved(page)).filter((e) => e.kind === "alerts")).toEqual([]);
});
