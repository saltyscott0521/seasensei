# SeaSensei

Live wind map and forecasts for kite spots. `web/` is the app (Vite + React 19 + TypeScript) plus a small Node
server (`web/server/`) that serves it and writes the daily wind discussion;
`ios/` is an older native SwiftUI version that isn't deployed. Live at https://seasensei.com.

## Working here
- Push straight to `main` (no PRs). Coolify redeploys automatically in about 70 seconds.
- `cd web && npm run dev` · `npm run build` · `npm test` (unit) · `npm run test:e2e` (Playwright).
  `E2E_PORT=4174 npx playwright test …` runs e2e against its own dev server (default 4173), so two checkouts can test at once.
- Discussion locally: `cd web/server && npm ci && ANTHROPIC_API_KEY=… PORT=8787 node server.mjs` (Vite proxies `/api` to it). `node generate.mjs --dry` writes one without saving.
- Deploy notes and infra: `~/Documents/Claude/docs/infrastructure.md` (Hetzner box, Coolify, Cloudflare tunnel).

## Testing: end to end first
Prefer Playwright e2e in `web/e2e/` that drive the real app the way a person does. All network is mocked
(`e2e/mocks.ts`) so runs are deterministic; the coastline test uses real map tiles saved in `e2e/fixtures/`.
**Don't add piles of unit tests.** `src/lib/wind.test.ts` holds four tests for logic that actually broke
(blank NOAA value read as 0 kn, direction arcs across north, direction averaging across north, HRRR→RRFS→NBM handoff) and
`src/lib/session.test.ts` four for the session engine (sunrise/sunset, night hours, minimum length, circular mean).
`src/lib/sensei.test.ts` holds four for the blend (speed map and clamp, weights renormalising, direction across north, nowcast decay).
Add a unit test only when a bug like that bites; otherwise extend an e2e flow. Specs are split by area (`app`, `shell`, `home`,
`spot`, `charts`, `map`, `forms`, `sessions`, `forecast`, `resilience`); phone-only specs are named `*-phone.spec.ts` so the phone project picks them up.
Software WebGL makes runs slow: use `--trace off --workers=2`. Don't edit `src/` while a run is going (Vite reloads the page).

## How the UI is built
- **Design system** (`src/styles/theme.css`, `src/components/ui/`): "night sea" tokens as Tailwind 4 `@theme static` utilities —
  surfaces (`bg-surface-1/2/3`), text (`text-fg`, `-fg-2`, `-fg-3`: the faintest allowed), `accent`, verdict colours
  (`go`, `soon`, `off`, `strong`, `wrongdir`), radii, type sizes (`text-micro` … `text-display`). Colour is data: chrome is neutral;
  only the wind scale, verdicts and the accent carry colour. The wind scale (`windColor`/`windGradient`/`windStops` in `lib/wind.ts`, used by
  everything: particles, markers, strip, hour grid, charts, legend) is one blue (hue ~212°) that brightens with the wind: dim slate
  (<10 kn) → 10–14 → 14–18 → bright 18–25 (prime) → pale 25–30 → near-white 30+; lightness only rises (`spot.spec.ts` checks hue and order). Use the primitives (Button, IconButton, Chip, Card, Segmented,
  VerdictPill, ConfidenceDots, Ribbon, …) instead of ad-hoc `text-white/NN`. `.num` is Geist with tabular figures (no mono).
- **Motion** (`src/lib/motion.ts`): duration/spring/ease tokens; `<MotionConfig reducedMotion="user">` wraps the app. Animate
  opacity/transform only, never `x` inside a scroll container; charts draw in once; rotations take the shortest path.
