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

## Screenshots

Captured from a production build with live keyless feeds (software WebGL; see
[docs/screenshots](docs/screenshots/README.md) for the full set and how to re-capture).

| | |
|---|---|
| ![Flight Paths: LHR → JFK great circle on the globe with METAR for both ends](docs/screenshots/flight-paths/lhr-jfk-route-globe-desktop.webp) | ![Entity card: a USGS earthquake with its source and observed time](docs/screenshots/cards/earthquake-desktop.webp) |
| ![Markets panel: exchange sessions and delayed quotes](docs/screenshots/panels/markets-desktop.webp) | ![Sources & Licences register](docs/screenshots/panels/sources-licences-desktop.webp) |

## Quick start (no keys needed)

Requirements: Node.js ≥ 22.12 and pnpm 10 (via Corepack).

```sh
corepack enable
pnpm i
pnpm dev            # http://localhost:3000
```

`pnpm dev` and `pnpm build` first vendor the MapLibre worker into `public/maplibre/<version>/`.
`pnpm build && pnpm start` serves a production build. The three web fonts (Inter, JetBrains Mono,
Space Grotesk; OFL) come from `@fontsource` packages through `next/font/local`, so the build needs no
font download and the browser never contacts a font CDN.

## Docker

```sh
docker compose up -d                                  # app + Caddy on https://localhost (Caddy's internal CA)
GODSEYE_DOMAIN=monitor.example.org docker compose up -d   # automatic HTTPS for your domain
docker compose --profile redis up -d                  # add Redis (set REDIS_URL=redis://redis:6379 in .env)
```

The image (`Dockerfile`) is a multi-stage `node:22-alpine` build (base pinned by digest):
`pnpm install --frozen-lockfile`, `pnpm build`, then the standalone server with `.next/static` and
`public/`, running as uid 1001 without a login shell or package managers, with a `HEALTHCHECK` on
`/api/health`. No secrets are baked in: put keys in `.env` (read at run time by compose) or pass them as
environment variables. Compose runs every container with a read-only root filesystem,
`no-new-privileges` and all Linux capabilities dropped (Caddy keeps only `NET_BIND_SERVICE`; Redis runs
as its own user); the app writes only to the `snapshots` volume (feed snapshots survive restarts) and
two small tmpfs mounts. The app container is never published directly; Caddy (`Caddyfile`) terminates
TLS, overwrites `X-Forwarded-For` / `X-Real-IP`, caps request bodies (64 KB on `/api/ai/*`, 1 MB
elsewhere), compresses JSON and HTML with zstd/gzip, streams Server-Sent Events unbuffered and keeps no
access log. The Caddy and Redis images are pinned by digest too; refresh the digests with
`docker buildx imagetools inspect caddy:2-alpine` (or `redis:8-alpine`) when you update.

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
| `SNAPSHOT_MEMORY_MAX_BYTES`, `SNAPSHOT_MAX_FILES`, `SNAPSHOT_MAX_DISK_BYTES` | Bounds for per-query cache entries in the memory (default 256 MB) and filesystem (default 20000 files, 1 GB) stores; feed snapshots are never evicted. |
| `PHOTON_URL`, `NOMINATIM_URL` | Self-hosted geocoders instead of the public demo servers. |
| `VALHALLA_URL`, `OSRM_URL` | Self-hosted routing engines. |
| `ARCGIS_ALLOWED_HOSTS` | Extra ArcGIS servers `/api/arcgis` may import from (exact hosts with an optional `:port` such as `:6443`, https only); ArcGIS Online hosted services (`services.arcgis.com`, `services[1-9].arcgis.com`, `services-eu1`/`services-ap1.arcgis.com`) and `*.arcgisonline.com` are built in. |

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
  directly: without a proxy that overwrites the header, every forged `X-Forwarded-For` value gets a
  fresh bucket, which in effect disables rate limiting (the server logs a warning at start-up when no
  trusted proxy is configured). Behind Cloudflare, Vercel or Akamai set `TRUSTED_PLATFORM` instead.
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
coding agents are in [CLAUDE.md](CLAUDE.md). CI runs all of the above plus `pnpm audit --prod` and
Lighthouse CI on every push and pull request: `/docs` and `/privacy` on `ubuntu-24.04` (`pnpm lhci`),
and `/` on a GPU runner (`pnpm lhci:gpu`), because a globe rasterised in software is not what visitors
with a GPU get.

