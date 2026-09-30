# OSIRIS HUD, panels & layer registry
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.

## Summary

UI shell of the reference app (Next 16, React 19, maplibre-gl 6.7, framer-motion, lucide-react, Tailwind 4) lives mostly in src/app/page.tsx (state, fetching, polling, HUD, rails, mobile) and src/components/OsirisMap.tsx (map layers, colours, popups). Layout: a full-screen MapLibre globe (CARTO dark-matter tiles proxied through /api/proxy-tiles; ArcGIS World_Imagery raster for satellite view) with floating glass HUD elements. Top-left: gold OSIRIS logo and title. Top-right: mono status strip (ZULU clock, STATUS, LAYERS, ENTITIES, SOLAR Kp, V5.0), a green $OSIRIS chart pill and a gold SUPPORT dropdown. Left: a 48px icon rail (LayerPanel) with 9 groups, hover/pin flyouts, ALL/NONE switches, counts and cyan badges, plus Style Studio and Ghost Protocol buttons. Right: a pill-shaped tool rail. Bottom-left: a 3D/2D and MAP/SAT segmented control with a scale bar. Bottom: a cursor readout and a 28px ticker. Data sits in one mutable dataRef. It is fetched lazily the first time a layer is toggled, then polled per layer. Live Alerts is the real intel feed: Telegram and RSS merged and deduped on the server, places resolved via Nominatim, and quakes and warnings merged on the client. Several advertised features are missing or dead in the code: Entity Graph UI, Settings/Gemini-key panel, desktop IntelFeed and SharePanel, ScmPanel, and the balloons/radiation routes. The docs page is generated from a typed catalog (src/app/docs/apiCatalog.ts). I only summarise the security-tooling panels (OSINT Recon, World Remote); their internals are left out on purpose.

## Findings

### 0. Layer registry definition

LAYER_GROUPS array (LayerDef {key,label,dataKey,description?,catKey?,requires?,parent?}). Groups in order (rail label / fullLabel / lucide icon): SDK/'OSIRIS SDK'/Network; AVIATION/'AVIATION'/Plane; MARITIME/'MARITIME'/Ship; SPACE/'SPACE TRACKING'/Satellite; SURVEIL/'SURVEILLANCE'/Camera; HAZARD/'NATURAL HAZARDS'/CloudLightning; THREAT/'THREATS & INTEL'/AlertTriangle; NETWORK/'NETWORK INTEL'/Network; NETINTEL/'NET & EVENT INTEL'/Megaphone; DISPLAY/'DISPLAY'/Sun. Layers whose 'requires' capability is missing are filtered out, and empty groups are dropped. Count = sum of array lengths for comma-separated dataKeys, or data.category_counts[catKey]. There are no per-layer tooltips; only the terrain layers have a description.

Files: `src/components/LayerPanel.tsx:52-152`, `src/components/LayerPanel.tsx:245-266`

### 1. Layer defaults (activeLayers initial state)

ON: maritime, satellites, cctv, cctv_previews, live_news, earthquakes, global_incidents, day_night, cables, sdk_sea, sdk_air, sdk_naval. OFF: flights, private, jets, military, sat_comms, sat_military, sat_navigation, sat_earth, sat_science, balloons, fires, weather, radiation, infrastructure, alert_pins, war_alerts, terrain_3d, terrain_elevation, malware, cyber_attacks, gdelt_events, cf_outages, cf_attacks. The URL ?layers=a,b,c is read on mount (keys not listed are set false) and rewritten with history.replaceState 1500ms after each change. Only layers are persisted, not the view.

Files: `src/app/page.tsx:328-370`, `src/app/page.tsx:423-433`, `src/app/page.tsx:484-493`

### 2. AVIATION layers

flights 'Commercial' (commercial_flights), private 'Private' (private_flights), jets 'Private Jets' (private_jets), military 'Military' (military_flights). Any of the four triggers GET /api/flights once, then polls every 300000ms. Map: WebGL symbol layers fl-commercial/fl-private/fl-jets/fl-military, drawn with a 24px canvas plane icon rotated by heading (icon-rotation-alignment map), icon-size 0.4@z1 to 1@z10, opacity 0.85. Decimation: commercial keeps every 10th, private and jets every 2nd, military all. Colours come from CSS vars: --map-flight-civil #00e5ff, --map-flight-private #ffd700 ('plane-green'), --map-flight-gov #ff9500 (used for jets, 'plane-pink'), --map-flight-military #ff0000, unknown #546e7a.

Files: `src/app/page.tsx:747-753`, `src/app/page.tsx:861-863`, `src/components/OsirisMap.tsx:794-806`, `src/components/OsirisMap.tsx:1824-1841`, `src/lib/map-palette.ts:53-66`

### 3. MARITIME layer

maritime 'Maritime / Naval', dataKey 'maritime_ships,maritime_ports,maritime_chokepoints'. GET /api/maritime; the transform maps ports, chokepoints and ships. Poll is self-rescheduling: 10000ms if ships.length>0, otherwise 300000ms. Ports: maritime-dots, naval #D32F2F, energy #E65100, other #26C6DA, labels z4+. Chokepoints: choke-dots by risk, CRITICAL #D32F2F, HIGH #E65100, ELEVATED #F9A825, else #26A69A, labels z3+. Ships: ship-dots, military #D32F2F, tanker #E65100, cargo #26C6DA, else #B0BEC5, labels z5+. Server-side AIS_API_KEY decides whether ships exist.

Files: `src/app/page.tsx:769-773`, `src/app/page.tsx:871-890`, `src/components/OsirisMap.tsx:673-704`, `src/components/OsirisMap.tsx:888-897`

### 4. SPACE TRACKING layers

