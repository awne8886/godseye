# GODSEYE architecture

GODSEYE is one Next.js 16 application (App Router, React 19, TypeScript strict) that serves a WebGL
globe and a same-origin JSON API over public data sources. The browser talks to this server for every
data feed; it contacts third parties directly only for map tiles, official video embeds and public
camera media (the CSP enforces that). This document describes how the pieces fit, the security model and
the trade-offs we accepted on purpose. The endpoint reference is [API.md](API.md) (also rendered at
`/docs`); sources and licences are in [DATA_SOURCES.md](DATA_SOURCES.md).

```
 browser ──HTTPS──> Caddy (TLS, overwrites X-Forwarded-For) ──> Next.js server (node server.js)
   │                                                              │
   │ tiles / embeds / camera media only (CSP allow-lists)         ├─ route handlers  (src/app/api/**)
   ▼                                                              │     └─ feed.get() / lookup modules, never upstreams directly
 OpenFreeMap · Esri · GIBS · Terrarium · YouTube · DOT media      ├─ feeds + single-writer poller (src/lib/feeds.ts)
                                                                  │     └─ httpJson / httpText (src/lib/http.ts) ──> upstream APIs
                                                                  └─ SnapshotStore: memory | filesystem | Redis (src/lib/cache.ts)
```

## Server

### Feeds and the single writer

A feed (`defineFeed()` in `src/lib/feeds.ts`) is declared once on the server with its TTL, attribution,
data kind (`live`, `reference` or `mixed`) and a `run()` that calls its providers through the HTTP client.
Route handlers only call `feed.get()`: they never fetch an upstream themselves and never call another
route over HTTP. `src/instrumentation.ts` imports every feed (`src/server/feeds.ts`) at boot and starts the
eager ones; other feeds start a background refresh loop on their first read and stop after ten minutes
without readers (`idleStopMs`). There is one loop per process, and when the store is shared (Redis) a
cross-instance lock makes exactly one instance the writer for each upstream, so per-IP quotas
(CelesTrak, Nominatim, adsb.fi) are spent once, not once per instance. `GODSEYE_DISABLE_POLLER=true`
switches the eager start off (tests, static previews).

Every provider run reports `{ok, count, ms, age_s}` (plus `error` or `skipped`), and every aggregate
response carries that `providers` map. A provider whose capability or licence gate is off reports
`skipped: 'not-configured' | 'licence'` instead of disappearing silently.

### SnapshotStore and `sourceCache`

`sourceCache(key, fetcher, opts)` in `src/lib/cache.ts` sits between feeds and upstreams:

- TTL with stale-while-revalidate: stale data is served at once while one refresh runs;
- single-flight per key, plus a lock with an owner token (`SET NX PX`, compare-and-delete release) when
  the store is shared; every fetch gets an `AbortSignal` and a deadline below the lock TTL;
- stale-on-error: a failed refresh keeps the last good snapshot and is not retried for 60 s (only
  `refresh({force: true})` bypasses the back-off);
- an empty result counts as a failed refresh unless the feed declares that empty is truthful;
- conditional GET: the fetcher receives the previous ETag/Last-Modified and may answer 304;
- feed snapshots (`feed:*` keys) are pinned and never LRU-evicted by per-query caches (OSINT lookups,
  geocoding), so visitor traffic cannot erase last-good data;
- an in-memory L1 with an LRU cap in front of the store.

Backends: `MemoryStore` (default), `FileStore` (`SNAPSHOT_DIR`, survives restarts; pinned feed
snapshots and per-query entries live apart, expired and excess per-query files are swept, bounded by
`SNAPSHOT_MAX_FILES` and `SNAPSHOT_MAX_DISK_BYTES`; `MemoryStore` bounds per-query entries by `SNAPSHOT_MEMORY_MAX_BYTES`) and `RedisStore` (`REDIS_URL`; shares snapshots, locks and rate limits across instances).
`SNAPSHOT_STORE=memory|filesystem|redis` forces one. Snapshots are kept for 24 h or 20 × TTL by default, so
a failing source is shown as stale with its last-good time rather than as empty.

### Honest responses

`src/lib/respond.ts` gives every route the same contract:

- `feedJson()` merges `meta` (feed, kind, state, fetchedAt, observedAt, lastGoodAt, stale, TTL) and
  `providers` into the body, sets weak ETags and answers 304. A feed with no data at all returns
  **503 `source_offline`** with `Retry-After: 30` and `no-store`: never an empty array pretending to be
  truth. Stale snapshots get an edge TTL of at most 15 s so a CDN never pins an outage.
