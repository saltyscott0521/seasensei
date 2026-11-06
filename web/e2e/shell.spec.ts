import { expect, test, type Page } from "@playwright/test";
import { mockApis } from "./mocks";

// The desktop shell: the docked panel, history-backed views (back / forward / deep links), the cross-hair
// confined to the open map, and the timeline dock.

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
});

const panel = (page: Page) => page.locator("aside");
const card = (page: Page, name: string) => panel(page).getByRole("button", { name: new RegExp(name) }).first();
const box = async (l: import("@playwright/test").Locator) => (await l.boundingBox())!;

test("the panel docks full height on the left with the brand and status on top", async ({ page }) => {
  const vp = page.viewportSize()!;
  const aside = await box(panel(page));
  expect(aside.x).toBe(16);
  expect(aside.y).toBe(16);
  expect(aside.width).toBe(420);
  expect(Math.round(aside.y + aside.height)).toBe(vp.height - 16);
  await expect(panel(page).getByRole("heading", { name: "SeaSensei" })).toBeVisible();
  await expect(panel(page).getByText("Now · HRRR forecast")).toBeVisible();
  // Add and Stations are a small group at the map's top right
  const add = await box(page.getByRole("button", { name: "Add a spot" }));
  expect(add.y).toBeLessThan(40);
  expect(add.x).toBeGreaterThan(aside.x + aside.width);
  // the keyboard starts in the panel, not on the map's markers
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("aside"))).toBe(true);
});

test("views: scroll resets, focus moves to the new heading, and the browser's back and forward follow", async ({ page }) => {
  const scroller = panel(page).locator("[data-panel-scroll]");
  await scroller.evaluate((el) => el.scrollTo(0, 99999));
  await card(page, "Picnic Island").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await expect(page).toHaveURL(/\?spot=/);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
  // keyboard and screen-reader users land on the spot's name
  await expect(page.locator(":focus")).toHaveText(/Picnic Island/);
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("H2");

  await page.goBack();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Skyway" })).toBeVisible();
  await expect(page).not.toHaveURL(/spot=/);
  // focus stays in the panel (back on the list), not dropped to the page
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("aside"))).toBe(true);

  await page.goForward();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Picnic Island" })).toBeVisible();
  // the in-app back button goes back through the same history entry
  await page.getByRole("button", { name: "Back to spots" }).click();
  await expect(page.getByRole("heading", { name: "Skyway" })).toBeVisible();
  await expect(page).not.toHaveURL(/spot=/);
});

test("back closes one layer at a time: the discussion, then add mode; Escape closes a spot", async ({ page }) => {
  await page.getByRole("region", { name: "Wind discussion" }).getByRole("button", { name: /Read the full discussion/ }).click();
  const dialog = page.getByRole("dialog", { name: "Wind discussion" });
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/discussion=/);
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();

  await page.getByRole("button", { name: "Add a spot" }).click();
  await expect(page.getByText(/(Tap|Click) the map to drop a pin/).first()).toBeVisible();
  await expect(page).toHaveURL(/\?add=1/);
  await page.locator(".maplibregl-canvas").click({ position: { x: 700, y: 420 } });
  await expect(page.locator(".maplibregl-marker")).toHaveCount(3 + 4 + 1); // spots, live stations, the new pin
  await page.goBack();
  await expect(page.getByRole("button", { name: "Add a spot" })).toBeVisible();
  await expect(page.getByText(/(Tap|Click) the map to drop a pin/)).toHaveCount(0);
  await expect(page.locator(".maplibregl-marker")).toHaveCount(3 + 4); // the abandoned pin goes with the form

  await card(page, "Skyway").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeHidden();
  await expect(page).not.toHaveURL(/spot=/);
});

