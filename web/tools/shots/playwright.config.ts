import { defineConfig, devices } from "@playwright/test";

// Visual check of the map (not part of the e2e suite): the real OpenFreeMap style and tiles under the app, wind mocked.
//   E2E_PORT=4185 SHOTS_TAG=after SHOTS_OUT=/some/dir npx playwright test -c tools/shots/playwright.config.ts
// The style, tiles and glyphs are fetched once with curl (which follows HTTPS_PROXY) and kept in SHOTS_CACHE.
const port = Number(process.env.E2E_PORT) || 4173;

export default defineConfig({
  testDir: ".",
  testMatch: /map-shots\.spec\.ts/,
  timeout: 400_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "off",
    reducedMotion: "no-preference", // the particles as a rider sees them
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`, cwd: "../..", url: `http://127.0.0.1:${port}`, reuseExistingServer: true, timeout: 60_000 },
});
