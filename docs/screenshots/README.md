# GODSEYE screenshots

Captured from the production build of `claude/godseye-build-orchestration-zz8kt7` @ `78d08fd` with Playwright + SwiftShader at **1600×1000** (desktop) and **390×844** (phone), `prefers-reduced-motion: reduce`, animations disabled. Clocks, the ticker and relative ages are masked. Data is whatever the live keyless feeds returned at capture time (2026-10-01, about 01:45–02:30 UTC); nothing is staged. Images are WebP (quality 72), 3.2 MB in total.

> **Capture environment.** Shared sandbox, software WebGL (SwiftShader), egress proxy, Playwright serialised behind a lock shared with other agents. Some shots show no basemap tiles or few entities because they had not arrived within the wait (the BASEMAP OFFLINE chip in a shot is the app reporting exactly that). Files ending in `-MISSING` record a palette query that opened a different panel than the one typed. Re-capture on a GPU machine before publishing.

## Hero shots

- [Flight Paths: LHR → JFK great circle on the globe with METAR chips](flight-paths/lhr-jfk-route-globe-desktop.webp)
- [Flight Paths LIVE: SYD → SCL, aircraft on the pair (matched vs inferred)](flight-paths/syd-scl-live-globe-desktop.webp)
- [Flight Paths FLIGHT: tracking a live callsign with its observed profile](flight-paths/flight-tracking-desktop.webp)
- [Markets: exchange sessions, delayed quotes badged RECENT](panels/markets-desktop.webp)
- [Globe after the 2D → 3D toggle (same map instance)](checks/toggle-2-globe-desktop.webp)
- [Entity card: USGS earthquake with observed time and source](cards/earthquake-desktop.webp)
- [Sources & licences register](panels/sources-licences-desktop.webp)
- [Phone: Flight Paths LIVE sheet](flight-paths/lhr-jfk-live-globe-mobile.webp)

## Re-capture

```sh
pnpm build && pnpm start --port 3000   # or point CAPTURE_BASE_URL at any running build
CAPTURE_PNG_DIR=/tmp/godseye-png CAPTURE_BASE_URL=http://127.0.0.1:3000 \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium E2E_IGNORE_HTTPS_ERRORS=1 \
  pnpm exec playwright test -c docs/screenshots/playwright.config.ts
python3 docs/screenshots/convert-webp.py /tmp/godseye-png 72   # needs Pillow
```

- `capture.spec.ts`: splash, landing, every palette panel, context panels, layer groups, presets + Ghost Protocol, sensor modes, entity cards, Flight Paths ROUTE / LIVE / FLIGHT (LHR→JFK, SYD→SCL, SVO→LAX), pages, and the DOM audit (`audit/dom-*.json`: overlaps, tiny text, tracking, phone touch targets).
- `checks.spec.ts`: per-deck-layer-type baselines on globe and mercator (Arc great-circle, Icon, Text, H3, Scatter; the watched-flight trail stands in for Trips, which no shipped layer uses), far-side occlusion, picking on both projections, and the 2D → globe toggle (asserts one map construction).
- `CAPTURE_SKIP_EXISTING=1` resumes a round; `-g "<area>/"` and `--project desktop|mobile` narrow it.

## splash

| View | Desktop 1600×1000 | Phone 390×844 |
|---|---|---|
| splash | [desktop](splash/splash-desktop.webp) | [phone](splash/splash-mobile.webp) |

## landing

| View | Desktop 1600×1000 | Phone 390×844 |
|---|---|---|
| globe | [desktop](landing/globe-desktop.webp) | [phone](landing/globe-mobile.webp) |

## panels

