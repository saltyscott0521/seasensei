# SeaSensei web (v2)

Vite + React 19 + TypeScript, served by a small Node server (`server/`) that also hosts the AI outlook.
All weather data is key-free; only the outlook needs an Anthropic API key (server-side).

- **Map:** MapLibre (OpenFreeMap dark style) with an animated HRRR wind-particle layer (`WindParticles.tsx`) fed by a
  multi-point Open-Meteo request covering the visible area.
- **Data:** TanStack Query. Open-Meteo `gfs_hrrr` per spot, NOAA CO-OPS live station wind, NOAA station list
  (auto-suggests the nearest station for new spots).
- **UI:** Tailwind v4, Motion, Vaul (bottom sheet on phones), NumberFlow, Radix Slider, Sonner, Lucide.
- **Direction per spot:** `dirC`/`dirW` (centre ± width, degrees FROM). Rideable = speed in range AND direction in arc
  (`isRideable`, `rideableWindows`, `rideState` in `lib/wind.ts`).
- **Forecast vs actual:** last 24 h of 6-min NOAA readings drawn over the model, scored (`scoreForecast`: bias, average
  miss, direction miss) against the spot's station or the nearest NOAA sensor within 25 km.
- **Charts:** sized to their container (`useChartSize`, drawn 1:1 in CSS px), with a line chart and a colour-coded hourly
  bar chart sharing one scrub cursor; bar = speed scale, faded cap = gusts, status strip = green rideable / amber wrong
  direction / grey too light / red too strong. An expand button opens both full screen.
- **Model comparison:** HRRR, NBM, ECMWF and GFS in one request; the spread between them is the confidence signal.
- **Spots** live in the browser's localStorage (same `spots` key/shape as v1).
- MapLibre 6 finds its worker via `import.meta.url`, which breaks once bundled. `scripts/copy-maplibre-worker.mjs`
  (run by `predev`/`prebuild`) copies it to `public/maplibre/<version>/`, and `main.tsx` calls `setWorkerUrl`.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # vitest: src/lib/wind.test.ts
npm run build
```

Deploy: Coolify app (project "SeaSensei") builds `web/Dockerfile` (node build → node server), port 80, on push to `main`.
Env: `ANTHROPIC_API_KEY` (enables the outlook), optional `OUTLOOK_DAILY_CAP`, `OUTLOOK_PER_IP_CAP`.
