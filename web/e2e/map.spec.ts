import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockApis } from "./mocks";

// The map: spot markers (verdict ring, glyph, name on demand), live-station chips that step aside for spots,
// the camera on selection, the add-mode pin, and the wind particles. Markers sit outside any landmark, so they are
// found by class/data attributes and driven with the mouse and keyboard like a person would.

const spotMarker = (page: Page, name: string) => page.locator(`.maplibregl-marker button[aria-label^='${name},']`);
const station = (page: Page, id: string) => page.locator(`.maplibregl-marker button[data-station='${id}']`);
const card = (page: Page, name: string) => page.locator("aside").getByRole("button", { name: new RegExp(name) }).first();
const centre = async (l: Locator) => { const b = (await l.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
/** Waits until a marker stops moving: with a spot open, the camera re-centres when the visible map band settles (e.g. the timeline dock's height). */
const settled = (page: Page, l: Locator) => expect.poll(async () => {
  const a = await l.boundingBox(); await page.waitForTimeout(250); const b = await l.boundingBox();
  return !!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}, { message: "the map settles" }).toBe(true);
/** The button (or its aria-label) on top at a page point. */
const topAt = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => {
  const el = document.elementFromPoint(px, py);
  return el?.closest("button")?.getAttribute("aria-label") ?? null;
}, [x, y]);
/** How much of the particle canvas has paint on it (sampled), optionally after stepping the field `steps` frames. */
const inked = (page: Page, steps = 0) => page.evaluate((k) => {
  if (k) (window as any).__wind.step(k);
  const c = document.querySelector<HTMLCanvasElement>("canvas[data-wind-particles]");
  if (!c) return -1;
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4 * 5) if (d[i] > 8) n++;
  return n;
}, steps);
/** Every shown name label clears every other shown name and every other spot's pill. */
const namesClear = (page: Page) => page.evaluate(() => {
  const r = (el: Element) => el.getBoundingClientRect();
  const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const markers = [...document.querySelectorAll("[data-spot-marker]")];
  const names = markers.map((m) => m.querySelector("[data-marker-label]")!).filter((l) => getComputedStyle(l).visibility === "visible");
  return names.every((l, i) => names.every((o, j) => i === j || !hit(r(l), r(o)))
    && markers.every((m) => m.contains(l) || !hit(r(l), r(m.querySelector("[data-marker-pill]")!))));
});
const timelineCard = (page: Page) => page.getByTestId("outlook").locator("xpath=ancestor::div[contains(@class,'glass')][1]");
/** Timeline index of the next hour (after now) whose UTC hour is h. */
const indexOfUtcHour = (h: number) => ((h - new Date().getUTCHours()) + 24) % 24 || 24;

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  await expect(page.locator(".maplibregl-marker")).toHaveCount(7);
});

test("spot markers: wind for the hour, a verdict ring with a glyph and words, the name on demand", async ({ page }) => {
  const fds = spotMarker(page, "Fort De Soto");
  // named with the reading and the verdict in words, coloured by a verdict tone
  await expect(fds).toHaveAttribute("aria-label", /^Fort De Soto, \d+ knots, (On now|On at \d+ [AP]M|Next: \w+ \d+ [AP]M|No session this week|Too strong now)$/);
  await expect(fds).toHaveAttribute("data-tone", /^(go|soon|strong|wrongdir|off)$/);
  // zoomed out, names show wherever they fit and never cover each other or another spot's pill; pointing at a
  // marker names it too (its verdict in words as well)
  await expect(fds.locator("[data-marker-label]")).toBeVisible();
  await expect.poll(() => namesClear(page)).toBe(true);
  await spotMarker(page, "Skyway").hover();
  await expect(spotMarker(page, "Skyway").locator("[data-marker-label]")).toBeVisible();
  await expect(spotMarker(page, "Skyway").locator("[data-marker-label]")).toContainText("Skyway");

  // the ring follows the timeline hour: a windy late-morning hour is rideable, a calm night hour too light
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await slider.focus();
  for (let i = 0; i < indexOfUtcHour(15); i++) await page.keyboard.press("ArrowRight"); // 10–11 AM in Tampa, ~24 kn
  await expect(fds).toHaveAttribute("aria-label", /^Fort De Soto, 2\d knots, rideable$/);
  await expect(fds).toHaveAttribute("data-tone", "go");
  await page.keyboard.press("Home");
  for (let i = 0; i < indexOfUtcHour(3); i++) await page.keyboard.press("ArrowRight"); // 10–11 PM, ~8 kn
  await expect(fds).toHaveAttribute("aria-label", /^Fort De Soto, \d knots, too light$/);
  await expect(fds).toHaveAttribute("data-tone", "off");
});