- **Session engine** (`src/lib/session.ts`, pure): `sunTimes`, daylight-only `sessions()` (≥ 2 h, with peak/gust/direction),
  `verdict()` (On now / On at 1 PM / Next: Sat 11 AM / No session this week), `rankSpots()`, `confidence()` from model spread,
  copy helpers (`fmtSession`, `fmtHour`, …) in the spot's time zone, and station semantics: `spot.station` is an id, `"none"`
  (forecast only, honoured) or undefined (auto: nearest sensor ≤ 16 km, labelled "Nearby sensor", never "Live").
  `useSpotNow`/`useRankedSpots` (`lib/useSpotNow.ts`) wrap it for components. `nowVerdict()` checks the verdict against the wind right
  now: only a fresh reading (≤ 30 min, `LIVE_MS`) from the spot's own station may confirm or overrule the forecast ("On now · 18 kn at
  the sensor", "Too light now · Forecast says on, sensor reads 9 kn"); a nearby sensor is shown beside it and never changes it.
  `useSpotNow().pill` is that answer (cards and map markers both use it).
- **One clock** (`src/lib/time.tsx`): the timeline's chosen hour is `useAt()` (null = now); map, cards, hero, hour grid and chart
  cursors all follow it. Anything may ask for an hour with `requestAt(t)`; the shell listens with `onAtRequest`.
- **Shell** (`App.tsx`, `components/shell/`, `lib/layout.ts`): desktop = docked glass panel + timeline dock; phones = status pill,
  with the morning briefing's bell beside it, one control rail (Add a spot, Stations, Find my location — no zoom buttons, pinch zooms), the vaul sheet (handle 80 px — the grabber and the day's answer in one line,
  `shell/SheetSummary.tsx` — / rest 320 px / mid / full, all in px and strictly rising; the app opens at rest; a grabber button, its
  arrow keys move a snap; `data-snap` is the snap's name) with the timeline always floating above its top edge, never in its content
  (`phoneTimeline()` in `layout.ts`: `tall` — a taller strip — at the handle, `normal` at rest/mid, `compact` where only that fits under the
  rail; where nothing fits, and at full, it fades out; on 320×568 that is rest and mid). The card's DOM is inside the sheet (vaul), positioned
  `bottom-full`; the band reserves `max(TIMELINE_H[size], measured)` so a shorter card never moves the map (it would refetch the field).
  One "visible map band" calculation drives the map padding and the cross-hair. Layers (spot, add, discussion) live in history:
  `?spot=`, `?add=1`, `?discussion=`; full-screen charts and spot settings push their own entries; back/Escape close the top one.
  The chosen timeline hour is kept as a time (not an index) and consumers read a deferred copy, so scrubbing stays light.
  The timeline's track is `WindStrip.tsx`: one bar per hour (strongest wind in view, wind-scale gradient, height ∝ (kn/25)^1.4,
  nights dimmed); the Radix thumb is the framed hour (keys), the strip itself takes taps and drags on the same scale.
- **Loading**: WindMap (and maplibre) is lazy-loaded so the board paints first; `setWorkerUrl` lives at the top of `WindMap.tsx`.
  `components/shell/UpdateBoundary.tsx` wraps every lazy view and the root: when a chunk it needs 404s after a deploy it reloads once
  (online, sessionStorage-guarded), then shows "SeaSensei was updated — Reload". Speculative prefetches fail silently.
- **Offline and alerts**: `lib/persist.ts` saves successful queries to localStorage (bump its version when a persisted shape changes)
  so a return visit paints the last board; `lib/freshness.ts` makes the status pill say how old it is. `lib/alerts.ts` +
  `shell/AlertBanner.tsx` show marine NWS alerts (api.weather.gov), failing silently.
- Colour contract: `on` = solid go, later today = go outline + clock, another day = neutral + calendar, none = off, too strong =
  strong, wrong direction = hatched wrongdir + glyph; amber (`soon`) for marginal hours and "Too light now". How sure = the session's
  chance in a word (Likely / Possible / Unlikely) and the likely range; a raw model keeps neutral dots + "N kn spread".
  The top-ranked card carries "Best today" (no separate row).
