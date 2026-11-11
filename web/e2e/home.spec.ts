import { expect, test, type Page } from "@playwright/test";
import { mockApis } from "./mocks";

// The Today board: spots ranked by their verdict, the one-line answer above them, a reading that follows the
// timeline, honest failure states, and the wind discussion after the spots.
test.use({ locale: "en-US" });

const TZ = "America/New_York"; // the mocks' forecast time zone

/** `h` o'clock today in Tampa (ms epoch). The mock wind is rideable from the SW from about 7 AM to 5 PM. */
function tampaToday(h: number) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(Date.now()).split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d, h);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hourCycle: "h23" })
    .formatToParts(utc).map((x) => [x.type, Number(x.value)]));
  return utc - (Date.UTC(p.year, p.month - 1, p.day, p.hour) - utc); // shift by the zone's offset that day
}

const list = (page: Page) => page.getByRole("list", { name: "Your spots, best first" });
const names = (page: Page) => list(page).getByRole("heading").allTextContents();
const cardOf = (page: Page, name: string) => list(page).getByRole("listitem").filter({ has: page.getByRole("heading", { name }) });

async function open(page: Page) {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
}

const SEEDED = [
  { id: "fds", name: "Fort De Soto", lat: 27.64, lon: -82.739, min: 15, max: 30 },
  { id: "sky", name: "Skyway", lat: 27.628, lon: -82.66, min: 15, max: 30 },
  { id: "pic", name: "Picnic Island", lat: 27.853, lon: -82.552, min: 15, max: 30, station: "8726607" },
];
/** Start with these spots (once per test: a reload keeps whatever the app saved since). */
const seed = (page: Page, spots: unknown[]) => page.addInitScript((s) => {
  if (!sessionStorage.getItem("seeded")) { localStorage.setItem("spots", JSON.stringify(s)); sessionStorage.setItem("seeded", "1"); }
}, spots);

test("the board ranks spots by their verdict, under one answer for the day", async ({ page }) => {
  await page.clock.install({ time: tampaToday(13) }); // early afternoon: the mock wind is on everywhere (the clock keeps running)
  await open(page);

  // the title row: today's date and daylight, and the one model picker in the list view
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByText(/Daylight\s*\d{1,2}:\d{2} AM – \d{1,2}:\d{2} PM/)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Forecast model" })).toHaveCount(1);

  // every spot is on now; equal sessions keep your order, and the answer names the first
  for (const n of ["Fort De Soto", "Skyway", "Picnic Island"]) {
    await expect(cardOf(page, n).locator("[data-verdict]")).toHaveText("On now");
    await expect(cardOf(page, n)).toContainText(/till \d{1,2} PM · \d+(–\d+)? kn SW/);
    // today's daylight ribbon, with the rideable hours in words for screen readers
    await expect(cardOf(page, n).getByRole("img", { name: /^Today, sunrise to sunset: rideable \d{1,2}( AM)?–\d{1,2} PM/ })).toBeVisible();
  }
  expect(await names(page)).toEqual(["Fort De Soto", "Skyway", "Picnic Island"]);
  const answer = page.getByTestId("today-answer");
  await expect(answer).toHaveText(/^Best today · Fort De Soto · \d{1,2}( AM)?–\d{1,2} PM · \d+(–\d+)? kn SW/);
});

// (On the real clock: a faked page clock drives requestAnimationFrame too, and under load the panel's transition crawls.)
test("tapping the day's answer opens that spot", async ({ page }) => {
  await open(page);
  const answer = page.getByTestId("today-answer");
  await expect(answer).toHaveText(/^(Best today|No session today|Done today|No session this week) · /);
  const name = (await list(page).getByRole("heading").first().textContent())!; // the answer is about the top-ranked spot
  await expect(answer).toContainText(name);
  await answer.click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name })).toBeVisible();
});