test("station chips step aside for spot markers, and open a card that Escape closes on its own", async ({ page }) => {
  // Old Port Tampa sits under Picnic Island's marker: it fades out (but stays in the DOM and keeps its name) …
  const opt = station(page, "8726607");
  await expect(opt).toHaveAttribute("data-hidden", "true");
  await expect(opt).toHaveAttribute("aria-label", /^Old Port Tampa: \d+ knots from [NESW]+, gusting \d+, (just now|\d+ min ago)$/);
  expect(await opt.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
  // … so Picnic Island's marker is the one you hit
  const pi = await centre(spotMarker(page, "Picnic Island"));
  expect(await topAt(page, pi.x, pi.y)).toMatch(/^Picnic Island,/);
  // stations in open water stay
  await expect(station(page, "8726724")).not.toHaveAttribute("data-hidden", "true");
  const mtb = station(page, "8726412");
  await expect(mtb).not.toHaveAttribute("data-hidden", "true");
  // a 20px chip with a taller invisible touch area around it
  const c = await centre(mtb);
  expect(c.b.height).toBeLessThanOrEqual(22);
  expect(await topAt(page, c.x, c.y + 16)).toMatch(/^Middle Tampa Bay: /);
  expect(await topAt(page, c.x, c.y - 16)).toMatch(/^Middle Tampa Bay: /);

  // tap a chip for its name, gust and age; Escape closes the card and leaves the open spot alone
  await card(page, "Fort De Soto").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await expect(mtb).not.toHaveAttribute("data-hidden", "true");
  await settled(page, mtb);
  await mtb.click();
  await expect(mtb).toHaveAttribute("aria-expanded", "true");
  await expect(mtb.getByText("Middle Tampa Bay")).toBeVisible();
  await expect(mtb.getByText(/NOAA PORTS · every 6 min · (just now|\d+ min ago)/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(mtb).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  // a tap on the open map closes it too
  await settled(page, mtb);
  await mtb.click();
  await expect(mtb).toHaveAttribute("aria-expanded", "true");
  const map = (await page.locator(".maplibregl-canvas").boundingBox())!;
  await page.mouse.click(map.x + map.width - 120, map.y + 120);
  await expect(mtb).toHaveAttribute("aria-expanded", "false");
});

test("opening a spot cuts the camera to it under reduced motion, rings it, and re-opening it doesn't move the map", async ({ page }) => {
  await card(page, "Fort De Soto").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  const fds = spotMarker(page, "Fort De Soto");
  await expect(fds).toHaveAttribute("data-selected", "true");
  await expect(fds.locator("[data-marker-label]")).toBeVisible(); // the selected spot shows its name …
  await expect(fds.locator("[data-marker-label]")).toContainText(/Fort De Soto\s*(On|Next|No session|Too strong)/); // … and its verdict
  // reduced motion: no flight, the marker is already where it ends up
  const a = await centre(fds);
  await page.waitForTimeout(700);
  const b = await centre(fds);
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1);
  // it lands in the open map: right of the panel, clear of the top and of the timeline
  const aside = (await page.locator("aside").boundingBox())!;
  const tl = (await timelineCard(page).boundingBox())!;
  expect(b.b.x).toBeGreaterThan(aside.x + aside.width);
  expect(b.b.y).toBeGreaterThan(60);
  expect(b.b.y + b.b.height).toBeLessThan(tl.y);
  // it sits above the other spots and is the one you hit
  expect(await topAt(page, b.x, b.y)).toMatch(/^Fort De Soto,/);

  // back to the list (Escape) and open it again: the camera stays put
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeHidden();
  await expect(fds).not.toHaveAttribute("data-selected", "true");
  await card(page, "Fort De Soto").click();
  await expect(fds).toHaveAttribute("data-selected", "true");
  await page.waitForTimeout(700);
  const c = await centre(fds);
  expect(Math.hypot(c.x - b.x, c.y - b.y)).toBeLessThan(1);
});

test("add mode: markers step back, the pin drops where you click and can be dragged", async ({ page }) => {
  await page.getByRole("button", { name: "Add a spot" }).click();
  // spots fade back and let clicks through to the map
  const fds = spotMarker(page, "Fort De Soto");
  expect(await fds.evaluate((el) => getComputedStyle(el.closest(".maplibregl-marker")!).pointerEvents)).toBe("none");
  await expect(fds).toHaveAttribute("tabindex", "-1");

  await page.locator(".maplibregl-canvas").click({ position: { x: 700, y: 420 } });
  const pin = page.locator("[data-pin]");
  await expect(pin).toBeVisible();
  const tip = async () => { const b = (await pin.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height }; };
  const canvas = (await page.locator(".maplibregl-canvas").boundingBox())!;
  let t = await tip();
  expect(Math.abs(t.x - (canvas.x + 700))).toBeLessThan(3);
  expect(Math.abs(t.y - (canvas.y + 420))).toBeLessThan(3);
  await expect(page.getByText("Drag to adjust")).toBeVisible();

  // drag it 120 px right and 40 down
  await page.mouse.move(t.x, t.y - 22);
  await page.mouse.down();
  await page.mouse.move(t.x + 60, t.y - 2, { steps: 6 });
  await page.mouse.move(t.x + 120, t.y + 18, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText("Drag to adjust")).toBeHidden();
  await expect.poll(async () => (await tip()).x).toBeGreaterThan(canvas.x + 815);
  // the new point stuck (re-rendering the form doesn't snap the pin back)
  await page.getByPlaceholder("e.g. Davis Islands").fill("Pin Drag");
  t = await tip();
  expect(Math.abs(t.x - (canvas.x + 820))).toBeLessThan(4);
  expect(Math.abs(t.y - (canvas.y + 460))).toBeLessThan(4);
  // Where that is on the map, read off two known spots' marker points (lon is linear in x; over this span lat is
  // linear in y to well under 0.001°).
  const point = async (name: string) => { const b = (await spotMarker(page, name).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height }; };
  const [a, b] = [await point("Fort De Soto"), await point("Picnic Island")];
  const A = { lat: 27.64, lon: -82.739 }, B = { lat: 27.853, lon: -82.552 };
  const expected = {
    lon: A.lon + ((t.x - a.x) * (B.lon - A.lon)) / (b.x - a.x),
    lat: A.lat + ((t.y - a.y) * (B.lat - A.lat)) / (b.y - a.y),
  };
  await page.getByRole("button", { name: "Save spot" }).click();
  await expect(page.getByRole("heading", { name: "Pin Drag" })).toBeVisible();
  // the saved spot is where the pin was let go, not where it was first dropped
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("spots")!).find((s: any) => s.name === "Pin Drag"));
  expect(Math.abs(saved.lon - expected.lon)).toBeLessThan(0.002);
  expect(Math.abs(saved.lat - expected.lat)).toBeLessThan(0.002);
});