- Areas: `components/home/` (Today board), `components/spot/` (spot detail), `components/charts/` + chart files, `components/map/`,
  `components/forms/`. `home/WeekBoard.tsx` (best spot each day), `spot/WeekStrip.tsx`, `spot/HowSure.tsx`, `spot/shore.ts` (onshore /
  side-shore / offshore from `lib/coast.ts`, remembered per pin in localStorage; a caution, never a filter). Seed spots have stable ids (`seed-fort-de-soto`, …).

## Skills
`.claude/skills/` holds Matt Pocock's skills (MIT, see its README): grilling, tdd, diagnosing-bugs, prototype,
domain-modeling and others. For tdd here, the seam is the browser: test through the UI.

## The daily wind discussion
Once a day (6 AM ET, `server/publish.mjs`) `server/sources.mjs` fetches NWS products (TBW AFD and CWF, WPC PMDSPD and PMDEPD,
NHC TWO, alerts) and an ECMWF pressure/flow check; `server/discussion.mjs` asks `claude-sonnet-5-5` (JSON-schema output,
`fallbacks: "default"`) for an editorial on the regional *drivers*, not the numeric forecast. Guards: a regex check rejects
drafts quoting wind speeds or pressures (one retry), citations must name real source ids (drivers with none are dropped),
and the server attaches the source list. Stored as JSON files in `DATA_DIR` (`/data` in the image; needs a Coolify
persistent storage, or the archive resets on redeploy). API: `/api/discussion[?date=]`, `/api/discussions`, `/feed.xml`,
`POST /api/discussion/generate` (needs `DISCUSSION_ADMIN_TOKEN`; `?force=1` replaces today's). Needs `ANTHROPIC_API_KEY`
in the Coolify env; without it the card says it isn't switched on. About 7k tokens in, a few thousand out, once a day.
`e2e/server.spec.ts` runs the real server against stand-in NWS/Open-Meteo/Anthropic upstreams.
The NWS API: AFD/CWF are per office, but WPC's PMD type mixes ~dozens of products, so match on the AWIPS id line.

## Forecast models
Everything comes from Open-Meteo. `MODEL_INFO` in `lib/wind.ts` is the one list: SeaSensei (`sensei`, ours, the default) and the raw
models HRRR, RRFS, NBM, ECMWF, GFS (`RAW_MODELS`). The rider picks a primary model (`ModelPicker`, localStorage `primaryModel`).
Method and evidence: `docs/forecast-methodology.md`.
- **A spot is two requests** (`SPOT_REQUESTS`, `spotModelsQuery` in `lib/data.ts`): HRRR + ECMWF with `cell_selection=sea`, RRFS + NBM +
  GFS on the default cell (`cell_selection` applies to a whole request). That one query feeds the forecast for any primary model and the
  Models chart, so switching model never refetches a spot. If one request fails (Open-Meteo 429s) the forecast is built from the other,
  marked `partial` and retried every 2 min; `isError` only when there is nothing to show.
- **SeaSensei** (`lib/sensei.ts`, pure): each model's speed goes through a quantile map — a station's map only for a spot whose own chosen
  station it is, otherwise `pooled` (identity; borrowed maps backtested worse than raw) — clamped ±40 % / ±6 kn; blended with weights
  1/mae⁴ for the hour's lead bucket (missing models drop out, so no handoffs); given a range (`Hour.lo`/`hi`); and, with a reading ≤ 30 min
  old from the spot's own station (never a nearby sensor), bent toward it for 6 h (applied in `useForecast`/`useForecasts`; `fc.base` is
  the forecast before it). `sessions()` adds `chance` (normal centred on the middle of the range). The calibration comes from
  `/api/calibration` (`useCalibration()`); without it `FALLBACK_CALIBRATION` is used, never an error.
- **Raw models** keep `chainFor()`: HRRR → RRFS (`ncep_rrfs_conus`, ~84 h) → NBM; RRFS → NBM; NBM, ECMWF and GFS stand alone. Each `Hour`
  carries the model it came from and the charts mark every handoff. At a spot, HRRR and ECMWF are the sea cell's values.