- `observedAt` comes from the upstream record and is kept separate from `fetchedAt`; freshness badges
  (`src/lib/freshness.ts`) derive LIVE / age / STALE / OFFLINE / REFERENCE from observation time, never
  show LIVE for a failed or future-dated observation, and label reference layers REFERENCE.
- `compressedJson()` serves bulk payloads pre-serialised and precompressed (brotli, gzip) and refuses
  anything over 4 MB uncompressed.
- `withRoute(path, handler)` applies the per-route rate limit from the catalogue and turns exceptions into
  a uniform `500 internal_error` (details only in the server log).

### Columnar bulk layers

Aircraft, satellites, cameras and fire pixels are served as `{fields, rows}` (`src/lib/columnar.ts`):
each row is a tuple in `fields` order, 40–60 % smaller than arrays of objects and cheap to turn into
deck.gl binary attributes. The flight schema uses compact encodings (seconds, source indexes, 0/1 flags)
so 24 000 aircraft stay under the 4 MB cap.

### Server-Sent Events

Push feeds (malware detections, flight deltas, SDK entities) use one server-side loop per feed pinned on
`globalThis` (`getHub()` in `src/lib/sse.ts`) and fan out to clients with `sseResponse()`: `snapshot` on
connect, batched `detections` / `update` events, `status` with retired ids, and a `heartbeat` every 15 s.
Frames are encoded once per broadcast. A client is limited to 4 concurrent streams per IP; a slow consumer
with more than 2 MB buffered is dropped, and past a process-wide budget (`SSE_MAX_BUFFERED_BYTES`,
256 MB) the clients furthest behind are dropped first; the per-IP slot is released on every exit path. Responses carry
`X-Accel-Buffering: no` for proxies. On hosts with a duration cap the stream closes itself before the
limit (`SSE_MAX_DURATION_MS`, default 280 s on Vercel, unlimited elsewhere) and the browser reconnects.

### Capabilities

`src/lib/capabilities.ts` derives capability flags from environment variables: a capability needs all its
`env` keys set, an optional `flag` equal to `"true"`, and an optional `invertFlag` not equal to `"true"`.
Everything works with zero keys; keys only unlock upgrades, and licence gates (`OPENSKY_LICENSED`,
`ADSBFI_PERSONAL_USE`, `NONCOMMERCIAL`, `COMMERCIAL_DEPLOYMENT`) switch sources on or off.
`GET /api/health` exposes the evaluated flags (never the values), per-feed status and geocoder queue
stats; the UI hides what is off. Client code never reads the environment.

### The endpoint catalogue

`src/lib/api-catalog.ts` lists every endpoint with method, path, parameters, TTL, stream type, response
schema, upstream hosts, whether user input is forwarded, capability, rate limit, aliases and an example.
It is the single inventory that drives:

- `/docs` and `docs/API.md` (`tools/gen-api-docs.ts`; a unit test fails when the file is stale);
- the Privacy page (`upstreamsReceivingUserInput()`);
- `withRoute()` rate limits (a route missing from the catalogue throws in development and tests);
- the route-existence test (`CHECK_CATALOG_COMPLETENESS=1`).

`EXCLUDED_OSIRIS_ROUTES` records the reference project's endpoints deliberately not replicated, with reasons.

`/docs` is a static server component (readable without JavaScript). Endpoint details sit in closed
`<details>` elements inside `content-visibility: auto` cards, so the ~80-card page stays cheap to style
and lay out. One client island (`src/app/docs/interactive.tsx`) adds reading progress, scroll-spy on the
section nav, a ⌘K / Ctrl-K / `/` endpoint palette (shortcuts from `src/lib/keyboard.ts`) and the
"Send request" console: GET only, URLs built by `buildTryUrl()` from the catalogue path with
percent-encoded values and re-checked to stay on the page's origin under `/api/`, same-origin
credentials, status + headers + body (event streams: the first three events, then the console closes
the stream).

### Upstream etiquette

All upstream traffic goes through `httpRequest()` / `httpJson()` / `httpText()` in `src/lib/http.ts`:
deadlines, retries with back-off for idempotent requests (honouring `Retry-After`), gzip/deflate/brotli
decoding with a body-size cap, conditional GET, and an identifying User-Agent
`GODSEYE/<version> (+<repo>; contact <GODSEYE_CONTACT>)`. The client throws if code tries to set a
browser-like User-Agent or any forwarding header (`X-Forwarded-For`, `X-Real-IP`, `Forwarded`, `Via`,
`Host`), so the server can neither spoof visitors nor pool quotas. Each provider's documented rate is held
by `providerBucket(name, ratePerSec)` or a `SerialQueue` (Nominatim: one request per second, at most 40
queued, 30-day cache, never used for autocomplete).

