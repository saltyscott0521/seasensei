# SeaSensei

Live wind map and forecasts for kite spots. `web/` is the app (Vite + React 19 + TypeScript) plus a small Node
server (`web/server/`) that serves it and writes the daily wind discussion;
`ios/` is an older native SwiftUI version that isn't deployed. Live at https://seasensei.com.

## Working here
- Push straight to `main` (no PRs). Coolify redeploys automatically in about 70 seconds.
- `cd web && npm run dev` · `npm run build` · `npm test` (unit) · `npm run test:e2e` (Playwright).
- Discussion locally: `cd web/server && npm ci && ANTHROPIC_API_KEY=… PORT=8787 node server.mjs` (Vite proxies `/api` to it). `node generate.mjs --dry` writes one without saving.
- Deploy notes and infra: `~/Documents/Claude/docs/infrastructure.md` (Hetzner box, Coolify, Cloudflare tunnel).

## Testing: end to end first
Prefer Playwright e2e in `web/e2e/` that drive the real app the way a person does. All network is mocked
(`e2e/mocks.ts`) so runs are deterministic; the coastline test uses real map tiles saved in `e2e/fixtures/`.
**Don't add piles of unit tests.** `src/lib/wind.test.ts` holds only four tests for logic that actually broke
(blank NOAA value read as 0 kn, direction arcs across north, direction averaging across north, HRRR→NBM handoff).
Add a unit test only when a bug like that bites; otherwise extend an e2e flow.

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

## Things that will bite
- MapLibre 6 finds its worker via `import.meta.url`, which breaks once bundled. `scripts/copy-maplibre-worker.mjs`
  runs on `predev`/`prebuild`; the server must serve `.mjs` as JavaScript (it does, in `server.mjs`'s type table).
- Vaul's bottom sheet marks everything outside it `aria-hidden`. Anything that must stay reachable on phones
  (the timeline) has to render inside the sheet.
- NOAA sends `""` for missing readings; `Number("")` is 0. Use `num()` in `lib/wind.ts`.
- Open-Meteo's `gfs_seamless` swaps in HRRR for the first ~48 h. For an independent GFS use `gfs_global`.
- Build test images from a git checkout or with `COPYFILE_DISABLE=1 tar`: macOS tar adds `._*` files that vitest
  tries to parse.
- Missing files with an extension must 404 (`server.mjs`), never fall back to `index.html`. During a deploy Traefik sends
  traffic to old and new containers; an old one answering a new hashed asset with immutable HTML got cached by Cloudflare
  under the `.js` URL and blanked the site (twice, 2026-09-29; the entry chunk is `main-[hash].js` for that reason).
  Don't poll a new asset URL during a swap from a script; wait for the health check.
