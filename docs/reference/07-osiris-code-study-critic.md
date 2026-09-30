# Code-study critic: coverage assessment and gaps
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
The critic reviewed the six code readers above and named the gaps filled in files 08–15.

## Assessment

Coverage is strong for the map engine (MapLibre 6.7 globe, worker vendoring, terrain, the instanced satellite layer), the HUD shell, aviation/space/earth routes, the geo/media routes and the reusable pieces for the airport-to-airport feature (airports.ts has 375 tuples, which I verified; greatCirclePoints, splitAtAntimeridian, lib/geo.ts). My spot-checks confirmed most of the quoted constants: the createIcon polygon, setVis wiring, ALERT_KINDS colours (rocket #FF3D3D, event #FF9500, news #00E5FF), the activeLayers defaults and the /api/geo shape.

Caveat: only 4 of the 6 reader results reached me. The 4th was truncated partway through /api/cctv. So I cannot confirm whether maritime/AIS, cyber (URLhaus/Feodo), nuclear infrastructure, CCTV region fetchers, OSINT or deployment were covered elsewhere. I checked those in the repo and list them below.

Contradictions and corrections:
- map-core says '~350 airports'. The code has exactly 375 RAW tuples.
- CctvStreamType in src/app/api/cctv/types.ts is 'jpg'|'hls'|'iframe'|'mjpeg', with no 'mp4'. Yet src/lib/camera-preview.ts:12 PreviewKind and CameraViewer.tsx:131/316 handle 'mp4'. The builder needs both unions.
- Conflict colours differ between the map icons (#D32F2F/#E65100/#F9A825) and the popup SEVERITY text (#FF1744/#FF9500/#FFD500). Both are real, so this is not an error, but it must be copied separately.
- /api/geo always answers in the ip-api shape (status, lat, lon, city, regionName, country, query, isp, org, as), including the normalised ipapi.co and freeipapi branches. In production with no visitor IP it returns {status:'fail'}.
- /api/geo/reverse is Nominatim (via lib/nominatim queue), not Photon. It rounds to a 0.1° grid, uses zoom=10 and addressdetails=1, and returns {label:'city, state, country'|null, attribution}. Cache-Control is s-maxage=2592000, max-age=86400.

Nothing in the repo supplies generic airport-pair schedules. A purely geometric planned path is the only in-repo basis.

## Gaps identified

### 1. There is no single wiring table from layer key → fetch URL + transform → dataRef key → GeoJSON source → layer ids → visibility rule. Hidden or always-on keys are not called out either.

- Why it matters: Readers listed the sources, layers and panel labels separately. A builder still has to guess the mapping, and some of it is unexpected:

Fetch transforms (verified):
- /api/maritime → {maritime_ports:d.ports, maritime_chokepoints:d.chokepoints, maritime_ships:d.ships}
- /api/live-news → live_feeds
- /api/weather → weather_events
- /api/infrastructure → infrastructure
- /api/gdelt → gdelt
- /api/cyber-attacks → cyber_attacks:d.indicators
- /api/cloudflare-radar → cf_outages / cf_attack_origins
- /api/satellites → {...d, satellites_at:d.timestamp}
- /api/news → newsTransform: {news, news_meta:{sources, fetchedAt}, alert_pins: news.filter(n=>n.place)}

Keys with odd behaviour:
- 'cables' is a hidden key, default true. It fetches /data/submarine-cables.json?v=<Date.now()> into submarine_cables.
- 'conflict_zones' has no panel toggle and is visible unless it is exactly false.
- 'internet_outages' does not exist in the defaults, but it OR-gates the network-mesh layers.
- 'war_alerts' defaults false and has no UI.

On the panel, sdk_sea's count reads sdk_entities, which is built client-side: about 60 sampled flights, about 60 ships, all quakes, gdelt and news. But the layer actually draws submarine cables.
- Where to look: src/app/page.tsx:141-146 (newsTransform), 326-370 (defaults), 733-855 (layer fetches), 857-899 (polls), 975-1048 (sdk_entities); src/components/OsirisMap.tsx:2371-2409 (setVis); src/components/LayerPanel.tsx:52-152 (dataKey/catKey)

### 2. The maritime/AIS pipeline is not documented. That covers the aisstream subscription, ship-type mapping, ship expiry, port congestion, dynamic chokepoint risk and the snapshot TTL.

- Why it matters: The Maritime layer is on by default, and the ship/port/chokepoint colours depend on these rules.

AIS subscription (verified):
- wss://stream.aisstream.io/v0/stream, env AIS_API_KEY.
- BoundingBoxes: Tokyo Bay, Hormuz, Suez, Bab el-Mandeb, Panama, Malacca/Singapore, Taiwan Strait, Rotterdam/Channel, LA/LB, plus a global [[-90,-180],[90,180]].
- FilterMessageTypes ['PositionReport','ShipStaticData'].
- Reconnects 5 s after close.

Ship handling:
- Type mapping: 80-89 tanker, 70-79 cargo, 35 military, else cargo.
- Position from Sog/TrueHeading||Cog.
- Ships are dropped after 10 min without an update; at most 20,000 are kept (FIFO).

Ports: 52 PORTS, each {name, country, lat, lng, type container|energy|naval, volume, rank?, fleet?}. Congestion counts ships within 50 km and treats speed <0.5 as waiting (non-military):
- SEVERE if waiting ratio >0.6 or more than 30 waiting.
- CONGESTED if ratio >0.4 or more than 15 waiting.
- Also computes dwell_time.

Chokepoints: 10 CHOKEPOINTS with static risk, including 'MODERATE', which has no colour case on the map and so falls to #26A69A. Dynamic risk counts ships within 100 km:
- more than 50 → CRITICAL
- more than 20 → HIGH
- more than 5 and currently LOW → ELEVATED
- traffic string gets ' | LIVE SHIPS: n' appended.

Response and caching:
- {ports, chokepoints, ships, total_ports, total_chokepoints, total_ships, timestamp}.
- SNAPSHOT_TTL_MS 5000; Cache-Control max-age=5, s-maxage=5, swr=15.
- Ships carry mmsi, but the map features drop it. This is the ship-popup 'mmsi:undefined' bug.
- Where to look: src/app/api/maritime/route.ts:9-82 (PORTS, CHOKEPOINTS), 100-205 (AIS client), 231-347 (snapshot, congestion, dynamic risk, GET)

### 3. The cyber layer upstreams and data shapes are missing: the Live Malware pipeline over URLhaus + ip-api over SSE, and Botnet C2 from Feodo.

- Why it matters: Readers give only the SSE event names. The source feed, geolocation method, cadence and record fields are not given, so the malware dots, labels and popups cannot be reproduced.

Live Malware (verified):
- Upstream: https://urlhaus.abuse.ch/downloads/csv_recent/, POLL_MS 60000.
- Geolocation via http://ip-api.com/batch?fields=status,countryCode,city,lat,lon,as,query: GEO_BATCH_SIZE 100, GEO_BATCHES_PER_POLL 8, GEO_BATCH_GAP_MS 4000, GEO_TTL_MS 24 h, GEO_RETRY_MS 10 min, MAX_GEO_ENTRIES 5000.
- SSE framing: `data: <json>\n\n`.
  - {type:'snapshot', detections, cursor, total}
  - {type:'detections', fresh, detections}
  - {type:'status', total, cursor, lastPollAt, error, retired[]}
  - {type:'heartbeat', at} every 15 s
- Detection/HostGroup/GeoResult types are in lib/malware-intel.ts. The map label field is 'malware'.

Botnet C2:
- Upstream: https://feodotracker.abuse.ch/downloads/ipblocklist.json, TTL 300 s.
- Coordinates are the hosting-country centroid (location_precision 'country'), never a host fix.
- Indicator fields: id, ip, port, status, malware, as_number, country, first_seen, last_online, lat, lng.
- Payload: {indicators, total, online, fetched_at, source, source_url}.
- Where to look: src/lib/malware-live.ts:57-105,288,383-461; src/lib/malware-intel.ts:79-99; src/app/api/malware/stream/route.ts:30-75; src/app/api/cyber-attacks/route.ts:30-74; src/lib/c2-indicators.ts:25-124

### 4. The exact popup HTML templates and symbol-label layout constants for non-flight entities were never quoted.

- Why it matters: Only the flight popup was reproduced verbatim. For the other popups (quake, fire, GDACS, conflict, GDELT event, CF outage/attack, vessel, port, chokepoint, nuclear, weather, alert pin, malware, C2, news) readers gave field lists only. There are no label/value colours, font sizes or link-button markup.

The map labels have about 20 distinct text-size/offset/minzoom values. Examples:
- conflict labels: text-size interpolate 1:7, 4:9, 8:11
- eq-label: size 9, offset [0,1.5]
- malware labels: 8/9 in ['JetBrains Mono Bold','Open Sans Bold']

A 1:1 visual replica needs these verbatim.
- Where to look: src/components/OsirisMap.tsx:438-897 (layer paint/layout), 1104-1118, 1211-1386, 1558-1740, 2306-2365 (popup HTML builders)

### 5. The Style Studio preset palettes, the buildVars variable list and each control's default and range are not quoted.

- Why it matters: Readers named the 6 presets and sections only. The exact values are in the code, for example:
- TERMINAL: accent #00ff9c, accent2 #00b36b, bg #000a06, …, scanlines 0.05
- CRIMSON: accent #ff4d5a / #ff9500
- ARCTIC: #8fd3ff / #4fc3f7
- BLACKOUT: #9e9e9e / #616161, glow 0.08
- PHANTOM: textMuted #6a4c93, which differs from the ghost theme's #4A148C

buildVars writes about 34 variables, e.g. --gold-light = shade(accent, 0.35) and --gold-dim = shade(accent, -0.45). Without these the builder has to invent the palettes and the derivation.
- Where to look: src/lib/style-tokens.ts:26-119 (settings, defaults, PRESETS at 113-118), 226-264 (buildVars/buildCss); src/components/StyleStudio.tsx (control ranges)

### 6. The visual reference assets and brand files the builder should copy or consult were not mentioned.

- Why it matters: No reader mentioned these files:
- Screenshots: docs/screenshots/taiwan-cctv.jpg, seoul-live-cctv.jpg and save-an-area.jpg, embedded in README.md:25-35.
- The Eye-of-Horus logo: an inline SVG path at page.tsx:1401 (viewBox 0 0 650 500) and public/eye-of-horus.svg.
- Favicons (favicon.svg, favicon-32.svg, png sizes), og-image.png, manifest.json and site.webmanifest.

Without them a 1:1 logo, splash and HUD look has to be guessed.
- Where to look: docs/screenshots/*.jpg; README.md:20-40; public/eye-of-horus.svg; src/app/page.tsx:1398-1445; public/manifest.json; src/app/layout.tsx

### 7. The request/response contract of the AI Overview and the AlertBrief structure are missing, as are the sibling /api/ai/analyze and /api/ai/briefing routes.

- Why it matters: The AI OVERVIEW UI renders fields the readers never defined.

Contract (verified):
- POST body {mode:'alerts'|'markets'|'chain', payload}.
- Rate limit 20 per client IP; returns 429 or 400 on error.
- Response {mode, overview, highlights, generatedBy:'gemini'|'analyst', generatedAt, brief? (alerts only)}.
- Uses GEMINI_API_KEY_1..8 with model 'gemini-2.0-flash' and systemInstruction SYSTEM_ALERTS/SYSTEM_DEFAULT, falling back to heuristicOverview.

The brief's shape comes from lib/alert-digest.ts AlertBrief/AlertThread (buildAlertBrief, buildThreads). The analyze and briefing routes accept an x-gemini-key header, which the readers only mention in passing.
- Where to look: src/app/api/ai/overview/route.ts:24-349; src/lib/alert-digest.ts:36-110,293-400 (DigestReport, AlertThread, AlertBrief, buildAlertBrief); src/app/api/ai/analyze/route.ts; src/app/api/ai/briefing/route.ts; src/lib/ai-engine.ts; src/components/AiOverview.tsx

### 8. The deployment topology, env vars and middleware behaviour are not covered. This includes the second tile proxy.

- Why it matters: docker-compose.yml runs three services:
- osiris
- osiris-cache (nginx:alpine on :8080): a 10 GB/365-day tile_cache for CARTO at /proxy/tiles/<[a-d].basemaps.cartocdn.com>/…, plus gzip for APIs. The comment says /api/cctv?region=all is ~4.3 MB and gzips to ~0.5 MB.
- osiris-intel (:4000)

src/middleware.ts fires bounded Umami page-view and IP events to http://umami-umami-1:3000/api/send.

.env.example lists SCANNER_URL/KEY, CLOUDFLARE_API_TOKEN, ETHERSCAN_API_KEY, HELIUS_API_KEY, FIRMS_API_KEY, OPENSKY_CLIENT_ID/SECRET, N2YO_API_KEY, AIS_API_KEY and OSIRIS_PORT.

A builder needs to decide which tile proxy is canonical (nginx or /api/proxy-tiles) and which env vars gate which layers.
- Where to look: docker-compose.yml; nginx/nginx.conf; src/middleware.ts:1-60; .env.example; Dockerfile; DOCKER.md; intel/server.js

### 9. The nuclear infrastructure dataset and its status derivation were not documented.

- Why it matters: The infra layer's colours are driven by status strings. NUCLEAR_FACILITIES is a static array (about 64 rows, including 7 Dutch ANVS sites with Wikipedia refs) with fields {id, name, city, country, lat, lng, status, reactors, capacityMW, owner}.

At request time the route fetches the USGS 4.5_day feed. Any facility with a quake within 150 km (flat approximation, sqrt(dx²+dy²)·111.32) gets status `SEISMIC RISK (M<max>)`. Static statuses include 'Active Conflict Zone', 'Decommissioned / Exclusion Zone' and 'Under Construction'. Cache-Control is 'no-store, no-cache, must-revalidate'.

The popup renders reactors and capacity of 0 as '—'.
- Where to look: src/app/api/infrastructure/route.ts:1-157; src/components/OsirisMap.tsx (infra-dots paint and nuclear popup)

### 10. The CCTV client-facing contract has unreconciled parts: the camera record type vs the preview/viewer kinds, the proxy allowlist, and the resolve and stream-status routes.

- Why it matters: CCTV is on by default and is the heaviest feature. The truncated reader may have covered it, but a builder needs these pieces:
- CctvCamera {id, lat, lng, name, city, country, feed_url?, stream_url?, stream_type?:'jpg'|'hls'|'iframe'|'mjpeg', external_url?, source}.
- inferStreamType regex (m3u8 → hls; youtube embed / rtsp.me / ipcamlive / click2stream / windy / skylinewebcams / voyage.aprr.fr → iframe; else jpg).
- PROXY_IMAGE_HOSTS ['infobanjirjps.selangor.gov.my'] → /api/cctv/proxy?url=.
- The proxy's ALLOWED_HOSTS and NO_REFERER_HOSTS ['thb.gov.tw'].
- /api/cctv/resolve?url= (with an X-Cache HIT header) and /api/cctv/stream-status?url= → {available, blocked, provider:'rtsp.me'}.
- The separate PreviewKind 'jpg'|'mjpeg'|'mp4'|'hls' used by the previews and the viewer.
- Where to look: src/app/api/cctv/types.ts:1-60; src/lib/camera-preview.ts:12-77; src/lib/camera-feed.ts:27-110; src/app/api/cctv/proxy/route.ts:14-150; src/app/api/cctv/resolve/route.ts:80-140; src/app/api/cctv/stream-status/route.ts; src/lib/cctv-snapshot.ts; src/lib/camera-catalog.ts
