# GODSEYE screenshots

Captured from the production build of `claude/godseye-build-orchestration-zz8kt7` @ `3325d94` with Playwright + SwiftShader at **1600×1000** (desktop) and **390×844** (phone), `prefers-reduced-motion: reduce`, animations disabled. Clocks, the ticker and relative ages are masked. Data is whatever the live keyless feeds returned at capture time (2026-10-01, round 2 about 01:45–02:30 UTC; round 3 03:43–04:04 UTC); nothing is staged. Images are WebP (quality 72; presets, sensors and deck baselines quality 60), about 6.0 MB in total.

> **Capture environment.** Shared sandbox, software WebGL (SwiftShader), egress proxy, Playwright serialised behind a lock shared with other agents. Some shots show no basemap tiles or few entities because they had not arrived within the wait (the BASEMAP OFFLINE chip in a shot is the app reporting exactly that). Files ending in `-MISSING` record a palette query that did not open the panel typed (round 3: STYLE STUDIO on desktop; the phone file does show the panel, a spec locator mismatch). Re-capture on a GPU machine before publishing.

## Hero shots

- [Flight Paths: SVO → LAX polar great circle framed on the globe, METAR chips](flight-paths/svo-lax-route-globe-desktop.webp)
- [Flight Paths LIVE: SYD → SCL, one matched aircraft, nothing inferred](flight-paths/syd-scl-live-globe-desktop.webp)
- [Flight Paths FLIGHT: tracking a live callsign with its observed profile](flight-paths/flight-tracking-desktop.webp)
- [3D buildings and terrain, Lower Manhattan](layers/display-3d-desktop.webp)
- [GPS interference as H3 cells on the globe](deck/h3-globe-desktop.webp)
- [Ghost Protocol over the conflict-zone reference layer, contrast table all PASS](presets/ghost-desktop.webp)
- [Entity card: public traffic camera with licence, UNTIMED badge and report/remove](cards/camera-desktop.webp)
- [Sources & licences register](panels/sources-licences-desktop.webp)
- [Phone: Flight Paths LIVE sheet, LHR → JFK](flight-paths/lhr-jfk-live-globe-mobile.webp)

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

## layers

| View | Desktop 1600×1000 | Phone 390×844 |
|---|---|---|
| aviation | [desktop](layers/aviation-desktop.webp) | [phone](layers/aviation-mobile.webp) |
| display | [desktop](layers/display-desktop.webp) | — |
| display-3d | [desktop](layers/display-3d-desktop.webp) | — |
| hazards | [desktop](layers/hazards-desktop.webp) | [phone](layers/hazards-mobile.webp) |
| maritime | [desktop](layers/maritime-desktop.webp) | — |
| netintel | [desktop](layers/netintel-desktop.webp) | — |
| network | [desktop](layers/network-desktop.webp) | — |
| space | [desktop](layers/space-desktop.webp) | — |
| surveillance | [desktop](layers/surveillance-desktop.webp) | — |
| threats | [desktop](layers/threats-desktop.webp) | [phone](layers/threats-mobile.webp) |

## presets

| View | Desktop 1600×1000 | Phone 390×844 |
|---|---|---|
| arctic | [desktop](presets/arctic-desktop.webp) | [phone](presets/arctic-mobile.webp) |
| blackout | [desktop](presets/blackout-desktop.webp) | [phone](presets/blackout-mobile.webp) |
| crimson | [desktop](presets/crimson-desktop.webp) | [phone](presets/crimson-mobile.webp) |
| ember | [desktop](presets/ember-desktop.webp) | [phone](presets/ember-mobile.webp) |
| ghost | [desktop](presets/ghost-desktop.webp) | [phone](presets/ghost-mobile.webp) |
| horus | [desktop](presets/horus-desktop.webp) | [phone](presets/horus-mobile.webp) |
| mono | [desktop](presets/mono-desktop.webp) | [phone](presets/mono-mobile.webp) |
| nvg | [desktop](presets/nvg-desktop.webp) | [phone](presets/nvg-mobile.webp) |
| phantom | [desktop](presets/phantom-desktop.webp) | [phone](presets/phantom-mobile.webp) |
| terminal | [desktop](presets/terminal-desktop.webp) | [phone](presets/terminal-mobile.webp) |

## sensors

| View | Desktop 1600×1000 | Phone 390×844 |
|---|---|---|
| crt | [desktop](sensors/crt-desktop.webp) | — |
| flir | [desktop](sensors/flir-desktop.webp) | — |
| noir | [desktop](sensors/noir-desktop.webp) | — |
| nvg | [desktop](sensors/nvg-desktop.webp) | — |

## panels