### GPU runner for Lighthouse on `/`

`/` is the WebGL globe. On a runner without a GPU, Chromium rasterises it with SwiftShader on the CPU
(recent runs measured performance 0.54 to 0.61 with 1.7 to 17 s of total blocking time), which says
nothing about what visitors with a GPU get. CI therefore measures `/docs` and `/privacy` on `ubuntu-24.04` (`lighthouserc.json`)
and `/` only on a hardware GPU (job `lighthouse-gpu`, `lighthouserc.gpu.json`). Both configs assert the
same contract thresholds (performance ≥ 0.85, accessibility = 1, LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 300 ms,
median of three desktop runs). The GPU job:

1. fails in its first step, on `ubuntu-24.04`, when the repository variable `LIGHTHOUSE_GPU_RUNNER` is
   empty or the run comes from a fork. The check is then red ("not measured"), never skipped (a skipped
   job counts as passed for a required check) and never queued for a runner that does not exist;
2. installs Playwright's pinned Chromium build, points `CHROME_PATH` at it and builds the app;
3. runs `pnpm lhci:gpu:check` (`tools/gpu-renderer-check.ts`). It launches that Chromium with the exact
   `chromeFlags` of `lighthouserc.gpu.json` and fails unless WebGL2 runs on a hardware renderer, both on
   a blank canvas and on the map's own canvas at `/`. SwiftShader, llvmpipe, lavapipe, any "software"
   renderer, a context with a major performance caveat or no WebGL2 at all fail the job;
4. only then runs Lighthouse CI on `/`, and uploads the reports together with `gpu-renderer.json`
   (renderer, GPU devices, Chromium version and command line) as the `lighthouse-gpu` artifact. The job
   summary names the renderer the scores were measured on.

**Set the variable.** Settings → Secrets and variables → Actions → Variables → New repository variable:
name `LIGHTHOUSE_GPU_RUNNER`, value the runner's label (for example `gpu-t4-4core`) or a JSON array of
labels (for example `["self-hosted","linux","x64","godseye-gpu"]`). It is not a secret, and no keys are
needed.

**Option A: GitHub-hosted GPU runner (recommended).** GPU runners are larger runners, which GitHub offers
only to organisations on GitHub Team or Enterprise Cloud, so a repository in a personal account must
first move into such an organisation (Settings → General → Transfer ownership). Then, as an
organisation owner: organisation Settings → Actions → Runners → New runner → New GitHub-hosted runner.
Name it (the name becomes the label, for example `gpu-t4-4core`); platform Linux x64; image: Partner
tab, "NVIDIA GPU-Optimized Image for AI and HPC"; size: GPU-powered tab (4 vCPU, one Tesla T4, 28 GB RAM,
16 GB VRAM); maximum concurrency 1; a dedicated runner group. Give that group access to this repository
(Repository access → Selected repositories) and allow public repositories, because runner groups serve
private repositories only by default. Billing is per minute (`linux_4_core_gpu`, $0.052 per minute on
2026-10-01), not covered by included minutes and never free, public repositories included. One run
(build, renderer check, three Lighthouse runs) takes roughly 8 to 15 minutes, about $0.40 to $0.80, and a
push to a branch with an open pull request runs it twice (push and pull_request), so set an Actions
budget for the organisation.

**Option B: self-hosted GPU machine.** GitHub's guidance is that self-hosted runners
"should almost never be used for public repositories", because anyone can open a pull request, and a
fork's pull request runs its own copy of the workflow: the routing in `ci.yml` is a cost guard, not a
security boundary. If you still use one:

- use a dedicated, disposable VM or host with a hardware GPU, rebuilt after every job, with an
  unprivileged user and no other credentials on it;
