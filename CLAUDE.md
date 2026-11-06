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
Add a unit test only when a bug like that bites; otherwise extend an e2e flow. Specs are split by area (`app`, `shell`, `home`,
`spot`, `charts`, `map`, `forms`, `sessions`); phone-only specs are named `*-phone.spec.ts` so the phone project picks them up.
Software WebGL makes runs slow: use `--trace off --workers=2`. Don't edit `src/` while a run is going (Vite reloads the page).

## How the UI is built
- **Design system** (`src/styles/theme.css`, `src/components/ui/`): "night sea" tokens as Tailwind 4 `@theme static` utilities —
  surfaces (`bg-surface-1/2/3`), text (`text-fg`, `-fg-2`, `-fg-3`: the faintest allowed), `accent`, verdict colours
  (`go`, `soon`, `off`, `strong`, `wrongdir`), radii, type sizes (`text-micro` … `text-display`). Colour is data: chrome is neutral;
  only the wind scale, verdicts and the accent carry colour. Use the primitives (Button, IconButton, Chip, Card, Segmented,
  VerdictPill, ConfidenceDots, Ribbon, …) instead of ad-hoc `text-white/NN`. `.num` is Geist with tabular figures (no mono).
- **Motion** (`src/lib/motion.ts`): duration/spring/ease tokens; `<MotionConfig reducedMotion="user">` wraps the app. Animate
  opacity/transform only, never `x` inside a scroll container; charts draw in once; rotations take the shortest path.
- **Session engine** (`src/lib/session.ts`, pure): `sunTimes`, daylight-only `sessions()` (≥ 2 h, with peak/gust/direction),
  `verdict()` (On now / On at 1 PM / Next: Sat 11 AM / No session this week), `rankSpots()`, `confidence()` from model spread,
  copy helpers (`fmtSession`, `fmtHour`, …) in the spot's time zone, and station semantics: `spot.station` is an id, `"none"`
  (forecast only, honoured) or undefined (auto: nearest sensor ≤ 16 km, labelled "Nearby sensor", never "Live").
  `useSpotNow`/`useRankedSpots` (`lib/useSpotNow.ts`) wrap it for components.
- **One clock** (`src/lib/time.tsx`): the timeline's chosen hour is `useAt()` (null = now); map, cards, hero, hour grid and chart
  cursors all follow it.
- **Shell** (`App.tsx`, `components/shell/`, `lib/layout.ts`): desktop = docked glass panel + timeline dock; phones = status pill,
  one control rail (Add a spot, Stations, Find my location — no zoom buttons, pinch zooms), the vaul sheet (rest 320 px / mid / full, all in px and strictly rising,
  a grabber button) with the timeline floating above it (a compact one-line timeline inside the sheet where it can't float).
  One "visible map band" calculation drives the map padding and the cross-hair. Layers (spot, add, discussion) live in history:
  `?spot=`, `?add=1`, `?discussion=`; full-screen charts and spot settings push their own entries; back/Escape close the top one.
  The chosen timeline hour is kept as a time (not an index) and consumers read a deferred copy, so scrubbing stays light.
- **Loading**: WindMap (and maplibre) is lazy-loaded so the board paints first; `setWorkerUrl` lives at the top of `WindMap.tsx`.
  `components/shell/UpdateBoundary.tsx` wraps every lazy view and the root: when a chunk it needs 404s after a deploy it reloads once
  (online, sessionStorage-guarded), then shows "SeaSensei was updated — Reload". Speculative prefetches fail silently.
- Colour contract: `on` = solid go, later today = go outline + clock, another day = neutral + calendar, none = off, too strong =
  strong, wrong direction = hatched wrongdir + glyph; amber (`soon`) only for marginal hours. Confidence = neutral dots + "N kn spread".
  The top-ranked card carries "Best today" (no separate row).
- Areas: `components/home/` (Today board), `components/spot/` (spot detail), `components/charts/` + chart files, `components/map/`,
  `components/forms/`. Seed spots have stable ids (`seed-fort-de-soto`, …).

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
Everything comes from Open-Meteo. `MODEL_INFO` in `lib/wind.ts` is the one list (HRRR, RRFS, NBM, ECMWF, GFS). The rider picks a
primary model (`ModelPicker`, kept in localStorage as `primaryModel`, default HRRR); `chainFor()` fills the hours it lacks:
HRRR → RRFS (`ncep_rrfs_conus`, ~84 h, Open-Meteo updates it every 6 h) → NBM; RRFS → NBM; NBM, ECMWF and GFS stand alone.
Each `Hour` carries the model it came from, and the charts mark every handoff. A single-model Open-Meteo request has plain keys
(`wind_speed_10m`), a multi-model one suffixes them (`wind_speed_10m_gfs_hrrr`); parsers handle both.

## The forecast-run archive
`server/archive.mjs` saves every new run of each model over the Tampa Bay area (seed spots, NOAA/airport stations in the box,
a 9 × 9 grid at 0.125°) to Cloudflare R2: `forecasts/v1/<model>/YYYY/MM/DD/HHz.json.gz` (run time, UTC), gzipped JSON with
`times`, `points` and `values[variable][point][hour]` (wind speed/gust/direction in kn, temperature, MSL pressure). It's the data
for verifying and later correcting the models against station readings. Every 10 min it reads Open-Meteo's run metadata
(`/data/<dataset>/static/meta.json`) and fetches only runs it hasn't saved; NBM keeps every third hourly run. ~4–5k Open-Meteo
calls and ~2 MB a day. Off unless `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` are set in Coolify
(`R2_ENDPOINT`/`R2_PREFIX`/`ARCHIVE_BOX` override). Status: `/api/archive`. Signed with `aws4fetch`. Tested in `e2e/server.spec.ts`.

## Things that will bite
- MapLibre 6 finds its worker via `import.meta.url`, which breaks once bundled. `scripts/copy-maplibre-worker.mjs`
  runs on `predev`/`prebuild`; the server must serve `.mjs` as JavaScript (it does, in `server.mjs`'s type table).
- Vaul's bottom sheet marks everything outside it `aria-hidden`. Anything that must stay reachable on phones
  (the timeline, the in-sheet "New spot" button) has to render inside the sheet; the map rail is pointer-only on phones.
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