## Client

### One map, one overlay

`src/components/map/MapView.tsx` owns the single MapLibre GL 6 map (globe or mercator, the only two
projections deck.gl accepts). deck.gl 9.4 runs as one interleaved `MapLibreOverlay` whose layers are
inserted beneath the basemap labels. Theme changes update paint properties in place; the map is never
remounted.

**Admission scheduler.** GPU-blocking start-up work (feature mounts, the deck device, the first instance
of each deck layer class, the first draw of each MapLibre layer type) is queued in one admission scheduler
(`src/lib/map/admission-scheduler.ts`, with `deck-admission.ts`, `native-admission.ts` and
`use-admission.ts`): one unit per idle, GPU-drained slot, with a `maxWaitMs` progress guarantee. While
units are pending the HUD shows fetched counts as `N RECEIVED + DRAWING`, never as drawn.

**Fonts.** Inter, JetBrains Mono and Space Grotesk (SIL OFL 1.1) are bundled from `@fontsource` packages
through `next/font/local` in `src/app/layout.tsx`; neither the build nor the browser contacts a font CDN.

**MapLibre worker recipe.** MapLibre 6 ships an ES-module worker that imports a sibling shared module,
and Turbopack neither emits that sibling nor leaves `new URL(x, import.meta.url)` alone. So
`tools/prepare-map-worker.mjs` (run by `predev` and `prebuild`) copies `maplibre-gl-worker.mjs` and
`maplibre-gl-shared.mjs` into `public/maplibre/<version>/` and prunes other versions; the map calls
`setWorkerUrl('/maplibre/' + getVersion() + '/maplibre-gl-worker.mjs')`; a Turbopack loader
(`tools/maplibre-url-loader.cjs`) rewrites MapLibre's runtime `new URL(...)` to `new globalThis.URL(...)`;
and `next.config.ts` serves `/maplibre/:version/*` with `Cache-Control: public, max-age=31536000,
immutable`. This is why the Docker image must be built with `pnpm build` (which runs `prebuild`) and must
copy `public/`.

