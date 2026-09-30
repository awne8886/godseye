# GODSEYE research pack — index

> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.


Read the files relevant to your slice before building. Files 01–15 come from reading the OSIRIS source; files 20–32 from web research and live API probes. `docs/OPUS_5_5_BUILD_PROMPT.md` is the build prompt that references this pack.


| File | Contents |
|---|---|
| `01-osiris-map-core.md` | Map constructor, worker vendoring, tile proxy, view toggles, terminator, terrain, source/layer ids, entity paint recipes, satellites WebGL layer, interaction model, performance techniques |
| `02-osiris-hud-panels.md` | Layer registry and defaults, rails, status strip, every tool and panel, popups, splash, mobile, docs page |
| `03-osiris-api-aviation-space-earth.md` | flights classifier and upstreams, flight-route, aircraft traces, airports table, satellites/orbit, space weather, quakes, fires, weather, stats/health, docs drift |
| `04-osiris-api-geo-media-surveillance.md` | conflicts, frontlines, GDACS/GDELT, dossier, news/Telegram pipeline, live news, markets, CCTV providers and player, proxy, maritime, ArcGIS, geocoding, directions |
| `05-osiris-api-cyber-osint-ai-sdk.md` | SSRF guard and limiter, AI prompts, malware SSE, OSINT lookups, sanctions, wallet intel, scanner proxy, entity graph service, SDK format, PYTHIA engine, Docker/CI/tests |
| `06-osiris-design-system.md` | tokens, themes, per-class colours, glass recipe, typography, keyframes, instrument chrome, overlays/splash, layout and z-index, motion inventory, Style Studio, responsive, a11y, states, visual spec and premium upgrade list |
| `07-osiris-code-study-critic.md` | What the six code dossiers missed and which gap-fills answer it |
| `08-osiris-layer-wiring.md` | Complete wiring per layer, hidden/always-on keys, core feed cadences, URL persistence, count semantics, z-order, click-target mismatches |
| `09-osiris-maritime-pipeline.md` | aisstream subscription, ship typing, expiry, ports/chokepoints constants, congestion and risk heuristics, snapshot, map styling, popups |
| `10-osiris-cyber-pipeline.md` | poll/conditional GET, CSV parser, detection shape, geolocation batching, SSE events, client consumer, visuals, popups |
| `11-osiris-popup-templates.md` | every non-flight popup verbatim, label layout/paint constants, glyphs, hover and click-priority lists |
| `12-osiris-style-studio.md` | StyleSettings defaults, six preset palettes verbatim, buildVars list, control ranges, sanitize clamps, injected CSS, persistence |
| `13-osiris-brand-assets.md` | screenshots and what they show, logo SVG usage, favicons, manifests, splash choreography, HUD reveal, brand tokens |
| `14-osiris-ai-contracts.md` | overview request/response, Gemini prompts verbatim, alert-digest types and algorithms, analyze/briefing contracts, key rotation |
| `15-osiris-deployment.md` | compose services, tile proxies, middleware, intel service, env → feature matrix, .env drift, Dockerfile/CI/deploy |
| `20-web-osiris-footprint-and-criticism.md` | repo metrics, README vs live drift, releases, viral moment, audits, GitHub issue themes (fabricated data, contract drift, security, legal), comparable products to beat |
| `21-web-flight-path-data-sources.md` | OurAirports, mwgg tz, OpenFlights, VRS standing-data routes, adsb.lol/adsb.fi/airplanes.live, adsbdb/hexdb, OpenSky, FlightPlanDatabase, AeroAPI, AeroDataBox, AirLabs, FAA NASR/ADDS, OpenAIP, Turf/MapLibre geometry, FlightAware/FR24 UX, geocoding, fuzzy search |
| `22-web-stack-and-visual-upgrades.md` | MapLibre 6/deck.gl 9.4/Next 16.3/React 19.3/TS 6-7/ESLint 10/Tailwind 4 gotchas, basemap licensing, GIBS, terminator, satellite.js 7, design references, contrast checks, Playwright/Lighthouse |
| `23-web-feed-verification-matrix.md` | every feed probed live with status, auth, limits, CORS and licence; what broke in 2025–2026; zero-key default vs keyed upgrade per layer |
| `24-web-recon-critic.md` | What the web dossiers missed and which gap-fills answer it |
| `25-web-flights-legality-and-scale.md` | OpenSky ToU, adsb.lol/adsb.fi/airplanes.live/ADSBX/FR24 terms and limits, measured tile sweep, recommended provider adapters |
| `26-web-claude-code-subagent-orchestration.md` | Agent tool semantics, agent files and frontmatter, model selection, built-in types, concurrency/nesting limits, worktree isolation, parallel fan-out, report contract, Opus 5.5 guidance |
| `27-web-osiris-layer-catalogue.md` | rail mechanics, LAYER_GROUPS verbatim, default activeLayers, per-layer loading, per-group styling/popups/click actions |
| `28-web-basemap-and-imagery.md` | CARTO Dark Matter internals and 2026 terms, Esri imagery, terrain, OpenFreeMap restyle path, OpenMapTiles building fields |
| `29-web-cctv-sources-and-compliance.md` | per-agency feeds and licences, tiering, exclusions, player spec, proxy spec, GDPR/takedown design |
| `30-web-tools-audit.md` | engines, geocoders, Web Bluetooth panel and its covert probes, stream IDs, tickers, GeoJSON schema, ArcGIS endpoints |
| `31-web-hosting-limits.md` | function body/duration limits, SSE behaviour, cache handlers |
| `32-web-deckgl-globe-and-3d-tiles.md` | layer compatibility and workarounds for deck.gl 9.4 interleaved on the MapLibre v6 globe, React 19/Next 16 issues, Google Photorealistic 3D Tiles and Cesium ion terms, pricing, attribution and caching rules |
