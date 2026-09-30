# GODSEYE — working checklist

Kept current by the lead after every phase. The build is done when this file is empty (§11).

## Setup (lead) — done
- [x] Next 16.3.7 + React 19.3 + TS 6 strict + Tailwind 4 + ESLint 10 flat config; pinned deps
- [x] MapLibre 6 worker recipe (vendored worker + shared module, `setWorkerUrl`, Turbopack loader, immutable cache)
- [x] Contracts: zod schemas (`src/lib/schemas/*`) + inferred types, layer/tool registries, keyboard map,
      API catalogue, capabilities, design tokens (CSS + TS mirror), feature-module + layer-host stores, URL state
- [x] Utilities with tests: http, SSRF guard, cache/SnapshotStore (memory/fs/Redis), feeds/poller,
      rate limits + provider buckets, SSE hub, responses (ETag/304, precompressed, 4 MB cap), geo, solar,
      freshness, columnar, CSV, RSS, geocoder queue
- [x] Globe shell: restyled OpenFreeMap globe, atmosphere, twilight terminator, deck overlay host,
      minimal HUD (header, telemetry, rail, 3D/2D, splash, overlays, status bar), /api/health, /api/stats, e2e smoke
- [x] CLAUDE.md, `.claude/rules/*`, `.claude/settings.json` (worktree baseRef head), 16 agents, `.env.example`, LICENSE + NOTICE

## Phase 0 (6 researchers) — contract and security fixes applied by the lead
- [x] Security S1–S8: IPv4-mapped/NAT64/3fff::/20/5f00::/16 blocked; bounded decode; cross-origin credential
      strip + https→http refusal on redirect; `safeFetch` defaults (no retry, 8 s, 20 s deadline, 2 MB,
      injectable resolver, rebinding-safe lookup); allow-list prefixes end in `/`; client IP trusts platform
      headers only when the platform is declared (`TRUSTED_PLATFORM`/Vercel); IPv6 /64 buckets; atomic Redis
      window; AI/scanner fail closed; shared `ai` bucket; `withRoute` limits from the catalogue; SSE per-IP cap 4
- [x] Schemas: FLIGHT_FIELDS altGeomFt + airlineCode, counts.noPosition, photoThumbUrl; ThreatIndicator
      (nullable geo, firstSeen/tags/threatfoxId); ConflictZone anchor/region + ConflictsResponse.events (own
      coords, ≤ 500); GdeltEvent rootCode/numMentions/numSources/dateAdded + window/scanned; DirectionsResponse
      routes[] with toll/highway/ferry + ascent/descent; RegionDossier nearby counts {count,state};
      AiOverviewResponse fallbackReason/keySource; AirportWeather altimHpa/gustKt/clouds; GpsJam bad/suspect;
      SpaceWeather solarWind.source; Market sessions; AlertItem views/forwardedFrom/replyTo; Port volume/fleet
- [x] Capabilities: wsdot, trafikverket, ibi511, cloudflare (not with COMMERCIAL_DEPLOYMENT), ai_user_keys,
      scanner_active, openmeteo; `nc_sources` gate on malware/cyber_attacks/threatfox
- [x] Registries: pickPriority + `choosePick`; day_night and gibs_truecolor are REFERENCE; PANELS `live-news`,
      `presets` + launcher; MOBILE_SHEETS keep every tool reachable; key `0` = sensor off, repeat/IME ignored;
      REGION_PRESETS + deterministic landing city (`src/lib/presets.ts`)
- [x] Store: `openPanel`, `dossierTarget`/`openDossier`, `watchedFlights` (≤ 6), `plannedRoute`, `flightIdent`,
      `cameraFromUrl`, persisted `settings` (units, motion, geoConsent, previewAutoplay, aiProvider)
- [x] URL: `?pinned=`, `?route=`, `?flight=`, `?dossier=` written back; OSIRIS `?lat=&lon=&zoom=` read and rewritten
- [x] Tokens: `--text-muted` #848178 (4.5:1 on tertiary and glass); `parseCssColor` + canvas probe in
      `readCssColor`; attribution background .88 and bottom controls above overlays; Space Grotesk not
      preloaded; pre-paint `data-theme` script (`src/lib/theme-boot.ts`, key `godseye:theme`)