**Globe workarounds** (deck.gl swaps in its experimental GlobeView on the MapLibre globe):
`parameters: {cullMode: 'none'}` on arc, great-circle (`numSegments ≥ 64`), line, path, trips, text and
icon layers, billboard icons included (MapLibre leaves back-face culling on after drawing the globe, and the
icon quad's winding would cull it); `antialiasing: true` on arcs, paths and lines; aircraft, ships and
satellites as billboard icons with `depthCompare: 'always'` and a far-side filter; no hexagon/heatmap/contour layers on the globe (H3 or MapLibre's
native heatmap instead); large circles as geodesic polygons.

### Feature modules

Features plug into the shell through `FeatureModule` (`src/lib/feature-module.ts`) without touching shared
files. Each owner exports its modules from one entry file; `src/features/registry.ts` concatenates them.
The map host mounts a module's `Layer` component while any of its layers is on. Modules publish deck
layers with `useDeckLayers()`, add native MapLibre layers through `useMapInstance()`, report counts and
freshness through `useLayerStatusStore`, and open entity cards through the selection store
(`src/lib/layer-host.ts`). Heavy panels load with `next/dynamic`.

### State

zustand holds UI state only (open panels, selection, persisted settings); per-frame entity data lives in
refs, typed arrays and Web Workers that post `Float32Array` positions, never in React state. TanStack
Query polls each layer at its registry interval and pauses in background tabs. The camera, layers, theme,
open panel and planned route live in the URL (`nuqs`, `src/lib/url-state.ts`), so every view is shareable.
Preferences persist in `localStorage` (`godseye:settings`, `godseye:theme`), read defensively.

## Security model

| Threat | Control |
|---|---|
| SSRF through user-supplied hosts/URLs (OSINT, ArcGIS import, headers check) | `safeFetch()` / `assertPublicUrl()` in `src/lib/ssrf.ts`: blocks loopback, RFC 1918, CGNAT, link-local, multicast, metadata, reserved and non-canonical IPv4 forms, IPv6 ULA/link-local/NAT64/mapped forms; resolves DNS inside the socket's own lookup (no rebinding window) and re-validates every redirect hop. |
| Open proxies | Proxy routes (camera stills, ArcGIS) fetch only via `allowListedFetch(url, RULES)`: exact host + directory prefix, re-checked with the SSRF guard on every hop. `next/image` follows no redirects and allows exact hosts only. |
| XSS from upstream strings | Popups and cards are React components; no `setHTML` / `dangerouslySetInnerHTML` with upstream text; RSS/Telegram text goes through `toPlainText()`; links are `http(s)` only with `rel="noopener noreferrer"`. |
| Clickjacking, sniffing, downgrade | `src/config/csp.ts`: CSP (`default-src 'self'`, path-scoped tile/media/frame/image hosts, `frame-ancestors 'none'`, `object-src 'none'`, `upgrade-insecure-requests`), HSTS two years with `includeSubDomains`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Permissions-Policy` (geolocation self only). |
| Rate-limit evasion | Limits per route and per client IP (IPv6 by /64), from the catalogue; AI routes share one fail-closed bucket. The client IP is the rightmost `X-Forwarded-For` entry appended by our own proxy (`TRUSTED_PROXY_HOPS`), a platform header only when that platform is declared (`TRUSTED_PLATFORM`), `x-real-ip` only when `TRUST_PROXY_HEADER=x-real-ip`. The app must never be exposed without a proxy that overwrites `X-Forwarded-For`. |
| Secret leakage | Secrets only in server `process.env`; nothing in `NEXT_PUBLIC_*`, URLs, logs or responses; credential headers are dropped on cross-origin redirects; visitor AI keys arrive in the `x-ai-key` header, are used once and never stored or logged; `/api/health` reports flags, not values; the Docker image contains no `.env`. |
| Abuse of active tools | No people search. Active scanning only through an optional operator-configured backend (`SCANNER_URL`, `SCANNER_KEY`), allow-listed scan types, active types only with `SCANNER_ALLOW_ACTIVE=true`, described as "proxied through this server". |
| Visitor tracking | No cookies, analytics or fingerprinting; IP geolocation only after an explicit click; WebRTC local-IP harvesting and localhost port probing are forbidden. |

## Accepted trade-offs

- **CSP `script-src 'unsafe-inline'`.** Next.js injects inline bootstrap scripts, and the pre-paint theme
  script must run before hydration. A nonce-based CSP would force dynamic rendering of every page (no
  static `/docs` or `/privacy`, no CDN caching of HTML). We keep `'unsafe-inline'` for scripts, no
  `'unsafe-eval'` in production, and rely on React rendering (no HTML injection sinks) plus a strict
  `default-src 'self'` with explicit host lists.
- **CSP `worker-src 'self' blob:`.** MapLibre 6.11 creates its module worker through a same-origin
  `blob:` shim; without `blob:` the map never loads tiles. Workers still come only from this origin.
  `'wasm-unsafe-eval'` is allowed for satellite.js WASM bulk propagation.
- **`x-real-ip` is opt-in.** Many PaaS edges pass a client-sent `X-Real-IP` through untouched, so trusting
  it by default would let clients choose their own rate-limit bucket. Operators whose proxy overwrites it
  set `TRUST_PROXY_HEADER=x-real-ip` (the bundled Caddyfile overwrites both headers).
- **Muted text token `#848178`.** The reference project's `#5C5A54` measures about 3:1; GODSEYE raises
  `--text-muted` to `#848178`, which clears 4.5:1 on the primary background, the tertiary surface and the
  glass panels, at the cost of a slightly brighter secondary hierarchy.
- **HSTS `preload` is opt-in** (`HSTS_PRELOAD=true`). Preload commits the whole registrable domain to
  HTTPS for months; a self-hoster on a shared domain must choose it deliberately.
- **Docker/Node is the primary target; Vercel is secondary.** A long-running process keeps one poller,
  one set of quotas and in-memory SSE hubs. On Vercel: 4.5 MB function bodies (bulk layers are split and
  compressed), capped durations (SSE reconnects at `SSE_MAX_DURATION_MS`), shared egress IPs (per-IP
  quotas behave worse), Hobby is non-commercial, and multi-instance deployments need `REDIS_URL` for the
  shared cache, lock and rate limits.

## Deployment

- **Docker Compose (recommended):** `Dockerfile` builds a multi-stage `node:22-alpine` image
  (base pinned by digest; `pnpm install --frozen-lockfile`, `pnpm build`, standalone output +
  `.next/static` + `public/`, non-root user `godseye` (uid 1001, no login shell, npm/corepack removed),
  `HEALTHCHECK` on `/api/health`). `docker-compose.yml` runs it behind Caddy (automatic TLS,
  `header_up X-Forwarded-For {remote_host}`, zstd/gzip for JSON and HTML but never
  `text/event-stream`, request bodies capped at 64 KB on `/api/ai/*` and 1 MB elsewhere in front of the
  app's own 32 KiB / 256 KiB caps, no access log) with a snapshot volume, and an optional `redis`
  profile. The Caddy and Redis images are pinned by digest like the app's base image. Every
  service has `read_only: true`, `no-new-privileges`, `cap_drop: [ALL]` (Caddy adds back only
  `NET_BIND_SERVICE`) and a PID limit; the app writes only to `/data` and tmpfs mounts at `/tmp` and
  `/app/.next/cache`. The app port is never published.
- **Multiple instances:** set `REDIS_URL`; snapshots, single-writer locks and rate limits then live in
  Redis.
- **Any other reverse proxy** must overwrite `X-Forwarded-For` (nginx: `proxy_set_header X-Forwarded-For
  $remote_addr;`), disable response buffering for `text/event-stream`, and keep read timeouts above the
  15 s heartbeat.

## Tooling and quality gates

| Tool | Purpose |
|---|---|
| `tools/prepare-map-worker.mjs` | Vendors the MapLibre worker (predev/prebuild). |
| `tools/gen-mounted-routes.mjs` | Lists the mounted `/api` routes into `src/server/mounted-routes.ts` for `/api/health` (predev/prebuild). |
| `tools/perf/*.mjs` | Lighthouse, trace, LCP, bundle-size and payload-size benchmarks (perf audits). |
| `tools/gen-types.mjs` | Regenerates `src/lib/types.ts` from the zod schemas. |
| `tools/gen-api-docs.ts` | Writes `docs/API.md` from the catalogue (`--check` to verify). |
| `tools/compile-data-sources.ts` | Compiles `docs/DATA_SOURCES.md` from `docs/data-sources/*.md` plus the licence summary. |
| `tools/gpu-renderer-check.ts` | Hardware-WebGL2 gate before Lighthouse on `/` (`pnpm lhci:gpu:check`): same Chromium (`CHROME_PATH`) and flags as `lighthouserc.gpu.json`; fails on a software renderer or no WebGL2. |
| `tools/ts-loader.mjs` | Resolve hook so Node's built-in TypeScript support can run the tools above against app modules. |

CI (`.github/workflows/ci.yml`) runs on every push and pull request: a placeholder grep over LICENSE,
README and `docs/` (pattern in the workflow; the research pack and the contract are exempt), lint,
typecheck, unit tests with ≥ 80 % line coverage on `src/lib`, `src/app/api` and
`src/features/flight-paths`, a production build, Playwright e2e inside the official Playwright image
(pinned by digest; per-test budget 150 s so the 90 s first-canvas waits under SwiftShader can finish),
Lighthouse CI with the same thresholds in two configs (performance ≥ 0.85, accessibility = 1,
LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 300 ms, desktop preset, median of three runs) and `pnpm audit --prod`
failing on high or critical advisories. `/docs` and `/privacy` are measured on a separate build on
`ubuntu-24.04` (`lighthouserc.json`); `/`, the WebGL globe, only on a GPU runner named by the
`LIGHTHOUSE_GPU_RUNNER` repository variable (job `lighthouse-gpu`, `lighthouserc.gpu.json`), because
SwiftShader would rasterise the globe on the CPU. That job installs Playwright's pinned Chromium as
`CHROME_PATH`, builds, and runs `tools/gpu-renderer-check.ts` before Lighthouse: the same binary with
the config's exact flags (Playwright defaults that Lighthouse's chrome-launcher does not pass, such as
`--enable-unsafe-swiftshader` and `--disable-field-trial-config`, are dropped) must create a WebGL2
context on a hardware renderer on a blank canvas and on the MapLibre canvas of `/`, with Chromium
reporting WebGL2 as enabled and no major performance caveat. The renderer, GPU devices and command
line go to the job summary and `.lighthouseci/gpu-renderer.json`. An empty variable or a fork pull
request fails the job's first step on `ubuntu-24.04` instead of skipping it, so `/` is never green
unmeasured; that routing is a cost guard only, and a self-hosted GPU runner additionally needs the
pre-job hook and fork-approval setting in the README. `CHECK_CATALOG_COMPLETENESS=1` makes CI fail when a catalogued
route has no route file.
