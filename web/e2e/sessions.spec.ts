import { expect, test, type Page } from "@playwright/test";
import { mockApis } from "./mocks";

// The session engine through the UI: rideable windows are daylight only, and "No station" means forecast only.
test.use({ locale: "en-US" });

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
});

const openSpot = async (page: Page, name: string) => {
  await page.locator("aside").getByRole("button", { name: new RegExp(name) }).first().click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
};
const storedSpot = (page: Page, name: string) => page.evaluate((n) => JSON.parse(localStorage.getItem("spots")!).find((s: any) => s.name === n), name);

const TZ = "America/New_York"; // the mocks' forecast time zone
const FORT_DE_SOTO = { lat: 27.64, lon: -82.739 };

/** Sunrise/sunset in minutes after UTC midnight: NOAA's fractional-year approximation (±2 min), independent of the app's. */
function sun(lat: number, lon: number, y: number, m: number, d: number) {
  const n = (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5 + 1, r = Math.PI / 180;
  const g = ((2 * Math.PI) / ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365)) * (n - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.cos(90.833 * r) / (Math.cos(lat * r) * Math.cos(dec)) - Math.tan(lat * r) * Math.tan(dec)) / r;
  return { rise: 720 - 4 * (lon + ha) - eq, set: 720 - 4 * (lon - ha) - eq };
}
/** Minutes the zone is ahead of UTC on a date (−300 for EST). */
function offsetMin(y: number, m: number, d: number) {
  const noon = Date.UTC(y, m - 1, d, 12);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(noon).map((x) => [x.type, Number(x.value)]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - noon) / 60e3;
}
/** The date a chip's day label names: "Today", or the next such weekday. */
function dateOf(label: string) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(Date.now()).split("-").map(Number);
  for (let i = 0; i < 8; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i, 12));
    if (label === "Today" ? i === 0 : i > 0 && dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }) === label)
      return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()] as const;
  }
  throw new Error(`no date for ${label}`);
}
const toMin = (h: number, ap: string) => ((h % 12) + (ap === "PM" ? 12 : 0)) * 60;

test("rideable windows are daylight only: none starts before sunrise or ends after sunset", async ({ page }) => {
  await openSpot(page, "Fort De Soto");
  const chips = page.locator("span[title^='HRRR'], span[title^='RRFS'], span[title^='NBM']");
  await expect(chips.first()).toBeVisible(); // the mock wind is rideable from the SW every afternoon
  const texts = await chips.allTextContents();
  for (const text of texts) {
    // "Today 7 AM–5 PM", "Sat 1–5 PM" (the start's AM/PM is left out when it matches the end's)
    const m = text.match(/^(Today|[A-Z][a-z]{2})\s*(\d{1,2})(?:\s?(AM|PM))?\s*–\s*(\d{1,2})\s?(AM|PM)/);
    expect(m, `window chip "${text}"`).not.toBeNull();
    const [, day, h0, ap0, h1, ap1] = m!;
    const [y, mo, d] = dateOf(day);
    const s = sun(FORT_DE_SOTO.lat, FORT_DE_SOTO.lon, y, mo, d), off = offsetMin(y, mo, d);
    const tol = 3; // minutes: this check's approximation vs the app's NOAA algorithm
    expect(toMin(+h0, ap0 ?? ap1), `"${text}" starts before sunrise`).toBeGreaterThanOrEqual(s.rise + off - tol);
    expect(toMin(+h1, ap1), `"${text}" ends after sunset`).toBeLessThanOrEqual(s.set + off + tol);
  }
});

test("'No station — forecast only' is honoured: the hero no longer passes a nearby sensor off as live", async ({ page }) => {
  await openSpot(page, "Fort De Soto");
  const panel = page.locator("aside");
  // Auto (no station set): Fort De Soto's "now" comes from Middle Tampa Bay, ~14 km away
  await expect(panel.getByText(/(Live|Nearby sensor) · Middle Tampa Bay/)).toBeVisible();

  await page.getByRole("button", { name: "Spot settings" }).click();
  await page.getByRole("radio", { name: "No station — forecast only" }).click();
  await expect.poll(async () => (await storedSpot(page, "Fort De Soto")).station).toBe("none");
  const forecastOnly = async () => {
    await expect(page.getByLabel(/Middle Tampa Bay: \d+ knots/)).toBeVisible(); // the sensor is live on the map …
    await expect(panel.getByText(/gusting \d+ · from [NESW]+/)).toBeVisible(); // … the hero shows the wind …
    await expect(panel.getByText(/Live ·|Nearby sensor ·/)).toHaveCount(0); // … from the forecast, not the sensor
  };
  await forecastOnly();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible(); // the reload kept the spot open (?spot=)
  await forecastOnly();
});
