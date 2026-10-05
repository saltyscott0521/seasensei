import { expect, test, type Page } from "@playwright/test";
import { mockApis } from "./mocks";

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
});

const card = (page: Page, name: string) => page.locator("aside").getByRole("button", { name: new RegExp(name) }).first();
const openSpot = async (page: Page, name: string) => { await card(page, name).click(); await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible(); };
const storedSpot = (page: Page, name: string) => page.evaluate((n) => JSON.parse(localStorage.getItem("spots")!).find((s: any) => s.name === n), name);

test("opens on the map with the three Tampa Bay spots, live stations and a wind field", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Skyway" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Picnic Island" })).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(page.getByText("Live wind · HRRR field")).toBeVisible();
  // one marker per spot + NOAA sensors and the airport from the mocks
  await expect(page.locator(".maplibregl-marker")).toHaveCount(3 + 3 + 1);
  await expect(page.getByLabel(/Old Port Tampa: \d+ knots/)).toBeVisible();
  await expect(page.getByLabel(/MacDill AFB \(MCF\): 6 knots/)).toBeVisible();
  // airport meters are just the reading — no plane glyph — and the chart's target sits on the open map
  await expect(page.locator(".maplibregl-marker", { hasText: "✈" })).toHaveCount(0);
  await expect(page.getByTestId("view-target")).toBeVisible();
  // the station toggle hides them
  await page.getByRole("button", { name: "Show live stations" }).click();
  await expect(page.locator(".maplibregl-marker")).toHaveCount(3);
});

