import { expect, test, type Page } from "@playwright/test";
import { mockApis } from "./mocks";

// The timeline and the spot charts on a phone: a slim card with the map's colour scale inside it, an outlook that
// isn't cut mid-thought, and charts you read with a tap.

/** Raise the sheet to full height: its grabber button when it has one, else a drag on its top edge. */
async function expandSheet(page: Page) {
  const grabber = page.getByRole("button", { name: "Expand spots" });
  if (await grabber.count()) return grabber.click();
  const sheet = page.locator("[data-vaul-drawer]");
  let last = -1; // let it finish its current snap first
  await expect.poll(async () => { const y = (await sheet.boundingBox())!.y, still = Math.abs(y - last) < 1; last = y; return still; }, { intervals: [200] }).toBe(true);
  const sh = (await sheet.boundingBox())!;
  await page.mouse.move(sh.x + sh.width / 2, sh.y + 10);
  await page.mouse.down();
  await page.mouse.move(sh.x + sh.width / 2, 30, { steps: 14 });
  await page.mouse.up();
}

const timelineCard = (page: Page) => page.getByTestId("outlook").locator("xpath=ancestor::div[contains(@class,'glass')][1]");

for (const size of [{ width: 412, height: 915 }, { width: 320, height: 640 }]) {
  test(`phone ${size.width}px: the timeline is one slim card with the outlook on one line and the colour scale inside`, async ({ page }) => {
    await page.setViewportSize(size);
    await mockApis(page);
    await page.goto("/");
    await expect(page.getByRole("slider", { name: "Forecast time" })).toBeVisible();
    const card = timelineCard(page);
    expect((await card.boundingBox())!.height).toBeLessThanOrEqual(132);
    await expect(card.getByText("40+ kn")).toBeVisible();

    // the headline is whole (never "…"), and on a 412px phone the strength sits beside it on the same line
    const outlook = page.getByTestId("outlook");
    const head = outlook.locator("b");
    expect(await head.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (size.width >= 412 && /^Wind on the way/.test((await head.textContent())!)) {
      const [h, m] = await Promise.all([head.boundingBox(), outlook.locator("b + span").boundingBox()]);
      expect(Math.abs(h!.y - m!.y)).toBeLessThan(2);
      expect(m!.x + m!.width).toBeLessThanOrEqual((await outlook.boundingBox())!.x + (await outlook.boundingBox())!.width + 1);
    }

    // scrubbing names the hour; the chip names the model; the slot for "Back to now" was there all along
    const slider = page.getByRole("slider", { name: "Forecast time" });
    await expect(card.getByText("NOW", { exact: true })).toBeVisible();
    await slider.focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("timeline-when")).toHaveText(/^\w{3} \d{1,2} (AM|PM)$/);
    await expect(card.getByText("HRRR", { exact: true })).toBeVisible();
    expect((await card.boundingBox())!.height).toBeLessThanOrEqual(132);
  });
}

test("phone: a tap on a chart reads that hour, and the reading stays a moment after the finger lifts", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await page.locator(".maplibregl-marker button[aria-label^='Fort De Soto,']").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await expandSheet(page);
  const line = page.locator('svg[aria-label="48 hour wind forecast"]');
  await expect.poll(async () => { // once the sheet has settled, scroll the chart's middle into view
    await line.scrollIntoViewIfNeeded();
    const b = (await line.boundingBox())!;
    return b.y >= 0 && b.y + b.height / 2 <= page.viewportSize()!.height - 20;
  }).toBe(true);
  const box = (await line.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width * 0.6, box.y + box.height / 2);
  const readout = line.getByText(/^\w{3} \d{1,2} (AM|PM) · \d+ kn [NESW]+ · gusts \d+/);
  await expect(readout).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(readout).toBeVisible(); // still there after lifting
  await expect(readout).toBeHidden({ timeout: 8000 }); // then it lets go
});
