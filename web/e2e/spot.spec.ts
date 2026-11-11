import { expect, test, type Page } from "@playwright/test";
import { calibrationFixture, mockApis } from "./mocks";

// The spot detail, driven like a rider: the answer first, honest sources, sessions that move the charts,
// the hour grid on the same clock as the timeline, settings that rename and close in layers.
test.use({ locale: "en-US" });

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
});

const card = (page: Page, name: string) => page.locator("aside").getByRole("button", { name: new RegExp(name) }).first();
const openSpot = async (page: Page, name: string) => { await card(page, name).click(); await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible(); };
const storedSpot = (page: Page, name: string) => page.evaluate((n) => JSON.parse(localStorage.getItem("spots")!).find((s: any) => s.name === n), name);
const hourTable = (page: Page) => page.getByRole("table", { name: /Hour by hour/ });
/** "11 AM" → minutes after midnight */
const minutes = (h: string, ap: string) => ((+h % 12) + (ap === "PM" ? 12 : 0)) * 60;

test("the answer comes first: verdict, an honest source line, range chips, no coordinates", async ({ page }) => {
  await openSpot(page, "Picnic Island");
  const panel = page.locator("aside");
  // header: the range and direction as chips; the coordinates wait in the settings
  await expect(panel.locator("header").getByText("15–30 kn")).toBeVisible();
  await expect(panel.locator("header").getByText("Any direction")).toBeVisible();
  await expect(panel.getByText(/27\.85/)).toHaveCount(0);
  // the verdict in words, and the source line in full: station, distance and age (never cut off)
  await expect(panel.getByText(/^(On now|On at \d+ (AM|PM)|Next: [A-Z][a-z]{2} \d+ (AM|PM)|No session this week)$/).first()).toBeVisible();
  await expect(panel.getByText(/^Live · Old Port Tampa · 0\.\d km · (just now|\d+ min ago)$/)).toBeVisible();
  // how the wind sits in the rider's range, in words
  await expect(panel.getByText(/^(In range|Too light|Too strong|Wrong direction)$/).first()).toBeVisible();
  // how sure is said in plain words (below); nothing here talks about model spread
  await expect(panel.getByRole("button", { name: "How sure is this?" })).toBeVisible();
  await expect(panel.getByText(/kn spread/)).toHaveCount(0);

  await page.getByRole("button", { name: "Spot settings" }).click();
  await expect(panel.getByText("27.853° N, 82.552° W")).toBeVisible();

  // Fort De Soto has no station of its own: its "now" is a sensor 14 km away, labelled as such and amber
  await page.getByRole("button", { name: "Back to spots" }).click();
  await openSpot(page, "Fort De Soto");
  const nearby = panel.getByText(/^Nearby sensor · Middle Tampa Bay · 14 km · (just now|\d+ min ago)$/);
  await expect(nearby).toBeVisible();
  await expect(panel.locator('[data-source="far"] svg')).toHaveCSS("color", "rgb(251, 191, 36)"); // an amber pin, plain text
});

test("sessions read as a schedule, and picking one puts the charts and the hour grid on its peak", async ({ page }) => {
  await openSpot(page, "Fort De Soto");
  const sessions = page.getByRole("button", { name: /Show on the charts$/ });
  await expect(sessions.first()).toBeVisible();
  expect(await sessions.count()).toBeGreaterThanOrEqual(4);
  // SeaSensei blends every model all week: no session is marked down for leaning on the NBM blend (app.spec.ts covers a raw model)
  await expect(page.getByRole("button", { name: /NBM blend, lower confidence/ })).toHaveCount(0);

  // four sessions on is more than two days away: the charts widen to the week to show it
  const row = sessions.nth(3);
  const name = (await row.getAttribute("aria-label"))!;
  const span = name.match(/^\S+ (\d+)(?: (AM|PM))?–(\d+) (AM|PM)/)!;
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  const bars = page.locator('svg[aria-label^="Hourly wind bars"]');
  await expect(bars.getByText(/\d+ kn \(\d+–\d+\) [NESW]+/)).toBeVisible(); // the chart cursor's readout

  // the hour grid marks the same hour, inside the session
  const marked = hourTable(page).locator('th[aria-current="time"]');
  await expect(marked).toHaveCount(1);
  const [, h, ap] = (await marked.textContent())!.match(/^(\d+) (AM|PM)$/)!;
  expect(minutes(h, ap)).toBeGreaterThanOrEqual(minutes(span[1], span[2] ?? span[4]));
  expect(minutes(h, ap)).toBeLessThan(minutes(span[3], span[4]));

  // pick it again to let go
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "false");
  await expect(bars.getByText(/\d+ kn [NESW]+/)).toHaveCount(0);
  await expect(marked).toHaveCount(0);
});

