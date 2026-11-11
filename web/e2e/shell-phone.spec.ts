import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockApis } from "./mocks";

// The phone shell on a Pixel 7: the status pill and the one control rail, the sheet's snaps and grabber,
// the back gesture, and keeping a selected spot in the open map.

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
});

const sheet = (page: Page) => page.locator("[data-vaul-drawer]");
const box = async (l: Locator) => (await l.boundingBox())!;
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const sheetTop = async (page: Page) => Math.round((await box(sheet(page))).y);
/** The sheet's top edge once it has settled (the same for three reads, longer than vaul's 0.5 s snap). */
const settledTop = async (page: Page) => {
  const seen: number[] = [];
  await expect.poll(async () => { seen.push(await sheetTop(page)); return seen.length >= 3 && seen.slice(-3).every((y) => y === seen.at(-1)); },
    { intervals: [250] }).toBe(true);
  return seen.at(-1)!;
};
// Outside the sheet everything is aria-hidden (vaul), so the rail and the map controls are found by label.
const RAIL = ["Add a spot", "Show live stations", "Find my location"];
const timelineCard = (page: Page) => page.getByTestId("outlook").locator("xpath=ancestor::div[contains(@class,'glass')][1]");

test("phone: a status pill on the left and one rail of thumb-sized controls on the right", async ({ page }) => {
  const vp = page.viewportSize()!;
  const pill = page.getByTestId("status-pill");
  await expect(pill).toContainText("SeaSensei");
  await expect(pill).toContainText("Now · SeaSensei forecast");
  const p = await box(pill);
  let prev: { x: number; y: number; width: number; height: number } | null = null;
  for (const label of RAIL) {
    const b = await box(page.locator(`button[aria-label="${label}"]`));
    expect(b.width, label).toBeGreaterThanOrEqual(44);
    expect(b.height, label).toBeGreaterThanOrEqual(44);
    expect(vp.width - (b.x + b.width), `${label} hugs the right edge`).toBeLessThanOrEqual(16);
    expect(overlap(b, p), `${label} clear of the status pill`).toBe(false);
    if (prev) {
      expect(Math.abs(b.x + b.width / 2 - (prev.x + prev.width / 2)), `${label} in the same column`).toBeLessThanOrEqual(1);
      expect(b.y, `${label} below the one before`).toBeGreaterThanOrEqual(prev.y + prev.height - 1);
    }
    prev = b;
  }
  // the resting sheet leaves the map open: about 320px of sheet, the timeline floating just above it
  const top = await settledTop(page);
  expect(vp.height - top).toBeGreaterThanOrEqual(316);
  expect(vp.height - top).toBeLessThanOrEqual(324);
  const card = await box(timelineCard(page));
  expect(card.y + card.height).toBeLessThanOrEqual(top);
  expect(top - (card.y + card.height)).toBeLessThanOrEqual(16);
  for (const label of RAIL) expect(overlap(card, await box(page.locator(`button[aria-label="${label}"]`))), label).toBe(false);
  expect(overlap(card, p)).toBe(false);
});

test("phone: the grabber steps the sheet through its snaps; at mid the content scrolls", async ({ page }) => {
  const rest = await settledTop(page);
  const grabber = page.getByRole("button", { name: "Expand spots" });
  await grabber.click();
  await expect.poll(() => sheetTop(page)).toBeLessThan(rest - 100);
  const mid = await settledTop(page);
  // at mid the list scrolls inside the sheet; the sheet itself stays put
  const scroller = sheet(page).locator(".sheet-scroll");
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const s = await box(scroller);
  await page.mouse.move(s.x + s.width / 2, mid + 160);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await settledTop(page)).toBe(mid);

  // keyboard works too: Enter on the grabber raises it to full, and then it offers to collapse
  await grabber.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => sheetTop(page)).toBeLessThan(mid - 100);
  const collapse = page.getByRole("button", { name: "Collapse spots" });
  await expect(collapse).toBeVisible();
  // the raised sheet would cut through the rail, so the rail steps aside
  await expect(page.locator('button[aria-label="Find my location"]')).toBeHidden();
  await collapse.click();
  await expect.poll(() => sheetTop(page)).toBe(rest);
  await expect(page.locator('button[aria-label="Find my location"]')).toBeVisible();
});