satellites 'All Satellites', sat_comms 'Starlink / Comms' (catKey comms), sat_military 'Military / Intel' (military), sat_navigation 'GPS / Navigation' (navigation), sat_earth 'Earth Observation' (earth_obs), sat_science 'Stations / Telescopes' (science). Any of them triggers a single GET /api/satellites, which is never re-polled; satellites_at stores the propagation epoch. When All is on, the category filters are ignored. Drawn by a custom 3D WebGL layer 'sat-3d' at orbital altitude with GPU picking (the circle layers stay hidden). ISS/TIANGONG/science points get size 2.2. Palette colours (#00e676, #ff3d3d, #448aff, #90ee90, #ffd700, other #00e5ff) apply only once a user has changed them; otherwise each satellite keeps its feed/mission colour.

Files: `src/components/LayerPanel.tsx:80-92`, `src/app/page.tsx:754-763`, `src/components/OsirisMap.tsx:1943-1987`, `src/lib/map-palette.ts:90-95`

### 5. SURVEILLANCE layers

cctv 'CCTV Cameras' (cameras) uses loadCameraCatalog: GET /api/cctv?region=all, then retries data.pendingRegions for at most 3 attempts with backoff attempts*15000ms, merging by id. cctv-dots use --map-cctv #00e676 with a 2.5px black stroke; labels from z10. Click opens CameraViewer and flies to zoom>=13. cctv_previews 'Live Previews' (parent cctv): an indented row with an elbow stem, opacity 0.4 while the parent is off. live_news 'Live News Feeds' (live_feeds): GET /api/live-news once; news-dots #EC407A; click opens the live-feed modal.

Files: `src/lib/camera-catalog.ts:10-40`, `src/app/page.tsx:733-743`, `src/app/page.tsx:784-788`, `src/components/OsirisMap.tsx:472-487`, `src/components/OsirisMap.tsx:706-719`

### 6. On-map live preview tiles

CctvPreviews: MIN_ZOOM 13, MAX_TILES 8, MAX_VIDEO_TILES 4, tile 176x99 + 20px label, gap 26. Candidates come from queryRenderedFeatures on cctv-dots, sorted nearest the screen centre, skipping overlaps. Recomputed on moveend, zoomend, idle and sourcedata. On 'move', positions are written straight to DOM transforms (no React re-render). JPG tiles refresh every 15000ms (staggered start), MP4 every 60000ms. LiveNewsPreviews uses the same geometry helper (lib/map-tile-layout): MIN_ZOOM 13, MAX_TILES 4 YouTube iframes 208x117, colour #EC407A, only feeds already in embed/live_stream?channel= form. Tint via color-mix.

Files: `src/components/CctvPreviews.tsx:28-47`, `src/components/CctvPreviews.tsx:315-476`, `src/components/LiveNewsPreviews.tsx:35-53`, `src/lib/camera-preview.ts:73-77`

### 7. NATURAL HAZARDS layers

earthquakes 'Earthquakes': fetched client-side straight from https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson and polled every 900000ms (skipped when the tab is hidden). eq-circles radius by magnitude 2.5->4, 5->12, 7->24; colour 2.5 #F9A825, 4 #E65100, 6 #D32F2F; opacity 0.55, blur 0.3; label 'M{mag}' for mag>=4.5. fires 'Active Fires': GET /api/fires once, no poll; fires-heat #E65100, opacity 0.45, blur 0.5. weather 'Severe Weather' (weather_events): GET /api/weather is a core feed polled every 300000ms regardless of toggle (Live Alerts needs it); weather-dots #7E57C2 (volcano #D32F2F) with labels.

Files: `src/app/page.tsx:684-722`, `src/components/OsirisMap.tsx:456-470`, `src/components/OsirisMap.tsx:614-628`

### 8. THREATS & INTEL layers

infrastructure 'Nuclear Facilities': GET /api/infrastructure once. Colour by status: contains 'SEISMIC RISK' #E65100, 'Active Conflict Zone' #D32F2F, contains 'Decommission' #546E7A, 'Under Construction' #FFA726, else #26A69A. global_incidents 'Global Incidents' (dataKey gdelt): GET /api/gdelt once (actually GDACS alerts); gdelt-dots #D32F2F r4. alert_pins 'Live Alert Pins': derived from /api/news items with a resolved place; colour by kind (rocket #FF3D3D, event #FF9500, news #00E5FF); region-precision pins are drawn as rings; reports under 15 minutes old get a 200ms-tick pulse ring; label from z5 'Place ·N' when several reports share a place; pins follow Live Alerts filters (alertPinIds). gdelt_events 'GDELT Events': GET /api/gdelt-events?limit=600 via loadLayerOnce (mark released on failure), colour by CAMEO quad: 1 #00E676, 2 #00E5FF, 3 #FF9500, 4 #FF3D3D, radius by article count.

Files: `src/components/LayerPanel.tsx:113-123`, `src/app/page.tsx:794-803`, `src/app/page.tsx:833-844`, `src/components/OsirisMap.tsx:565-583`, `src/components/OsirisMap.tsx:630-651`, `src/components/OsirisMap.tsx:721-751`, `src/components/OsirisMap.tsx:2250-2303`

### 9. NETWORK INTEL and NET & EVENT INTEL layers

malware 'Live Malware' (malware_threats): EventSource /api/malware/stream with snapshot/detections/status events keyed by IP. Dots #D32F2F sized by sqrt(url_count). A new-arrival ring #FF1744 animates for about 1 minute on a 200ms tick. A decorative mesh links each node to the next 2 (not real data). cyber_attacks 'Botnet C2 Servers': GET /api/cyber-attacks, re-polled every 300000ms; online #FF6D00, otherwise #555555. cf_outages 'Internet Outages' and cf_attacks 'Attack Origins' both need capability 'cloudflare': probed on mount via GET /api/cloudflare-radar?probe=1 -> {configured}, backed by server env CLOUDFLARE_API_TOKEN; both come from one GET /api/cloudflare-radar. Outage colours: ongoing #FFB300, resolved #8B7325, with halo. Attack origins: #FF3D3D sized by share %, label 'CC n%'.

Files: `src/app/page.tsx:436-440`, `src/app/page.tsx:846-852`, `src/app/page.tsx:891-965`, `src/components/OsirisMap.tsx:493-612`

### 10. OSIRIS SDK and DISPLAY layers

sdk_sea 'Maritime Lines': draws real submarine cables from /data/submarine-cables.json?v={ts}, fetched once because the hidden key 'cables' defaults to true. Line #1976D2, opacity 0.3 to 0.7 by zoom; cable colours #9BB5CC, #A0B8CD and #8EABC2 are skipped. Its panel count uses sdk_entities, a sampled mix of flights, ships, quakes and news, so the count does not match what is drawn. day_night 'Day / Night Cycle': a computed solar-terminator polygon refreshed every 300000ms, fill #000022 (ghost #0D0030), opacity 0.35. terrain_3d '3D Buildings' / 'City detail · zoom 14.5+': fill-extrusion on CARTO 'building', minzoom 14.5, colour by render_height 0 #1a1a2e, 20 #16213e, 50 #0f3460, 120 #533483, 300 #e94560; the camera eases to pitch 50. terrain_elevation '3D Terrain' / 'Mountains · zoom 10+': shows status text (idle / waiting / loading / error / on), 'Zoom to terrain' and 'Retry terrain' buttons and a Tilezen joerd attribution link; turning on either 3D layer forces globe projection, and choosing 2D turns both off.

Files: `src/app/page.tsx:805-819`, `src/components/OsirisMap.tsx:2204-2240`, `src/components/OsirisMap.tsx:1797-1810`, `src/components/OsirisMap.tsx:2558-2615`, `src/components/LayerPanel.tsx:224-232`

### 11. Left rail visuals and behaviour

Desktop: absolute, w-[48px], full height, pt-24, background rgba(0,0,0,0.15), backdrop blur(24px) saturate(1.2); slides in from x -60 after the splash with a spring. Group buttons 40x40, icon 16px; alpha 0.75 when the group is active (with drop-shadow), 0.45 on hover, 0.22 idle. Active-count badge at top-right: 13px, bg rgba(0,229,255,0.9), text #04040A. Hover opens the flyout and click pins it; Esc unpins. Flyout at left-52px, min-w 220, bg rgba(0,0,0,0.6), blur(40px), border rgba(255,255,255,0.06), rounded-xl. Header shows fullLabel plus an ALL/NONE button and ✕ when pinned. Rows: a 28x14 white-alpha toggle with a spring knob, 11px mono uppercase label, tabular count. Below a divider: Style Studio button (SlidersHorizontal, gold when open) and Ghost Protocol button (Ghost icon, #B388FF when active).

Files: `src/components/LayerPanel.tsx:154-201`, `src/components/LayerPanel.tsx:348-551`

### 12. Style Studio and themes

Tokens are written as CSS vars on body (localStorage key 'osiris:style-studio'; injected style tag #osiris-style-studio; body[data-studio=on]; event 'osiris:style' tells the map to re-read the palette). Presets: HORUS, PHANTOM, TERMINAL, CRIMSON, ARCTIC, BLACKOUT. Sections: Preset, Accent, Signal, Surface, Text, Typography, Motion & FX (radius, blur, tracking, motion, scanlines, vignette, grain), Map controls, Map layers (per-category satellite and aircraft colours, camera colour). Actions: copy, paste, reset. Input is sanitised to hex and whitelisted fonts. Ghost Protocol adds body.theme-ghost: violet #B388FF / #7C4DFF, bg #05000F, and violet map palette overrides. OsirisMap is keyed by theme, so switching theme remounts the map.

Files: `src/lib/style-tokens.ts:26-119`, `src/lib/style-tokens.ts:226-264`, `src/components/StyleStudio.tsx`, `src/app/globals.css:98-150`, `src/app/page.tsx:1252-1253`

### 13. Header and top-right status strip

Top-left: an SVG logo in #D4AF37 with drop-shadow rgba(255,215,0,0.5), h1 'OSIRIS' (tracking 0.4em), subtitle 'OPEN SOURCE INTELLIGENCE', and a tagline at 40% opacity: 'REAL-TIME GLOBAL MONITORING · FLIGHTS · MARITIME · SATELLITES · CCTV · WEATHER · CYBER THREATS' (the part after the first · is hidden on mobile). Top-right (desktop, class status-bar-desktop): 'ZULU HH:MM:SSZ' in cyan (lg and up); 'STATUS: LIVE' green or CONNECTING/ERROR red; '{n} LAYERS' counting every truthy activeLayers key, including hidden ones; '{n} ENTITIES' in green, the sum of every array in data; 'SOLAR: Kp{n}' coloured by spaceWeather.storm_color (N/A when null); 'V5.0'. TokenPanel: green pill (border #14F195/40, bg #14F195/10, TrendingUp icon, label '$OSIRIS') that opens a modal '$OSIRIS LIVE CHART' embedding a dexscreener.com Solana pair iframe. SupportMenu: gold pill 'SUPPORT' with chevron, menu items 'SUPPORT ON KO-FI' (ko-fi.com/M8D41ZYW4Z) and 'BUY MERCH' (shop.osirisai.live).

Files: `src/app/page.tsx:1398-1445`, `src/components/TokenPanel.tsx`, `src/components/SupportMenu.tsx:12-27`

### 14. View segmented control, scale bar, map controls, cursor readout

Bottom-left (left 120px desktop / 12px mobile, bottom 100px/75px): one rounded-xl strip with ViewSegment buttons sharing a framer layoutId gold highlight. Buttons: 3D (Globe, title '3D Globe'), 2D (MapPinned, '2D Map'), divider, MAP (Moon, 'Night Mode'), SAT (Satellite, 'Satellite View', ArcGIS raster at opacity 0.85). ScaleBar (desktop only): nice-number steps, max 100px wide. MapControls sit at bottom-right: zoom +/- plus a hold-to-repeat pan pad (desktop only); honours prefers-reduced-motion; can be hidden from the Style Studio. Cursor readout at bottom-8, left 72px: CURSOR lat,lng to 4 dp (written through a ref, no re-render); LOCATION reverse-geocoded via /api/geo/reverse with a 3s debounce, skipped if moved less than 0.5°, cache keyed to a 0.1° grid, capped at 500 entries; ZOOM x.x. Hint text: 'Press ? for shortcuts · F fullscreen · R reset view'.

Files: `src/app/page.tsx:1374-1396`, `src/app/page.tsx:534-563`, `src/app/page.tsx:1877-1895`, `src/components/ScaleBar.tsx`, `src/components/MapControls.tsx`

### 15. Right tool rail

Position: absolute right-2, vertically centred, bg-black/40, backdrop-blur-sm, p-1, rounded-full, border-white/5. Buttons are 32px circles; the active one gets a colour/20 background and a 2px bar on its right edge; a hover tooltip appears to the left. Order (label, icon, accent, tooltip title): RECON (Radar, cyan, 'OSINT Recon — …'), SPACE (Radio, #00E5FF, 'Live from Space — 24/7 video downlink from the ISS'), MARKETS (BarChart3, gold, 'Markets — crypto prices, space weather, global indices'), ALERTS (AlertTriangle, #FF3D3D, 'Live Alerts — earthquakes, conflicts, breaking news'), DRAW (PenLine, #00E5FF, 'Draw — measure areas of interest on the map'), ROUTE (Route, gold, 'Directions — turn-by-turn routing'), SEARCH (Search, gold, 'Search — find locations, cities, coordinates'), separator, ARCGIS (Database, gold, gold count badge, 'ArcGIS — search & import geospatial intel layers'), separator, REMOTE (Bluetooth, cyan). Panels open at right-12, w-80 (ArcGIS 340px). Mutual exclusion between panels is inconsistent.

Files: `src/app/page.tsx:1466-1667`

### 16. Search

SearchBar: placeholder 'SEARCH ADDRESS, CITY, OR COORDINATES...'. A 'lat, lng' regex match produces an instant COORDS result at zoom 15. Otherwise it debounces 500ms, aborts the previous request, and calls GET /api/geosearch?q=&lat=&lng= (biased to the map centre; server uses Photon photon.komoot.io, cached s-maxage 600). Zoom by kind: address 18, street 16, poi 16, city 12, region 8, country 5, place 13, default 13. Icons by type (Building2 cyan, Navigation green, Globe2 gold, Landmark #FF9500, MapPin). Arrow keys, Enter and Esc work; Ctrl/Cmd+F opens it. Footer: 'PLACES © OPENSTREETMAP CONTRIBUTORS'. No airport-code search exists.

Files: `src/components/SearchBar.tsx:31-39`, `src/components/SearchBar.tsx:117-182`, `src/app/api/geosearch/route.ts:25`

### 17. Live Alerts: server sources and headline pipeline

GET /api/news. Telegram public channels are scraped from https://t.me/s/{handle}: Osintdefender, WarMonitors, rybar_in_english, DDGeopolitics, KyivIndependent_official, QudsNen, AlMayadeenEnglish, intelslava, PressTV. RSS wires: BBC, Guardian, Al Jazeera, Times of Israel, TASS, Anadolu, SCMP, CNA, Africanews. Each source carries lean text and a bloc (western/russian/regional/independent). Per-source cache: channels 3 min, wires 5 min. The whole feed is rebuilt at most once per 60s, single-flight. Limits: 8 posts per channel, 5 items per wire, 72h age window. splitHeadline strips emoji and decoration, flags BREAKING when prefixed 'breaking|just in|urgent|flash|срочно|молния|última hora', clips to 140 chars. mergeCrossPosts: fingerprint = first 24 words over 1 char with links and handles removed (only when at least 6 words); the earliest post leads and other channels become also_reported_by. alert_kind: rocket (rocket/missile/grad/himars… regex), event (strike/drone/attack topics), else news. risk_score = min(10, 1 + 2 × matched risk keywords). Place: capitalised-phrase candidates resolved via Nominatim, theatre countries first then worldwide (importance ≥0.6 for world, ≥0.5 in-theatre for non-locative names), budget of 15 lookups and 2500ms per refresh. Response cached s-maxage=60.

Files: `src/app/api/news/route.ts:36-86`, `src/app/api/news/route.ts:117-170`, `src/app/api/news/route.ts:320-475`, `src/lib/telegram.ts:108-224`, `src/lib/alert-places.ts:42-58`, `src/lib/alert-places.ts:369-412`

### 18. Live Alerts: client merge and UI

Panel is glass, h-560 (max 82vh), resizable; the Maximize button portals it to a fixed inset-4 two-column layout (Esc restores). Header: Radio icon #FF4081, 'LIVE ALERTS' with count, a pin toggle showing the pinned count, refresh ('Refresh (channels are re-read every 3 minutes)'), maximize, collapse. Status line: '{live}/{n} SOURCES LIVE' (green when all live, else #FF9500; tooltip lists CHANNELS/WIRES health), '· UPDATED Xm AGO', '· N BREAKING'. 'Right now' stat buttons: SEVERE (high-severity warnings), ROCKET (last 6h), BREAKING (last 6h), QUAKE M{max}; each acts as a filter. Tabs: ALL, NEWS, WARN, QUAKE, FEEDS. Search placeholder 'Search headlines, places, channels…'; perspective select (All sides / bloc labels). Then the AI OVERVIEW button and thread chips. ALL merges news, quakes (top 15) and warnings, sorted by ts desc then urgency (warnings high=4 medium=3 low=1; quake ≥6:4, ≥5:2; news flagged 3, rocket 2). groupStatements folds 'Speaker: quote' runs from one source within 2h into '{n} STATEMENTS' cards. Section headings: LAST HOUR / 1–6 HOURS AGO / 6–24 HOURS AGO / OLDER (WARN tab uses SEVERE / MODERATE / ADVISORY). Relative times refresh every 30s.

Files: `src/components/LiveAlerts.tsx:685-1219`, `src/lib/alert-digest.ts:15-34`, `src/lib/alert-digest.ts:245-289`

### 19. Live Alerts cards, media and colours

NewsCard: 2px left border in the bloc colour (western #4F9CFF, russian #A78BFA, regional #2DD4BF, independent #C8C2B4); fresh dot #FF4081 when under 15 min old; source_name and lean; BREAKING tag (#FF6B6B on #FF3D3D/15); 12.5px sans title (line-clamp-3). Chips: kind, place, media (video duration / photo +N), '+N channels' (#00E5FF), forwarded, reply, up to 2 keywords (#FF9500), views. Expanded: an inline <video> for Telegram CDN (telesco.pe / cdn-telegram.org) with a poster, or a thumbnail image with a 'WATCH ON TELEGRAM · 0:42' overlay; summary; ALSO CARRIED BY list; buttons OPEN POST, IN REPLY TO, place button (flies to zoom 10 for a settlement, 7 for a region, and opens the pin) or '≈ ANCHOR' button. QuakeCard: 40px magnitude tile coloured ≥6 #FF3D3D, ≥5 #FF9500, ≥4 #FFD700, else #9CCC65; depth, felt; tsunami chip #448AFF; PAGER chip (green #00E676, yellow #FFD700, orange #FF9500, red #FF3D3D). WarningCard: severity colours high #FF3D3D, medium #FF9500, low #FFD700; type, provider, area, 'N min/h/d left' expiry; SHOW flies to zoom 6. FEEDS tab: 23 built-in YouTube live channels grouped AMERICAS / EUROPE / MIDDLE EAST / ASIA PACIFIC / AFRICA.

Files: `src/components/LiveAlerts.tsx:44-74`, `src/components/LiveAlerts.tsx:292-683`

### 20. AI Overview and threads

Button 'AI OVERVIEW' (Sparkles icon), which toggles to 'HIDE AI OVERVIEW'. Calls POST /api/ai/overview with {mode: 'alerts'|'markets'|'chain', payload}. The server uses GEMINI_API_KEY_1..8 (gemini-2.0-flash) and otherwise falls back to a heuristic analyst, so it always answers. The header reads 'OSIRIS AI' or 'OSIRIS ANALYST' plus age. A stale-signature pulse and 'FEED UPDATED SINCE THIS READ-OUT — REGENERATE' appear when the feed changes. Alerts brief: bottomLine prose, THREADS rows (perspective chip BOTH SIDES #00E676 / ONE SIDE #FF9500 / MIXED #8A8880, a lean bar coloured by bloc, channel count, topics, lead headline), strongest quake, coverage line. buildThreads: keyword clustering into 12 theatres (Russia–Ukraine, Israel·Gaza·Lebanon, Iran & Gulf, Yemen & Red Sea, Syria & Iraq, China·Taiwan·Pacific, Korea, South & Central Asia, Africa, Latin America, Europe & NATO, U.S. policy) with top-3 topics, limit 8 in the panel.

Files: `src/components/AiOverview.tsx`, `src/lib/alert-digest.ts:110-182`, `src/lib/alert-digest.ts:293-357`, `src/app/api/ai/overview/route.ts:24-33`

### 21. Markets panel and chart

Header: gold accent bar, 'Markets & Intel', green 'Live' chip, feed age. Blocks: BREADTH (up/down of total with a bar, top and worst movers), SPACE WEATHER ('Kp n — level' coloured by storm_color, latest flare class), AI overview (accent #D4AF37), tabs INDICES / DEFENSE / ENERGY / COMMODITIES / CRYPTO / FX (default DEFENSE), SCM alert boxes (#FF9500) derived from chokepoint risk, SESSION OPEN/CLOSED, sort DEFAULT or BY MOVE. Rows: name, symbol, a 46x14 SVG sparkline of 1 month of closes, price and % change. Instruments (Yahoo v8 chart, 60s server cache, last-good fallback per symbol): ES=F, NQ=F, ^VIX, DX-Y.NYB, ^TNX; RTX, LMT, NOC, GD, BA, LHX, PLTR; CL=F, BZ=F, NG=F; GC=F, SI=F, HG=F, ZW=F, ZC=F; BTC-USD, ETH-USD, SOL-USD, XRP-USD; EURUSD=X, USDJPY=X, GBPUSD=X, USDCNY=X. The client retries up to 3 times at 15s on a cold empty response, then polls every 15 min. MarketChart (lightweight-charts v5): candlesticks up #26A69A / down #D32F2F, volume histogram on its own scale, gold crosshair #D4AF37, OHLCV readout. Ranges 1m, 15m, 24H, 1W, 1M (default), 6M, 1Y map to Yahoo interval/range (1m/1d, 15m/2d, 5m/1d, 30m/5d, 1d/1mo, 1d/6mo, 1wk/1y) via /api/markets/history?symbol=&range=. Height 200, or 420 when maximized.

Files: `src/components/MarketsPanel.tsx`, `src/components/MarketChart.tsx:25-37`, `src/app/api/markets/route.ts:31-65`, `src/app/api/markets/history/route.ts:18-26`

### 22. Live from Space

SpaceCam panel titled 'LIVE FROM SPACE' with a red pulsing '24/7' marker. Three YouTube feeds via youtube-nocookie embed (autoplay, mute, playsinline): '4K EARTH' Sen fO9e9jnhYK8, 'EARTH VIEW' tj4knR4r1UU, 'OVERVIEW CAM' OKQEMp2555A. Footer 'ALT ~408 KM · ORBIT ~93 MIN' and a SOURCE link. The expand button portals a fixed overlay (sized so YouTube serves HD; vq=hd1080); Esc closes.

Files: `src/components/SpaceCam.tsx:32-81`

### 23. Directions

DirectionsBar calls /api/directions?from=lat,lng&to=lat,lng&mode=auto|pedestrian|bicycle, with optional via and avoid=tolls,highways,ferries. The server uses Valhalla (valhalla1.openstreetmap.de) and OSRM (router.project-osrm.org), cached s-maxage 300. UI: header 'Route' with STANDBY / PLOTTING / N STEPS chip, live-tracking crosshair (#4285F4), follow toggle. A rail shows a green origin dot, cyan diamond stops and a red destination pin. Inputs 'Choose starting point', 'Stop n', 'Choose destination' use geosearch autocomplete with map bias. Swap button; mode tabs Drive / Walk / Bike; add-stop; options toggle for avoid tolls/highways/ferries. Results: alternates, steps, elevation SVG profile, 'Start navigation', which opens NavigationView (map rotates to heading, zoom ≥16.5, pitch 50) and reroutes from the live fix. Map layers: directions-alt-line, casing, line, active segment, endpoints; user dot #4285F4 with an accuracy ring.

Files: `src/components/DirectionsBar.tsx:86-216`, `src/components/DirectionsBar.tsx:624-830`, `src/app/api/directions/route.ts:20-22`, `src/components/OsirisMap.tsx:2753-2894`

### 24. Draw / AOI

DrawingToolbar 'DRAWING TOOLS'. Summary strip: Tracked Area km² and AOIs/Perim. Steps 'STEP 1 — CHOOSE A SHAPE' then 'STEP 2 — NOW CLICK THE MAP'. Modes: AREA (polygon), BOX (rectangle), RADIUS (circle), PATH (line), with blurbs and key hints (double-click or Enter closes, Backspace undoes, Esc cancels). Live figures while drawing. DrawHud centred at the top of the map: title, step text, measurement, 'Undo point', 'Finish area/path', 'Cancel'. Shapes are named 'Area 1' / 'Box 2' etc., coloured from the palette #00E5FF, #FF3D57, #FFD700, #00E676, #E040FB, #FF9800, #29B6F6, #AB47BC, #26A69A, #EC407A, drawn as fill 0.12 plus a dashed [6,3] 2.5px line and label, and persisted in localStorage 'osiris.aoi.shapes.v1'. Selecting a polygon shows CONTENTS: a point-in-polygon sweep over the live data per group (Commercial aircraft #00E5FF, Private aircraft #76FF03, Private jets #FFD500, Military aircraft #FF3D3D, Vessels #448AFF, Satellites #E040FB, CCTV cameras #00E676, Earthquakes #FF9500, Nuclear facilities #FFEE58, Global incidents #FF6B1A, Severe weather #7E57C2), max 50 items listed per group, CSV and GEOJSON export. A per-polygon watch toggle (Radar icon) records enter/leave events per data refresh ('WATCHING n', log capped at 100). 'EXPORT GEOJSON' downloads osiris-aoi-YYYY-MM-DD.geojson; CLEAR removes all.

Files: `src/components/DrawingToolbar.tsx`, `src/components/DrawHud.tsx`, `src/lib/draw.ts:52-157`, `src/lib/aoi.ts:46-82`, `src/lib/aoi-export.ts:79`, `src/app/page.tsx:599-649`

### 25. ArcGIS panel

Stats header 'ArcGIS Intel': '{n} Layers Active', '{n} Features'. Shows 'Map Extent:' bbox. 'Active Data Layers' list with visibility, colour and opacity controls. Search input 'Search ArcGIS layers...' with a SCAN button, plus category chips Pipelines / Power Grid / Infrastructure / Military / Emergency. Search: /api/arcgis?q=&bbox=, which uses https://www.arcgis.com/sharing/rest/search. Import: /api/arcgis?service={url}&bbox=, returning GeoJSON with resultRecordCount 2000. Layer colours cycle #D4AF37, #00E5FF, #FF6B6B, #00E676, #FF9800, #AB47BC, #29B6F6, #FFEE58, #EC407A, #26A69A, opacity 0.8. On the map: fill (polygons only) at opacity×0.15, zoom-scaled line, zoom-scaled circle.

Files: `src/components/ArcGISPanel.tsx:62-82`, `src/components/ArcGISPanel.tsx:180-420`, `src/app/api/arcgis/route.ts:20`, `src/components/OsirisMap.tsx:3036-3070`

### 26. Share, help overlay, keyboard

SharePanel ('SHARE VIEW', current view, shareable link with copy, 𝕏 POST / IN SHARE / REDDIT buttons) is mounted only in the mobile SEARCH drawer. It builds ?lat=&lon=&zoom=&layers=, but on load the page reads only 'layers'. KeyboardShortcuts overlay (opened with ?): F Toggle fullscreen, S Share current view, L Toggle layer panel, M Toggle markets panel, I Toggle intel feed, R Reset to global view, ? Show this help, ESC Close panels; footer 'PRESS [?] OR [ESC] TO CLOSE'. Actual bindings in page.tsx: f fullscreen, l layers, m markets, c (dead SCM panel), i the RECON panel, s search (not share), r flies to 20,0 at zoom 2.5, g toggles globe/mercator, Ctrl/Cmd+F search.

Files: `src/components/SharePanel.tsx`, `src/components/KeyboardShortcuts.tsx:7-16`, `src/app/page.tsx:505-532`

### 27. Intel Feed component (mobile only)

IntelFeed 'SIGINT FEED' renders data.news.slice(0,25). Risk labels: CRITICAL ≥8 (.risk-critical #FF3D3D with glow), HIGH ≥6 (#FF9500), ELEVATED ≥4 (#D4AF37), LOW (#00E676). Each row shows source tag, MapPin locate (tooltip explains the country-centroid anchor), timeAgo, title, and keyword_assessment in a red box. Empty state 'AWAITING INTELLIGENCE...'. It is only reachable from the mobile INTEL tab; there is no desktop equivalent, and the real merged stream is Live Alerts.

Files: `src/components/IntelFeed.tsx`, `src/app/globals.css:349-352`

### 28. Region Dossier

Trigger: a double right-click (second click within 500ms and 12px) or a single touch long-press (contextmenu with pointerType touch). Calls GET /api/region-dossier?lat=&lng=. Server: Photon reverse geocode (3 dp, radius 50, 24h cache), Wikipedia REST summary (5s timeout, extract ≤500 chars), Wikidata country facts and head of state (24h cache per country); response cached 1h only when a place was found, otherwise no-store. Layout: glass-panel p-5 osiris-glow, centred, md:w-[480px], max-h 65vh. Title 'REGION DOSSIER' in gold. Loading state: spinner and 'COMPILING INTEL...'. Fields: LOCATION display_name; grid of COUNTRY (flag + name), CAPITAL, POPULATION, REGION, LANGUAGES, AREA km²; HEAD OF STATE (gold) with position; 'INTELLIGENCE BRIEF' with a 56px thumbnail and extract. It does not aggregate the live feeds, despite the docs claim.

Files: `src/components/OsirisMap.tsx:135-138`, `src/components/OsirisMap.tsx:918-941`, `src/app/page.tsx:565-572`, `src/app/page.tsx:1899-1931`, `src/app/api/region-dossier/route.ts:28-265`

### 29. Entity Graph

There is no UI. react-force-graph-2d is in package.json but never imported. /api/entity/expand?type=aircraft|vessel|company|person|ip|country&id= (rate limit 30/min) proxies to INTEL_URL (intel/server.js, express on :4000, /resolve), which returns {nodes:[{id,label,type,properties}], links:[{source,target,label}], entity, source}. Node types: aircraft, company, person, country, sanction, event. Edge labels include OPERATED BY, HEADQUARTERED, CEO, PARENT ORG, REGISTERED IN, AIRCRAFT TYPE, OWNED BY, FLAG STATE, SANCTIONS MATCH, LOCATED_IN, ASN, HOSTED_BY. Data comes from Wikidata SPARQL and OpenSanctions with a 24h cache.

Files: `src/app/api/entity/expand/route.ts`, `intel/server.js:1-40`, `intel/server.js:718-750`, `package.json`

### 30. Status bar ticker

GlobalStatusBar (md and up): h-28px, bg #0a0a0f/95, top scanline in cyan. Left: Discord (discord.gg/EPaFD5FFKf, bg #5865F2/10), X (x.com/soulsimplifai), 'DOCS' gold link to /docs, 'PRIVACY' link. Centre: a marquee repeated 4 times with a 30s CSS translateX(-50%) animation and edge mask. Content: BTC/ETH/SOL from the CoinGecko simple/price API with 24h change (▲ #00E676 / ▼ #FF3D57; price formatted as $x.xK when ≥1000), '│', then the 5 most recent USGS M≥4.0 quakes ('🔴 M5.1 place' in #FF5722). Hovering a quake shows a tooltip with magnitude, USGS tag, place, depth and time. Right: '● ONLINE' #00E676. Refreshes every 60s, fetched directly from the browser.

Files: `src/components/GlobalStatusBar.tsx:57-248`, `src/app/globals.css:313-320`

### 31. Popup system

A single maplibregl.Popup (closeButton, maxWidth 420px, offset 14) with raw HTML. The inner div style is background rgba(12,14,26,0.95), blur 16px, radius 10px, padding 16px, JetBrains Mono, with a 1px border in the accent colour. The MapLibre popup chrome is made transparent and the tip hidden in globals.css. Link buttons are 10px letter-spaced pills. HTML is escaped with htmlEsc, idSafe and urlSafe helpers (only http(s) links survive). A CLICKABLE_LAYERS set lets satellite GPU picking defer to other layers.

Files: `src/components/OsirisMap.tsx:955-966`, `src/components/OsirisMap.tsx:1121-1127`, `src/app/globals.css:325-329`

### 32. Flight popup and Flight Watch

Flight popup: callsign (15px bold #E8E6E0) and icao24; a 3-column grid MODEL, ALT (m), SPEED (kt), HDG°, REG, POS. 'IDENTIFYING AIRFRAME…' is replaced from /api/aircraft?icao24= (model, then registration · typeCode · operator, or 'AIRFRAME NOT IN REGISTRY'). A '+ WATCH THIS AIRCRAFT' button calls window.osirisWatchFlight. 'RESOLVING ROUTE…' is replaced from /api/flight-route?callsign=&icao24=&lat=&lng=&speed= with FROM IATA city → TO IATA city, a progress bar, and 'DEP hh:mm · pct% · km · ARR hh:mm', or 'NO SCHEDULED ROUTE' / 'ROUTE UNAVAILABLE'. External links FLIGHTAWARE, ADS-B (globe.adsbexchange.com), RADARBOX. FlightWatchPanel (top-left, max 6 aircraft): per-row callsign, icao, locate, remove; model, registration, type, operator; ALT in ft (rounded to 25), kt, squawk; ORIG → DEST with 'landed' / 'scheduled' / 'destination unknown'; '{n} points this leg'; 'No longer in the live feed'. resolveEndpoints corroborates schedule claims against the observed track (corridor test: detour ≤ direct×1.15+150 km). Watched-airport pins: glow #FFB300, white dot with #FFB300 stroke, label IATA in #FFB300.

Files: `src/components/OsirisMap.tsx:976-1078`, `src/components/FlightWatchPanel.tsx:59-305`, `src/components/OsirisMap.tsx:2966-3030`

### 33. Reusable pieces for the new airport-to-airport flight path feature

/api/flight-route already computes greatCirclePoints(origin,destination,72) as 'arc', plus totalDistanceKm, estimateTimes (departureTime, arrivalTime, progress) and sanity checks (rejects routes under 30 km, and planes more than 1.5× the route distance from both ends). Sources are raced with Promise.any: api.adsbdb.com/v0/callsign, hexdb.io route/callsign, api.airplanes.live v2. Cache: hit 30 min, miss 2 min. src/lib/airports.ts has about 375 hardcoded airports {iata, icao, name, city, country, lat, lng} indexed by ICAO and IATA, with lookupAirport, lookupAirportAsync (falls back to api.adsbdb.com/v0/airport/{code}), getAllAirports and nearestAirport(lat,lng,25km). The UI never draws the arc or the watched aircraft's actual track, and the search box does not resolve airport codes.

Files: `src/app/api/flight-route/route.ts:27-28`, `src/app/api/flight-route/route.ts:53-80`, `src/app/api/flight-route/route.ts:253-322`, `src/lib/airports.ts:7-20`, `src/lib/airports.ts:442-554`

### 34. Satellite card and camera viewer

SatelliteCard: a fixed panel (md: left 72px, top 88px, w 248), not a map popup, because satellites are drawn at altitude. It has a rule in the satellite's colour, name, mission, and fields ALTITUDE km, ORBIT (LEO under 2000, MEO under 35000, GEO up to 36500, else HEO), PERIOD, SPEED km/s, LATITUDE, LONGITUDE, NORAD ID, CLASS. Status line 'PLOTTING ORBIT…' / 'ORBIT TRACK ON GLOBE' / 'NO TRACK — TLE UNAVAILABLE'; link 'TRACK ON N2YO'. The orbit comes from /api/satellites/orbit?id=&t=epoch. Esc or an empty click clears the selection. CameraViewer: fixed bottom-right, 480px (fullscreen inset-4). Meta bar: 'CAM-xxxx-yyyy', coordinates, UTC clock, 'SECURE UPLINK'. Title and 'city, country • SOURCE'. Plays HLS via hls.js (enableWorker false; native m3u8 fallback on Safari), MJPEG img, MP4 video, iframe (YouTube resolved via /api/cctv/resolve), or JPG refreshed every 5s with a cache-busting _t param. States: 'DECRYPTING FEED...', 'ACQUIRING UPLINK', 'CAMERA OFFLINE' / 'CAMERA WITHDRAWN', external-only view, 'FEED UNAVAILABLE' + RETRY. Badge LIVE SAT-LINK / LIVE FEED / SNAPSHOT; 'WATCH LIVE' link; footer FEED TYPE and STATUS, links RAW FEED and MAP TARGET.

Files: `src/components/SatelliteCard.tsx`, `src/components/CameraViewer.tsx`

### 35. Other popups

Earthquake: 'M{mag} EARTHQUAKE' in #FF9500, place, DEPTH, COORDS, 'USGS DETAILS' link to the event page. Fire: '🔥 ACTIVE FIRE DETECTED' in #FF6B00, BRIGHTNESS K, COORDS, 'NASA FIRMS MAP' link. GDACS incident: kind label and colour (EARTHQUAKE #FF9500, WILDFIRE #FF6B1A, FLOOD #00B0FF, TROPICAL CYCLONE #00E5FF, VOLCANO #FF3D3D, DROUGHT #FFD500, fallback 'GLOBAL INCIDENT' #FF3D3D), '[ OPEN SOURCE ↗ ]'. Conflict zone (always-on layer from /api/conflicts, fallback list of 6 zones): '⚠️ label', description, SEVERITY (war #FF1744, high #FF9500, else #FFD500). GDELT event: quad label, Goldstein, Avg tone, Articles, Country, 'SOURCE ARTICLE'. Cloudflare: 'ONGOING OUTAGE' / 'RESOLVED OUTAGE' with Cause/Scope/Started/Ended; 'L3 ATTACK ORIGIN' with Share %. Vessel: '[ TYPE ]' with FLAG, name, SPEED kn, HEADING, LAT, LON, DESTINATION, MarineTraffic link. Port: name, NAVAL BASE / ENERGY PORT / CONTAINER PORT, Volume, Fleet, Global Rank, CONGESTION (SEVERE #FF1744, CONGESTED #FF9500, else #00E676) and EST. DWELL TIME. Chokepoint: name, Traffic, Risk. Nuclear: '☢️ name', city/country, STATUS, OWNER, REACTORS, CAPACITY MWe, REFERENCE and SATELLITE (Google Maps) links. Weather: emoji by icon, type in #E040FB, title, SEVERITY, SOURCE link. Alert pin: kind dot and label, time ago, title (Inter 12.5px), source · lean, '📍 place_label · place named in the post · © OpenStreetMap', inline video or thumbnail, 'OPEN POST ↗', and an 'ALSO HERE' list of up to 4 other reports at the same place.

Files: `src/components/OsirisMap.tsx:1104-1118`, `src/components/OsirisMap.tsx:1211-1224`, `src/components/OsirisMap.tsx:1261-1386`, `src/components/OsirisMap.tsx:1558-1740`, `src/components/OsirisMap.tsx:2306-2365`

### 36. Live news viewer modal

Clicking a live_news dot, a preview tile or a FEEDS entry opens a fixed overlay (bg-black/70) with a 90vw / max 900px card. Header: pink #FF4081 pulsing dot, name, red 'LIVE STREAM' tag, amber 'EXTERNAL ONLY' tag when embedding is disallowed, 'Open in YouTube' button. Body: an aspect-video iframe, or for restricted feeds an 'EMBED RESTRICTED' card with an 'OPEN LIVE STREAM' button (#39FF14). Footer tip: 'If you see Video unavailable, use Open in YouTube above'.

Files: `src/app/page.tsx:1669-1756`

### 37. Splash and boot sequence

Splash: radial background #0a0a14 fading to bg-void, gold CRT scanlines drifting over 8s, V5.0 badge, three counter-rotating rings (20s, 12s, 7s) around a gold crosshair core with a conic radar sweep, 'OSIRIS' letters staggered in with blur, typewriter subtitle 'GLOBAL INTELLIGENCE PLATFORM', and a progress bar (gold-cyan gradient) stepping 25/50/78/100% with 'ESTABLISHING SECURE CONNECTION...' → 'INITIALIZING FEEDS...' → 'CALIBRATING SENSORS...' → 'SYSTEM READY' (cyan). Timers: stage 1 at 1100ms, stage 2 at 1700ms, stage 3 500ms after the map's first idle frame, hide 550ms later, hard cap 7000ms. Exit animation: opacity 0 and scale 1.04 over 0.7s. The HUD then animates in with ease [0.22,1,0.36,1] and staggered delays. /api/geo (ipapi.co, then freeipapi.com, then ip-api.com) is requested immediately; after the splash, the map flies to the result at zoom 8 over 3500ms. If no answer within 6s, it lands on a random city from lib/landing-cities. Any pointerdown or keydown cancels the fly-in. The initial globe centre longitude = -timezoneOffset/4, zoom 1.8, minZoom 1.5, maxZoom 18, maxPitch 85; globe sky #04040A with pitch 20.

Files: `src/app/page.tsx:149-160`, `src/app/page.tsx:387-481`, `src/app/page.tsx:1058-1246`, `src/components/OsirisMap.tsx:306-343`, `src/components/OsirisMap.tsx:2498-2525`

### 38. Mobile and responsive behaviour

isMobile = innerWidth < 768 OR (innerHeight < 500 AND innerWidth < 1024). On mobile the left rail and right tool rail are hidden. A bottom nav (.mobile-nav, glass) has tabs LAYERS, MARKETS, INTEL, RECON (cyan), SEARCH, ROUTE, REMOTE. Most tabs open a spring slide-up drawer above the nav (bottom 52px, max-height min(55vh, calc(100dvh - 100px)), handle bar, title 'LAYERS & STATS' / 'MARKETS & INTEL' / 'INTEL FEED' / 'OSIRIS RECON' / 'WORLD REMOTE' / 'SEARCH'). ROUTE instead opens the directions planner at the top and is disabled during navigation. The LAYERS drawer has a stats row AIR / SAT / CAM / WX / NUC, the mobile LayerPanel list, Style Studio and Ghost toggles, and REGION PRESETS: GLOBAL, EUROPE, MIDDLE EAST (hot), EAST ASIA, AMERICAS, UKRAINE (hot), AFRICA, S.E. ASIA, ARCTIC, INDIA, AUSTRALIA, SUDAN (hot). Top-right on mobile shows only $OSIRIS and a compact SUPPORT. The status ticker is hidden below md. CSS breakpoints: 1024 hides .desktop-only; 768 shows the mobile nav and caps popups at 260px; 390 and landscape shrink nav buttons; ≥2560 and ≥3440 widths scale the root font size.

Files: `src/app/page.tsx:45-63`, `src/app/page.tsx:1447-1457`, `src/app/page.tsx:1758-1875`, `src/components/ViewPresets.tsx:10-23`, `src/app/globals.css:367-510`

### 39. Design tokens

Fonts: JetBrains Mono (--font-hud) and Inter (--font-body) from Google Fonts. :root values: --bg-void #04040A, --bg-primary #06060C, --bg-secondary #0C0E1A, --bg-tertiary #121628, --bg-panel rgba(8,10,20,0.88); gold #D4AF37 (light #F0D060, dim #8B7325, glow 0.3); cyan #00E5FF (dim #006B7A); alerts red #FF3D3D, orange #FF9500, green #00E676, blue #448AFF; --accent-weather #E040FB, --accent-nuclear #76FF03; borders are gold at alpha 0.15, 0.08 and 0.4 (active); text #E8E6E0, #9B978E, muted #5C5A54, heading #F5F0E0. .glass-panel: bg-panel, blur(24px) saturate(1.3), 1px border, radius 14, layered shadow. .glass-panel-sm: blur 16, radius 10. .hud-label: 7px, 0.2em tracking, uppercase. .hud-value: 11px, 600 weight, gold, tabular numerals. .gotham-tag variants critical/high/medium/low/info/classified. Instrument chrome: .instrument-grid (22px gold grid masked to fade), .instrument-corners (10px corner brackets), .instrument-title, .instrument-rule, .instrument-chip. Overlays: .vignette, .crt-scanlines at opacity 0.02, four gold corner frames of 64px. Every element has a global 0.6s colour transition so theme switches animate.

Files: `src/app/globals.css:1-96`, `src/app/globals.css:200-330`, `src/app/globals.css:1488-1506`, `src/app/globals.css:2400-2491`, `src/app/page.tsx:1974-1988`

### 40. Docs page

/docs uses metadata from ENDPOINT_COUNT and a client component, DocsClient. Guide sections: Overview, Quick Start, Self-Hosting, Configuration, Interface Guide, Keyboard Shortcuts. API sections: Conventions plus one per API_GROUPS entry (System, Aviation & Space, Earth & Environment, Geopolitical, Media & Markets, Surveillance & Infrastructure, Cyber Threat, OSINT Toolkit, Recon Scanner, Entity Graph, AI Analysis, Polybolos SDK, Webhooks). The endpoint reference is a typed data file, apiCatalog.ts: ApiEndpoint {path, method, summary, params[{name, required, desc, example}], returns[], notes, env[], bodyExample, requiresAuth}. It exports endpointId (anchor 'ep-{method}-{path}'), sampleUrl, and ENDPOINT_COUNT, which is derived rather than hard-coded. EndpointCard: code tabs cURL / JavaScript / Python, copy button, a 'Send request' live try-it for GET routes without auth (response truncated to 4000 chars, shows status and ms). CommandPalette opens with ⌘K, Ctrl-K or '/'. Also scroll-spy, a reading-progress bar, a hero 'Build on the OSIRIS platform' with a 'Open Source · MIT' pill, and origin fallback https://osirisai.live. Page scrolling is re-enabled with html:has(.docs-root). Code-token colours are in .docs-code.

Files: `src/app/docs/page.tsx`, `src/app/docs/apiCatalog.ts:9-58`, `src/app/docs/apiCatalog.ts:660`, `src/app/docs/DocsClient.tsx:10-25`, `src/app/docs/EndpointCard.tsx:80-110`, `src/app/globals.css:163-192`

### 41. Privacy page and site metadata

/privacy 'Data & Privacy': an orange callout 'YOUR QUERY LEAVES THIS INSTANCE'; sections AUTOMATIC IP GEOLOCATION, WHERE DATA GOES (a Service / What is sent / When table listing the external services each lookup reaches, including Google Gemini and the Telegram CDN), AI FEATURES and SCANNING; 'Last reviewed against the codebase: 17 September 2026'. It says geolocation runs 3s after load, but the code now requests it immediately. layout.tsx: SITE_URL https://osirisai.live, title template '%s | OSIRIS Intelligence', themeColor #D4AF37, OG image /og-image.png 1200x630, Twitter @simplifaisoul, JSON-LD WebApplication with a featureList, and a manifest.

Files: `src/app/privacy/page.tsx`, `src/app/layout.tsx`

### 42. Security-tooling panels (summary only)

OSINT Recon (right-rail RECON button, mobile RECON tab) and World Remote (REMOTE button) exist in the reference as a grouped lookup toolkit and a Web Bluetooth panel. They proxy many third-party lookup and scanning services. I have not documented their internals here; a replica can leave them out or scope them separately without affecting the rest of the monitor.

Files: `src/components/OsintPanel.tsx`, `src/components/WorldRemote.tsx`

## Worth copying

- Registry-driven layer panel: one typed LAYER_GROUPS array drives the desktop rail, the mobile list, counts (dataKey arrays or category_counts), capability gating ('requires' + server probe endpoint) and sub-layer parent/child dimming.
- Lazy layer loading: fetch on first toggle, mark before await, release the mark on failure (loadLayerOnce), per-layer poll intervals, skipWhenHidden for background polls, and adaptive polling (maritime 10s only while vessels exist).
- Single fetchEndpoint utility that merges transformed payloads into one dataRef and bumps a dataVersion counter, so effects run once per refresh instead of once per render.
- Splash gated on the map's first 'idle' frame, with a minimum intro time and a 7s cap, then an IP fly-in with a 6s give-up that lands on a random well-covered city; cancelled by any user input.
- Zero-render cursor readout written via a ref, and a reverse-geocode throttle (3s debounce, 0.5° movement threshold, 0.1° cache grid).
- Map tiles and previews positioned by writing CSS transforms on map 'move' while React only recomputes on moveend/idle; hard caps on concurrent video decoders (8 tiles, 4 video, 4 YouTube).
- GPU-picked 3D satellite layer drawn at altitude, a readout card instead of a ground-anchored popup, and selection that survives catalogue refreshes (resync by NORAD id).
- Honest labelling: pins say 'place named in the post', risk scores show their matched keywords, C2 dots say 'blocklist entry, not an observed attack', and schedule-derived destinations say 'scheduled' vs 'landed'.
- Server-side feed build shared by all clients (single-flight, 60s TTL, per-source caches, last-good fallback), a Nominatim request budget per refresh, and cross-post dedupe by word fingerprint that keeps 'also carried by'.
- Live Alerts UX: 'right now' stat buttons that double as filters, time-bucket headings, statement grouping, perspective/bloc colouring, and map pins that follow the feed's active filters.
- Flight route corroboration (observed track leads, schedule accepted only if it passes a corridor test) and the existing 72-point great-circle arc in /api/flight-route — a direct basis for the airport-to-airport planned-path feature.
- Draw tool as a pure reducer (lib/draw.ts), live measurement HUD over the map, AOI contents sweep with CSV/GeoJSON export, localStorage persistence, and arrival/departure tripwires.
- Style Studio token engine: CSS vars on body, conditional injected rules, sanitised import/export, and a map palette read back from CSS so WebGL layers recolour live.
- A typed API catalog powering the docs (anchors, sample URLs, a live try-it, derived endpoint count, command palette).

## Weaknesses to fix in GODSEYE

- Entity Graph is advertised in the docs and has a backend, but has no UI; react-force-graph-2d is an unused dependency.
- No Settings panel for a user Gemini key, even though /api/ai/analyze and /api/ai/briefing accept an x-gemini-key header and their error messages point to 'the settings panel'.
- Desktop has no Intel Feed or Share panel: the 'i' key opens RECON and 's' opens Search, while the help overlay says I = intel feed and S = share. SharePanel exists only in the mobile search drawer.
- Share links encode lat/lon/zoom, but the page restores only ?layers=, so shared views do not reproduce.
- Region Dossier claims to be a 'composite summary from every feed' but only shows geocode, country facts, head of state and a Wikipedia extract; none of the live layers are included.
- Dead code and dead routes: ScmPanel imported but never rendered (the 'c' key toggles nothing); 'scm-dots' has a click handler but no layer; balloons and radiation keys fetch /api/balloons and /api/radiation, which do not exist; the war_alerts, sdk_air and sdk_naval keys have no UI; demoMode is never set; globalStats is fetched but never shown; UptimeClock is defined but unused.
- The LAYERS counter counts hidden keys (cables, sdk_air, sdk_naval, cctv_previews), so the number is inflated. The ENTITIES counter sums every array in data, including news and ports.
- The OSIRIS SDK 'Maritime Lines' count shows sampled sdk_entities, while the layer actually draws submarine cables. The malware 'mesh' links each node to the next two in array order, which is fake topology.
- The flight popup comment says watched aircraft draw their real track, but no track layer exists; only endpoint airport pins are drawn. There is no airport search and no way to plan a route between two airports.
- Commercial flights are decimated to every 10th aircraft at every zoom level, so dense areas look emptier than they are, even when zoomed in.
- Satellites are fetched once and never re-polled, so positions go stale. Fires, infrastructure, GDELT, live-news and gdelt-events are also never refreshed.
- Theme switching remounts the whole map (key={osirisTheme}), which reloads all sources and layers.
- Mutual exclusion between right-rail panels is inconsistent (e.g. ArcGIS closes only Remote), so panels can overlap.
- The privacy page says IP geolocation runs 3s after load, but the code requests it immediately.
- Popups are raw HTML strings with inline styles, which makes them hard to theme, test or make accessible; weather, port, radiation and balloon popups interpolate some fields without htmlEsc.
- The status ticker calls CoinGecko and USGS directly from every browser every 60s, bypassing the server cache.
- Layer rows have no tooltips or source attribution (only the terrain layers have descriptions).

## Gaps (not verified)

- The internals of the OSINT Recon toolkit and the World Remote Bluetooth panel are summarised only.
- The internals of the Style Studio component were only skimmed (labels and sections captured, not every control's range and default).
- The API routes (/api/flights bucketing rules, /api/maritime, /api/live-news feed list, /api/weather providers, /api/cctv regions) were not examined in depth; they belong to other slices.
- NavigationView turn-by-turn UI details and the full DirectionsBar results section (lines 830-1048) were not fully read.
- The 3D satellite layer shader (src/lib/satellite-layer.ts) and the terrain pipeline (src/lib/map-terrain.ts, terrain-tiles.ts) were not examined.
- The shallow git clone means removed components (e.g. an earlier Entity Graph or Settings UI) could not be checked in history.
