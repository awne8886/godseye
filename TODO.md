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

## Phase 0 build items per builder (Phase 2 owners)
### map-engine
- [ ] `setMissingStyleImageResolver` for `circle-11` (gold SDF dot); drop `fill-pattern` on `landcover_wood`
- [ ] Explicit `sources.openmaptiles.attribution = BASEMAP_ATTRIBUTION`; per-source attribution Esri/GIBS/Terrarium
- [ ] SAT basemap: `store.basemap` → Esri World_Imagery raster (256, maxzoom 19) beneath labels; MAP|SAT toggle
- [ ] Night lights (Black Marble 2016, GIBS maxzoom 8) via `addProtocol('godseye-night')` alpha from solar
      elevation, LRU + 2-concurrency + abort, refresh 5 min, label "BLACK MARBLE 2016 · REFERENCE"
- [ ] Terrain (Terrarium) + draped layer order; mercator while terrain on; `<Map projection>` gets effective projection
- [ ] 3D buildings (minzoom 14.5, `hide_3d != true`, tokenised paint); geometry worker `src/workers/geometry.ts`
- [ ] Far-side filter with camera altitude (`acos(R/(R+alt))`); pick routing via `choosePick`; `webglcontextlost`
      handling + context fallback ladder; pitch ease on projection switch; GIBS true-colour date chip (yesterday UTC)
- [ ] Double right-click (500 ms/12 px) and long-press → `openDossier`; label density at z 3–5
### design-system-hud
- [ ] Tool strip, panel host (`openPanel`/`pinnedPanels`), entity-card frame, key handler + help overlay from
      `KEY_BINDINGS` (G also disables terrain), cmdk palette (tools/panels/layers/presets + "Dossier at map centre")
- [ ] Share, settings (persisted slice), Style Studio (writes `godseye:theme`, presets as `:root[data-theme]`
      incl. EMBER/MONO/NVG and the researched muted fixes per preset), Ghost last
- [ ] Telemetry SOLAR + Kp, MAP|SAT segmented + scale bar, cursor readout (3 s debounce, 0.1° cache), hint line
- [ ] Status bar: ticker, ONLINE, LEDs; STATUS LIVE only with ≥ 1 live layer; layer count excludes hidden capabilities
- [ ] Splash readiness = map idle + first two core feeds; wordmark visible in SSR (LCP)
- [ ] Mobile nav (7 tabs, 44 px, safe-area) + sheets from `MOBILE_SHEETS`; ≥ 24 px targets everywhere
- [ ] Tokens: panel-rgb/alpha, glass-1/2/3, radius-control/chip, ease-hud, durations, z scale; instrument chrome
      (chip opacity 1); header strap without opacity .4
### layers-aviation
- [ ] adsb.lol tiles (alt_baro "ground", space-padded flight, emergency "none"), mil/ladd/pia merge (no-position
      rows counted, not drawn), columnar < 4 MB; drop airplanes.live; hexdb route path fix + stale label
- [ ] adsbdb identity + thumbnail (never stored), Flight Watch (`watchedFlights` ≤ 6), trails, GPS jam (bad > 0 cells)
### layers-space
- [ ] CelesTrak OMM with error counter + last-good; SatNOGS TLE fallback labelled; 6-digit NORAD ids
- [ ] SWPC: append `Z` to Kp/RTSW times; RTSW active filter; Bt/Bz from rtsw_mag_1m; X-ray class 0.1–0.8 nm;
      alerts `issue_datetime` → ISO; ISS position + SPACE panel (official NASA stream)
### layers-hazards
- [ ] USGS, FIRMS (VIIRS confidence words, MODIS 0–100, columnar), EONET, NWS (zone geometry lookup cached 30 d),
      GDACS geteventlist, NHC cones (mapservices.weather.noaa.gov), GVP RSS (ISO-8859-1), Open-Meteo AQ
      (`openmeteo` capability), RainViewer
### layers-surveillance
- [ ] CCTV keyless providers (Caltrans paged, WSDOT KML, TxDOT new shape, HK TD, LTA, Digitraffic gzip, DriveBC/RWS
      new URLs, NZTA, Trafikverket, …); keyed TfL/511/Seoul/Windy behind capabilities; excluded list honoured
- [ ] Stills-only `/api/cctv/proxy` with exact prefixes; `/api/cctv` lat/lng region select + ETag; live news `/live`
      resolved server-side; report any new media host for `src/config/hosts.ts`
### layers-threats-network
- [ ] GDELT https + multi-window export; GDACS; conflict zones (15 Natural Earth polygons, events at own coords);
      INFORM retry; WGI iso3 join; nuclear Wikidata + OSIRIS merge with seismic/conflict flags
- [ ] URLhaus conditional GET; Feodo honest single live C2; ThreatFox as INDICATOR; never resolve attacker domains;
      co-located points spread, no mesh; `nc_sources` gate; ports WPI + NE; IODA; cables
### panels-alerts-markets-dossier-graph
- [ ] /api/ticker (USGS M ≥ 4 + Binance fallback, per-quote observedAt); markets (Binance/Coinbase/Kraken first,
      CoinGecko only keyed); sessions (12 exchanges); SCM section from maritime feed
- [ ] Alerts: Telegram channel list, ToI/TASS SOURCE OFFLINE, SCMP http redirect refused; desktop Intel Feed
- [ ] Dossier (`dossierTarget`), entity graph (QID/OpenSanctions person nodes only), AI: key header only, no-store,
      never logged; drop citations not in the prompt; SDK ingest Bearer timingSafeEqual + body cap
### panels-recon
- [ ] Search (Photon debounce/cache → Nominatim queue), directions (lat,lng + via + mode aliases), draw, ArcGIS any
      public Feature/MapServer via `safeFetch`, OSINT passive tools (crt.sh 20 s + 1 retry), scanner (key in
      Authorization header, pinned IP, passive default, active behind `SCANNER_ALLOW_ACTIVE`), World Remote without
      RTCPeerConnection/localhost probing
### feature-flight-paths
- [ ] OurAirports + mwgg + VRS routes; FAA airways build-time snapshot; METAR/TAF (999999 → null, error-in-body);
      winds aloft multi-coordinate single request + 1 h grid cache (`skipped: 'budget'` when limited); planner,
      live aircraft on route, track my flight (`flightIdent`)
### pages-docs-privacy-ops
- [ ] `/docs` (from API_CATALOG) and `/privacy`; CI workflow; Docker; DATA_SOURCES.md licences (abuse.ch, InternetDB,
      ip-api, OpenSanctions, TeleGeography, gpsjam, OpenFlights ODbL)

## Upstream risks to design around (from probes, 2026-09-30)
- CoinGecko keyless 429 and Open-Meteo daily 429 on shared egress; CelesTrak TLS resets (firewall after 50 errors/2 h)
- ToI and TASS RSS 403; GDELT DOC API 1 req/5 s; crt.sh 404/13 s; RIPEstat 8 concurrent, 1000/day; NVD 5/30 s
- Payload sizes: gpsjam 5.2 MB, FIRMS ~20 MB/15 min, adsb.lol sweep ~35 MB inbound → columnar responses

## Known gaps carried into Phase 1–2
- [ ] map-engine: tune label density at z 3–5 (state/oblast labels crowd the view)
- [ ] pages-docs-privacy-ops: `/docs` and `/privacy` (Link prefetch 404 until built)
- [ ] lead: flip `CHECK_CATALOG_COMPLETENESS=1` in CI once every catalogue route exists
- [ ] lead: add each builder's reported operator media hosts to `src/config/hosts.ts` (CSP)