test("phone: the sheet drags by its grabber, and by its content at rest", async ({ page }) => {
  const rest = await settledTop(page);
  const drag = async (fromY: number, toY: number) => {
    const s = await box(sheet(page));
    await page.mouse.move(s.x + s.width / 2, fromY);
    await page.mouse.down();
    await page.mouse.move(s.x + s.width / 2, toY, { steps: 12 });
    await page.mouse.up();
  };
  // grab the grabber (the sheet's top edge) and pull it up
  await drag(rest + 12, 300);
  await expect.poll(() => sheetTop(page)).toBeLessThan(rest - 100);
  const up = await settledTop(page);
  // a drag that started on the grabber is a drag, not a tap: it doesn't also step the snap
  expect(up).toBeGreaterThan(200);
  await page.getByRole("button", { name: "Expand spots" }).click(); // to full
  await expect(page.getByRole("button", { name: "Collapse spots" })).toBeVisible();
  await page.getByRole("button", { name: "Collapse spots" }).click(); // back to rest
  await expect.poll(() => sheetTop(page)).toBe(rest);
  // at rest the whole sheet is a handle
  await drag(rest + 140, 300);
  await expect.poll(() => sheetTop(page)).toBeLessThan(rest - 100);
});

test("phone: the back gesture closes the spot, add mode and the discussion, one at a time", async ({ page }) => {
  const rest = await settledTop(page);
  await page.locator(".maplibregl-marker button[aria-label^='Fort De Soto,']").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await expect(page).toHaveURL(/\?spot=/);
  await page.goBack();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Skyway" })).toBeAttached();
  await expect.poll(() => sheetTop(page)).toBe(rest); // and the sheet settles back where it was

  await page.locator('button[aria-label="Add a spot"]').click();
  await expect(page.getByText(/(Tap|Click) the map to drop a pin/).first()).toBeVisible();
  await page.goBack();
  await expect(page.getByText(/(Tap|Click) the map to drop a pin/)).toHaveCount(0);
  await expect(page.locator('button[aria-label="Add a spot"]')).toBeVisible();

  await page.getByRole("button", { name: "Read the full wind discussion" }).click();
  await expect(page.getByRole("dialog", { name: "Wind discussion" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Wind discussion" })).toBeHidden();
  await expect(page).not.toHaveURL(/discussion=|spot=|add=/);
});

test("phone: a selected spot lands in the open map, between the top chrome and the timeline", async ({ page }) => {
  await page.locator(".maplibregl-marker button[aria-label^='Fort De Soto,']").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  const top = await settledTop(page);
  const pill = await box(page.getByTestId("status-pill"));
  const marker = page.locator(".maplibregl-marker", { has: page.locator("button[aria-label^='Fort De Soto,']") });
  await expect.poll(async () => {
    const card = await timelineCard(page).boundingBox();
    const floor = card && card.y < top ? card.y : top; // the floating timeline, or the sheet when it rides inside
    const m = await marker.boundingBox();
    return !!m && m.y >= pill.y + pill.height && m.y + m.height <= floor;
  }, { timeout: 15_000, message: "Fort De Soto's marker sits in the open band" }).toBe(true);
  // and the controls in the rail stay usable over it
  for (const label of RAIL) {
    const card = await timelineCard(page).boundingBox();
    if (card) expect(overlap(card, await box(page.locator(`button[aria-label="${label}"]`))), label).toBe(false);
  }
});

test("phone: Escape closes the top layer here too (the sheet hands it on), and leaves a text field first", async ({ page }) => {
  await page.locator(".maplibregl-marker button[aria-label^='Fort De Soto,']").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeHidden();
  await expect(page).not.toHaveURL(/spot=/);

  await page.locator('button[aria-label="Add a spot"]').click();
  await expect(page).toHaveURL(/\?add=1/);
  await page.mouse.click(120, 330); // drop a pin on the open map
  const name = page.getByPlaceholder("e.g. Davis Islands");
  await name.fill("Half typed");
  await name.focus();
  await page.keyboard.press("Escape"); // leaves the field, keeps the form
  await expect(name).not.toBeFocused();
  await expect(name).toHaveValue("Half typed");
  await page.keyboard.press("Escape"); // then closes the form
  await expect(page).not.toHaveURL(/add=1/);
});

test("phone: at rest, focus that lands below the fold raises the sheet; back at rest it starts from the top", async ({ page }) => {
  const grabber = page.getByRole("button", { name: "Expand spots" });
  await expect(grabber).toHaveAttribute("aria-expanded", "false");
  // what a screen reader's cursor (or find-in-page) does: focus something the resting sheet clips
  const read = page.getByRole("button", { name: "Read the full wind discussion" });
  await read.evaluate((el: HTMLElement) => el.focus());
  await expect(sheet(page)).toHaveAttribute("data-snap", "2");
  await expect(read).toBeInViewport();
  const collapse = page.getByRole("button", { name: "Collapse spots" });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await collapse.click();
  await expect(sheet(page)).toHaveAttribute("data-snap", "0");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeInViewport();
  expect(await sheet(page).locator(".sheet-scroll").evaluate((el) => el.scrollTop)).toBe(0);
});

for (const size of [{ width: 412, height: 839, name: "Pixel 7" }, { width: 375, height: 667, name: "iPhone SE" }]) {
  test(`phone (${size.name}): the resting sheet shows the board's header and the top two spots, the timeline floating above it`, async ({ page }) => {
    await page.setViewportSize(size);
    const top = await settledTop(page);
    expect(size.height - top).toBeGreaterThanOrEqual(316);
    // the timeline floats over the map (clear of the rail), not inside the sheet
    const card = await box(timelineCard(page));
    expect(card.y + card.height).toBeLessThanOrEqual(top);
    for (const label of RAIL) expect(overlap(card, await box(page.locator(`button[aria-label="${label}"]`))), label).toBe(false);
    await expect(page.locator("[data-inline-timeline]")).toHaveCount(0);
    await expect(page.getByRole("img", { name: /^Wind in view over the next week/ })).toBeInViewport();
    // the answer without touching anything: the two best spots' names and verdicts
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeInViewport();
    const cards = sheet(page).locator("button:has(h3)");
    for (const i of [0, 1]) {
      const c = cards.nth(i);
      await expect(c.locator("h3")).toBeInViewport({ ratio: 1 });
      await expect(c.getByText(/^(On now|On at \d{1,2} (AM|PM)|Next: [A-Z][a-z]{2} \d{1,2} (AM|PM)|No session( this week)?)$/).first()).toBeInViewport({ ratio: 1 });
    }
  });
}

test("phone (320×568): too short to float, the timeline rides in the sheet as one compact card: outlook and slider, no chart", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const inline = page.locator("[data-inline-timeline]");
  await expect(inline.getByRole("slider", { name: "Forecast time" })).toBeVisible();
  await expect(inline.getByTestId("outlook")).toBeVisible();
  await expect(page.getByRole("img", { name: /^Wind in view over the next week/ })).toHaveCount(0);
  expect((await box(timelineCard(page))).height).toBeLessThanOrEqual(96);
  // and the board starts right under it, its header on screen at rest
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeInViewport({ ratio: 1 });
});

test("phone: when the wind field fails, the sheet says so to screen readers and the timeline offers a retry", async ({ page }) => {
  let fail = true;
  // The map's field is one request for a grid of points; the spots' own forecasts still load.
  await page.route("https://api.open-meteo.com/v1/forecast?**", (route) => {
    const many = (new URL(route.request().url()).searchParams.get("latitude") ?? "").split(",").length > 8;
    return many && fail ? route.fulfill({ status: 500, body: "" }) : route.fallback();
  });
  await page.reload();
  await expect(sheet(page).getByRole("heading", { name: "SeaSensei", level: 1 })).toBeAttached();
  await expect(sheet(page).getByRole("status")).toHaveText("Wind field unavailable", { timeout: 20_000 });
  const retry = sheet(page).getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible();
  await expect(sheet(page).getByText(/Wind map unavailable/)).toBeVisible();
  fail = false;
  await retry.click();
  await expect(page.getByRole("slider", { name: "Forecast time" })).toBeVisible();
  await expect(sheet(page).getByRole("status")).toHaveText("Now · SeaSensei forecast");
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });
  test("phone: the wind particles stop while the full sheet covers the map, and start again below it", async ({ page }) => {
    await expect(page.locator("canvas[data-wind-particles='animated']")).toHaveCount(1);
    const running = () => page.evaluate(() => (window as any).__wind.running());
    await expect.poll(running).toBe(true);
    await page.getByRole("button", { name: "Expand spots" }).click();
    await page.getByRole("button", { name: "Expand spots" }).click();
    await expect(sheet(page)).toHaveAttribute("data-snap", "2");
    await expect.poll(running).toBe(false);
    await page.getByRole("button", { name: "Collapse spots" }).click();
    await expect.poll(running).toBe(true);
  });
});