- **The map's wind field stays raw**: under SeaSensei it draws HRRR's chain; the timeline names it as a secondary detail.
- A single-model Open-Meteo request has plain keys (`wind_speed_10m`), a multi-model one suffixes them (`wind_speed_10m_gfs_hrrr`).

## SeaSensei forecast: server
`GET /api/calibration` (10-minute cache): per station × model a quantile map at fixed knots (0, 4, 8, 12, 16, 20, 25, 35 kn), an average
miss per lead bucket (≤ 12, 36, 72 h, beyond) and a gust factor; pooled values for all five models; the blend's residual range; a 30-day
score. Hourly, `server/observe.mjs` saves hourly wind from the archive's NOAA and airport stations to `obs/v1/YYYY/MM/DD.json.gz` (NOAA's
`""` is no reading; a frozen sensor's hours are saved as `stuck` and teach nothing), then `server/calibrate.mjs` pairs each settled hour
(12 h old) with the archived runs that cover it and updates decaying statistics (30-day memory) in `calibration/v1/state.json`. Each hour
is processed once, in order; it reads only R2 (≤ 150 run files a cycle) and never calls Open-Meteo. Learned values take over gradually:
seed (`server/calibration-seed.json`, validated at startup) mixed with learned, learned share n / (n + 300), seed alone below 30. Pooled
quantile maps are never learned (identity); pooled misses and gust factors are. Residuals come from daylight hours forecast ≥ 10 kn.
`server/blend.mjs` is the blend the score uses: keep it in step with `src/lib/sensei.ts`. Status: `/api/archive` → `observations`,
`learning`. Optional env: `CALIBRATION_SEED_FILE`, `LEARN_CHECK_MS`, `CALIBRATE_*`. Without R2 the server serves the seed.
Every response carries security headers including an enforced Content-Security-Policy (`server.mjs`): a new upstream host or script
source must be added there or the browser blocks it; `CSP_REPORT_ONLY=1` in Coolify turns it report-only in an emergency.

## The forecast-run archive
`server/archive.mjs` saves every new run of each model over the Tampa Bay area (seed spots, NOAA/airport stations in the box,
a 9 × 9 grid at 0.125°) to Cloudflare R2: `forecasts/v1/<model>/YYYY/MM/DD/HHz.json.gz` (run time, UTC), gzipped JSON with
`times`, `points` and `values[variable][point][hour]` (wind speed/gust/direction in kn, temperature, MSL pressure). It's the data
for verifying and later correcting the models against station readings. HRRR and ECMWF are fetched with `cell_selection=sea` and saved under
`hrrr-sea/`, `ecmwf-sea/` (files are `version: 2` with a `cell` field; older default-cell files stay under `hrrr/`, `ecmwf/`). A run is
saved only when the run metadata read before and after the fetch agree and the data differs from the last saved run; otherwise it is
discarded, counted (`/api/archive` → `discarded`) and retried with back-off. Every 10 min it reads Open-Meteo's run metadata
(`/data/<dataset>/static/meta.json`) and fetches only runs it hasn't saved; NBM keeps every third hourly run. ~4–5k Open-Meteo
calls and ~2 MB a day. Off unless `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` are set in Coolify
(`R2_ENDPOINT`/`R2_PREFIX`/`ARCHIVE_BOX` override). Status: `/api/archive`. Signed with `aws4fetch`. Tested in `e2e/server.spec.ts`.