- register it on this repository only (Settings → Actions → Runners → New self-hosted runner, Linux x64)
  as an ephemeral runner: run the commands that page shows, adding `--labels godseye-gpu --ephemeral` to
  `./config.sh` (`self-hosted`, `linux` and `x64` are added automatically);
- preinstall the GPU driver with its Vulkan ICD (`vulkaninfo --summary` must list the GPU, not
  llvmpipe), `jq`, and Chromium's system libraries (`sudo npx playwright@1.63.0 install-deps chromium`):
  the workflow never runs `sudo` on a self-hosted runner;
- save the pre-job hook below outside the runner directory, for example as
  `/opt/godseye-runner-hooks/job-started.sh` (executable, owned by root), and name it in the runner's
  `.env` file: `ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/godseye-runner-hooks/job-started.sh`. The runner
  executes it before every job; a non-zero exit fails the job before any step runs, and a fork cannot
  edit a file on your machine;
- under Settings → Actions → General → "Approval for running fork pull request workflows from
  contributors", choose "Require approval for all external contributors", and read every `.github/**`
  and `package.json` change before approving. Never add a `pull_request_target` trigger.

```sh
#!/bin/sh
# GODSEYE GPU runner pre-job hook: admit pushes and pull requests from this repository only.
set -eu
case "${GITHUB_EVENT_NAME:-}" in
  push) exit 0 ;;
  pull_request)
    head=$(jq -r '.pull_request.head.repo.full_name // empty' "$GITHUB_EVENT_PATH")
    if [ -n "$head" ] && [ "$head" = "${GITHUB_REPOSITORY:-}" ]; then exit 0; fi
    ;;
esac
echo "GODSEYE GPU runner: refusing a ${GITHUB_EVENT_NAME:-unknown} job from ${GITHUB_REPOSITORY:-unknown}: only pushes and same-repository pull requests run here" >&2
exit 1
```

**Branch protection.** In the ruleset for the default branch, require both Lighthouse checks:
"Build + Lighthouse CI (/docs, /privacy)" and "Build + Lighthouse CI (/, GPU runner)". A pull request
from a fork shows the `/` check red ("not measured") by design: a maintainer reviews the change, pushes
it to a branch of this repository, and that push run measures it.

**When the renderer check fails on a GPU machine,** the job summary and `gpu-renderer.json` show what
Chromium got, and the "GPU diagnostics" step lists the Vulkan ICD manifests. Without a Vulkan ICD for the
GPU, install the driver's user-space GL/Vulkan package for the same driver version (on Ubuntu,
`libnvidia-gl-<driver major>`). If Vulkan cannot work on that machine, ANGLE's EGL backend is the
alternative: replace `--use-angle=vulkan --enable-features=Vulkan --disable-vulkan-surface` with
`--use-gl=angle --use-angle=gl-egl` in `lighthouserc.gpu.json`; the renderer check still gates it. Never
add SwiftShader flags or loosen thresholds: a red `/` on a real GPU is an application performance problem
to fix.

**Locally,** on a machine with a GPU: `pnpm build && CHROME_PATH=/path/to/chrome pnpm lhci:gpu`.

## Credits and licence

GODSEYE is released under the [MIT licence](LICENSE). It is an independent project that replicates the
features of OSIRIS — **OSIRIS © 2026 simplifaisoul, MIT licence** — and reuses some of its data tables and
behaviours with attribution; the NOTICE section of [LICENSE](LICENSE) lists files substantially derived
from it. GODSEYE does not use the OSIRIS name, logo, links or promotions. World Monitor and Orodruin
(AGPL) were studied for ideas only; no code was copied from them.

Map data © OpenStreetMap contributors (ODbL), tiles by OpenFreeMap; satellite imagery: Esri, Vantor,
Earthstar Geographics, and the GIS User Community; night lights and imagery courtesy of NASA GIBS. Fonts: Inter, JetBrains Mono and Space Grotesk (SIL Open
Font License 1.1), bundled from @fontsource. Every
other source and its licence is listed in [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) and in the in-app
attribution panel.