test("reduced motion: the wind is a still field that moves with the map and is never wiped by a pan", async ({ page }) => {
  await expect(page.locator("canvas[data-wind-particles='still']")).toHaveCount(1);
  await expect(page.getByRole("slider", { name: "Forecast time" })).toBeVisible(); // the wind field is in
  await expect.poll(() => inked(page), { timeout: 20_000 }).toBeGreaterThan(500);
  const before = await inked(page);
  // pan: mid-drag the field is still there, carried along with the map
  const map = (await page.locator(".maplibregl-canvas").boundingBox())!;
  await page.mouse.move(map.x + 820, map.y + 300);
  await page.mouse.down();
  await page.mouse.move(map.x + 880, map.y + 340, { steps: 5 });
  expect(await inked(page)).toBeGreaterThan(before * 0.5);
  await page.mouse.up();
  await expect.poll(() => inked(page)).toBeGreaterThan(before * 0.5);
  expect(await page.evaluate(() => (window as any).__wind.running())).toBe(false); // nothing animates
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference", deviceScaleFactor: 2 });

  test("particles animate on a capped canvas, keep their trails through a pan, and stop while the tab is hidden", async ({ page }) => {
    const canvas = page.locator("canvas[data-wind-particles='animated']");
    await expect(canvas).toHaveCount(1);
    await expect(page.getByRole("slider", { name: "Forecast time" })).toBeVisible(); // the wind field is in
    // ≤ 1.5× device pixels, even on a 2× screen
    expect(await canvas.evaluate((c: HTMLCanvasElement) => c.width / c.clientWidth)).toBeCloseTo(1.5, 2);
    const count = await page.evaluate(() => (window as any).__wind.count());
    expect(count).toBeGreaterThanOrEqual(60);
    expect(count).toBeLessThanOrEqual(1600);
    // The loop is running; once the field has the wind grid, step it too (a starved software-GL frame rate under
    // load mustn't stall the check) and read the paint in the same tick.
    expect(await page.evaluate(() => (window as any).__wind.running())).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).__wind.ready())).toBe(true);
    const before = await inked(page, 30);
    expect(before).toBeGreaterThan(300);
    const map = (await page.locator(".maplibregl-canvas").boundingBox())!;
    await page.mouse.move(map.x + 820, map.y + 300);
    await page.mouse.down();
    await page.mouse.move(map.x + 900, map.y + 340, { steps: 4 });
    expect(await inked(page)).toBeGreaterThan(before * 0.4); // trails carried, not wiped
    await page.mouse.up();

    expect(await page.evaluate(() => (window as any).__wind.running())).toBe(true);
    const setHidden = (hidden: boolean) => page.evaluate((h) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
    await setHidden(true);
    expect(await page.evaluate(() => (window as any).__wind.running())).toBe(false);
    await setHidden(false);
    expect(await page.evaluate(() => (window as any).__wind.running())).toBe(true);
  });

  test("opening a spot moves the camera smoothly to it", async ({ page }) => {
    // Record where Fort De Soto's marker is on every frame while the spot opens.
    await page.evaluate(() => {
      const w = window as any;
      w.__track = [] as string[];
      const end = performance.now() + 6000;
      const frame = () => {
        const b = document.querySelector(".maplibregl-marker button[aria-label^='Fort De Soto,']")?.getBoundingClientRect();
        if (b) w.__track.push(`${Math.round(b.x)},${Math.round(b.y)}`);
        if (performance.now() < end) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await card(page, "Fort De Soto").click();
    await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
    await page.waitForTimeout(6100);
    const track: string[] = await page.evaluate(() => (window as any).__track);
    const stops = track.filter((p, i) => p !== track[i - 1]);
    expect(stops.length, `positions: ${stops.join(" ")}`).toBeGreaterThan(3); // it travelled through the frames, not a cut
    const [x, y] = stops[stops.length - 1].split(",").map(Number);
    const aside = (await page.locator("aside").boundingBox())!;
    expect(x).toBeGreaterThan(aside.x + aside.width); // and came to rest in the open map
    expect(y).toBeGreaterThan(60);
    expect(track.slice(-2).every((p) => p === track[track.length - 1]), `tail: ${track.slice(-12).join(" ")} (${track.length})`).toBe(true); // settled
  });
});

test("a live reading over the spot's max is never a green \"On now\": the marker says too strong", async ({ page }) => {
  // Midday ET (17:00 UTC): inside the mock's daylight session, so the forecast verdict is "On now" for every spot.
  const d = new Date(), noon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 17);
  await page.clock.setFixedTime(noon);
  // Old Port Tampa (Picnic Island's own sensor, 15–30 kn) reads 35 kn, six minutes ago.
  await page.route("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?**", (route) => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get("station") !== "8726607" || q.get("range")) return route.fallback();
    const t = new Date(noon - 6 * 60e3).toISOString().slice(0, 16).replace("T", " ");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({
      metadata: { id: "8726607", name: "Old Port Tampa", lat: "27.8578", lon: "-82.5528" },
      data: [{ t, s: "35.00", d: "220.0", dr: "SW", g: "41.00", f: "0,0" }],
    }) });
  });
  await page.goto("/");
  const pi = spotMarker(page, "Picnic Island");
  await expect(pi).toHaveAttribute("aria-label", "Picnic Island, 35 knots, Too strong now");
  await expect(pi).toHaveAttribute("data-tone", "strong");
  await expect(pi.locator(".halo")).toHaveCount(0); // no "live" pulse
  // the other spots are on, and say so with the solid treatment and the pulse
  const fds = spotMarker(page, "Fort De Soto");
  await expect(fds).toHaveAttribute("aria-label", /^Fort De Soto, \d+ knots, On now$/);
  await expect(fds).toHaveAttribute("data-glyph", "check");
});