test("the hour grid is a real table from now: night shaded, the mouse wheel scrolls it sideways", async ({ page }) => {
  await openSpot(page, "Fort De Soto");
  const table = hourTable(page);
  await expect(table.getByRole("columnheader", { name: "Now", exact: true })).toBeVisible();
  for (const r of ["kn", "Gust", "From", "Ride"]) await expect(table.getByRole("rowheader", { name: r, exact: true })).toBeVisible();
  // 3 AM is dark in Tampa all year; noon never is
  await expect(table.getByRole("columnheader", { name: "3 AM", exact: true }).first()).toHaveAttribute("data-night", "true");
  await expect(table.getByRole("columnheader", { name: "12 PM", exact: true }).first()).not.toHaveAttribute("data-night");

  // a vertical wheel over the grid scrolls the hours, not the panel
  const grid = page.getByRole("region", { name: /Hour by hour, scrolls sideways/ });
  await grid.scrollIntoViewIfNeeded();
  const panel = page.locator("aside");
  const top = await panel.evaluate((el) => el.scrollTop);
  const box = (await grid.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => grid.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
  expect(await panel.evaluate((el) => el.scrollTop)).toBe(top);
});

test("one clock: the timeline's hour drives the hero and the hour grid", async ({ page }) => {
  await openSpot(page, "Fort De Soto");
  const panel = page.locator("aside");
  await expect(panel.getByText("SeaSensei said for this hour")).toBeVisible();
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await slider.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");

  const line = panel.getByText(/^(Today|[A-Z][a-z]{2}) \d+ (AM|PM) · SeaSensei forecast$/);
  await expect(line).toBeVisible();
  await expect(panel.getByText("SeaSensei said for this hour")).toHaveCount(0); // a forecast hour has nothing live to compare
  const hour = (await line.textContent())!.match(/\d+ (AM|PM)/)![0];
  await expect(hourTable(page).locator('th[aria-current="time"]')).toHaveText(hour);

  await page.getByRole("button", { name: "Back to now" }).click();
  await expect(panel.getByText(/^Nearby sensor · Middle Tampa Bay/)).toBeVisible();
  await expect(hourTable(page).locator('th[aria-current="time"]')).toHaveCount(0);
});

test("night has one word, and the hero tells before sunrise from after dark", async ({ page }) => {
  // 5:30 AM in Tampa, forecast only (so "now" is the model's hour, in range, before a 6:4x sunrise)
  const TZ = "America/New_York";
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(Date.now()).split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 5, 30);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(guess).map((x) => [x.type, Number(x.value)]));
  await page.evaluate(() => localStorage.setItem("spots", JSON.stringify([
    { id: "seed-fort-de-soto", name: "Fort De Soto", lat: 27.64, lon: -82.739, min: 15, max: 30, station: "none" },
  ])));
  await page.clock.install({ time: guess - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess) });
  await page.reload();
  await openSpot(page, "Fort De Soto");
  const panel = page.locator("aside");
  await expect(panel.getByText("In range", { exact: true })).toBeVisible();
  await expect(panel.getByText("· before sunrise")).toBeVisible();
  await expect(panel.getByText(/after dark/)).toHaveCount(0);
  // the hour grid's key and the chart key say "Night" alike
  await expect(page.getByRole("list", { name: "The ride row" }).getByText("Night", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "The ride row" }).getByText("Dark", { exact: true })).toHaveCount(0);
});