test("a spot with no session sinks below the ones with a session today, and says why", async ({ page }) => {
  await page.clock.install({ time: tampaToday(13) });
  await seed(page, SEEDED.map((s) => (s.name === "Fort De Soto" ? { ...s, dirC: 45, dirW: 90 } : s))); // NE only; the mock wind is SW
  await open(page);
  await expect.poll(() => names(page)).toEqual(["Skyway", "Picnic Island", "Fort De Soto"]);
  const fds = cardOf(page, "Fort De Soto");
  await expect(fds.locator("[data-verdict]")).toHaveText("No session this week");
  await expect(fds).toContainText("Wrong direction · SW, needs NE");
  await expect(fds.getByRole("img", { name: /^Today, sunrise to sunset: .*wrong direction/ })).toBeVisible();
  await expect(cardOf(page, "Skyway").locator("[data-verdict]")).toHaveText("On now");
  await expect(page.getByTestId("today-answer")).toHaveText(/^Best today · Skyway · /);
});

test("changing a spot's directions in its settings re-ranks the board", async ({ page }) => {
  test.slow(); // a long keyboard flow on software WebGL
  await open(page);
  await expect(cardOf(page, "Skyway").locator("[data-verdict]")).not.toHaveText("No session this week");
  await cardOf(page, "Skyway").getByRole("button").first().click();
  await page.getByRole("button", { name: "Spot settings" }).click();
  const press = async (label: string, key: string, times = 1) => {
    const thumb = page.getByRole("slider", { name: label });
    await thumb.focus();
    for (let i = 0; i < times; i++) await page.keyboard.press(key);
  };
  await press("Width", "Home");
  await press("Width", "ArrowRight", 6); // 90° wide
  await press("Centre", "Home");
  await press("Centre", "ArrowRight", 9); // centred on 45°: NE only, and the mock wind is SW
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("spots")!).find((s: { name: string }) => s.name === "Skyway").dirC)).toBe(45);
  await page.keyboard.press("Escape"); // closes the settings first…
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await page.keyboard.press("Escape"); // …then leaves the spot for the board
  await expect.poll(() => names(page)).toEqual(["Fort De Soto", "Picnic Island", "Skyway"]);
  await expect(cardOf(page, "Skyway").locator("[data-verdict]")).toHaveText("No session this week");
});

test("before the wind comes up, the verdict says when, and the answer is the earliest session", async ({ page }) => {
  await page.clock.install({ time: tampaToday(5) }); // before sunrise
  await open(page);
  for (const n of ["Fort De Soto", "Skyway", "Picnic Island"]) {
    await expect(cardOf(page, n).locator("[data-verdict]")).toHaveText(/^On at \d{1,2} AM$/);
  }
  await expect(page.getByTestId("today-answer")).toHaveText(/^Best today · Fort De Soto · \d{1,2} AM–\d{1,2} PM · /);
});

test("each card's reading follows the timeline hour, then comes back to now", async ({ page }) => {
  await open(page);
  const reading = cardOf(page, "Skyway").getByTestId("spot-reading");
  await expect(reading).toHaveText(/^(Now|Live|Nearby( · [\d.]+ km)?)\s*·\s*\d+ kn/);
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await slider.focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
  // 30 hours ahead: the card names that hour and shows the forecast for it
  await expect(reading).toHaveText(/^(Today|Tomorrow|[A-Z][a-z]{2}) \d{1,2} (AM|PM)\s*·\s*\d+ kn/);
  await page.getByRole("button", { name: "Back to now" }).click();
  await expect(reading).toHaveText(/^(Now|Live|Nearby)\s*·/);
});

test("a spot whose forecast fails says so plainly, sinks to the bottom and can retry", async ({ page }) => {
  await mockApis(page);
  const picnic = /api\.open-meteo\.com\/v1\/forecast\?latitude=27\.853&/;
  await page.route(picnic, (r) => r.fulfill({ status: 503, body: "" }));
  await page.goto("/");
  const card = cardOf(page, "Picnic Island");
  await expect(card).toContainText("Couldn't load the forecast.", { timeout: 30_000 }); // after the client's retries
  expect((await names(page)).at(-1)).toBe("Picnic Island");
  await expect(cardOf(page, "Skyway").locator("[data-verdict]")).toBeVisible(); // the others are unaffected

  await page.unroute(picnic);
  await card.getByRole("button", { name: "Retry loading Picnic Island" }).click();
  await expect(card.locator("[data-verdict]")).toBeVisible();
  await expect(card).not.toContainText("Couldn't load the forecast.");
});

