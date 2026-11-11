import { expect, test, type Page } from "@playwright/test";
import { mockApis, speedAt } from "./mocks";

// The SeaSensei forecast, driven like a rider: it leads by default and shows its range, raw models read the sea
// cell, a live sensor bends the next hours, one failed Open-Meteo request doesn't blank anything, and a raw model
// can still be picked.

const SPOT_REQUEST = /api\.open-meteo\.com\/v1\/forecast\?.*past_days=1/;
const openSpot = async (page: Page, name: string) => {
  await page.locator("aside").getByRole("button", { name: new RegExp(name) }).first().click();
  await expect(page.getByRole("button", { name: "Spot settings" })).toBeVisible();
};
const start = async (page: Page) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fort De Soto" })).toBeVisible();
};
/** The timeline's hour, n hours from now (0 = now). */
const hoursAhead = async (page: Page, n: number) => {
  await page.getByRole("slider", { name: "Forecast time" }).focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < n; i++) await page.keyboard.press("ArrowRight");
};
/** What a model's tile on the Models chart reads, in whole knots (NaN for "—"). */
const tile = async (page: Page, model: string) =>
  parseInt((await page.getByRole("button", { name: new RegExp(`^${model}`) }).locator(".num").innerText()), 10);

test("SeaSensei leads by default: one blended line with its range, from two requests per spot", async ({ page }) => {
  await mockApis(page);
  const asked: URL[] = [];
  page.on("request", (r) => { if (SPOT_REQUEST.test(r.url())) asked.push(new URL(r.url())); });
  await start(page);
  const picker = page.getByRole("combobox", { name: "Forecast model" });
  await expect(picker).toHaveValue("sensei");
  await expect(picker.locator("option:checked")).toHaveText("SeaSensei");
  await expect(picker).toHaveAccessibleDescription("Our blend of all five models, tuned to local sensors");
  await expect(page.getByText("Now · SeaSensei forecast")).toBeVisible();

  await openSpot(page, "Fort De Soto");
  await page.getByRole("button", { name: "7 days" }).click();
  const line = page.locator('svg[aria-label="7 day wind forecast"]');
  await expect(line.locator("[data-range-band]")).toHaveCount(1);
  // a blend has no handoffs, and no NBM tail to hatch
  await expect(line.locator("[data-handoff]")).toHaveCount(0);
  await expect(page.getByText("NBM · lower confidence")).toHaveCount(0);
  await expect(line).toHaveAccessibleDescription(/The shaded band is the range the wind is likely to fall in\./);

  // the readout gives the hour's range next to its speed, on the line chart and the bars alike
  const box = (await line.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  const readout = line.getByText(/· \d+ kn \(\d+–\d+\) [NESW]+ · gusts \d+/);
  await expect(readout).toBeVisible();
  const [, kn, lo, hi] = (await readout.textContent())!.match(/· (\d+) kn \((\d+)–(\d+)\)/)!.map(Number);
  expect(lo).toBeLessThan(kn);
  expect(hi).toBeGreaterThan(kn);
  await expect(page.locator('svg[aria-label^="Hourly wind bars"]').getByText(new RegExp(`^${kn} kn \\(${lo}–${hi}\\) [NESW]+`))).toBeVisible();

  // the Models chart draws SeaSensei bold over the five raw models, without asking Open-Meteo again
  await page.getByRole("button", { name: "Models" }).click();
  const models = page.locator('svg[aria-label="Wind forecast by model"]');
  await expect(models.locator('path[stroke="#f1f5f9"]')).toHaveAttribute("stroke-width", "2.75");
  await expect(models).toHaveAccessibleDescription(/SeaSensei \d+, HRRR \d+, RRFS \d+, NBM \d+, ECMWF \d+, GFS \d+/);
  const mine = asked.filter((u) => u.searchParams.get("latitude") === "27.64");
  expect(mine.map((u) => `${u.searchParams.get("models")}|${u.searchParams.get("cell_selection") ?? "default"}`).sort())
    .toEqual(["gfs_hrrr,ecmwf_ifs025|sea", "ncep_rrfs_conus,ncep_nbm_conus,gfs_global|default"]);
  expect(asked).toHaveLength(3 * 2); // three spots, two requests each: the board, the detail and the Models chart share them
});

test("a raw model at a spot reads the sea cell: HRRR and ECMWF show the windier water, the others the default cell", async ({ page }) => {
  await mockApis(page, { sea: 10 }); // the sea cell blows 10 kn harder than the land cell
  await page.addInitScript(() => localStorage.setItem("primaryModel", "hrrr"));
  await start(page);
  await expect(page.getByRole("combobox", { name: "Forecast model" })).toHaveValue("hrrr"); // the saved choice wins over the default
  await openSpot(page, "Skyway");
  await hoursAhead(page, 5);
  const t = (Math.floor(Date.now() / 3600e3) + 5) * 3600;
  const hrrr = Math.round(+(speedAt(t) + 10).toFixed(1));
  // the spot's forecast (HRRR leading) is the sea cell's value …
  await expect(page.locator('svg[aria-label="48 hour wind forecast"]').getByText(new RegExp(`· ${hrrr} kn [NESW]+ · gusts`))).toBeVisible();
  // … and so is its line among the models, well above RRFS from the default cell
  await page.getByRole("button", { name: "Models" }).click();
  expect(await tile(page, "HRRR")).toBe(hrrr);
  expect(await tile(page, "HRRR") - await tile(page, "RRFS")).toBeGreaterThanOrEqual(9); // 10 − RRFS's own +0.5
  expect(await tile(page, "ECMWF") - await tile(page, "NBM")).toBeGreaterThanOrEqual(7); // (−3 + 10) − (−1)
});

test("a live sensor reading well above the forecast pulls the next hours up, fading out by the evening", async ({ page }) => {
  await mockApis(page);
  // Picnic Island's own station (Old Port Tampa) reads 10 kn over what the models say for now.
  await page.route("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?**", (route) => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get("station") !== "8726607" || q.get("range")) return route.fallback();
    const now = Math.floor(Date.now() / 360e3) * 360e3;
    const s = speedAt(now / 1000) + 10;
    return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({
      metadata: { id: "8726607", name: "Old Port Tampa", lat: "27.8578", lon: "-82.5528" },
      data: [{ t: new Date(now).toISOString().slice(0, 16).replace("T", " "), s: s.toFixed(2), d: "220.0", dr: "SW", g: (s + 4).toFixed(2), f: "0,0" }],
    }) });
  });
  await start(page);
  await openSpot(page, "Picnic Island");
  await expect(page.getByText(/Live · Old Port Tampa/)).toBeVisible();
  await page.getByRole("button", { name: "Models" }).click();

  // The next hour: SeaSensei sits far above every raw model (which the sensor doesn't touch) …
  await hoursAhead(page, 1);
  await expect.poll(async () => await tile(page, "SeaSensei") - await tile(page, "HRRR")).toBeGreaterThanOrEqual(6);
  expect(await tile(page, "SeaSensei")).toBeGreaterThan(Math.max(await tile(page, "RRFS"), await tile(page, "GFS")) + 4);
  // … and the correction has faded away past six hours.
  await hoursAhead(page, 9);
  await expect.poll(async () => Math.abs(await tile(page, "SeaSensei") - await tile(page, "HRRR"))).toBeLessThanOrEqual(1);

});