test("settings: rename the spot, then Escape closes the settings before it leaves the spot", async ({ page }) => {
  await openSpot(page, "Picnic Island");
  await page.getByRole("button", { name: "Spot settings" }).click();
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await name.fill("Picnic Island Flats");
  await expect(page.getByRole("heading", { name: "Picnic Island Flats" })).toBeVisible();
  await expect.poll(async () => (await storedSpot(page, "Picnic Island Flats"))?.station).toBe("8726607");

  await page.keyboard.press("Escape");
  await expect(name).toBeHidden();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Picnic Island Flats" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeHidden();
  await expect(card(page, "Picnic Island Flats")).toBeVisible();
});

test("delete takes two taps, and the toast can undo it", async ({ page }) => {
  await openSpot(page, "Skyway");
  await page.getByRole("button", { name: "Spot settings" }).click();
  await page.getByRole("button", { name: "Delete spot" }).click();
  const confirm = page.getByRole("button", { name: /(Click|Tap) again to delete/ });
  await expect(confirm).toBeVisible(); // one tap only arms it
  await expect(page.getByRole("heading", { name: "Skyway" })).toBeVisible();
  await confirm.click();
  await expect(page.locator("[data-sonner-toast]").getByText("Deleted Skyway")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Skyway" })).toHaveCount(0);
  expect(await storedSpot(page, "Skyway")).toBeUndefined();

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Skyway" })).toBeVisible();
  expect(await storedSpot(page, "Skyway")).toMatchObject({ lat: 27.628, lon: -82.66, min: 15, max: 30 });
});

test("the toast's Undo brings a deleted spot back from any view, in its place", async ({ page }) => {
  const order = () => page.evaluate(() => JSON.parse(localStorage.getItem("spots")!).map((s: { name: string }) => s.name));
  await openSpot(page, "Skyway");
  await page.getByRole("button", { name: "Spot settings" }).click();
  await page.getByRole("button", { name: "Delete spot" }).click();
  await page.getByRole("button", { name: /(Click|Tap) again to delete/ }).click();
  const toastUndo = page.locator("[data-sonner-toast]").getByRole("button", { name: "Undo", exact: true });
  await expect(toastUndo).toBeVisible();
  expect(await order()).toEqual(["Fort De Soto", "Picnic Island"]);
  // moved on: another spot is open, so the board (and its undo row) is gone
  await openSpot(page, "Fort De Soto");
  await toastUndo.click();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await expect.poll(order).toEqual(["Fort De Soto", "Skyway", "Picnic Island"]); // back in the same place
  expect(await storedSpot(page, "Skyway")).toMatchObject({ id: "seed-skyway", lat: 27.628, lon: -82.66, min: 15, max: 30 });
  await page.getByRole("button", { name: "Back to spots" }).click();
  await expect(card(page, "Skyway")).toBeVisible();
  await expect(page.getByTestId("undo-row")).toHaveCount(0); // nothing left to undo
});

test("full-screen charts hold focus, and hand it back to the button that opened them", async ({ page }) => {
  await openSpot(page, "Picnic Island");
  const expand = page.getByRole("button", { name: "Expand charts to full screen" });
  await expand.click();
  const dialog = page.getByRole("dialog", { name: /Picnic Island wind charts/ });
  await expect(dialog).toBeFocused();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(expand).toBeFocused();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible(); // still on the spot
});

test("after a delete, Undo is one Tab from the board's heading, and brings the spot back where it was", async ({ page }) => {
  await openSpot(page, "Skyway");
  await page.getByRole("button", { name: "Spot settings" }).click();
  await page.getByRole("button", { name: "Delete spot" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter"); // armed: the second press deletes
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeFocused();
  await expect(page.getByTestId("undo-row")).toContainText("Deleted Skyway");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Undo deleting Skyway" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("undo-row")).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0); // the toast goes with it
  await expect(page.getByRole("heading", { name: "Skyway" })).toBeVisible();
  await expect(card(page, "Skyway")).toBeFocused(); // focus lands on the spot that came back
  expect(await storedSpot(page, "Skyway")).toMatchObject({ lat: 27.628, lon: -82.66, min: 15, max: 30 });
});

test("back closes the full-screen charts, then the settings, and only then the spot", async ({ page }) => {
  await openSpot(page, "Picnic Island");
  const url = page.url();
  const settings = page.getByRole("button", { name: "Spot settings" });
  await page.getByRole("button", { name: "Expand charts to full screen" }).click();
  const dialog = page.getByRole("dialog", { name: /Picnic Island wind charts/ });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.fullscreen)).toBe("1"); // the shell pauses the particles on it
  await page.goBack();
  await expect(dialog).toBeHidden();
  expect(page.url()).toBe(url);
  await expect(settings).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.fullscreen)).toBeUndefined();

  await settings.click();
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(name).toBeVisible();
  await page.goBack();
  await expect(name).toBeHidden();
  await expect(settings).toHaveAttribute("aria-pressed", "false");

  // closing a layer with its own button leaves no dead entry behind: the next back leaves the spot
  await settings.click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(name).toBeHidden();
  await page.goBack();
  await expect(settings).toBeHidden();
  await expect(card(page, "Picnic Island")).toBeVisible();

  // and "Back to spots" from inside the settings leaves the spot in one step
  await openSpot(page, "Picnic Island");
  await settings.click();
  await page.getByRole("button", { name: "Back to spots" }).click();
  await expect(settings).toBeHidden();
  await expect(page).not.toHaveURL(/spot=/);
});