| View | Desktop 1600×1000 | Phone 390×844 |
|---|---|---|
| alerts | [desktop](panels/alerts-desktop.webp) | [phone](panels/alerts-mobile.webp) |
| arcgis | [desktop](panels/arcgis-desktop.webp) | [phone](panels/arcgis-mobile.webp) |
| camera-viewer-from-card | [desktop](panels/camera-viewer-from-card-desktop.webp) | [phone](panels/camera-viewer-from-card-mobile.webp) |
| dossier | [desktop](panels/dossier-desktop.webp) | — |
| draw | [desktop](panels/draw-desktop.webp) | [phone](panels/draw-mobile.webp) |
| flight-watch-from-card | — | [phone](panels/flight-watch-from-card-mobile.webp) |
| intel | [desktop](panels/intel-desktop.webp) | [phone](panels/intel-mobile.webp) |
| layers | [desktop](panels/layers-desktop.webp) | [phone](panels/layers-mobile.webp) |
| markets | [desktop](panels/markets-desktop.webp) | [phone](panels/markets-mobile.webp) |
| palette | [desktop](panels/palette-desktop.webp) | [phone](panels/palette-mobile.webp) |
| paths | [desktop](panels/paths-desktop.webp) | [phone](panels/paths-mobile.webp) |
| presets | [desktop](panels/presets-desktop.webp) | [phone](panels/presets-mobile.webp) |
| recon | [desktop](panels/recon-desktop.webp) | [phone](panels/recon-mobile.webp) |
| route | [desktop](panels/route-desktop.webp) | [phone](panels/route-mobile.webp) |
| search | [desktop](panels/search-desktop.webp) | [phone](panels/search-mobile.webp) |
| settings | [desktop](panels/settings-desktop.webp) | [phone](panels/settings-mobile.webp) |
| share | [desktop](panels/share-desktop.webp) | [phone](panels/share-mobile.webp) |
| shortcuts | [desktop](panels/shortcuts-desktop.webp) | [phone](panels/shortcuts-mobile.webp) |
| sources-licences | [desktop](panels/sources-licences-desktop.webp) | [phone](panels/sources-licences-mobile.webp) |
| space | [desktop](panels/space-desktop.webp) | [phone](panels/space-mobile.webp) |
| style-studio-MISSING | [desktop](panels/style-studio-MISSING-desktop.webp) | [phone](panels/style-studio-MISSING-mobile.webp) |

## cards

| View | Desktop 1600×1000 | Phone 390×844 |
|---|---|---|
| aircraft | [desktop](cards/aircraft-desktop.webp) | [phone](cards/aircraft-mobile.webp) |
| camera | [desktop](cards/camera-desktop.webp) | [phone](cards/camera-mobile.webp) |
| conflict-zone | [desktop](cards/conflict-zone-desktop.webp) | [phone](cards/conflict-zone-mobile.webp) |
| earthquake | [desktop](cards/earthquake-desktop.webp) | [phone](cards/earthquake-mobile.webp) |
| fire | [desktop](cards/fire-desktop.webp) | [phone](cards/fire-mobile.webp) |
| malware | [desktop](cards/malware-desktop.webp) | [phone](cards/malware-mobile.webp) |
| satellite | [desktop](cards/satellite-desktop.webp) | [phone](cards/satellite-mobile.webp) |

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

## deck

| View | Desktop 1600×1000 | Phone 390×844 |
|---|---|---|
| arc-greatcircle-globe | [desktop](deck/arc-greatcircle-globe-desktop.webp) | — |
| arc-greatcircle-mercator | [desktop](deck/arc-greatcircle-mercator-desktop.webp) | — |
| h3-globe | [desktop](deck/h3-globe-desktop.webp) | — |
| h3-mercator | [desktop](deck/h3-mercator-desktop.webp) | — |
| icon-globe | [desktop](deck/icon-globe-desktop.webp) | — |
| icon-mercator | [desktop](deck/icon-mercator-desktop.webp) | — |
| scatter-globe | [desktop](deck/scatter-globe-desktop.webp) | — |
| scatter-mercator | [desktop](deck/scatter-mercator-desktop.webp) | — |
| text-globe | [desktop](deck/text-globe-desktop.webp) | — |
| text-mercator | [desktop](deck/text-mercator-desktop.webp) | — |
| trail-path-globe | [desktop](deck/trail-path-globe-desktop.webp) | — |
| trail-path-mercator | [desktop](deck/trail-path-mercator-desktop.webp) | — |

## checks

| View | Desktop 1600×1000 | Phone 390×844 |
|---|---|---|
| far-side-atlantic | [desktop](checks/far-side-atlantic-desktop.webp) | — |
| far-side-pacific | [desktop](checks/far-side-pacific-desktop.webp) | — |
| globe-void-wedge | [desktop](checks/globe-void-wedge-desktop.webp) | — |
| picking-globe | [desktop](checks/picking-globe-desktop.webp) | [phone](checks/picking-globe-mobile.webp) |
| picking-mercator | [desktop](checks/picking-mercator-desktop.webp) | [phone](checks/picking-mercator-mobile.webp) |
| toggle-1-mercator | [desktop](checks/toggle-1-mercator-desktop.webp) | [phone](checks/toggle-1-mercator-mobile.webp) |
| toggle-2-globe | [desktop](checks/toggle-2-globe-desktop.webp) | [phone](checks/toggle-2-globe-mobile.webp) |

## audit

| View | Desktop 1600×1000 | Phone 390×844 |
|---|---|---|
| dom | [desktop](audit/dom-desktop.webp) | [phone](audit/dom-mobile.webp) |