- [x] CSP hosts path-scoped (S3 bucket, Esri World_Imagery, GIBS wmts, RainViewer); creodias + Telegram
      image hosts; official HLS/mp4 media hosts (TfL, NV, LA, IN, Telegram)

## Phase 1 (2 contract reviewers) — 2 blocking + 14 major fixed by the lead, regression tests in `src/lib/regression/`
- [x] B1 poller honours the error back-off (`dueForRefresh`, `refresh({force})`); B2 `allowListedFetch` re-checks
      allow-list + SSRF guard on every hop (next/image `maximumRedirects: 0`)
- [x] SSE: idempotent per-IP release on every exit path, slow-consumer drop (2 MB), encode-once broadcast,
      bare-CR line breaks, default max duration on Vercel
- [x] Cache: owner-token locks with compare-and-delete, fetch deadline + AbortSignal below the lock TTL, feed
      snapshots pinned (never evicted by per-query caches), 304-without-data recorded, provider age refreshed
      on 304, FileStore deletes expired files, L1 on globalThis
- [x] Rate limits: `x-real-ip` only via `TRUST_PROXY_HEADER`, `TRUSTED_PROXY_HOPS`, Redis Lua fixed window,
      expired-first eviction (saturation denies fail-closed buckets), `providerBucket` rate mismatch throws
- [x] `runProvider(..., {allowEmpty})`; `FeedDef.maxObservationAgeMs`, `deadlineMs`, `ctx.signal`
- [x] http: stricter UA (browser tokens refused), more forbidden headers incl. Host/Via, POST→GET on 301/302/303,
      stacked/unknown encodings rejected, deadline covers DNS checks and limiter waits
- [x] respond: 503 SOURCE OFFLINE is `no-store`, ETag variant defaults to the query, `q=0` honoured,
      `withRoute` refuses paths missing from the catalogue (dev/test)
- [x] geocoder: clamped cache keys, single-flight + cache re-check inside the Nominatim queue, Photon bucket;
      RSS links http(s) only; `GODSEYE_CONTACT` validated; HSTS `preload` opt-in (`HSTS_PRELOAD`)
- [x] Freshness: REFERENCE without observedAt, future stamps never LIVE, `entityFreshness()` +
      `OBSERVATION_CADENCE_MS` (events inherit the feed state), `normalizeUtc()`
- [x] Schemas: compact FLIGHT_FIELDS (seenAt s, src index + `sources`, int bucket, 0/1 flags; 24k rows < 4 MB),
      FIRE_FIELDS columnar (≤ 30k rows), caps on vessels/GDELT/gpsjam/orbits, `LocalTime` for airport-local times
      + `etaTz`, trimmed callsign regex, `posSource`/`emergencyStatus`, `CAMERA_FIELDS` + source, date types,
      `AttackOrigin.targetCountryCode` (arcs only when both ends are reported)
- [x] Client state: longitudes wrapped in `?c=`/`?dossier=`, empty components rejected, dossier ⇔ panel
      invariant, pinned ≤ 6 and never the open panel, `~hex` watchable, 3–8 char route idents + `~` for
      hyphenated idents, junk `?layers=` ignored, Intel Feed dedupe per layer + time sort, `defaultLayersFor()`
- [x] Orchestration: CLAUDE.md lists every lead-owned file; builders own `e2e/<agent>/**` and
      `docs/data-sources/<agent>.md`; rules globs cover panel server code; auditors run in worktrees;
      builders have explicit `tools:`; route names match the catalogue (aliases noted)