/* ---------- Chance and range in plain words ---------- */

test("sessions, the hero and the hour grid give a range and a chance in plain words; \"How sure is this?\" explains them", async ({ page }) => {
  await openSpot(page, "Fort De Soto");
  const panel = page.locator("aside");
  // every session: the likely range, then one of three words (in its name too)
  const sessions = page.getByRole("button", { name: /Show on the charts$/ });
  await expect(sessions.first()).toBeVisible();
  for (const row of await sessions.all()) {
    await expect(row).toHaveAccessibleName(/, \d+–\d+ kn SW, (likely|possible|unlikely)[,.]/);
    await expect(row.getByTestId("chance")).toHaveText(/^(Likely|Possible|Unlikely)$/);
  }
  await expect(panel.getByText(/spread|confidence|Models (agree|disagree)/)).toHaveCount(0);

  // the hour grid has the range under each hour's speed
  const range = hourTable(page).getByRole("row", { name: /^Likely/ });
  const cells = await range.getByRole("cell").allTextContents();
  expect(cells.length).toBeGreaterThan(100);
  for (const c of cells.slice(0, 48)) expect(c).toMatch(/^\d+–\d+$/);

  // a forecast hour in the hero: its speed inside the range it is likely to fall in
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await slider.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  const likely = panel.getByTestId("hero-range");
  await expect(likely).toHaveText(/^likely \d+–\d+ kn · $/);
  const [, lo, hi] = (await likely.textContent())!.match(/(\d+)–(\d+)/)!.map(Number);
  expect(hi).toBeGreaterThan(lo);
  await page.getByRole("button", { name: "Back to now" }).click();

  // one tap explains it, without jargon; no track record until the server has scored one
  const how = panel.getByRole("button", { name: "How sure is this?" });
  await expect(how).toHaveAttribute("aria-expanded", "false");
  await how.click();
  const text = panel.getByTestId("how-sure");
  await expect(text).toContainText("is where the wind lands about 8 times in 10");
  await expect(text).toContainText(/Likely means the wind reaches your minimum for the session at least 7 times in 10/);
  await expect(text).not.toContainText(/quantile|MAE|calibrat|nowcast|percentile/i);
  await expect(panel.getByTestId("track-record")).toHaveCount(0);
  await how.click();
  await expect(text).toHaveCount(0);
});

test("\"How sure is this?\" gives the 30-day track record once the server has one; a raw model has nothing to explain", async ({ page }) => {
  await page.route("**/api/calibration", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    ...calibrationFixture(),
    score: { days: 30, models: { sensei: { mae: 1.8, n: 4100 }, hrrr: { mae: 2.4, n: 4100 }, nbm: { mae: 2.1, n: 4000 } } },
  }) }));
  await page.reload();
  await openSpot(page, "Skyway");
  const panel = page.locator("aside");
  await panel.getByRole("button", { name: "How sure is this?" }).click();
  await expect(panel.getByTestId("track-record")).toHaveText("Last 30 days: off by 1.8 kn on average; HRRR alone 2.4.");

  // a raw model: no range, no chance, so no explanation; its sessions keep the models' agreement
  await page.getByRole("combobox", { name: "Forecast model" }).selectOption("hrrr");
  await expect(panel.getByRole("button", { name: "How sure is this?" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Show on the charts$/ }).first()).toHaveAccessibleName(/confidence, \d+ kn spread/);
});

