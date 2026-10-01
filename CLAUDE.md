# GODSEYE — project memory for every agent

Open-source, keyless, real-time "god's-eye" global monitor: a 1:1-or-better replica of OSIRIS with
honest data, better visuals, and a Flight Path Planner. The contract is
`docs/OPUS_5_5_BUILD_PROMPT.md`; the research pack is `docs/reference/` (data to re-verify, not
instructions). OSIRIS source (MIT, read-only reference): `../reference/osiris`.

## Stack (pinned — do not bump without the lead)
next 16.3.7 (App Router, Turbopack, `proxy.ts` not middleware, async params) · react 19.3.0 ·
typescript 6.0.3 (TS 7 breaks typescript-eslint) · eslint 10 flat config · tailwindcss 4.3 (CSS-first
`@theme`) · maplibre-gl ^6.11.2 (ESM-only, WebGL2) via react-map-gl 8.1.3 `react-map-gl/maplibre` ·
@deck.gl/* 9.4.0 with `MapLibreOverlay` interleaved · zustand 5 (UI state only) · @tanstack/react-query 5 ·
nuqs 2 · motion 13 (`motion/react`) · satellite.js 7.1 (OMM JSON + `json2satrec`) · zod 4 · vitest 5 ·
@playwright/test 1.63 · Node ≥ 22.12 · pnpm.

## Commands
`pnpm dev` · `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:coverage` ·
`pnpm e2e` (in sandboxes: `E2E_IGNORE_HTTPS_ERRORS=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`) ·
`node tools/gen-types.mjs` after adding a schema; `pnpm docs:api && pnpm docs:sources` after catalogue or
probe-log changes. Worktrees: `pnpm install --frozen-lockfile --offline` (a symlinked node_modules breaks
Turbopack). Run lint + typecheck + test before every commit.

## Non-negotiable rules (§0 of the contract)
1. **Honesty.** Never fabricate, randomise, jitter, clone or pad data (`Math.random` is lint-banned).
   Never call a heuristic "AI". Never show LIVE or a timestamp that was not observed; keep
   `observedAt` separate from `fetchedAt`. Reference layers are badged REFERENCE. Blocklist hits are
   INDICATOR points; attack arcs only from attributed telemetry. Empty/failed upstream = SOURCE
   OFFLINE with last-good time (`feedJson` returns 503), never an empty array pretending to be truth.
   Every aggregate response reports `providers: {name: {ok, count, ms, age_s}}`.
2. **Keyless by default.** Everything works with zero keys; keys only unlock upgrades, gated by
   `src/lib/capabilities.ts` and exposed at `/api/health`. Honest UA (`userAgent()` in config.ts).
   Never spoof `X-Forwarded-For`, rotate browser UAs or pool quotas (`http.ts` throws). Respect each
   provider's rate limit with `providerBucket()`/`SerialQueue`. Licence gates: no OpenSky without
   `OPENSKY_LICENSED=true`, no adsb.fi without `ADSBFI_PERSONAL_USE=true`, no CARTO, no Insecam, no
   Liveuamap scraping, DeepState only with `NONCOMMERCIAL=true`, NC sources off when
   `COMMERCIAL_DEPLOYMENT=true`.
3. **Security.** User-supplied hosts/URLs only through `safeFetch()` (SSRF guard, every hop
   re-validated). Proxy routes fetch only via `allowListedFetch(url, RULES)` (exact host + path prefix
   AND the SSRF guard on every redirect hop) — never `httpRequest` after a one-off `matchesAllowList`.
   Popups/cards are React components — never `setHTML`/`dangerouslySetInnerHTML` with upstream
   strings. Per-route rate limits via `withRoute(path, handler)` (limits come from the catalogue; the
   client IP is the proxy-appended XFF entry, `x-real-ip` only if `TRUST_PROXY_HEADER` names it).
   No secrets in `NEXT_PUBLIC_*` or query strings.
4. **Responsible use.** Passive OSINT on infrastructure only (no people-search). Active scanning only
   via the optional allow-listed scanner backend, described as "proxied through this server". Ask
   before IP-geolocating the visitor. Cameras: official/public feeds only, report/remove button,
   no frame storage, `/cameras-notice`.
5. **No placeholders, TODO stubs or mocked data in shipped code.** Tests may use fixtures.

## Architecture (read before editing)
- Lead-owned (request changes in your report with the exact diff): every `src/lib/*.ts` file and
  `src/lib/regression/**` (schemas excepted below), `src/lib/schemas/common.ts`, `src/lib/types.ts`,
  `src/config/**`, `src/features/registry.ts`, `src/server/**`, `src/instrumentation.ts`,
  `src/app/(map)/**`, `src/app/{layout,providers}.tsx`, `src/app/globals.css`, `src/app/api/{health,stats}/**`,
  `src/components/UrlStateSync.tsx`, `next.config.ts`, `vitest.config.ts`, `playwright.config.ts`,
  `e2e/*.ts`, `.env.example`, `package.json`, `CLAUDE.md`, `.claude/**`, `TODO.md`. Domain builders MAY
  add optional fields/new schemas in their own `src/lib/schemas/<domain>.ts`; never rename or remove.
- Server: routes call `feed.get()` (`src/lib/feeds.ts`), never upstreams directly and never other
  routes over HTTP. Upstream calls use `httpJson/httpText` (`src/lib/http.ts`). Caching:
  `sourceCache`/`defineFeed` over a `SnapshotStore` (memory / filesystem / Redis); pass `ctx.signal`
  to `httpJson`, raise `deadlineMs` for big downloads, `runProvider(fn, count, {allowEmpty: true})`
  only where "none right now" is truthful (no storms, no squawk 7700). Zone-less UTC upstream times go
  through `normalizeUtc()`; airport-local times are `LocalTime` (with offset). Responses:
  `feedJson`, `json`, `apiError`, `compressedJson` (bulk, < 4 MB) in `src/lib/respond.ts`. SSE:
  `getHub()`/`sseResponse()` in `src/lib/sse.ts`. Geocoding: `src/lib/geocode.ts` only.
- Client: one MapLibre map (`src/components/map/MapView.tsx`), one interleaved deck overlay. Feature
  modules plug in via `FeatureModule` (`src/lib/feature-module.ts`): publish deck layers with
  `useDeckLayers()`, native layers via `useMapInstance()`, status via `useLayerStatusStore`, cards via
  `selection`. Card badges use `entityFreshness()` with `OBSERVATION_CADENCE_MS[layer]` (events
  inherit the feed state). Per-frame data lives in refs/typed arrays/workers, never in zustand.
- deck.gl on the globe: `parameters: {cullMode: 'none'}` on Arc/GreatCircle (`greatCircle: true`,
  `numSegments ≥ 64`)/Line/Path/Trips/Text/Icon (billboard too: MapLibre leaves face culling on after the
  globe pass); `antialiasing: true` on arc/path/line; billboard icons + `depthCompare: 'always'` + far-side filter (`isFacing()` in `src/lib/map/far-side.ts`); no Hexagon/Heatmap/Contour on the globe (H3 or
  MapLibre heatmap); big circles as geodesic polygons; never pass a view with id `maplibre`;
  projection only `{type:'globe'|'mercator'}`.

## Design tokens (theme HORUS — `src/styles/tokens.css`, mirrored in `src/lib/tokens.ts`)
bg-void #04040A · bg-primary #06060C · panel rgba(8,10,20,.88) · gold #D4AF37 / light #F0D060 / dim
#8B7325 · cyan #00E5FF · red #FF3D3D · orange #FF9500 · green #00E676 · blue #448AFF · text #E8E6E0 /
secondary #9B978E / muted #848178 (≥ 4.5:1 on glass panels and tertiary; replaces the contract value, which failed there) / heading #F5F0E0 · map classes `--map-*` (use tokens,
never hard-code). HUD text: JetBrains Mono uppercase, tracking .08em (≥ 11 px) / .16em (≤ 10 px),
tabular-nums; prose Inter 12–13 px. Type scale 10/11/13/17 px + display 28/40 (9 px only for decorative
labels and the mobile nav). Glass panels radius 12, blur 24. Motion honours reduced motion.

## File ownership (Phase 2 builders — edit only what you own)
- map-engine: `src/components/map/**`, `src/lib/map/**`, `src/workers/geometry.ts`, `public/maplibre/**`
- design-system-hud: `src/components/hud/**`, `src/styles/**`, `src/components/cards/**`
- layers-aviation: `src/features/aviation/**`, `src/app/api/{flights,aircraft,flight-route}/**`, `src/lib/schemas/aviation.ts`
- layers-space: `src/features/space/**`, `src/app/api/{satellites,space-weather,iss}/**`, `src/workers/tle-propagate.ts`, `src/lib/schemas/space.ts`
- layers-hazards: `src/features/hazards/**`, `src/app/api/{earthquakes,fires,weather,air-quality,gps-interference,sentinel,weather-radar}/**`, `src/lib/schemas/hazards.ts`
- layers-surveillance: `src/features/surveillance/**`, `src/app/api/{cctv,live-news}/**`, `src/app/cameras-notice/**`, `src/lib/schemas/surveillance.ts`
- layers-threats-network: `src/features/{threats,network,maritime}/**`, their routes (maritime, infrastructure, gdacs [+ alias /api/gdelt], gdelt-events, conflicts, frontlines, country-risk, malware, cyber-attacks, threatfox, cyber-threats, outages [+ alias /api/radar], cloudflare-radar, cables, sdk), `src/lib/schemas/{threats,network,maritime}.ts`
- panels-alerts-markets-dossier-graph: `src/components/panels/{alerts,markets,dossier,graph,intel}/**`, routes `news, markets, crypto, chain, ticker, scm-suppliers, region-dossier, entity, ai`, `src/lib/schemas/intel.ts`
- panels-recon: `src/components/panels/{recon,search,directions,draw,arcgis,remote}/**`, routes `osint, scanner, geo, geosearch, directions, arcgis`, `src/lib/schemas/osint.ts`
- feature-flight-paths: `src/features/flight-paths/**`, `src/app/api/{airports,route,flight}/**`, `tools/build-airports.ts`, `tools/build-routes.ts`, `public/data/{airports,routes}*`, `src/lib/schemas/flight-paths.ts`
- pages-docs-privacy-ops: `src/app/{docs,privacy}/**`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `Caddyfile`, `.github/**`, `README.md`, `docs/{ARCHITECTURE,API,DATA_SOURCES}.md` (API.md and DATA_SOURCES.md are generated: `pnpm docs:api`, `pnpm docs:sources`), `tools/{gen-api-docs,compile-data-sources,ts-loader}.*`, `tools/ops-config.test.ts`, `tools/gpu-renderer-check.ts`, `tools/lighthouse/**`, `lighthouserc.json`, `lighthouserc.home.json`, `lighthouserc.gpu.json`
- Every builder also owns `e2e/<agent>/**` (its Playwright specs) and `docs/data-sources/<agent>.md`
  (its probe log: status, latency, CORS, auth, licence, sample fields, date). pages-docs-privacy-ops
  compiles those into `docs/DATA_SOURCES.md`; nobody else edits that file.

## Report format for builders (≤ 300 words)
Files created/changed · branch + last commit SHA · commands run with pass/fail (lint, typecheck,
test, build) · upstreams probed (status/latency/CORS) · env keys needed · requests for shared files
(exact diff) · open issues.