test("a spot's detail: live vs model, 7 days with NBM, forecast vs actual, model comparison", async ({ page }) => {
  await openSpot(page, "Picnic Island");
  await expect(page.getByText(/Live · Old Port Tampa/)).toBeVisible();
  await expect(page.getByText("HRRR said for this hour")).toBeVisible();

  await page.getByRole("button", { name: "7 days" }).click();
  await expect(page.getByText("NBM · lower confidence")).toBeVisible();

  // charts are big, and the bars are colour coded (different speeds → different fills; status strip shows the spot's verdict)
  const line = page.locator('svg[aria-label="7 day wind forecast"]');
  const bars = page.locator('svg[aria-label^="Hourly wind bars"]');
  await expect(line).toBeVisible();
  await expect(bars).toBeVisible();
  expect((await line.boundingBox())!.height).toBeGreaterThan(240);
  expect((await bars.boundingBox())!.height).toBeGreaterThan(140);
  await expect.poll(async () => new Set(await bars.locator("rect[fill^='rgba(']").evaluateAll((rs) => rs.map((r) => r.getAttribute("fill")))).size).toBeGreaterThan(6);
  // the scale follows the rider's ranges: 15–20 kn green, 20–30 kn purple (mock wind swings 8–24 kn)
  const fills = () => bars.locator("rect[fill^='rgba(']").evaluateAll((rs) => rs.map((r) => r.getAttribute("fill")));
  await expect.poll(async () => (await fills()).includes("rgba(34,197,94,1)")).toBe(true);
  await expect.poll(async () => (await fills()).includes("rgba(168,85,247,1)")).toBe(true);
  await expect.poll(async () => new Set(await bars.locator("rect[height='7']").evaluateAll((rs) => rs.map((r) => r.getAttribute("fill")))).size).toBeGreaterThan(1);
  // scrubbing one chart moves the cursor and readout on the other
  await bars.scrollIntoViewIfNeeded();
  const box = (await bars.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + 60);
  await expect(bars.getByText(/\d+ kn [NESW]+/)).toBeVisible();
  await expect(line.locator("circle").first()).toBeVisible();
  await page.mouse.move(0, 0);

  await page.getByRole("button", { name: "Past 24 h" }).click();
  await expect(page.getByText(/Model ran 1\.\d kn low/)).toBeVisible(); // mock station reads 1.2 kn above the model
  await expect(page.getByText(/vs Old Port Tampa/)).toBeVisible();
  await expect(page.locator('svg[aria-label*="forecast versus actual"] path[stroke="white"]')).toBeVisible();

  await page.getByRole("button", { name: "Expand charts to full screen" }).click();
  const dialog = page.getByRole("dialog", { name: /Picnic Island wind charts/ });
  await expect(dialog).toBeVisible();
  // bigger than the inline chart, and the bar chart still fits on screen below it
  expect((await dialog.locator('svg[aria-label*="forecast versus actual"]').boundingBox())!.height).toBeGreaterThan(300);
  const barsBox = (await dialog.locator('svg[aria-label^="Hourly wind bars"]').boundingBox())!;
  expect(barsBox.y + barsBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Models" }).click();
  for (const m of ["HRRR", "NBM", "ECMWF", "GFS"]) await expect(page.getByText(m, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Next 48 h: .*(agree|disagree)/i)).toBeVisible();
});

test("wind direction: a spot only counts hours from a workable direction", async ({ page }) => {
  await openSpot(page, "Fort De Soto");
  const chips = page.locator("span[title^='HRRR'], span[title^='NBM']");
  await expect(chips.first()).toBeVisible(); // mock wind is SW and reaches 24 kn, so there are windows

  await page.getByRole("button", { name: "Spot settings" }).click();
  const press = async (label: string, key: string, times = 1) => {
    const thumb = page.getByRole("slider", { name: label });
    await thumb.focus();
    for (let i = 0; i < times; i++) await page.keyboard.press(key);
  };
  await press("Width", "Home");             // 30° wide
  await press("Width", "ArrowRight", 6);    // 90° wide
  await press("Centre", "Home");            // north…
  await press("Centre", "ArrowRight", 9);   // …then 45°: wind from the NE only
  await expect.poll(async () => (await storedSpot(page, "Fort De Soto")).dirC).toBe(45);
  await expect(page.getByText("No rideable window this week.")).toBeVisible();

  await press("Centre", "Home");            // back to SW: 225° = 45 steps of 5°
  await press("Centre", "PageUp", 4);       // PageUp moves 10 steps → 200°
  await press("Centre", "ArrowRight", 5);   // 225°
  await expect.poll(async () => (await storedSpot(page, "Fort De Soto")).dirC).toBe(225);
  await expect(chips.first()).toBeVisible();
});

test("suggest from coastline reads real water polygons and picks Fort De Soto's Gulf-side directions", async ({ page }) => {
  await openSpot(page, "Fort De Soto");
  await page.getByRole("button", { name: "Spot settings" }).click();
  await page.getByRole("button", { name: "Suggest from coastline" }).click();
  await expect(page.getByTestId("coast-summary")).toContainText("Clean water (3 km+) upwind from", { timeout: 20_000 });
  const s = await storedSpot(page, "Fort De Soto");
  // open Gulf water lies to the SW–W of the island; the suggested arc must sit there, and not include N/E
  expect(s.dirC).toBeGreaterThan(200);
  expect(s.dirC).toBeLessThan(300);
  expect(s.dirW).toBeLessThan(180);
});

test("add a spot by tapping the map", async ({ page }) => {
  await page.getByRole("button", { name: "Add a spot" }).click();
  await expect(page.getByText("Tap the map to drop a pin").first()).toBeVisible();
  await page.locator(".maplibregl-canvas").click({ position: { x: 700, y: 420 } });
  await page.getByPlaceholder("e.g. Davis Islands").fill("Davis Islands");
  await page.getByRole("button", { name: "Save spot" }).click();
  await expect(page.getByRole("heading", { name: "Davis Islands" })).toBeVisible();
  const s = await storedSpot(page, "Davis Islands");
  expect(s).toMatchObject({ min: 15, max: 30 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Davis Islands" })).toBeVisible(); // survives a reload
});

test("the timeline scrubs the week: header, markers and station layer follow the chosen hour", async ({ page }) => {
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await expect(slider).toBeVisible();

  // the week's outlook for the area in view: a chart plus a headline you can tap to jump there
  const chart = page.getByRole("img", { name: "Wind in view over the next week" });
  await expect(chart.locator("path")).toHaveCount(2); // typical (filled) + strongest in view
  const outlook = page.getByTestId("outlook");
  await expect(outlook).toHaveText(/Windy now: up to \d+ kn in view|Wind on the way: .+ up to \d+ kn|No 15\+ kn in view this week/);
  const text = (await outlook.textContent())!;
  if (text.startsWith("Wind on the way")) {
    await outlook.click();
    await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    await expect(page.getByText(/^Forecast · /)).toBeVisible();
    await page.getByRole("button", { name: "Back to now" }).click();
  }
  // tapping the chart seeks: halfway along the chart ≈ halfway through the week,
  // and leaving "now" must not resize the chart under your finger
  const box = (await chart.boundingBox())!;
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  expect((await chart.boundingBox())!.width).toBe(box.width);
  await page.keyboard.press("Home");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const max = Number(await slider.getAttribute("aria-valuemax"));
  await expect.poll(async () => Math.abs(Number(await slider.getAttribute("aria-valuenow")) - max / 2)).toBeLessThan(4);
  await page.getByRole("button", { name: "Back to now" }).click();
  await expect(page.getByText("Live wind · HRRR field")).toBeVisible();
  const nowMarker = await page.locator(".maplibregl-marker button[aria-label^='Fort De Soto']").getAttribute("aria-label");

  await slider.focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByText(/^Forecast · /)).toBeVisible();
  await expect(page.getByLabel(/knots from/)).toHaveCount(0); // live stations hide in the future
  const laterMarker = await page.locator(".maplibregl-marker button[aria-label^='Fort De Soto']").getAttribute("aria-label");
  expect(laterMarker).not.toBe(nowMarker);

  await page.getByRole("button", { name: "Play the week" }).click();
  const before = await slider.getAttribute("aria-valuenow");
  await expect.poll(async () => slider.getAttribute("aria-valuenow"), { timeout: 5000 }).not.toBe(before);
  await page.getByRole("button", { name: "Pause" }).click();

  await page.getByRole("button", { name: "Back to now" }).click();
  await expect(page.getByText("Live wind · HRRR field")).toBeVisible();
  await expect(page.getByLabel(/Old Port Tampa: \d+ knots/)).toBeVisible();
});

test("the wind discussion: card summary, full dialog with drivers, days, sources, and the archive", async ({ page }) => {
  const card = page.getByRole("region", { name: "Wind discussion" });
  await expect(card.getByTestId("discussion-headline")).toHaveText(/stalled front and Atlantic high/);
  await expect(card.getByText("Easterly flow, humid")).toBeVisible();
  await expect(card.getByRole("list", { name: "Day by day" }).getByRole("listitem")).toHaveCount(7);

  await card.getByRole("button", { name: /Read the full discussion/ }).click();
  const dialog = page.getByRole("dialog", { name: "Wind discussion" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\?discussion=\d{4}-\d{2}-\d{2}/); // a shareable permalink

  const drivers = dialog.getByTestId("discussion-driver");
  await expect(drivers).toHaveCount(3);
  await expect(drivers.first()).toContainText("Cold front stalls north of the bay");
  await expect(drivers.first()).toContainText("On the water:");
  await expect(drivers.first()).toContainText("NWS Tampa Bay"); // its citations, as readable labels
  await expect(dialog.getByTestId("discussion-day")).toHaveCount(7);
  await expect(dialog.getByText("How far south the front sags")).toBeVisible();
  await expect(dialog.getByRole("link", { name: /Area Forecast Discussion/ })).toHaveAttribute("href", /forecast\.weather\.gov/);
  await expect(dialog.getByText(/Not available today: NHC outlook/)).toBeVisible();
  await expect(dialog.getByText(/Written by AI \(claude-sonnet-5-5\) from the National Weather Service products/)).toBeVisible();
  // it explains the pattern; it doesn't repeat wind numbers
  expect(await dialog.textContent()).not.toMatch(/\b\d+\s?(kn|kt|kts|knots|mph)\b/i);

  // drag the right edge to widen it (the dialog is centred, so it grows both ways); it remembers the width
  const before = (await dialog.boundingBox())!;
  const edge = dialog.getByRole("separator", { name: /right edge/ });
  const eb = (await edge.boundingBox())!;
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.mouse.down();
  await page.mouse.move(eb.x + eb.width / 2 + 60, eb.y + eb.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(before.width + 100);
  await edge.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  expect((await dialog.boundingBox())!.width).toBeLessThan(before.width + 100);
  await edge.dblclick();
  expect(Math.round((await dialog.boundingBox())!.width)).toBe(720);

  // the archive: step back a day, then come back
  await dialog.getByRole("button", { name: "Older discussion" }).click();
  await expect(dialog.getByRole("heading", { name: /Yesterday's pattern/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Older discussion" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Newer discussion" }).click();
  await expect(dialog.getByRole("heading", { name: /stalled front/ })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/discussion=/);
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible(); // Escape closed the dialog, not the list
});

test("a discussion permalink opens that day's discussion straight away", async ({ page }) => {
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  await page.goto(`/?discussion=${yesterday}`);
  await expect(page.getByRole("dialog", { name: "Wind discussion" }).getByRole("heading", { name: /Yesterday's pattern/ })).toBeVisible();
  await page.goto("/?discussion=1999-01-01");
  await expect(page.getByTestId("discussion-missing")).toHaveText(/No discussion was published for/);
});

test("the discussion says so plainly before the first one is published, and when it isn't switched on", async ({ page }) => {
  const empty = (configured: boolean) => (route: import("@playwright/test").Route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ discussion: null, configured, publishHour: 6, timeZone: "America/New_York" }) });
  await page.route(/\/api\/discussion(\?.*)?$/, empty(true));
  await page.reload();
  const card = page.getByRole("region", { name: "Wind discussion" });
  await expect(card.getByTestId("discussion-empty")).toHaveText(/publishes around 6:00 ET/);

  await page.route(/\/api\/discussion(\?.*)?$/, empty(false));
  await page.reload();
  await expect(card.getByTestId("discussion-empty")).toHaveText("The daily wind discussion isn't switched on for this server yet.");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible(); // the rest of the app is unaffected
});
