# GODSEYE

**GLOBAL INTELLIGENCE MONITOR** — an open-source, keyless, real-time "god's-eye" view of the planet on a
WebGL globe: aircraft, maritime, satellites, public traffic cameras, hazards, conflict and cyber
indicators, markets and live alerts, plus a Flight Path Planner for the route between any two airports.

It runs with **zero API keys**. Keys only unlock upgrades. Every number on screen comes from a named
source, with the time it was observed and how fresh it is.

- In the app: `/docs` (API reference), `/privacy` (what leaves the instance), `/cameras-notice` (camera
  policy and takedown).
- In this repository: [docs/API.md](docs/API.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ·
  [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) · [.env.example](.env.example).

## Honest data, by construction

GODSEYE replicates the feature set of an existing MIT-licensed monitor (credited under Licence below) and
was built to answer the criticism that project received: synthetic data shown as live intelligence, docs that drifted
from the API, and weak security and licensing. The rules are enforced in code and tests, not just stated:

- **Nothing is fabricated.** No random, jittered, cloned or padded data (`Math.random` is a lint error in
  shipped code; retry-timing jitter in the HTTP client is the only exemption). Blocklist hits are drawn as **INDICATOR** points; attack arcs appear only when a source
  reports both ends. Static layers (nuclear sites, chokepoints, conflict zones, ports) are badged
  **REFERENCE**, never LIVE.
- **Observation time is not fetch time.** Responses carry `observedAt` and `fetchedAt` separately; LIVE
  only appears for data observed within its cadence. A source that fails shows **SOURCE OFFLINE** with
  its last-good time — the API answers `503 source_offline`, never an empty list pretending to be current.
- **Every aggregate response names its providers** with `{ok, count, ms, age_s}`.
- **A heuristic is called a heuristic.** Without a model key, summaries come from the deterministic
  ANALYST digest and say so; "AI" is used only for actual language-model output.
- **One catalogue, no drift.** `src/lib/api-catalog.ts` generates `/docs`, `docs/API.md`, the Privacy
  page's list of third parties and the per-route rate limits; tests fail when they disagree.

## Quick start (no keys needed)

Requirements: Node.js ≥ 22.12 and pnpm 10 (via Corepack).

```sh
corepack enable
pnpm i
pnpm dev            # http://localhost:3000
```

`pnpm dev` and `pnpm build` first vendor the MapLibre worker into `public/maplibre/<version>/`.
`pnpm build && pnpm start` serves a production build. The first build downloads the three web fonts
through `next/font`, which then self-hosts them.

## Docker

```sh
docker compose up -d                                  # app + Caddy on https://localhost (Caddy's internal CA)
GODSEYE_DOMAIN=monitor.example.org docker compose up -d   # automatic HTTPS for your domain
docker compose --profile redis up -d                  # add Redis (set REDIS_URL=redis://redis:6379 in .env)
```

The image (`Dockerfile`) is a multi-stage `node:22-alpine` build: `pnpm install --frozen-lockfile`,
`pnpm build`, then the standalone server with `.next/static` and `public/`, running as a non-root user
with a `HEALTHCHECK` on `/api/health`. No secrets are baked in: put keys in `.env` (read at run time by
compose) or pass them as environment variables. The app container is never published directly; Caddy
(`Caddyfile`) terminates TLS, overwrites `X-Forwarded-For` / `X-Real-IP`, streams Server-Sent Events
unbuffered and keeps no access log. Feed snapshots persist in the `snapshots` volume.

## Configuration

Every variable is optional; copy `.env.example` to `.env` and fill in only what you need.
`GET /api/health` shows which capabilities are on and, if not, why. Never put secrets in `NEXT_PUBLIC_*`
variables.

### Identity, licensing and deployment

| Variable | Effect |
|---|---|
| `GODSEYE_CONTACT` | Email or URL appended to the User-Agent sent to every upstream (default: this repo's issue tracker). Please set it on public instances. |
| `GODSEYE_DOMAIN` | Public hostname for the bundled Caddy in `docker compose` (automatic HTTPS). |
| `COMMERCIAL_DEPLOYMENT` | `true` turns off every non-commercial source (capabilities `nc_sources`, `openmeteo`, `cloudflare`, `deepstate`). |
| `NONCOMMERCIAL` | `true` enables DeepStateMap frontlines (`deepstate`; never with `COMMERCIAL_DEPLOYMENT`). Non-commercial use with attribution only; DeepState requires prior approval for commercial use of its API. |
| `TRUSTED_PLATFORM` | `cloudflare`, `vercel` or `akamai`: trust that edge's client-IP header. Leave empty behind your own proxy. |
| `TRUSTED_PROXY_HOPS` | Number of proxies appending to `X-Forwarded-For` (default 1: the rightmost entry is the client). |
| `TRUST_PROXY_HEADER` | Trust exactly one header your proxy overwrites, e.g. `x-real-ip`. |
| `HSTS_PRELOAD` | `true` adds `preload` to HSTS (commits the whole domain to HTTPS). |
| `SSE_MAX_DURATION_MS` | Close event streams after this many ms so capped hosts reconnect cleanly (Vercel default 280000). |
| `SSE_MAX_BUFFERED_BYTES` | Process-wide budget for bytes queued to slow event-stream clients (default 256 MB); past it the slowest clients are dropped. |
| `GODSEYE_DISABLE_POLLER` | `true` disables the background upstream poller (tests, static previews). |

### Caching and self-hosted engines

| Variable | Capability / effect |
|---|---|
| `REDIS_URL` | `redis`: shared snapshots, single-writer locks and rate limits across instances. |
| `SNAPSHOT_STORE` | Force `memory`, `filesystem` or `redis`. |
| `SNAPSHOT_DIR` | Filesystem snapshot store directory (survives restarts). |
| `SNAPSHOT_MEMORY_MAX_BYTES`, `SNAPSHOT_MAX_FILES` | Bounds for per-query cache entries in the memory (default 256 MB) and filesystem (default 20000 files) stores; feed snapshots are never evicted. |
| `PHOTON_URL`, `NOMINATIM_URL` | Self-hosted geocoders instead of the public demo servers. |
| `VALHALLA_URL`, `OSRM_URL` | Self-hosted routing engines. |

### Upgrades by capability

| Variable(s) | Capability | Unlocks |
|---|---|---|
| `ADSBLOL_REAPI=true` | `adsblol_reapi` | adsb.lol re-api (only from a feeder IP) |
| `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`, `OPENSKY_LICENSED=true` | `opensky` | OpenSky (requires a written licence for live products) |
| `ADSBFI_PERSONAL_USE=true` | `adsbfi` | adsb.fi open data (personal, non-commercial use only) |
| `FPDB_API_KEY` | `fpdb` | FlightPlanDatabase plans (flight simulation only) |
| `AIS_API_KEY` | `ais` | Live AIS vessels via a server-side AISStream relay |
| `TFL_APP_KEY` | `tfl` | TfL Unified API ("Powered by TfL Open Data") |
| `CCTV_LINK_OUT_ONLY` | — | Region keys or country codes whose cameras are shown as operator links only (no previews) |
| `CCTV_REMOVED_IDS` | — | Camera ids removed on request (report/remove button), comma-separated |
| `TRAFIKVERKET_KEY` | `trafikverket` | Trafikverket API (stills are keyless) |
| `CLOUDFLARE_API_TOKEN` | `cloudflare` | Cloudflare Radar outages and attack origins (CC BY-NC data) |
| `ABUSECH_AUTH_KEY` | `abusech` | abuse.ch APIs (bulk files stay keyless) |
| `NVD_API_KEY` | `nvd` | Higher NVD rate limit |
| `OTX_KEY` | `otx` | AlienVault OTX |
| `SDK_INGEST_KEY` | `sdk` | GODSEYE SDK entity ingest (fail-closed without a key) |
| `OPENSANCTIONS_KEY` | `opensanctions` | OpenSanctions API |
| `SCANNER_URL`, `SCANNER_KEY` | `scanner` | Optional allow-listed scanner backend (passive scan types) |
| `SCANNER_ALLOW_ACTIVE=true` | `scanner_active` | Operator opt-in for active scan types |
| `COINGECKO_DEMO_KEY` | `coingecko_demo` | CoinGecko demo key |
| `ANTHROPIC_API_KEY` | `anthropic` | Language-model briefings and overviews |
| `GEMINI_API_KEY_1` | `gemini` | Fallback analyst model |
| `OLLAMA_URL` | `ollama` | Operator-configured local model (visitors can never supply a URL) |
| `ANTHROPIC_MODEL`, `GEMINI_MODEL`, `OLLAMA_MODEL` | — | Optional model overrides; by default the newest suitable model from each provider's model list is used |
| `DISABLE_USER_AI_KEYS=true` | `ai_user_keys` | Refuse visitor-supplied keys (`x-ai-key` header, used once, never stored) |

Keyless licence gates that are on by default: `nc_sources` (TeleGeography cables, OpenSanctions bulk,
abuse.ch, ip-api, Shodan InternetDB) and `openmeteo` (Open-Meteo free tier); both are
off when `COMMERCIAL_DEPLOYMENT=true`.

## Deployment notes

- **Always put a reverse proxy in front, and make it overwrite `X-Forwarded-For`.** Rate limits are per
  route and per client IP; if clients can supply their own `X-Forwarded-For`, they choose their own
  bucket. Caddy: `header_up X-Forwarded-For {remote_host}` (as in `Caddyfile`); nginx:
  `proxy_set_header X-Forwarded-For $remote_addr;`. Never expose `next start` or `node server.js`
  directly. Behind Cloudflare, Vercel or Akamai set `TRUSTED_PLATFORM` instead.
- **Streaming:** disable proxy buffering for `text/event-stream` (the app also sends
  `X-Accel-Buffering: no`) and keep read timeouts above the 15 s heartbeat.
- **Several instances:** set `REDIS_URL` so they share snapshots, the single-writer locks and the rate
  limits; otherwise each instance polls every upstream itself.
- **Vercel (secondary target):** function bodies are capped at 4.5 MB (bulk layers are compressed and
  split to stay under it), durations are capped (event streams close at `SSE_MAX_DURATION_MS`, 280 s by
  default there, and the browser reconnects), egress IPs are shared, so per-IP quotas such as CelesTrak
  and Nominatim behave worse, and the Hobby plan is non-commercial. Use one region and a Redis
  (for example Upstash) `REDIS_URL`.
- **Security headers** (CSP, HSTS, `X-Frame-Options`, `nosniff`, `Permissions-Policy`) are set by the
  app itself; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#accepted-trade-offs) for the trade-offs.

## Privacy and responsible use

- No accounts, no cookies, no analytics. Data APIs are called by the server, never with the visitor's IP
  address. Map tiles, official video embeds and some camera video load directly in the browser from the
  hosts listed on `/privacy`, and `/api/geo` sends the visitor's IP to a geolocation provider only after
  they click "centre on my region". `/privacy` also lists every third party that receives something a
  visitor typed, generated from the endpoint catalogue.
- The visitor is never geolocated automatically: "centre on my region" is an explicit click.
- OSINT tools are **passive and about infrastructure only** (domains, IPs, certificates, networks,
  vulnerabilities). There is no username, email, phone or identity search: sanctions-list screening and
  the entity graph cover listed or public entities only, never private individuals.
- Active scanning is available only if the operator connects a separate scanner backend; scans are
  allow-listed and **proxied through this server**, never run "from your browser". Scanning systems you
  are not authorised to test may be unlawful.
- Cameras are official public feeds for situational and traffic awareness: no recording, archiving, or
  face/plate recognition, a "Report / remove this camera" button on every feed, and a camera notice at
  `/cameras-notice`.
- Respect each provider's terms: the licence summary in [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)
  lists attribution duties and which sources are non-commercial.

## Contributing

```sh
pnpm lint          # ESLint 10, zero warnings
pnpm typecheck     # TypeScript strict
pnpm test          # Vitest (pnpm test:coverage enforces ≥ 80 % lines on src/lib, src/app/api, src/features/flight-paths)
pnpm build
pnpm e2e           # Playwright (starts the production server itself)
```

After changing the endpoint catalogue or a probe log, regenerate the generated docs (tests fail when they
are stale):

```sh
node --experimental-transform-types --import ./tools/ts-loader.mjs tools/gen-api-docs.ts
node --experimental-transform-types --import ./tools/ts-loader.mjs tools/compile-data-sources.ts
```

Probe every new upstream with `curl` and the GODSEYE User-Agent before wiring it, and record status,
latency, CORS, auth and licence in `docs/data-sources/<area>.md`. Project rules for contributors and
coding agents are in [CLAUDE.md](CLAUDE.md). CI runs all of the above plus Lighthouse CI and
`pnpm audit --prod` on every push and pull request.

## Credits and licence

GODSEYE is released under the [MIT licence](LICENSE). It is an independent project that replicates the
features of OSIRIS — **OSIRIS © 2026 simplifaisoul, MIT licence** — and reuses some of its data tables and
behaviours with attribution; the NOTICE section of [LICENSE](LICENSE) lists files substantially derived
from it. GODSEYE does not use the OSIRIS name, logo, links or promotions. World Monitor and Orodruin
(AGPL) were studied for ideas only; no code was copied from them.

Map data © OpenStreetMap contributors (ODbL), tiles by OpenFreeMap; satellite imagery: Esri, Vantor,
Earthstar Geographics, and the GIS User Community; night lights and imagery courtesy of NASA GIBS. Every
other source and its licence is listed in [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) and in the in-app
attribution panel.