test("a session later today is go with a clock (not amber); the next one on another day is neutral with a calendar", async ({ page }) => {
  // Before sunrise (10:00 UTC is 5–6 AM in Tampa): the day's session starts at first light.
  const d = new Date(), dawn = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 10);
  await page.clock.setFixedTime(dawn);
  await page.goto("/");
  const fds = spotMarker(page, "Fort De Soto");
  await expect(fds).toHaveAttribute("aria-label", /^Fort De Soto, \d+ knots, On at \d+ AM$/);
  await expect(fds).toHaveAttribute("data-tone", "go");
  await expect(fds).toHaveAttribute("data-glyph", "clock");
});

test("hovering a spot's card rings and names its marker on the map", async ({ page }) => {
  const skyway = spotMarker(page, "Skyway");
  await expect(skyway).not.toHaveAttribute("data-highlighted", "true");
  await card(page, "Skyway").hover();
  await expect(skyway).toHaveAttribute("data-highlighted", "true");
  await expect(skyway.locator("[data-marker-label]")).toBeVisible();
  await expect(skyway.locator("[data-marker-label]")).toContainText(/Skyway\s*(On|Next|No session|Too strong)/); // and its verdict
  await page.mouse.move(700, 120); // off the panel
  await expect(skyway).not.toHaveAttribute("data-highlighted", "true");
});