| View | Desktop 1600×1000 | Phone 390×844 |
|---|---|---|
| alerts | [desktop](panels/alerts-desktop.webp) | [phone](panels/alerts-mobile.webp) |
| arcgis | [desktop](panels/arcgis-desktop.webp) | [phone](panels/arcgis-mobile.webp) |
| draw | [desktop](panels/draw-desktop.webp) | [phone](panels/draw-mobile.webp) |
| intel | [desktop](panels/intel-desktop.webp) | [phone](panels/intel-mobile.webp) |
| layers-MISSING | [desktop](panels/layers-MISSING-desktop.webp) | [phone](panels/layers-MISSING-mobile.webp) |
| markets | [desktop](panels/markets-desktop.webp) | [phone](panels/markets-mobile.webp) |
| palette | [desktop](panels/palette-desktop.webp) | [phone](panels/palette-mobile.webp) |
| paths | [desktop](panels/paths-desktop.webp) | [phone](panels/paths-mobile.webp) |
| presets | [desktop](panels/presets-desktop.webp) | [phone](panels/presets-mobile.webp) |
| recon | [desktop](panels/recon-desktop.webp) | [phone](panels/recon-mobile.webp) |
| route | [desktop](panels/route-desktop.webp) | [phone](panels/route-mobile.webp) |
| search | [desktop](panels/search-desktop.webp) | [phone](panels/search-mobile.webp) |
| settings-MISSING | [desktop](panels/settings-MISSING-desktop.webp) | [phone](panels/settings-MISSING-mobile.webp) |
| share-MISSING | [desktop](panels/share-MISSING-desktop.webp) | [phone](panels/share-MISSING-mobile.webp) |
| shortcuts | [desktop](panels/shortcuts-desktop.webp) | [phone](panels/shortcuts-mobile.webp) |
| sources-licences | [desktop](panels/sources-licences-desktop.webp) | [phone](panels/sources-licences-mobile.webp) |
| space | [desktop](panels/space-desktop.webp) | [phone](panels/space-mobile.webp) |
| style-studio-MISSING | [desktop](panels/style-studio-MISSING-desktop.webp) | [phone](panels/style-studio-MISSING-mobile.webp) |

## cards

| View | Desktop 1600×1000 | Phone 390×844 |
|---|---|---|
| earthquake | [desktop](cards/earthquake-desktop.webp) | [phone](cards/earthquake-mobile.webp) |

## flight-paths

| View | Desktop 1600×1000 | Phone 390×844 |
|---|---|---|
| flight-tracking | [desktop](flight-paths/flight-tracking-desktop.webp) | [phone](flight-paths/flight-tracking-mobile.webp) |
| lhr-jfk-live-globe | [desktop](flight-paths/lhr-jfk-live-globe-desktop.webp) | [phone](flight-paths/lhr-jfk-live-globe-mobile.webp) |
| lhr-jfk-route-globe | [desktop](flight-paths/lhr-jfk-route-globe-desktop.webp) | [phone](flight-paths/lhr-jfk-route-globe-mobile.webp) |
| lhr-jfk-route-mercator | [desktop](flight-paths/lhr-jfk-route-mercator-desktop.webp) | — |
| svo-lax-live-globe | [desktop](flight-paths/svo-lax-live-globe-desktop.webp) | [phone](flight-paths/svo-lax-live-globe-mobile.webp) |
| svo-lax-route-globe | [desktop](flight-paths/svo-lax-route-globe-desktop.webp) | [phone](flight-paths/svo-lax-route-globe-mobile.webp) |
| svo-lax-route-mercator | [desktop](flight-paths/svo-lax-route-mercator-desktop.webp) | — |
| syd-scl-live-globe | [desktop](flight-paths/syd-scl-live-globe-desktop.webp) | [phone](flight-paths/syd-scl-live-globe-mobile.webp) |
| syd-scl-route-globe | [desktop](flight-paths/syd-scl-route-globe-desktop.webp) | [phone](flight-paths/syd-scl-route-globe-mobile.webp) |
| syd-scl-route-mercator | [desktop](flight-paths/syd-scl-route-mercator-desktop.webp) | — |

## checks

| View | Desktop 1600×1000 | Phone 390×844 |
|---|---|---|
| far-side-atlantic | [desktop](checks/far-side-atlantic-desktop.webp) | — |
| far-side-pacific | [desktop](checks/far-side-pacific-desktop.webp) | — |
| toggle-1-mercator | [desktop](checks/toggle-1-mercator-desktop.webp) | [phone](checks/toggle-1-mercator-mobile.webp) |
| toggle-2-globe | [desktop](checks/toggle-2-globe-desktop.webp) | [phone](checks/toggle-2-globe-mobile.webp) |

## audit

| View | Desktop 1600×1000 | Phone 390×844 |
|---|---|---|
| dom | [desktop](audit/dom-desktop.webp) | [phone](audit/dom-mobile.webp) |