test("when one of a spot's two requests is rate-limited, the board and the charts are built from the other", async ({ page }) => {
  await mockApis(page);
  await page.route(/api\.open-meteo\.com\/v1\/forecast\?.*cell_selection=sea/, (r) => r.fulfill({ status: 429, body: "" }));
  await start(page);
  for (const id of ["seed-fort-de-soto", "seed-skyway", "seed-picnic-island"]) {
    await expect(page.locator(`[data-spot-card="${id}"] [data-verdict]`)).toBeVisible();
  }
  await expect(page.getByText("Couldn't load the forecast.")).toHaveCount(0);

  // SeaSensei from the three models that arrived, range and all
  await openSpot(page, "Skyway");
  const line = page.locator('svg[aria-label="48 hour wind forecast"]');
  await expect(line.locator("[data-range-band]")).toHaveCount(1);
  await page.getByRole("button", { name: "Models" }).click();
  expect(await tile(page, "HRRR")).toBeNaN();
  expect(await tile(page, "ECMWF")).toBeNaN();
  expect(await tile(page, "SeaSensei")).toBeGreaterThan(0);
  expect(await tile(page, "RRFS")).toBeGreaterThan(0);

  // a raw chain carries on from what it has: HRRR's falls through to RRFS; ECMWF alone has nothing and says so
  await page.getByRole("button", { name: "Forecast", exact: true }).click();
  await page.getByRole("combobox", { name: "Forecast model" }).selectOption("hrrr");
  await expect(line).toBeVisible();
  await expect(line.locator("[data-range-band]")).toHaveCount(0);
  await expect(page.getByText("RRFS said for this hour").or(page.getByText(/RRFS forecast$/)).first()).toBeVisible();
  await page.getByRole("combobox", { name: "Forecast model" }).selectOption("ecmwf");
  await expect(page.getByText("Couldn't load the forecast.").first()).toBeVisible();
  await page.getByRole("combobox", { name: "Forecast model" }).selectOption("sensei");
  await expect(line.locator("[data-range-band]")).toHaveCount(1);
});