/* ---------- The week at a glance, in the spot ---------- */

test("the spot's week at a glance: seven days with window, range and chance; picking a day shows it", async ({ page }) => {
  await openSpot(page, "Fort De Soto");
  const strip = page.getByTestId("week-strip");
  const days = strip.getByRole("button");
  await expect(days).toHaveCount(7);
  await expect(days.first()).toHaveAccessibleName(/^Today: /);
  // the mock wind is rideable every day ahead
  for (const i of [1, 3, 6]) {
    await expect(days.nth(i)).toHaveAccessibleName(/^[A-Z][a-z]{2}: \d{1,2}( AM)?–\d{1,2} PM, \d+–\d+ kn SW, (likely|possible|unlikely).*\. Show that day$/);
    await expect(days.nth(i)).toHaveAttribute("data-state", "go");
    await expect(days.nth(i)).toContainText(/(Likely|Possible|Unlikely)$/);
  }
  const day = days.nth(3);
  const label = (await day.getAttribute("aria-label"))!.slice(0, 3);
  await day.click();
  await expect(day).toHaveAttribute("aria-pressed", "true");
  // the hero and the hour grid are on that day
  await expect(page.locator("aside").getByText(new RegExp(`^${label} \\d+ (AM|PM) · SeaSensei forecast$`))).toBeVisible();
  await expect(hourTable(page).locator('th[aria-current="time"]')).toHaveCount(1);
  if (await strip.getAttribute("data-clock")) {
    // … and so is the one clock: the timeline says the same day, at the session's start
    await expect(page.locator("aside").getByText(new RegExp(`^${label} \\d+ AM · SeaSensei forecast$`))).toBeVisible();
    await page.getByRole("button", { name: "Back to now" }).click();
    await expect(day).toHaveAttribute("aria-pressed", "false");
  }
});

/* ---------- Shore-relative direction ---------- */

test("where the coast can tell, the wind is named against the shore, and offshore sessions carry a caution but stay listed", async ({ page }) => {
  // Fort De Soto faces the Gulf (WSW). The default mock wind is SW: onshore, nothing to warn about.
  await openSpot(page, "Fort De Soto");
  const panel = page.locator("aside");
  await expect(panel.getByTestId("shore")).toHaveText(" · onshore");
  await expect(panel.getByTestId("offshore")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Show on the charts$/ }).first()).toHaveAccessibleName(/, onshore/);
  await expect(panel.getByText("Offshore", { exact: true })).toHaveCount(0);
  // Skyway's pin has no coastline in the saved tiles: nothing is claimed
  await page.getByRole("button", { name: "Back to spots" }).click();
  await openSpot(page, "Skyway");
  await expect(panel.getByText(/gusting \d+ · from SW$/)).toBeVisible();
  await expect(panel.getByTestId("shore")).toHaveCount(0);

  // The same beach in an ENE wind: off the land
  await mockApis(page, { dir: 70 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await page.getByRole("button", { name: "Back to spots" }).click();
  await openSpot(page, "Fort De Soto");
  const slider = page.getByRole("slider", { name: "Forecast time" }); // a forecast hour (the sensors still read SW)
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(panel.getByTestId("shore")).toHaveText(" · offshore");
  await expect(panel.getByTestId("offshore")).toHaveText("Offshore: wind blows out to sea");
  // the sessions are still there (a caution, not a filter), each tagged in sight and in its name
  const sessions = page.getByRole("button", { name: /Show on the charts$/ });
  expect(await sessions.count()).toBeGreaterThanOrEqual(4);
  for (const row of await sessions.all()) {
    await expect(row).toHaveAccessibleName(/, offshore[,.]/);
    await expect(row.getByText("Offshore", { exact: true })).toBeVisible();
  }
  await expect(panel.getByTestId("offshore-note")).toContainText("Offshore: wind blows out to sea");
  await expect(page.getByTestId("week-strip").getByRole("button").nth(2)).toHaveAccessibleName(/, offshore\. Show that day$/);
});