test("the wind discussion comes after the spots, and closing it gives focus back", async ({ page }) => {
  await open(page);
  const region = page.getByRole("region", { name: "Wind discussion" });
  await expect(region.getByTestId("discussion-headline")).toBeVisible();
  const after = await list(page).evaluate((ol) => {
    const r = document.querySelector('section[aria-label="Wind discussion"]')!;
    return !!(ol.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(after, "the discussion follows the spot list").toBe(true);

  const summary = region.getByRole("button", { name: "Read the full wind discussion" });
  await summary.click();
  const dialog = page.getByRole("dialog", { name: "Wind discussion" });
  const article = dialog.getByRole("region", { name: "Wind discussion" });
  await expect(article).toBeFocused(); // the article: arrows, Page Down and Space read it
  await expect(article.getByRole("heading", { level: 3 })).toBeVisible(); // (once its text has loaded)
  await page.keyboard.press("PageDown");
  await expect.poll(() => article.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(dialog).toBeVisible(); // (Space or Page Down never lands on Close)
  // Tab stays inside the dialog
  for (let i = 0; i < 30; i++) await page.keyboard.press("Tab");
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(summary).toBeFocused();
});

test("with no spots, the board invites you to add one", async ({ page }) => {
  await seed(page, []);
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByText(/^No spots yet\. (Tap|Click) \+ and drop a pin where you launch\.$/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByTestId("today-answer")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Wind discussion" })).toBeVisible();
});

test("the discussion's archive arrows keep focus when they reach the end of the archive", async ({ page }) => {
  await open(page);
  await page.getByRole("region", { name: "Wind discussion" }).getByRole("button", { name: "Read the full wind discussion" }).click();
  const dialog = page.getByRole("dialog", { name: "Wind discussion" });
  const older = dialog.getByRole("button", { name: "Older discussion" });
  await older.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("heading", { name: /Yesterday's pattern/ })).toBeVisible();
  await expect(older).toHaveAttribute("aria-disabled", "true");
  await expect(older).toBeFocused(); // not dropped to <body>
  await page.keyboard.press("Enter"); // pressing it again does nothing
  await expect(dialog.getByRole("heading", { name: /Yesterday's pattern/ })).toBeVisible();
});

test("the board's top card carries the day's answer, with how sure the models are", async ({ page }) => {
  await page.clock.install({ time: tampaToday(13) });
  await open(page);
  const answer = page.getByTestId("today-answer");
  // the answer rides on the first card (no separate row repeating it)
  const first = list(page).getByRole("listitem").first();
  await expect(first.getByTestId("today-answer")).toHaveCount(1);
  await expect(first.getByRole("button")).toHaveAccessibleName(/^Best today Fort De Soto On now/);
  await expect(answer).toBeVisible();
  // how sure: the models' agreement for that session, in words
  await expect(first.getByRole("img", { name: /^(Models agree|Some disagreement|Models disagree) · \d+ kn spread$/ })).toBeVisible();
});

test("each card says where its reading comes from, and how far away a nearby sensor is", async ({ page }) => {
  await open(page);
  await expect(cardOf(page, "Fort De Soto").getByTestId("spot-reading")).toContainText("Nearby · 14 km");
  await expect(cardOf(page, "Picnic Island").getByTestId("spot-reading")).toContainText(/^Live/);
});

test("while the timeline points elsewhere, a card's verdict steps back and its reading names the hour as the map does", async ({ page }) => {
  await page.clock.install({ time: tampaToday(13) }); // on everywhere
  await open(page);
  const fds = cardOf(page, "Fort De Soto");
  const pill = fds.locator("[data-verdict]");
  await expect(pill).toHaveText("On now");
  await expect(pill).not.toHaveAttribute("data-muted");
  await expect(fds.getByRole("button")).toHaveAttribute("data-go", "true"); // the best spot's go wash
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await slider.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  // tonight: too light, on the card and on the map, in the same word
  await expect(fds.getByTestId("spot-reading")).toHaveText(/^Today \d{1,2} PM\s*·\s*\d+ kn.*·\s*Too light$/);
  await expect(page.locator('[data-spot-marker="seed-fort-de-soto"]')).toHaveAttribute("aria-label", /, too light$/);
  // the verdict is still about now, but neutral: nothing green next to a hour that isn't rideable
  await expect(pill).toHaveText("On now");
  await expect(pill).toHaveAttribute("data-muted", "true");
  await expect(fds.getByRole("button")).not.toHaveAttribute("data-go");
  await expect(fds.getByTestId("today-answer")).toHaveText(/^Best today · /); // the day's answer stays

  // the spot's hero too: the pill steps back, the range line speaks for the hour
  await fds.getByRole("button").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await expect(list(page)).toHaveCount(0);
  const hero = page.locator("aside [data-verdict]").first();
  await expect(hero).toHaveAttribute("data-muted", "true");
  await expect(page.locator("aside").getByText("Too light", { exact: true }).first()).toBeVisible(); // the range line
  await page.getByRole("button", { name: "Back to now" }).click();
  await expect(hero).not.toHaveAttribute("data-muted");
  await page.getByRole("button", { name: "Back to spots" }).click();
  await expect(fds.getByTestId("hour-state")).toHaveCount(0);
  await expect(fds.getByRole("button")).toHaveAttribute("data-go", "true");
});

test("wind over the range right now reads \"Too strong now\" on the card and the hero, as on the map", async ({ page }) => {
  // Midday ET (17:00 UTC), inside the forecast session; Picnic Island (15–24.5 kn) has its own sensor reading 31 kn.
  // On a raw model (HRRR picked) the forecast still calls it on; SeaSensei would bend to the sensor (forecast.spec.ts).
  const d = new Date(), noon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 17);
  await page.clock.setFixedTime(noon);
  await page.addInitScript(() => localStorage.setItem("primaryModel", "hrrr"));
  await seed(page, [SEEDED[0], SEEDED[1], { ...SEEDED[2], max: 24.5 }]);
  await mockApis(page);
  await page.route("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?**", (route) => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get("station") !== "8726607" || q.get("range")) return route.fallback();
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({
      metadata: { id: "8726607", name: "Old Port Tampa", lat: "27.8578", lon: "-82.5528" },
      data: [{ t: new Date(noon - 6 * 60e3).toISOString().slice(0, 16).replace("T", " "), s: "31.00", d: "220.0", dr: "SW", g: "36.00", f: "0,0" }],
    }) });
  });
  await page.goto("/");
  const pic = cardOf(page, "Picnic Island");
  await expect(pic.locator("[data-verdict]")).toHaveText("Too strong now");
  await expect(pic.locator("[data-verdict]")).toHaveAttribute("data-verdict", "strong");
  await expect(pic).toContainText(/forecast till \d{1,2} PM/); // the forecast's session, said as such
  await expect(page.locator('[data-spot-marker="pic"]')).toHaveAttribute("aria-label", "Picnic Island, 31 knots, Too strong now");
  await expect(cardOf(page, "Skyway").locator("[data-verdict]")).toHaveText("On now"); // the others are on
  await pic.getByRole("button").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await expect(list(page)).toHaveCount(0);
  await expect(page.locator("aside [data-verdict]").first()).toHaveText("Too strong now");
  await expect(page.locator("aside").getByText("Too strong", { exact: true }).first()).toBeVisible(); // the range line
});

test("a card lights its marker when the keyboard reaches it, not when focus comes back after a mouse Back", async ({ page }) => {
  await open(page);
  await cardOf(page, "Skyway").getByRole("button").click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
  await page.getByRole("button", { name: "Back to spots" }).click();
  await page.mouse.move(900, 120); // over the map, clear of the panel
  await expect(cardOf(page, "Skyway").getByRole("button")).toBeFocused(); // focus came back to the card …
  await page.waitForTimeout(300);
  await expect(page.locator("[data-spot-marker][data-highlighted]")).toHaveCount(0); // … but nothing is pointed at
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab"); // the keyboard brings it back
  await expect(cardOf(page, "Skyway").getByRole("button")).toBeFocused();
  await expect(page.locator('[data-spot-marker="seed-skyway"]')).toHaveAttribute("data-highlighted", "true");
});