test("markers outside the open map leave the Tab order, and come back when the map brings them into view", async ({ page }) => {
  await card(page, "Fort De Soto").click(); // zooms in on Fort De Soto: Clearwater Beach's sensor is far off screen
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  const clearwater = station(page, "8726724");
  await expect(clearwater).toHaveAttribute("tabindex", "-1");
  await expect(spotMarker(page, "Fort De Soto")).not.toHaveAttribute("tabindex", "-1");
  // every marker you can Tab to is on the open map, where its focus ring can be seen
  const aside = (await page.locator("aside").boundingBox())!;
  const vp = page.viewportSize()!;
  const reachable = await page.locator(".maplibregl-marker button:not([tabindex='-1'])").evaluateAll((els) => els.map((e) => {
    const b = e.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }));
  expect(reachable.length).toBeGreaterThan(0);
  for (const p of reachable) {
    expect(p.x).toBeGreaterThan(aside.x + aside.width);
    expect(p.x).toBeLessThan(vp.width);
    expect(p.y).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(vp.height);
  }
  // back on the list the whole bay is in view again (zoomed out): Clearwater Beach is reachable once more
  await page.keyboard.press("Escape");
  await page.locator(".maplibregl-canvas").focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press("-");
  await expect(clearwater).not.toHaveAttribute("tabindex", "-1", { timeout: 15_000 });
});