test("deep links: ?spot= opens that spot, a stale one falls back to the list, ?add=1 starts adding", async ({ page }) => {
  // a saved spot (ids are stored with the spots)
  await page.evaluate(() => localStorage.setItem("spots", JSON.stringify([
    { id: "davis-islands", name: "Davis Islands", lat: 27.915, lon: -82.452, min: 15, max: 30 },
    { id: "skyway", name: "Skyway", lat: 27.6, lon: -82.66, min: 15, max: 30 },
  ])));
  await page.goto("/?spot=davis-islands");
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Davis Islands" })).toBeVisible();
  // opened straight on the spot: back to the list rewrites the URL instead of leaving the app
  await page.getByRole("button", { name: "Back to spots" }).click();
  await expect(page.getByRole("heading", { name: "Skyway" })).toBeVisible();
  await expect(page).not.toHaveURL(/spot=/);
  // and a reload keeps whichever spot is open
  await card(page, "Skyway").click();
  await expect(page).toHaveURL(/\?spot=skyway/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Skyway" })).toBeVisible();

  await page.goto("/?spot=not-a-spot");
  await expect(page.getByRole("heading", { name: "Davis Islands" })).toBeVisible();
  await expect(page).not.toHaveURL(/spot=/);

  await page.goto("/?add=1");
  await expect(page.getByRole("button", { name: "Cancel adding a spot" })).toBeVisible();
  await expect(page.getByText(/(Tap|Click) the map to drop a pin/).first()).toBeVisible();
});

test("the cross-hair stays on the open map, and a selected spot lands on it", async ({ page }) => {
  await expect(page.getByRole("slider", { name: "Forecast time" })).toBeVisible();
  const aside = await box(panel(page));
  const dock = await box(page.getByTestId("outlook").locator("xpath=ancestor::div[contains(@class,'glass')][1]"));
  const target = page.getByTestId("view-target");
  const cross = async () => target.evaluate((el) => ({
    x: parseFloat(getComputedStyle(el).getPropertyValue("--cx")),
    y: parseFloat(getComputedStyle(el).getPropertyValue("--cy")),
    // every painted piece of it
    parts: [...el.querySelectorAll("div")].map((d) => d.getBoundingClientRect().toJSON() as DOMRect),
  }));
  const c = await cross();
  expect(c.x).toBeGreaterThan(aside.x + aside.width);
  expect(c.y).toBeLessThan(dock.y);
  for (const p of c.parts) {
    expect(p.left, "never paints over the panel").toBeGreaterThanOrEqual(aside.x + aside.width);
    expect(p.top + p.height, "never paints over the timeline").toBeLessThanOrEqual(dock.y);
  }
  // the timeline dock: centred on the open map, clear of the panel and of the zoom / locate column
  const zoom = await box(page.locator('button[aria-label="Zoom in"]'));
  expect(dock.x).toBeGreaterThanOrEqual(aside.x + aside.width + 16);
  expect(dock.x + dock.width).toBeLessThanOrEqual(zoom.x - 8);
  expect(Math.round(dock.y + dock.height)).toBe(page.viewportSize()!.height - 16);

  await card(page, "Picnic Island").click();
  const marker = page.locator(".maplibregl-marker", { has: page.locator("button[aria-label^='Picnic Island']") });
  await expect.poll(async () => {
    const m = await marker.boundingBox();
    const { x, y } = await cross();
    return !!m && x >= m.x - 12 && x <= m.x + m.width + 12 && y >= m.y - 12 && y <= m.y + m.height + 12;
  }, { timeout: 15_000, message: "the selected spot sits on the cross-hair" }).toBe(true);
});

test("the timeline keeps its chosen hour as the clock moves on, names it on top, and Back to now hands focus to the slider", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await expect(slider).toBeVisible();
  await slider.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  const when = page.getByTestId("timeline-when");
  await expect(when).toHaveText(/^\w{3} \d{1,2} (AM|PM)$/);
  const chosen = (await when.textContent())!;
  // scrubbed, the top line describes that hour instead of the outlook from now
  await expect(page.getByTestId("outlook")).toHaveText(new RegExp(`^${chosen}\\s*· up to \\d+ kn [NESW]+ in view$`));
  await expect(page.getByText(`Forecast · ${chosen}`)).toBeVisible();

  // An hour (and a minute) later the list of hours starts later, but the chosen hour stays the chosen hour.
  await page.clock.fastForward("01:01:00");
  await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow"))).toBeLessThan(6);
  await expect(when).toHaveText(chosen);
  await expect(page.getByText(`Forecast · ${chosen}`)).toBeVisible();

  // Back to now goes away as you press it: focus lands on the slider, not on the page
  await page.getByRole("button", { name: "Back to now" }).focus();
  await page.keyboard.press("Enter");
  await expect(when).toHaveText("Now");
  await expect(slider).toBeFocused();
  await expect(page.getByTestId("outlook")).toHaveText(/^(Windy now|Wind on the way|No \d+\+ kn in view)/);
});

