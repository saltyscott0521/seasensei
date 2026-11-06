import { expect, test } from "@playwright/test";
import { mockApis } from "./mocks";

// The spot forms on a phone: thumb-sized controls, no keyboard popping up uninvited, nothing scrolling sideways.

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
});

const sideways = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

test("phone: add a spot from the sheet with thumb-sized controls", async ({ page }) => {
  // The header's + sits outside the sheet, which aria-hides it (CLAUDE.md), so reach it by its label attribute
  await page.locator("button[aria-label='Add a spot']").click({ force: true });
  const sheet = page.locator("[data-vaul-drawer]");
  await expect(sheet.getByText("Tap the map to drop a pin")).toBeVisible(); // touch wording on a touch screen

  // The map loads lazily; a tap before it's ready drops nothing, so tap until the pin lands (as a person would).
  const name = page.getByPlaceholder("e.g. Davis Islands");
  await expect(async () => {
    await page.mouse.click(120, 420); // open map, clear of markers and the control rail
    await expect(name).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByTestId("pin-coords")).toHaveText(/\d+\.\d{4}° N, \d+\.\d{4}° W/);
  await expect(name).not.toBeFocused(); // no keyboard over the form until the rider asks for it

  // Every way to change the form is at least 44 px to the thumb
  const small = await page.getByRole("region", { name: "New spot" }).evaluate((form) => {
    const out: string[] = [];
    const hit = (el: Element) => {
      const r = el.getBoundingClientRect(), b = getComputedStyle(el, "::before");
      const grow = b.content !== "none" && b.position === "absolute" ? -parseFloat(b.left || "0") : 0; // the halo's inset
      return { w: r.width + 2 * Math.max(0, grow), h: r.height + 2 * Math.max(0, grow) };
    };
    for (const el of form.querySelectorAll(":is(button, input:not([type=radio]), label:has(input[type=radio]), [role=slider])")) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const { w, h } = hit(el);
      if (w < 44 || h < 44) out.push(`${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30)} ${Math.round(w)}×${Math.round(h)}`);
    }
    return out;
  });
  expect(small, `undersized controls: ${JSON.stringify(small)}`).toEqual([]);
  expect(await sideways(page)).toBeLessThanOrEqual(0);

  // The radio list scrolls into view and works by tap
  const forecastOnly = page.getByRole("radio", { name: "No station — forecast only" });
  await forecastOnly.scrollIntoViewIfNeeded();
  await forecastOnly.click(); // a tap anywhere on the row
  await expect(forecastOnly).toBeChecked();

  await name.fill("Gandy Beach");
  const save = page.getByRole("button", { name: "Save spot" });
  await expect(save).toBeInViewport(); // the action stays in reach while the form scrolls
  await save.click();
  await expect(page.getByRole("heading", { name: "Gandy Beach" })).toBeVisible();
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("spots")!).find((x: any) => x.name === "Gandy Beach"));
  expect(s).toMatchObject({ min: 15, max: 30, station: "none" });
});

test("phone: spot settings fit the sheet; the compass aims the arc without dragging the sheet", async ({ page }) => {
  await page.locator(".maplibregl-marker button[aria-label^='Fort De Soto,']").click();
  await page.getByRole("button", { name: "Spot settings" }).click();
  // Raise the sheet all the way: with its grabber button where there is one, else by dragging its top edge
  const expand = page.getByRole("button", { name: "Expand spots" });
  if (await expand.count()) await expand.click();
  else {
    const sh = (await page.locator("[data-vaul-drawer]").boundingBox())!;
    await page.mouse.move(sh.x + sh.width / 2, sh.y + 10); await page.mouse.down();
    await page.mouse.move(sh.x + sh.width / 2, 30, { steps: 14 }); await page.mouse.up();
  }
  await page.waitForTimeout(600); // the sheet settles
  const compassImg = page.getByRole("img", { name: /^Rideable directions/ });
  await compassImg.scrollIntoViewIfNeeded();
  const sheetY = (await page.locator("[data-vaul-drawer]").boundingBox())!.y;
  await expect(compassImg).toBeInViewport({ ratio: 1 });
  const b = (await compassImg.boundingBox())!;
  // Drag along the compass's east side, from NE to SE: the arc follows the finger, the sheet stays put
  await page.mouse.move(b.x + b.width * 0.85, b.y + b.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.95, b.y + b.height * 0.5, { steps: 4 });
  await page.mouse.move(b.x + b.width * 0.85, b.y + b.height * 0.8, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole("slider", { name: "Centre" })).toHaveAttribute("aria-valuetext", /^(ENE|E|ESE|SE|SSE), \d+°$/);
  expect((await page.locator("[data-vaul-drawer]").boundingBox())!.y).toBeCloseTo(sheetY, 0);
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("spots")!).find((x: any) => x.name === "Fort De Soto"));
  expect(s.dirW).toBe(90);
  expect(s.dirC).toBeGreaterThan(60); // east side (the header above may reflow as the arc changes, so not exact)
  expect(s.dirC).toBeLessThan(170);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

for (const size of [{ width: 412, height: 839 }, { width: 390, height: 664 }, { width: 375, height: 667 }, { width: 320, height: 568 }]) {
  test(`phone ${size.width}×${size.height}: a dropped pin brings the Name field up, clear of the Save dock, and nothing in the form is cut off`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
    await page.locator("button[aria-label='Add a spot']").click({ force: true });
    const sheet = page.locator("[data-vaul-drawer]");
    await expect(sheet.getByText("Tap the map to drop a pin")).toBeVisible();
    await page.waitForTimeout(600); // the sheet settles at rest
    await page.mouse.click(100, Math.round((await sheet.boundingBox())!.y / 2) + 20); // the open map above the sheet
    const name = page.getByPlaceholder("e.g. Davis Islands");
    // the field is on screen and nothing covers it (the sticky dock used to, on short phones)
    await expect.poll(() => name.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom <= innerHeight && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el;
    }), { timeout: 5000 }).toBe(true);
    await expect(name).not.toBeFocused(); // still no keyboard uninvited
    // wrapped, never cut with an ellipsis: the pin's coordinates and the live-wind choices
    expect(await page.getByTestId("pin-coords").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const cut = await page.getByRole("radiogroup", { name: "Live wind from" }).evaluate((g) =>
      [...g.querySelectorAll("label span[id]")].filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent));
    expect(cut, `cut off: ${JSON.stringify(cut)}`).toEqual([]);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
}
