import { expect, test, type Page } from "@playwright/test";
import { mockApis } from "./mocks";

// The spot forms: the add flow (pin, name, coastline read on drop, station default, Save) and the controls it shares
// with spot settings (wind range, direction compass + sliders, live-wind source as a radio list).

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
});

const storedSpot = (page: Page, name: string) => page.evaluate((n) => JSON.parse(localStorage.getItem("spots")!).find((s: any) => s.name === n), name);
const openSettings = async (page: Page, name: string) => {
  await page.locator("aside").getByRole("button", { name: new RegExp(name) }).first().click();
  await page.getByRole("button", { name: "Spot settings" }).click();
};
/**
 * Open a spot (the camera flies to it), start adding, and return a function that clicks the map a few pixels from
 * that spot. The point comes from the marker's MapLibre transform, so it doesn't depend on how the marker looks.
 */
const addNear = async (page: Page, spot: string) => {
  await page.locator("aside").getByRole("button", { name: new RegExp(spot) }).first().click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await page.waitForTimeout(1600); // let the camera settle on the spot
  await page.getByRole("button", { name: "Add a spot" }).click();
  const at = await page.locator(`.maplibregl-marker:has(button[aria-label^='${spot}'])`).evaluate((el) => {
    const m = [...(el as HTMLElement).style.transform.matchAll(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/g)].pop()!;
    const r = el.parentElement!.getBoundingClientRect();
    return { x: r.left + +m[1], y: r.top + +m[2] };
  });
  return (dx: number, dy: number) => page.mouse.click(at.x + dx, at.y + dy);
};