test("the map's locate and zoom buttons are one joined group", async ({ page }) => {
  const locate = await box(page.locator('button[aria-label="Find my location"]'));
  const zoomIn = await box(page.locator('button[aria-label="Zoom in"]'));
  const zoomOut = await box(page.locator('button[aria-label="Zoom out"]'));
  expect(Math.abs(locate.x - zoomIn.x)).toBeLessThanOrEqual(1);
  // one hairline between them, no gap of map
  expect(Math.abs(zoomIn.y - (locate.y + locate.height))).toBeLessThanOrEqual(1.5);
  expect(Math.abs(zoomOut.y - (zoomIn.y + zoomIn.height))).toBeLessThanOrEqual(1.5);
  // rounded outside, square where they meet
  const radii = await page.locator(".maplibregl-ctrl-bottom-right .maplibregl-ctrl-group").evaluateAll((gs) => gs.map((g) => {
    const s = getComputedStyle(g);
    return { top: s.borderTopLeftRadius, bottom: s.borderBottomLeftRadius, locate: !!g.querySelector(".maplibregl-ctrl-geolocate") };
  }));
  for (const r of radii) {
    if (r.locate) { expect(r.top).not.toBe("0px"); expect(r.bottom).toBe("0px"); }
    else { expect(r.top).toBe("0px"); expect(r.bottom).not.toBe("0px"); }
  }
});

test("adding without a pointer: a reticle marks the map's centre, and Use map centre drops the pin there", async ({ page }) => {
  await page.getByRole("button", { name: "Add a spot" }).click();
  // one instruction, in the panel (no second copy floating on the map)
  await expect(page.getByText(/(Tap|Click) the map to drop a pin/)).toHaveCount(1);
  const target = page.getByTestId("view-target");
  await expect(target).toHaveAttribute("data-drop", "true");
  const c = await target.evaluate((el) => ({ x: parseFloat(getComputedStyle(el).getPropertyValue("--cx")), y: parseFloat(getComputedStyle(el).getPropertyValue("--cy")) }));
  await page.getByRole("button", { name: "Use map centre" }).click();
  const pin = page.locator("[data-pin]");
  await expect(pin).toBeVisible();
  await expect(page.getByTestId("pin-coords")).toHaveText(/\d+\.\d{4}° N, \d+\.\d{4}° W/);
  await expect.poll(async () => {
    const b = (await pin.boundingBox())!;
    return Math.hypot(b.x + b.width / 2 - c.x, b.y + b.height - c.y);
  }, { message: "the pin's tip is on the reticle" }).toBeLessThan(4);
  await expect(target).toHaveCount(0); // the pin marks the spot now
});