for (const size of [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 390, height: 664 }, { width: 412, height: 839 }]) {
  test(`phone (${size.width}×${size.height}): the sheet's snaps rise in order — rest, mid, full — and a spot opens at mid, above rest`, async ({ page }) => {
    await page.setViewportSize(size);
    const rest = await settledTop(page);
    await page.getByRole("button", { name: "Expand spots" }).click();
    await expect(sheet(page)).toHaveAttribute("data-snap", "1");
    const mid = await settledTop(page);
    expect(mid, "mid stands well above rest").toBeLessThan(rest - 60);
    await expect(page.getByRole("button", { name: "Expand spots" })).toBeVisible(); // once more, to full
    await page.getByRole("button", { name: "Expand spots" }).click();
    await expect(sheet(page)).toHaveAttribute("data-snap", "2");
    const full = await settledTop(page);
    expect(full, "full stands above mid").toBeLessThan(mid - 60);
    await page.getByRole("button", { name: "Collapse spots" }).click();
    await expect.poll(() => sheetTop(page)).toBe(rest);
    // a spot opens at the same mid
    await sheet(page).locator("button:has(h3)").first().click();
    await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
    expect(await settledTop(page)).toBe(mid);
  });
}

test("phone: Escape in a focused chart clears its cursor and leaves the spot open; the next Escape closes the spot", async ({ page }) => {
  await page.locator(".maplibregl-marker button[aria-label^='Fort De Soto,']").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  const chart = page.locator("svg[aria-roledescription=chart]").first();
  await chart.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\?spot=seed-fort-de-soto/);
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/spot=/);
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeHidden();
});

test("phone: a location that arrives after Add was cancelled is dropped (no pin, no raised sheet, no fly-away)", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (ok) => {
      setTimeout(() => ok({ coords: { latitude: 27.95, longitude: -82.46, accuracy: 10 }, timestamp: Date.now() } as GeolocationPosition), 1500);
    };
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  const rest = await settledTop(page);
  const marker = page.locator(".maplibregl-marker", { has: page.locator("button[aria-label^='Fort De Soto,']") });
  const before = (await marker.boundingBox())!;
  await page.locator('button[aria-label="Add a spot"]').click();
  await sheet(page).getByRole("button", { name: "Use my location" }).click();
  await sheet(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).not.toHaveURL(/add=1/);
  await page.waitForTimeout(2500); // the position comes in now
  await expect(sheet(page)).toHaveAttribute("data-snap", "0");
  expect(await settledTop(page)).toBe(rest);
  await expect(page.locator("[data-pin]")).toHaveCount(0);
  const after = (await marker.boundingBox())!;
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeLessThan(2);
});