## Phase 1 follow-ups for Phase 2 builders
- [x] design-system-hud: apply `defaultLayersFor(capabilities)` once /api/health loads, before the first URL write
- [ ] map-engine: build the worker URL from `maplibregl.getVersion()`; store `normalizeLng` camera
- [x] layers-aviation: trim/upper-case callsigns; emit the compact FLIGHT_FIELDS row + `sources`
- [x] layers-hazards: fires as FIRE_FIELDS columnar; Sentinel quicklooks by final (zipper) URL, no redirects
- [x] layers-threats-network: GDACS `geteventlist/SEARCH?eventlist=…` (MAP returns 400); lower-case alert
      levels, `url.report`; GDELT zip URLs upgraded to https; Cloudflare origins as points unless a target exists
- [x] layers-surveillance: TfL mp4 via plain `<video src>` (no CORS); cameras carry `source`
- [x] feature-flight-paths: `LocalTime` with offsets (`etaTz`), never offset-less local strings
- [x] pages-docs-privacy-ops: compile `docs/DATA_SOURCES.md` from `docs/data-sources/*.md`; Dockerfile runs
      `pnpm build` (prebuild vendors the worker) and copies `public/` into the standalone image; compose Caddy
      overwrites XFF (`header_up X-Forwarded-For {remote_host}`); ARCHITECTURE.md records the accepted
      trade-offs (CSP `'unsafe-inline'` for Next inline scripts, `worker-src blob:` for MapLibre's module
      shim, `x-real-ip` opt-in, muted token #848178)
- [ ] lead (Phase 3): scope the §11 branding grep to shipped UI/docs (the HORUS preset is required by §5;
      the MIT NOTICE must credit OSIRIS; internal `osiris` catalogue flags are not branding)

## Phase 2 wave A — merged (map-engine, design-system-hud, layers-aviation, layers-space, layers-hazards, pages-docs-privacy-ops)
- [x] All six branches merged; lint, typecheck, 687 unit tests, build green after every merge
- [x] Shared-file requests applied (tokens, IMAGE_HOSTS, LayerStatus.attribution, agentRules off, sandbox proxy for
      Playwright, Turbopack alias for satellite.js multi-thread WASM, docs scripts, js-yaml, image-size 2.0.4 override)
- [x] map-engine (integration round): ONE click router (deck + native + CPU hit-testers → `choosePick`), aviation and
      hazards migrated off their own `map.on('click')`; `ready` after load; tokens re-read on `godseye:style`
- [ ] map-engine (integration round): startup performance — CI Lighthouse on `/` is 0.61 / TBT 1710 ms (need ≥ 0.85 / ≤ 300 ms)
- [ ] map-engine: merged-main e2e regressions (terrain → mercator at z ≥ 10, double-right-click dossier, OSM
      attribution on mobile); worker URL from `maplibregl.getVersion()`; label density z 3–5; imagery chips vs mobile nav
- [x] design-system-hud (integration round): MAP|SAT control, scale bar + cursor readout from `src/lib/map/cursor.ts`,
      terrain status, `LayerStatus.attribution` in flyouts/sources panel, real cards/panels end-to-end, label-in-name,
      space e2e locators
- [ ] layers-aviation: full adsb.lol sweep takes ~170 s, so most aircraft render frozen/dimmed (honest but sparse) —
      find a keyless cadence that keeps positions ≤ 60 s where possible; flight-route `basis: 'observed'` via traces
- [ ] layers-space: verify the 8 unverified CelesTrak group names; satellite IconLayer (mission glyphs) instead of
      ScatterplotLayer; catalogue 3.18 MB (cap at ~21.9k rows) — split by group if the catalogue grows
- [ ] layers-hazards: NWS alerts without geometry are `unplacedAlerts` until the zone cache fills (120/refresh);
      OpenAQ/WAQI keyed adapters unwired (no keys to test) — shown as skipped: not-configured
- [ ] pages-docs-privacy-ops follow-up: README screenshots (Phase 3); confirm the Lighthouse desktop preset choice

## Phase 2 wave B + integration — merged (surveillance, threats-network, alerts/markets/dossier/graph, recon, flight paths)
- [x] All five branches + both integration rounds merged; 1,113 unit tests, lint, typecheck, build green;
      every catalogued route mounted (`CHECK_CATALOG_COMPLETENESS=1` in CI)
- [x] Cross-builder links: aircraft card → PATHS, palette route/flight commands, SCM alerts only on live risk
- [ ] CI red: desktop e2e (HUD panel launchers, Style Studio, double-right-click dossier) and Lighthouse on `/`
      (0.61 perf / 1.7 s TBT on the last measured run; the space client's 3 MB satellites parse + clone should
      move into `src/workers/tle-propagate.ts`)
- [ ] layers-surveillance: IBI 511, Windy, INDOT, MLIT, Edmonton, Via Lietuva not wired; Trafikverket untested live
- [ ] layers-threats-network: polygon clicks (zones, risk, frontlines, cables) unverified in the sandbox; alert
      pins not yet counted in conflict zones; AIS relay + Cloudflare untested live (keys); DeepState proxying
      needs the operator's approval — keep `deepstate` off by default and say so in docs
- [ ] panels-alerts: true token streaming for chat needs a streaming reader in `http.ts` (lead); alert pins
      import hazards' `useGeoJsonLayers` (move to a shared map helper)
- [ ] panels-recon: drawn shapes/routes/ArcGIS layers clickable via `drawn_shape` (kind added); sweep limited to
      /28–/32 by the catalogue
- [ ] feature-flight-paths: AeroAPI unwired, FAA airways skipped (quota); comet head / pulsing endpoints / reverse
      arc / route clicks; panel title "FLIGHT PATHS" per §8

## Phase 3 round 1 — 8 verifiers (R1–R4, visual-qa, perf, security, docs); fixes merged (029fc3c)
Findings: `phase3/round1/*.md` in the lead scratchpad. 7 BLOCKING, ~35 MAJOR, ~80 MINOR. Fixed by the lead:
security (cross-site POST 403, streamed body caps, redirect header allow-list, secret redaction, IPv6 zone/48,
SSE global budget, bounded memory/file caches, ArcGIS limit, dev-dep overrides, proxy-trust warning), one NVD
bucket, feedJson compression, 17 unwired capabilities removed, LICENSE NOTICE, README/catalogue honesty (TTLs,
receivers, OSIRIS strings), `/api/stats` cameras. Fixed by owners (11 worktrees): attribution visibility,
sources register (113 entries), deep links vs intro, click-only deck picking, antimeridian tracks, §8 styling,
dossier nearby layers, markets chip truth, live NACp, malware count/co-location, KEV events, keyless cameras
(no 503), TfL key in header, narrowed allow-lists, ArcGIS allow-list, directions snap gate, classifier parity,
lazy layers (initial JS 560 → ~459 KB gz), worker-side satellite parse, /docs try-it/⌘K (LH 0.99), Docker
hardening.
- [ ] Lighthouse `/`: perf 0.54, TBT 4.1 s on c25edd6 (budget 0.85 / 300 ms); initial JS ~459 KB gz (350) —
      dedicated map-engine perf task in progress
- [ ] aviation: 40–79 % of positions older than 60 s after a few minutes under adsb.lol 429 on shared egress;
      `ADSBLOL_REAPI` is the real fix; rail shows the stale count
- [ ] feature-flight-paths: FAA airways layer (needs a cached, quota-aware provider); ArcLayer arc height and
      deck extensions dashes; R4 minors m2, m5, m7, m8
- [ ] layers-surveillance: INDOT, Edmonton, Via Lietuva, MLIT, Skyline link-out rows (R2-M4); camera card footer
      on phones (m21); example camera ids for `/api/cctv/{resolve,stream-status,texas/snapshot}` docs
- [ ] panels-recon: redirects within `*.arcgis.com` may change path (needs a path-pattern option on AllowRule)
- [ ] map-engine: dark triangle artefact (m13) not reproduced; label density at z 3–5
- [ ] panels: Telegram channel cache 2 min (brief asked 3); HKEX holidays from a secondary source — verify
- [ ] pages-docs-privacy-ops: pin Caddy/Redis images by digest (Docker Hub 429); README screenshots (visual-qa
      round 2, WebP)
- [ ] dev-only advisories: extract-zip, uuid under @lhci/cli (no patched release)

## Phase 0 build items per builder (Phase 2 owners)
### map-engine
- [x] `setMissingStyleImageResolver` for `circle-11` (gold SDF dot); drop `fill-pattern` on `landcover_wood`
- [x] Explicit `sources.openmaptiles.attribution = BASEMAP_ATTRIBUTION`; per-source attribution Esri/GIBS/Terrarium
- [ ] SAT basemap: `store.basemap` → Esri World_Imagery raster (256, maxzoom 19) beneath labels; MAP|SAT toggle
- [x] Night lights (Black Marble 2016, GIBS maxzoom 8) via `addProtocol('godseye-night')` alpha from solar
      elevation, LRU + 2-concurrency + abort, refresh 5 min, label "BLACK MARBLE 2016 · REFERENCE"
- [x] Terrain (Terrarium) + draped layer order; mercator while terrain on; `<Map projection>` gets effective projection
- [x] 3D buildings (minzoom 14.5, `hide_3d != true`, tokenised paint); geometry worker `src/workers/geometry.ts`
- [ ] Far-side filter with camera altitude (`acos(R/(R+alt))`); pick routing via `choosePick`; `webglcontextlost`
      handling + context fallback ladder; pitch ease on projection switch; GIBS true-colour date chip (yesterday UTC)
- [ ] Double right-click (500 ms/12 px) and long-press → `openDossier`; label density at z 3–5
### design-system-hud
- [x] Tool strip, panel host (`openPanel`/`pinnedPanels`), entity-card frame, key handler + help overlay from
      `KEY_BINDINGS` (G also disables terrain), cmdk palette (tools/panels/layers/presets + "Dossier at map centre")
- [x] Share, settings (persisted slice), Style Studio (writes `godseye:theme`, presets as `:root[data-theme]`
      incl. EMBER/MONO/NVG and the researched muted fixes per preset), Ghost last
- [ ] Telemetry SOLAR + Kp, MAP|SAT segmented + scale bar, cursor readout (3 s debounce, 0.1° cache), hint line
- [x] Status bar: ticker, ONLINE, LEDs; STATUS LIVE only with ≥ 1 live layer; layer count excludes hidden capabilities
- [x] Splash readiness = map idle + first two core feeds; wordmark visible in SSR (LCP)
- [x] Mobile nav (7 tabs, 44 px, safe-area) + sheets from `MOBILE_SHEETS`; ≥ 24 px targets everywhere
- [x] Tokens: panel-rgb/alpha, glass-1/2/3, radius-control/chip, ease-hud, durations, z scale; instrument chrome
      (chip opacity 1); header strap without opacity .4
### layers-aviation
- [x] adsb.lol tiles (alt_baro "ground", space-padded flight, emergency "none"), mil/ladd/pia merge (no-position
      rows counted, not drawn), columnar < 4 MB; drop airplanes.live; hexdb route path fix + stale label
- [x] adsbdb identity + thumbnail (never stored), Flight Watch (`watchedFlights` ≤ 6), trails for watched aircraft
### layers-space
- [x] CelesTrak OMM with error counter + last-good; SatNOGS TLE fallback labelled; 6-digit NORAD ids
- [x] SWPC: append `Z` to Kp/RTSW times; RTSW active filter; Bt/Bz from rtsw_mag_1m; X-ray class 0.1–0.8 nm;
      alerts `issue_datetime` → ISO; ISS position + SPACE panel (official NASA stream)
### layers-hazards
- [x] USGS, FIRMS (VIIRS confidence words, MODIS 0–100, columnar), EONET, NWS (zone geometry lookup cached 30 d),
      GDACS geteventlist, NHC cones (mapservices.weather.noaa.gov), GVP RSS (ISO-8859-1), Open-Meteo AQ
      (`openmeteo` capability), RainViewer, GPS jam (gpsjam daily H3, bad > 0 cells, columnar), Sentinel (CDSE STAC)
### layers-surveillance
- [x] CCTV keyless providers (Caltrans paged, WSDOT KML, TxDOT new shape, HK TD, LTA, Digitraffic gzip, DriveBC/RWS
      new URLs, NZTA, Trafikverket, …); keyed TfL behind its capability (511 keys, Seoul, Windy not wired —
      their capabilities were removed in Phase 3); excluded list honoured
- [x] `/cameras-notice` page + "Report / remove this camera" on every feed + region link-out-only mode (§0.7)
- [x] Stills-only `/api/cctv/proxy` with exact prefixes; `/api/cctv` lat/lng region select + ETag; live news `/live`
      resolved server-side; report any new media host for `src/config/hosts.ts`
### layers-threats-network
- [x] GDELT https + multi-window export; GDACS; conflict zones (15 Natural Earth polygons, events at own coords);
      INFORM retry; WGI iso3 join; nuclear Wikidata + OSIRIS merge with seismic/conflict flags
- [x] URLhaus conditional GET; Feodo honest single live C2; ThreatFox as INDICATOR; never resolve attacker domains;
      co-located points spread, no mesh; `nc_sources` gate; ports WPI + NE; IODA; cables
### panels-alerts-markets-dossier-graph
- [x] /api/ticker (USGS M ≥ 4 + Binance fallback, per-quote observedAt); markets (Binance/Coinbase/Kraken first,
      CoinGecko only keyed); sessions (12 exchanges); SCM section from maritime feed
- [x] Alerts: Telegram channel list, ToI/TASS SOURCE OFFLINE, SCMP http redirect refused; desktop Intel Feed
- [x] Dossier (`dossierTarget`), entity graph (QID/OpenSanctions person nodes only), AI: key header only, no-store,
      never logged; drop citations not in the prompt; SDK ingest Bearer timingSafeEqual + body cap
### panels-recon
- [x] Search (Photon debounce/cache → Nominatim queue), directions (lat,lng + via + mode aliases), draw, ArcGIS any
      public Feature/MapServer via `safeFetch`, OSINT passive tools (crt.sh 20 s + 1 retry), scanner (key in
      Authorization header, pinned IP, passive default, active behind `SCANNER_ALLOW_ACTIVE`), World Remote without
      RTCPeerConnection/localhost probing
### feature-flight-paths
- [x] OurAirports + mwgg + VRS routes (FAA airways snapshot NOT built — quota; see Phase 3); METAR/TAF (999999 → null, error-in-body);
      winds aloft multi-coordinate single request + 1 h grid cache (`skipped: 'budget'` when limited); planner,
      live aircraft on route, track my flight (`flightIdent`)
### pages-docs-privacy-ops
- [x] `/docs` (from API_CATALOG) and `/privacy`; CI workflow; Docker; DATA_SOURCES.md licences (abuse.ch, InternetDB,
      ip-api, OpenSanctions, TeleGeography, gpsjam, OpenFlights ODbL)

## Upstream risks to design around (from probes, 2026-09-30)
- CoinGecko keyless 429 and Open-Meteo daily 429 on shared egress; CelesTrak TLS resets (firewall after 50 errors/2 h)
- ToI and TASS RSS 403; GDELT DOC API 1 req/5 s; crt.sh 404/13 s; RIPEstat 8 concurrent, 1000/day; NVD 5/30 s
- Payload sizes: gpsjam 5.2 MB, FIRMS ~20 MB/15 min, adsb.lol sweep ~35 MB inbound → columnar responses

## Known gaps carried into Phase 1–2
- [ ] map-engine: tune label density at z 3–5 (state/oblast labels crowd the view)
- [x] pages-docs-privacy-ops: `/docs` and `/privacy` (Link prefetch 404 until built)
- [x] lead: flip `CHECK_CATALOG_COMPLETENESS=1` in CI once every catalogue route exists
- [x] lead: add each builder's reported operator media hosts to `src/config/hosts.ts` (CSP)