test("a view whose code a deploy has replaced reloads once onto the new build, then says so and offers a reload, instead of blanking the app", async ({ page }) => {
  // After a deploy the old build's hashed chunks are gone (404): stand in for that with the add form's module.
  await page.route("**/src/components/AddSpot.tsx*", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  let loads = 0;
  page.on("load", () => loads++);
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  await page.getByRole("button", { name: "Add a spot" }).click();
  const notice = panel(page).getByRole("alert");
  await expect(notice).toContainText("SeaSensei was updated");
  // it tried one reload (back on ?add=1) before saying so
  expect(loads).toBe(1);
  await expect(page).toHaveURL(/\?add=1/);
  await expect(notice.getByRole("button", { name: "Reload" })).toBeVisible();
  // the rest of the app is still there and still works
  await expect(panel(page).getByRole("heading", { name: "SeaSensei" })).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
});

test("a prefetch that fails stays quiet; opening its view later reloads once and opens it", async ({ page }) => {
  let asked = 0;
  // The first request for the discussion's module (the idle prefetch) fails, as on a flaky connection.
  await page.route("**/src/components/Discussion.tsx*", (route) => (asked++ ? route.fallback() : route.abort()));
  await page.goto("/");
  let loads = 0;
  page.on("load", () => loads++);
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  await expect.poll(() => asked).toBeGreaterThanOrEqual(1);
  // Vite announces a failed preload (prefetches included) as vite:preloadError: that alone reloads nothing
  await page.evaluate(() => window.dispatchEvent(new Event("vite:preloadError", { cancelable: true })));
  await page.waitForTimeout(1500);
  expect(loads).toBe(0);
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  // the browser keeps the failed import, so opening the discussion reloads once (onto ?discussion=) and it opens
  await page.getByRole("region", { name: "Wind discussion" }).getByRole("button", { name: /Read the full discussion/ }).click();
  await expect(page.getByRole("dialog", { name: "Wind discussion" })).toBeVisible();
  expect(loads).toBeLessThanOrEqual(1); // (one reload where the browser kept the failure, none where it asked again)
  await expect(page).toHaveURL(/\?discussion=/);
});

test("the discussion's error card closes with the discussion, and the app stays usable", async ({ page }) => {
  await page.route("**/src/components/Discussion.tsx*", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  const read = page.getByRole("region", { name: "Wind discussion" }).getByRole("button", { name: /Read the full discussion/ });
  await read.click();
  // (one reload first; the module is still missing after it)
  const notice = page.getByRole("alert").filter({ hasText: "SeaSensei was updated" });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("button", { name: "Reload" })).toBeVisible();
  await notice.getByRole("button", { name: "Close" }).click();
  await expect(notice).toBeHidden();
  await expect(page).not.toHaveURL(/discussion=/);
  await card(page, "Skyway").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  // and Escape (or Back) closes it too
  await page.getByRole("button", { name: "Back to spots" }).click();
  await read.click();
  await expect(notice).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(notice).toBeHidden();
  await expect(page).not.toHaveURL(/discussion=/);
});

test("a spot's settings don't stay behind in history: opening another spot or adding from them, Back still returns to the list", async ({ page }) => {
  const marker = (name: string) => page.locator(`.maplibregl-marker button[aria-label^='${name},']`);
  await card(page, "Fort De Soto").click();
  await page.getByRole("button", { name: "Spot settings" }).click();
  await expect(page.getByRole("button", { name: "Suggest from coastline" })).toBeVisible();
  // another spot, from its marker, with the settings open
  await expect(marker("Skyway")).toBeVisible();
  await marker("Skyway").click();
  await expect(page).toHaveURL(/\?spot=seed-skyway$/);
  await expect(panel(page).getByRole("heading", { name: "Skyway", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Back to spots" }).click();
  await expect(page).not.toHaveURL(/spot=/);
  await expect(panel(page).getByRole("heading", { name: "Today", exact: true })).toBeVisible();

  // adding, with the settings open: Back lands on the list, not on the spot
  await card(page, "Picnic Island").click();
  await page.getByRole("button", { name: "Spot settings" }).click();
  await expect(page.getByRole("button", { name: "Suggest from coastline" })).toBeVisible();
  await page.getByRole("button", { name: "Add a spot" }).click();
  await expect(page).toHaveURL(/\?add=1/);
  await page.goBack();
  await expect(page).not.toHaveURL(/add=|spot=/);
  await expect(panel(page).getByRole("heading", { name: "Today", exact: true })).toBeVisible();
});

test("the timeline's threshold tag sits on a solid chip, clear of the day names and ticks", async ({ page }) => {
  const chart = page.getByRole("img", { name: /^Wind in view over the next week/ });
  await expect(chart).toBeVisible();
  const clear = await chart.evaluate((svg) => {
    const tag = svg.querySelector("[data-threshold-tag]")!;
    const t = tag.getBoundingClientRect();
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const days = [...svg.querySelectorAll("text")].filter((x) => !tag.contains(x) && /^[A-Z][a-z]{2}$/.test(x.textContent ?? ""));
    const ticks = [...svg.querySelectorAll("line")].filter((l) => l.getAttribute("x1") === l.getAttribute("x2") && l.classList.contains("stroke-line-strong"));
    return { solid: !!tag.querySelector("rect"), days: days.length, clearOfDays: days.every((d) => !hit(d.getBoundingClientRect(), t)),
      clearOfTicks: ticks.every((l) => { const x = l.getBoundingClientRect().left; return x < t.left - 1 || x > t.right + 1; }) };
  });
  expect(clear).toEqual({ solid: true, days: expect.any(Number), clearOfDays: true, clearOfTicks: true });
  expect(clear.days).toBeGreaterThan(3);
});