test("add a spot: the pin can be moved, the coastline is read straight away, and Save needs a name", async ({ page }) => {
  const clickMap = await addNear(page, "Fort De Soto");
  await expect(page.locator("aside").getByText("Click the map to drop a pin")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save spot" })).toHaveCount(0); // nothing to save before there's a pin

  // Drop the pin just south of Fort De Soto (the mocks serve real water tiles there)
  await clickMap(0, 8);
  const coords = page.getByTestId("pin-coords");
  await expect(coords).toHaveText(/27\.\d{4}° N, 82\.\d{4}° W/);
  const name = page.getByPlaceholder("e.g. Davis Islands");
  await expect(name).toBeFocused(); // desktop: type straight away
  const save = page.getByRole("button", { name: "Save spot" });
  await expect(save).toBeDisabled();
  await expect(page.getByText("Add a name to save")).toBeVisible();
  expect(await page.locator("aside").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0); // no sideways scroll in the panel

  // The coastline analysis runs on its own and sets the arc (no click on "Suggest from coastline")
  await expect(page.getByTestId("coast-summary")).toContainText("Set automatically", { timeout: 20_000 });
  const width = page.getByRole("slider", { name: "Width" });
  await expect(width).not.toHaveAttribute("aria-valuetext", "Any direction");
  await expect(page.getByRole("list", { name: "Coastline around the spot" }).getByRole("listitem").first()).toBeVisible();
  await expect(page.getByRole("img", { name: /Rideable directions: .*(Onshore|Offshore)/ })).toBeVisible();

  // Mistakes are fixable: clicking the map again moves the pin, and the coastline is read again there
  const first = await coords.textContent(), read = await page.getByTestId("coast-summary").getAttribute("data-for");
  await clickMap(0, 22); // a little further south, clear of the pin that is now standing at the first point
  await expect(coords).not.toHaveText(first!);
  await expect(page.getByTestId("coast-summary")).not.toHaveAttribute("data-for", read!, { timeout: 20_000 });
  await expect(page.getByTestId("coast-summary")).toContainText("Set automatically");

  // Escape while typing leaves the field but keeps the form (and the pin)
  await name.fill("Bunces Pass");
  await name.press("Escape");
  await expect(name).toHaveValue("Bunces Pass");
  await expect(page.getByRole("heading", { name: "New spot" })).toBeVisible();

  await expect(save).toBeEnabled();
  await expect(page.getByText("Add a name to save")).toBeHidden();
  const arc = await width.getAttribute("aria-valuetext");
  await save.click();
  await expect(page.getByRole("heading", { name: "Bunces Pass" })).toBeVisible();
  const s = await storedSpot(page, "Bunces Pass");
  expect(s).toMatchObject({ min: 15, max: 30 });
  expect(s.lat).toBeCloseTo(27.6, 0);
  expect(Math.round(s.dirW)).toBe(parseFloat(arc!)); // the arc on screen ("135° wide") is the one saved
  expect(s.dirC).toBeGreaterThan(200); // Gulf side
  expect(s.dirC).toBeLessThan(300);
});

test("add a spot: the live-wind source defaults to a nearby NOAA station and can be changed", async ({ page }) => {
  const clickMap = await addNear(page, "Picnic Island");
  await clickMap(0, 8); // Old Port Tampa is about half a kilometre away
  const group = page.getByRole("radiogroup", { name: "Live wind from" });
  await expect(group.getByRole("radio", { name: "Old Port Tampa" })).toBeChecked();
  // Each station shows how far it is and what it reads now
  await expect(group.getByRole("radio", { name: "Old Port Tampa" })).toHaveAccessibleDescription(/km · #8726607.*\d+ kn [NESW]+/);
  // Arrow keys move the choice, as in any radio group
  await group.getByRole("radio", { name: "Old Port Tampa" }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(group.getByRole("radio", { name: /Auto — nearest sensor/ })).toBeChecked();
  await page.getByPlaceholder("e.g. Davis Islands").fill("Ballast Point");
  await page.getByRole("button", { name: "Save spot" }).click();
  await expect(page.getByRole("heading", { name: "Ballast Point" })).toBeVisible();
  expect((await storedSpot(page, "Ballast Point")).station).toBeUndefined(); // Auto
});

test("spot settings: sliders announce their values with units; the compass aims the arc", async ({ page }) => {
  await openSettings(page, "Fort De Soto");
  const min = page.getByRole("slider", { name: "Minimum knots" });
  await expect(min).toHaveAttribute("aria-valuetext", "15 knots");
  await min.focus();
  await page.keyboard.press("ArrowRight");
  await expect(min).toHaveAttribute("aria-valuetext", "16 knots");
  await expect.poll(async () => (await storedSpot(page, "Fort De Soto")).min).toBe(16);

  const width = page.getByRole("slider", { name: "Width" }), centre = page.getByRole("slider", { name: "Centre" });
  await expect(width).toHaveAttribute("aria-valuetext", "Any direction");
  // Centre works straight from "any direction": it starts a ±45° arc there
  await centre.focus();
  await page.keyboard.press("Home");
  await expect(centre).toHaveAttribute("aria-valuetext", "N, 0°");
  await expect(width).toHaveAttribute("aria-valuetext", "90° wide");
  await expect.poll(async () => (await storedSpot(page, "Fort De Soto")).dirW).toBe(90);

  // Tap the compass on its west side: the arc swings round to W
  const compassImg = page.getByRole("img", { name: /^Rideable directions/ });
  const b = (await compassImg.boundingBox())!;
  await page.mouse.click(b.x + b.width * 0.12, b.y + b.height / 2);
  await expect(centre).toHaveAttribute("aria-valuetext", "W, 270°");
  await expect(compassImg).toHaveAccessibleName(/W ±45°/);
  await expect.poll(async () => (await storedSpot(page, "Fort De Soto")).dirC).toBe(270);

  await width.focus();
  await page.keyboard.press("End");
  await expect(width).toHaveAttribute("aria-valuetext", "Any direction");
  await expect(compassImg).toHaveAccessibleName(/Any direction/);
});

test("spot settings: the station choice is a radio list with Auto, nearby stations and forecast only", async ({ page }) => {
  await openSettings(page, "Fort De Soto");
  const group = page.getByRole("radiogroup", { name: "Live wind from" });
  const auto = group.getByRole("radio", { name: "Auto — nearest sensor (≤ 16 km)" });
  await expect(auto).toBeChecked(); // the seed has no station: auto
  await expect(auto).toHaveAccessibleDescription(/Middle Tampa Bay · 1\d km/);
  await expect(group.getByRole("radio")).toHaveCount(5); // Auto + 3 NOAA stations from the mocks + forecast only

  await group.getByRole("radio", { name: "Middle Tampa Bay" }).check();
  await expect.poll(async () => (await storedSpot(page, "Fort De Soto")).station).toBe("8726412");
  await expect(page.locator("aside").getByText(/^Live · Middle Tampa Bay/)).toBeVisible(); // its own station now reads as live

  await group.getByRole("radio", { name: "No station — forecast only" }).check();
  await expect.poll(async () => (await storedSpot(page, "Fort De Soto")).station).toBe("none");
  await expect(group.getByRole("radio", { name: "No station — forecast only" })).toHaveAccessibleDescription(/HRRR forecast/);

  await auto.check();
  await expect.poll(async () => (await storedSpot(page, "Fort De Soto")).station).toBeUndefined();
});

test("add a spot with the keyboard alone: Use map centre, a name, Enter", async ({ page }) => {
  await page.getByRole("button", { name: "New spot" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "New spot" })).toBeVisible();
  const centre = page.locator("aside").getByRole("button", { name: "Use map centre" });
  await centre.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("pin-coords")).toHaveText(/\d+\.\d{4}° N, \d+\.\d{4}° W/);
  const name = page.getByPlaceholder("e.g. Davis Islands");
  await expect(name).toBeFocused(); // the pin is down: straight on to its name
  await expect(page.getByRole("button", { name: "Move pin to map centre" })).toBeVisible();
  await page.keyboard.type("Mid Bay");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Mid Bay" })).toBeVisible();
  expect(await storedSpot(page, "Mid Bay")).toMatchObject({ min: 15, max: 30 });
});

test.describe("with location allowed", () => {
  test.use({ geolocation: { latitude: 27.9213, longitude: -82.4889 }, permissions: ["geolocation"] });
  test("add a spot: Use my location drops the pin where you are", async ({ page }) => {
    await page.getByRole("button", { name: "New spot" }).click();
    await page.locator("aside").getByRole("button", { name: "Use my location" }).click();
    await expect(page.getByTestId("pin-coords")).toHaveText(/27\.9213° N, 82\.4889° W/);
  });
});

test("add a spot: Use my location says plainly when location is off", async ({ page }) => {
  await page.getByRole("button", { name: "New spot" }).click();
  await page.locator("aside").getByRole("button", { name: "Use my location" }).click();
  await expect(page.getByRole("region", { name: "New spot" }).getByRole("status")).toHaveText(/Location is turned off for this site|Couldn.t find your location/);
  await expect(page.getByTestId("pin-coords")).toHaveCount(0);
});