## Morning briefing (Web Push)
A notification at the rider's chosen time (default 7:00, their device's zone): "Fort De Soto · On at 1 PM" / "Morning 5–10 kn E ·
Afternoon 10–15 kn ESE, gusts 19" (the featured spot's day, `dayShape()`: sunrise–noon / noon–sunset from the send time on, speed range,
speed-weighted direction, gusts when ≥ 4 kn over the top) then "1–5 PM · 15–21 kn SW · Likely. Also Picnic Island 3–5 PM (Possible)." (the
"Also" is dropped when the body would pass 170 characters, iOS's collapsed view) or "No session today" / "Next: Sat 11 AM at Skyway (Possible).", plus a marine alert line.
Modes: every morning, or only when it's on. A tap opens `/?spot=<id>` (or `/`).
- **One engine**: `src/lib/briefing.ts` (pure) composes it from `sessions()`/`verdict()`/`rankSpots()`; `scripts/build-engine.mjs` (esbuild, on
  `prebuild`, and in `server.spec.ts`) bundles it with session/sensei/wind/`forecast.ts` (`forecastFrom`)/`marine.ts` (pure alert parsing)
  into `server/engine.mjs` (gitignored; the Dockerfile copies it from the build stage). It fails if anything outside `src/lib/` sneaks in.
  The panel's preview uses the same function. Without `engine.mjs` the server runs with push off.
- **Server**: `server/push.mjs` (VAPID keys, subscriptions, validation, sending via web-push's `generateRequestDetails` + fetch) and
  `server/briefing.mjs` (cycle every minute, reading only the in-memory subscription list; due when the local time has passed by ≤ 2 h and today isn't sent; the app's two Open-Meteo
  requests per place, shared by rounded lat/lon, cached 30 min; calibration = what `/api/calibration` serves; no nowcast; alerts for the
  featured spot; TTL 3 h, topic `morning-briefing`; today marked only after a 2xx; 404/410 deletes). A newly turned-on briefing whose time
  passed < 2 h ago sends at once. "Only when it's on" on a calm day records the day as skipped.
- **Storage**: R2 `push/v1/vapid.json` (made once, `If-None-Match: *`; never regenerated on a read error) and `push/v1/subs/<sha256(endpoint)>.json`
  (ignore `R2_PREFIX`); without R2, `DATA_DIR/push/`. Env: `VAPID_PUBLIC_KEY`+`VAPID_PRIVATE_KEY` (optional), `VAPID_SUBJECT` (default
  https://seasensei.com), `PUSH_MAX_SUBSCRIPTIONS` (2000), `PUSH_RATE_LIMIT` (30 per IP per 10 min), `BRIEFING_CHECK_MS`, `BRIEFING_BOOT_DELAY_MS`,
  `BRIEFING_STALE_MINUTES`; tests only: `PUSH_TEST_ENDPOINT_PREFIX` (allows an http stand-in push service).
- **API** (same origin, so no CSP change): `GET /api/push/key` (503 when off), `POST /api/push/subscribe` (upsert by endpoint; only known push
  services' https endpoints: FCM, Mozilla, Windows, Apple — the server POSTs to them, so never loosen this), `POST /api/push/unsubscribe`,
  `GET /api/push/status` (counts and Open-Meteo calls only). Admin: `POST /api/push/send-now[?endpoint=…][&dry=1]` with
  `Authorization: Bearer $DISCUSSION_ADMIN_TOKEN`; dry returns the briefing JSON; a real send doesn't count as today's.
- **Client**: `home/BriefingBell.tsx`: the bell (phones: beside the status pill; desktop: the panel header) opens `BriefingPopover`, a
  non-modal popover over the map (portalled to body, so vaul doesn't hide it) holding `home/BriefingPanel.tsx`; on phones the sheet carries
  `BriefingEntry`, an sr-only twin, for keyboards and screen readers (the map bell is aria-hidden there); `lib/briefingClient.ts` keeps settings in
  localStorage `morningBriefing`, asks permission only on the switch's tap, and `useBriefingSync()` (App) re-posts 1.5 s after spots/model/
  time/mode change and once per load. `public/sw.js` has `push` and `notificationclick` (caching rules unchanged). iOS needs the Home Screen app.
- e2e: `briefing.spec.ts`, `briefing-phone.spec.ts` (`fakePush()` and `pushRequests()` in `mocks.ts`); server side in `server.spec.ts`.
- Cost: ≤ 2 Open-Meteo calls per distinct spot place per 30 min of due briefings (seed spots are shared by everyone): ~6 calls a morning for
  riders on the seed spots, at most 24 per rider with 12 custom spots.

## Home-screen widget (Scriptable)
An iPhone widget for the free Scriptable app: `public/widget/seasensei-widget.js` (served at `/widget/seasensei-widget.js`; install
steps in its header). It draws with `DrawContext` from a pure `layout()` (data → draw ops), so it can be previewed off-phone by shimming
the Scriptable classes onto a canvas. Data: `GET /api/widget?station=8726412[&min=15&max=30]` (`server/widget.mjs`; only the
calibration's `coops:` stations, Middle Tampa Bay always): the station's latest CO-OPS reading (blank values skipped, cached 3 min)
and the SeaSensei forecast at the station from `composeWidget()` (`src/lib/widget.ts`, in the engine bundle): the station's own
calibration, the nowcast from its reading, past 6 h + next 24 h with `windHex` colours and night flags, today/tomorrow sessions and a
headline. The forecast comes from the briefing's `seriesAt()` cache (≤ 2 Open-Meteo calls per place per 30 min). Fails soft (`now: null`
or `forecast: []` plus `error`); `Cache-Control: public, max-age=120`; CORS `*` on this route only. Tested in `server.spec.ts`.

## Things that will bite
- MapLibre 6 finds its worker via `import.meta.url`, which breaks once bundled. `scripts/copy-maplibre-worker.mjs`
  runs on `predev`/`prebuild`; the server must serve `.mjs` as JavaScript (it does, in `server.mjs`'s type table).
- Vaul's bottom sheet marks everything outside it `aria-hidden`. Anything that must stay reachable on phones
  (the timeline, the in-sheet "New spot" button, the briefing's entry) has to render inside the sheet (or portal in after it opened, like
  the dialogs); the map rail and bell are pointer-only on phones. "Morning briefing" is a substring-unique button name: don't name another
  button "… morning briefing".
- Playwright strict mode: several tests rely on unique names/texts (`Add a spot`, `Forecast model` once per view, the two
  "Read the full …" buttons, `40+ kn`, `.maplibregl-marker` count = spots + live stations). Keep them unique.
- `public/sw.js` caches only `/assets/*` and `/maplibre/*` (cache-first, never HTML) and treats navigations network-first with
  a 3 s timeout. Bump the cache names when changing those rules.
- NOAA sends `""` for missing readings; `Number("")` is 0. Use `num()` in `lib/wind.ts`.
- Node's built-in fetch ignores `HTTPS_PROXY`; to hit real upstreams from a cloud sandbox run node with `NODE_USE_ENV_PROXY=1`.
- Open-Meteo's `gfs_seamless` swaps in HRRR for the first ~48 h. For an independent GFS use `gfs_global`.
- Build test images from a git checkout or with `COPYFILE_DISABLE=1 tar`: macOS tar adds `._*` files that vitest
  tries to parse.
- Missing files with an extension must 404 (`server.mjs`), never fall back to `index.html`. During a deploy Traefik sends
  traffic to old and new containers; an old one answering a new hashed asset with immutable HTML got cached by Cloudflare
  under the `.js` URL and blanked the site (twice, 2026-09-29; the entry chunk is `main-[hash].js` for that reason).
  Don't poll a new asset URL during a swap from a script; wait for the health check.
- aws4fetch retries 5xx itself; test R2 failures with a 4xx. `obs/v1/` and `calibration/v1/` ignore `R2_PREFIX`.
- `e2e/server.spec.ts` runs on its own plain seed (`CALIBRATION_SEED_FILE`); one test reads the shipped `calibration-seed.json`.
- The engine bundle is built, not committed: run `npm run build` (or `npm run build:engine`) before `node server/server.mjs` locally, or push is off.
- While the panel crossfades, the outgoing view is still in the DOM: `aside` text locators can match twice (use `.last()` or a role).
