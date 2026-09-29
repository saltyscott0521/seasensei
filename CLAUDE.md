# SeaSensei

Live wind map and forecasts for kite spots. `web/` is the app (Vite + React 19 + TypeScript) plus a small Node
server (`web/server/`) that serves it and the LLM outlook endpoint;
`ios/` is an older native SwiftUI version that isn't deployed. Live at https://seasensei.com.

## Working here
- Push straight to `main` (no PRs). Coolify redeploys automatically in about 70 seconds.
- `cd web && npm run dev` · `npm run build` · `npm test` (unit) · `npm run test:e2e` (Playwright).
- Outlook locally: `cd web/server && npm ci && ANTHROPIC_API_KEY=… PORT=8787 node server.mjs` (Vite proxies `/api` to it).
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

## The AI outlook (`POST /api/outlook`)
`web/server/outlook.mjs`: the server fetches HRRR, NBM, ECMWF and GFS for the posted spots itself (never trusts
forecast numbers from the browser), then asks Claude (`claude-opus-5-5`, medium effort, JSON-schema output,
`fallbacks: "default"`) for a 5-day outlook. Needs `ANTHROPIC_API_KEY` in the Coolify env; without it the endpoint
returns 503 `not_configured` and the card says so. Spend guards: cached per spot set per 3-hour model cycle,
concurrent identical requests share one call, `OUTLOOK_DAILY_CAP` (default 40) and `OUTLOOK_PER_IP_CAP` (default 8)
count fresh generations only. Roughly 1.5–3k input tokens per request.

## Things that will bite
- MapLibre 6 finds its worker via `import.meta.url`, which breaks once bundled. `scripts/copy-maplibre-worker.mjs`
  runs on `predev`/`prebuild`; the server must serve `.mjs` as JavaScript (it does, in `server.mjs`'s type table).
- Vaul's bottom sheet marks everything outside it `aria-hidden`. Anything that must stay reachable on phones
  (the timeline) has to render inside the sheet.
- NOAA sends `""` for missing readings; `Number("")` is 0. Use `num()` in `lib/wind.ts`.
- Open-Meteo's `gfs_seamless` swaps in HRRR for the first ~48 h. For an independent GFS use `gfs_global`.
- Build test images from a git checkout or with `COPYFILE_DISABLE=1 tar`: macOS tar adds `._*` files that vitest
  tries to parse.
