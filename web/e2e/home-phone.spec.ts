import { expect, test, type Page } from "@playwright/test";
import { mockApis } from "./mocks";

/** Drag the sheet up by its top edge, as a thumb would, to its highest snap. */
async function raiseSheet(page: Page) {
  const sh = (await page.locator("[data-vaul-drawer]").boundingBox())!;
  await page.mouse.move(sh.x + sh.width / 2, sh.y + 12);
  await page.mouse.down();
  await page.mouse.move(sh.x + sh.width / 2, 40, { steps: 12 });
  await page.mouse.up();
}

test("phone: the sheet's peek leads with the Today board; raised, it shows the ranked spots, then the discussion", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  // at rest: the board's title row is on screen, the regional discussion is not (it comes after your spots)
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeInViewport();
  const region = page.getByRole("region", { name: "Wind discussion" });
  await expect(region).not.toBeInViewport();

  await raiseSheet(page);
  const answer = page.getByTestId("today-answer");
  await expect(answer).toBeInViewport();
  await expect(answer).toHaveText(/^(Best today|No session today|Done today|No session this week) · /);
  const cards = page.getByRole("list", { name: "Your spots, best first" }).getByRole("listitem");
  await expect(cards).toHaveCount(3);
  for (const card of await cards.all()) await expect(card.locator("[data-verdict]")).toHaveText(/^(On now|On at \d{1,2} (AM|PM)|Next: [A-Z][a-z]{2} \d{1,2} (AM|PM)|No session this week)$/);
  // every card, and so the answer (it rides on the top card), is comfortably thumb-sized
  await expect(page.locator("ol button [data-testid='today-answer']")).toHaveCount(1);
  const small = await page.locator("[data-vaul-drawer]").evaluate((sheet) => [...sheet.querySelectorAll("ol button")]
    .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 44 || r.width < 44); }).map((b) => b.textContent?.slice(0, 30)));
  expect(small, `small targets: ${JSON.stringify(small)}`).toEqual([]);

  await region.getByRole("button", { name: "Read the full wind discussion" }).scrollIntoViewIfNeeded();
  await expect(region).toBeInViewport();

  // tap a card to open its spot
  await page.getByRole("list", { name: "Your spots, best first" }).getByRole("button", { name: /Skyway/ }).click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Skyway" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

for (const size of [{ width: 412, height: 839 }, { width: 375, height: 667 }]) {
  test(`phone ${size.width}×${size.height}: the board's header and its spot cards are compact enough for two spots at rest`, async ({ page }) => {
    await page.setViewportSize(size);
    await mockApis(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
    const header = page.getByRole("heading", { name: "Today", exact: true }).locator("xpath=..");
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(52);
    const cards = page.getByRole("list", { name: "Your spots, best first" }).getByRole("listitem");
    await expect(cards.first().locator("[data-verdict]")).toBeVisible();
    for (const c of await cards.all()) expect((await c.boundingBox())!.height).toBeLessThanOrEqual(104);
    // the picker is small to the eye, full size to the thumb, and still the one "Forecast model"
    const picker = page.getByRole("combobox", { name: "Forecast model" });
    expect((await picker.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(picker).toHaveAccessibleDescription(/blend of all five models/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
}

/** `h`:`m` today in Tampa (ms epoch), whatever the zone's offset that day. */
function tampaToday(h: number, m = 0) {
  const TZ = "America/New_York";
  const [y, mo, d] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(Date.now()).split("-").map(Number);
  const utc = Date.UTC(y, mo - 1, d, h, m);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(utc).map((x) => [x.type, Number(x.value)]));
  return utc - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - utc);
}

const PHONES = [{ width: 412, height: 839 }, { width: 390, height: 664 }, { width: 375, height: 667 }, { width: 320, height: 568 }];

for (const size of PHONES) {
  test(`phone ${size.width}×${size.height}: after sunset each card's strip says it is tomorrow's, and the day's answer says today is done`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.clock.install({ time: tampaToday(19, 30) });
    await mockApis(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
    const cards = page.getByRole("list", { name: "Your spots, best first" }).getByRole("listitem");
    await expect(cards).toHaveCount(3);
    for (const c of await cards.all()) {
      await expect(c.getByRole("img", { name: /^Tomorrow, sunrise to sunset: / })).toBeAttached();
      await expect(c.getByTestId("ribbon-day").getByText("Tomorrow", { exact: true })).toBeVisible(); // in words, on the phone too
      await expect(c.locator("[data-verdict]")).toHaveText(/^Next: [A-Z][a-z]{2} \d{1,2} AM$/);
    }
    // today's session ran this morning: today is done, not "no session"
    await expect(page.getByTestId("today-answer")).toHaveText(/^Done today · /);
    // the first card's day is on screen at rest, next to its strip
    await expect(cards.first().getByTestId("ribbon-day")).toBeInViewport();
    // an evening's longer verdicts ("Next: Sat 7 AM") still leave every card one verdict line (the resting sheet's two)
    if (size.width >= 375) for (const c of await cards.all()) expect((await c.boundingBox())!.height).toBeLessThanOrEqual(104);
  });
}

test("phone 320×568: the discussion's header keeps its date controls and never shows a cut-off title", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  const open = page.getByRole("region", { name: "Wind discussion" }).getByRole("button", { name: "Read the full wind discussion" });
  await open.scrollIntoViewIfNeeded();
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Wind discussion" }); // still named by its title
  await expect(dialog).toBeVisible();
  for (const b of ["Older discussion", "Newer discussion", "Close"]) await expect(dialog.getByRole("button", { name: b })).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole("combobox", { name: "Discussion date" })).toBeInViewport({ ratio: 1 });
  const cut = await dialog.locator("#discussion-title").evaluate((el) => el.getBoundingClientRect().width > 1 && el.scrollWidth > el.clientWidth);
  expect(cut).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
