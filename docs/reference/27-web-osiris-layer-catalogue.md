# OSIRIS exact layer catalogue verified against the production bundle
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
**Question answered:** What is the exact OSIRIS layer catalogue in each left-rail category? This means individual layer names and descriptions, which layers are on by default (the '12 LAYERS' default), icon, colour and cluster styling, popup and hover fields, click actions, and which API route feeds each layer.

## Summary

I extracted the OSIRIS layer catalogue from source and checked it against the deployed bundle. Source: raw.githubusercontent.com/simplifaisoul/osiris/master. The GitHub API and github.com were blocked for this session, but raw.githubusercontent.com worked. Deployed bundle: osirisai.live chunk 39v3nav0fooxj.js holds LAYER_GROUPS byte-for-byte, and chunk 1136nyajv2-oe.js holds the default activeLayers object, so the live site matches master. The left rail comes from a single constant, LAYER_GROUPS, in src/components/LayerPanel.tsx. It has 10 groups in this order: OSIRIS SDK, AVIATION, MARITIME, SPACE TRACKING, SURVEILLANCE, NATURAL HAZARDS, THREATS & INTEL, NETWORK INTEL, NET & EVENT INTEL, DISPLAY. Together they hold 29 toggles. NET & EVENT INTEL has two layers (cf_outages, cf_attacks) marked `requires:'cloudflare'`. They are hidden unless GET /api/cloudflare-radar?probe=1 returns configured:true, and on osirisai.live it returns {"configured":false}, so the live rail shows 9 groups. Style Studio (SlidersHorizontal icon) and Ghost Protocol (Ghost icon, #B388FF) sit below a separator.

The header's '12 LAYERS' figure is `Object.values(activeLayers).filter(Boolean).length` over the whole activeLayers object in src/app/page.tsx. That object includes keys with no toggle in the rail. The 12 keys that start true are maritime, satellites, cctv, cctv_previews, live_news, earthquakes, global_incidents, day_night, cables, sdk_sea, sdk_air and sdk_naval. Only 9 of them are visible rail toggles (sdk_sea, maritime, satellites, cctv, cctv_previews, live_news, earthquakes, global_incidents, day_night). Everything else defaults to false. Active layers are written to `?layers=a,b,c` after a 1.5 s debounce and restored from it on load.

Rendering is in src/components/OsirisMap.tsx. Every layer is a plain MapLibre GeoJSON source drawn with circle, symbol or line layers. There is no clustering anywhere: no `cluster:true`, and a grep for "cluster" found nothing. Density is controlled in three ways. Commercial flights are thinned to every 10th and private/jets to every 2nd before setData. FIRMS fires are sampled to about 2,000 points on the server. Satellites are a custom WebGL layer drawn at compressed altitude (620 to 2,500 km display band) and hidden above zoom 7. Most point layers use the same pattern: a large blurred 'glow' circle at 0.08 to 0.12 opacity, a solid dot with a 1.5 px stroke, and a label layer with a minzoom. Clicks open a MapLibre Popup (maxWidth 420px, offset 14, close button) built from inline HTML: dark glass background rgba(12,14,26,0.95), JetBrains Mono, a 2- or 3-column grid of small grey (#5C5A54) uppercase field labels, and outline link buttons. CCTV, live news and satellites open React panels instead of popups. Hover only sets cursor:pointer. There are no hover tooltips on any layer.

## Findings

### 0. Rail mechanics (LayerPanel.tsx) (verified)

Desktop rail: a 48 px wide absolute column on the left, pt-24, background rgba(0,0,0,0.15), backdrop blur(24px) saturate(1.2). It slides in with a framer-motion spring (x -60 to 0, delay 0.25) once the splash lifts. Each group is a 40x40 button with a lucide icon at 16 px. Icon colour: rgba(255,255,255,0.75) plus drop-shadow when any layer in the group is on, 0.45 when the flyout is open, 0.22 when idle. A cyan badge (bg rgba(0,229,255,0.9), text #04040A, 13 px pill, 9 px mono) shows the count of active non-sub-layers. Hovering opens a flyout at left:52px, min-w 220px, rounded-xl, bg rgba(0,0,0,0.6), blur(40px) saturate(1.5), border rgba(255,255,255,0.06). Clicking pins the flyout open; ESC unpins it. The flyout header shows fullLabel (10px mono, tracking 0.2em) and an ALL/NONE button that switches the whole group off if any layer is on, otherwise all on. Each row: a custom 28x14 toggle (knob 10 px, spring animation), the label in 11px mono uppercase, an optional 9px description, and a right-aligned count. The count is data[dataKey].length (comma-separated keys are summed) or data.category_counts[catKey] for satellite sub-layers. Sub-layers (`parent`) are indented 22 px with an elbow line and drawn at 40% opacity while the parent is off. Mobile renders the same groups as stacked sections in the 'LAYERS & STATS' sheet.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/components/LayerPanel.tsx

### 1. Exact LAYER_GROUPS constant (verified identical on the live bundle) (verified)

The four fields per group are rail label / fullLabel / lucide icon / layers, with each layer written as {key, label, dataKey, extras}.
1) SDK / 'OSIRIS SDK' / Network: {sdk_sea,'Maritime Lines','sdk_entities'}.
2) AVIATION / AVIATION / Plane: {flights,'Commercial','commercial_flights'}, {private,'Private','private_flights'}, {jets,'Private Jets','private_jets'}, {military,'Military','military_flights'}.
3) MARITIME / MARITIME / Anchor-type icon: {maritime,'Maritime / Naval','maritime_ships,maritime_ports,maritime_chokepoints'}.
4) SPACE / 'SPACE TRACKING' / Satellite: {satellites,'All Satellites','satellites'}, {sat_comms,'Starlink / Comms',catKey comms}, {sat_military,'Military / Intel',catKey military}, {sat_navigation,'GPS / Navigation',catKey navigation}, {sat_earth,'Earth Observation',catKey earth_obs}, {sat_science,'Stations / Telescopes',catKey science}.
5) SURVEIL / SURVEILLANCE / Camera: {cctv,'CCTV Cameras','cameras'}, {cctv_previews,'Live Previews','',parent:'cctv'}, {live_news,'Live News Feeds','live_feeds'}.
6) HAZARD / 'NATURAL HAZARDS' / CloudLightning: {earthquakes,'Earthquakes','earthquakes'}, {fires,'Active Fires','fires'}, {weather,'Severe Weather','weather_events'}.
7) THREAT / 'THREATS & INTEL' / AlertTriangle: {infrastructure,'Nuclear Facilities','infrastructure'}, {global_incidents,'Global Incidents','gdelt'}, {alert_pins,'Live Alert Pins','alert_pins'}, {gdelt_events,'GDELT Events','gdelt_events'}.
8) NETWORK / 'NETWORK INTEL' / Network: {malware,'Live Malware','malware_threats'}, {cyber_attacks,'Botnet C2 Servers','cyber_attacks'}.
9) NETINTEL / 'NET & EVENT INTEL' / Megaphone: {cf_outages,'Internet Outages','cf_outages',requires:'cloudflare'}, {cf_attacks,'Attack Origins','cf_attack_origins',requires:'cloudflare'}.
10) DISPLAY / DISPLAY / Sun: {day_night,'Day / Night Cycle'}, {terrain_3d,'3D Buildings',description 'City detail · zoom 14.5+'}, {terrain_elevation,'3D Terrain',description 'Mountains · zoom 10+'}.
Turning either terrain toggle on forces globe projection. The terrain toggle expands a status box with the states 'Terrain at zoom 10+ · zoom in', 'Loading nearby terrain…' and 'Terrain unavailable', plus 'Zoom to terrain' and 'Retry terrain' buttons and a Tilezen 'Terrain credits' link.

Source: https://osirisai.live/_next/static/chunks/39v3nav0fooxj.js

### 2. Default activeLayers ('12 LAYERS') (verified)

useState in page.tsx, confirmed in the live chunk as the minified `flights:!1,...`. Keys set true: maritime, satellites, cctv, cctv_previews, live_news, earthquakes, global_incidents, day_night, cables, sdk_sea, sdk_air, sdk_naval (12 total). Keys set false: flights, private, jets, military, sat_comms, sat_military, sat_navigation, sat_earth, sat_science, balloons, fires, weather, radiation, infrastructure, alert_pins, war_alerts, terrain_3d, terrain_elevation, malware, cyber_attacks, gdelt_events, cf_outages, cf_attacks. The top-right HUD shows `<cyan count> LAYERS` next to 'STATUS: LIVE', a Zulu clock and an entity count. Because cables, sdk_air and sdk_naval count toward the number but have no toggle, the rail badges add up to 9 while the header says 12.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/page.tsx

### 3. Data loading per layer (page.tsx) (verified)

Loaded at startup regardless of toggles:
- USGS 2.5_day GeoJSON, fetched directly from earthquake.usgs.gov (not via /api), every 15 min.
- /api/news every 5 min. It feeds the Intel feed and alert_pins.
- /api/weather every 5 min into weather_events.
- /api/markets every 15 min.
- /api/space-weather once, after 5 s.

Loaded once when the toggle first goes on (layerFetchedRef guard):
- /api/flights for any of the 4 aviation keys; polled every 5 min.
- /api/satellites for any sat key; never re-polled.
- /api/fires.
- /api/maritime → {maritime_ports, maritime_chokepoints, maritime_ships}. Polled every 10 s if ships > 0, otherwise every 5 min.
- /api/live-news → live_feeds.
- /api/infrastructure.
- /api/gdelt → data.gdelt. Note: this is the GDACS RSS feed.
- /data/submarine-cables.json (a 665 KB static file) when cables is on → submarine_cables.
- /api/cyber-attacks → indicators; every 5 min.
- /api/gdelt-events?limit=600.
- /api/cloudflare-radar, which backs both CF layers.
- /api/cctv?region=all via loadCameraCatalog. The server returns pendingRegions; the client retries up to 3 times with 15 s x attempt backoff.

Live Malware uses an EventSource on /api/malware/stream. It sends a snapshot, then detections and status events. Hosts are keyed by IP, and retired IPs are removed.

/api/conflicts is fetched once on map ready.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/page.tsx

### 4. AVIATION layers: style, popup, click (verified)

Four symbol layers: fl-commercial (source 'flights'), fl-private ('private-fl'), fl-jets ('jets'), fl-military ('military').

Icons are canvas-drawn 24 px plane silhouettes named plane-cyan/green/pink/red, coloured from CSS vars. Core theme: --map-flight-civil #00e5ff, --map-flight-private #ffd700, --map-flight-gov #ff9500 (used by the jets layer), --map-flight-military #ff0000, --map-flight-unknown #546e7a. Ghost theme: civil #b388ff, private #ce93d8, gov #d500f9.

Layout: icon-size interpolates by zoom (1→0.4, 5→0.7, 10→1). icon-rotate = heading with rotation-alignment map. allow-overlap and ignore-placement are on; opacity 0.85. Commercial is thinned to every 10th aircraft and private/jets to every 2nd.

Popup:
- Header: callsign (15px bold #E8E6E0) and icao24.
- 3-column grid: MODEL, ALT (m), SPEED (kt), HDG, REG, POS.
- 'IDENTIFYING AIRFRAME…' slot, filled from /api/aircraft?icao24= (adsbdb) with model / registration · typeCode · operator.
- Cyan '+ WATCH THIS AIRCRAFT' button → window.osirisWatchFlight → FlightWatchPanel.
- 'RESOLVING ROUTE…' slot, filled from /api/flight-route?callsign&icao24&lat&lng&speed (adsbdb / hexdb / airplanes.live). It shows FROM IATA+city → TO IATA+city, a progress bar, 'DEP hh:mm · pct% · km · ARR hh:mm', or 'NO SCHEDULED ROUTE'.
- Links: FLIGHTAWARE, ADS-B (globe.adsbexchange.com), RADARBOX.

Classification (/api/flights):
- military: OpenSky category 14, dbFlags&1, a MILITARY_INDICATORS type (C17, KC135, F35, and so on), or an RCH/REACH/KING/DUKE/EVAC/JAKE/CONVOY callsign.
- commercial: airliner types or heavy category.
- jet: bizjet operators (EJA, NJE, VJT…), PRIVATE_JET_TYPES (G650, CL60, C680…), or a GA callsign cruising above 8,500 m and 300 kt.
- private: other GA callsigns and light aircraft.

Feeds are OpenSky states/all?extended=1 plus the adsb.fi /mil and regional feeds.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/components/OsirisMap.tsx

### 5. MARITIME layer ('Maritime / Naval'): style and popups (verified)

One toggle drives three sources.

(a) 'maritime' ports:
- Colour by type: naval #D32F2F, energy #E65100, container #26C6DA.
- Glow radius 6/12/20 (zoom 1/5/10) at 0.08 opacity; dot radius 3/5/9 at 0.8 opacity; label minzoom 4 in #26C6DA.
- Popup: name, 'CONTAINER PORT' / 'ENERGY PORT' / 'NAVAL BASE' — country, Volume, Fleet, Global Rank #, and congestion NORMAL / CONGESTED / SEVERE with EST. DWELL TIME.

(b) 'maritime-choke' chokepoints:
- Colour by risk: CRITICAL #D32F2F, HIGH #E65100, ELEVATED #F9A825, otherwise #26A69A.
- Glow #E65100; label minzoom 3, 10px bold #E65100.
- Popup: name, Traffic, Risk.

(c) 'maritime-ships' (AIS):
- Colour: military #D32F2F, tanker #E65100, cargo #26C6DA, other #B0BEC5; radius 2/4/6; label minzoom 5.
- Popup: icon + [TYPE], FLAG, name, SPEED kn, HEADING, LAT, LON, DESTINATION, and an [OPEN SOURCE ↗] MarineTraffic link. The link uses mmsi, but mmsi is not passed into the feature properties (a bug in the original).

Data: 52 static ports (container, energy and 13 naval bases) and 10 chokepoints (Hormuz HIGH, Malacca MODERATE, Suez ELEVATED, Bab el-Mandeb CRITICAL, Panama LOW, Turkish MODERATE, Danish LOW, Cape of Good Hope LOW, Taiwan Strait ELEVATED, Lombok LOW). Ships come from the aisstream.io WebSocket and need AIS_API_KEY. The live site returns total_ports 52, total_chokepoints 10, total_ships 0.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/maritime/route.ts

### 6. SPACE TRACKING layers: style, pick, card (verified)

Satellites are drawn only by a custom WebGL layer, 'sat-3d' (src/lib/satellite-layer.ts), using MapLibre projectTileFor3D. Altitude is sqrt-compressed into a 620 to 2,500 km display band. Point size is clamp(size*260/clip.w, 2.5, 16) px, with size 2.2 for the science category and ISS/TIANGONG and 1 for everything else. The layer is hidden and unclickable above zoom 7 (SAT_MAX_ZOOM). The circle layers sat-glow and sat-dots exist but are kept at visibility none.

Colour is the mission colour from /api/satellites, unless the Style Studio has overridden the category var. Mission colours: USA/NROL Military Recon #FF3D3D; SIGINT #FFFFFF; GPS/GLONASS/Galileo/BeiDou #448AFF; SBIRS/DSP Early Warning #FF00FF; Starlink/OneWeb/Planet/WorldView #00E676; ISS/Tiangong/Hubble/JWST #FFD700; COSMOS/YAOGAN #FF6B6B; weather #87CEEB; Landsat/Sentinel/Terra/Aqua #90EE90; unknown #00E5FF.

Category mapping: comms = Commercial Comms/Imaging; navigation; earth_obs = Weather/EO/Earth Science; military = Recon/NRO/SIGINT/Early Warning/Russian/Chinese/SAR; science = Station/Telescope; other = debris, R/B and unknown.

Sub-layers: 'All Satellites' shows everything. Otherwise the enabled categories are unioned. Counts come from category_counts; live values were comms 11336, military 429, navigation 115, earth_obs 44, science 16, other 6833.

Click uses a GPU pick. It defers to CLICKABLE_LAYERS so aircraft and cameras win. The click opens the SatelliteCard React panel, not a popup. Fields: ALTITUDE km, ORBIT (LEO <2000 / MEO / GEO 35000–36500 / HEO), PERIOD, SPEED km/s, LATITUDE, LONGITUDE, NORAD ID, CLASS. Track status reads PLOTTING ORBIT… / ORBIT TRACK ON GLOBE / NO TRACK, with a 'TRACK ON N2YO' link. The orbit line comes from /api/satellites/orbit?id=&t=. Hover picks are throttled to 10/s.

TLEs come from CelesTrak groups (active, the Starlink supplemental feed, gps-ops, glonass, galileo, beidou, oneweb, iridium-NEXT, stations, weather, military, geo, debris groups and others), with SatNOGS as fallback and SGP4 propagation on the server.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/satellites/route.ts

### 7. SURVEILLANCE layers: CCTV, Live Previews, Live News (verified)

CCTV ('cctv' source):
- cctv-glow: black at 0.35 opacity, blur 1, radius 5/8/14/20 at zoom 1/5/10/14.
- cctv-dots: --map-cctv (#00e676 core, #b388ff ghost), radius 3/5/8/12, 2.5 px black stroke.
- cctv-label: minzoom 10, 9px, camera name.
- Click: no popup. It emits onEntityClick({type:'cctv', id, name, city, country, source, feed_url, stream_url, stream_type, external_url, lat, lng}), which opens the CameraViewer panel, and flies to max(zoom,13) over 1 s.
- Catalogue: /api/cctv (TfL JamCam, WSDOT, Caltrans, 511 Alberta/Ontario, DriveBC, Singapore, Toronto, TxDOT and others). The live site returned total 39,520.

Live Previews (cctv_previews, a sub-layer of cctv): the CctvPreviews component pins live frame tiles above camera dots at zoom 13 and above. MAX_TILES is 8, and at most 4 of them play video at once. Clicking a tile opens CameraViewer.

Live News Feeds ('live-news' source):
- Colour #EC407A. Glow radius 8/14/22 at 0.08; dot radius 4/6/10 at 0.8 with a 1.5 px stroke; label minzoom 4.
- Click opens the live feed player: an iframe if embed_allowed, otherwise an external link.
- LiveNewsPreviews shows up to 4 tiles at zoom 13 and above.
- /api/live-news returns 15 static feeds (live total 15): NBC, CBS, ABC, Bloomberg, C-SPAN, CBC (external only); Sky, France24, DW, Al Jazeera, NHK, CNA, WION (embeddable YouTube live_stream); CGTN, RT (external). Fields: id, name, city, country, lat, lng, url, embed_allowed, category, language.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/components/OsirisMap.tsx

### 8. NATURAL HAZARDS layers (verified)

Earthquakes (eq-circles):
- Source: the USGS 2.5_day feed, loaded directly by the client.
- Radius by magnitude: 2.5→4, 5→12, 7→24. Colour by magnitude: 2.5 #F9A825, 4 #E65100, 6 #D32F2F.
- Opacity 0.55, blur 0.3, stroke #F9A825 at 0.25.
- eq-label shows 'M{mag}' for M4.5 and above, 9px #F9A825.
- Popup: 'M{mag} EARTHQUAKE' (#FF9500), place, DEPTH km, COORDS, and a '📊 USGS DETAILS' link to the eventpage.

Active Fires (fires-heat):
- Circle #E65100 at 0.45, blur 0.5, radius 2/4/8 at zoom 1/5/10.
- Popup: '🔥 ACTIVE FIRE DETECTED', BRIGHTNESS K, COORDS, and a '🛰️ NASA FIRMS MAP' link.
- /api/fires reads the FIRMS open CSV (SUOMI VIIRS C2 Global 24h, falling back to MODIS C6.1), sampled to about 2,000 points. EONET volcanoes are appended with brightness 500.

Severe Weather:
- weather-glow #7E57C2 at 0.08, radius 12/20/30. weather-dots radius 5/8/14: cyclone #7E57C2, volcano #D32F2F, otherwise #7E57C2.
- weather-label: title in 9px #7E57C2 with no minzoom.
- Popup: accent #E040FB, emoji by icon (🌀 cyclone, 🌋 volcano, 🌊 flood, 🏜️ drought, 🧊 ice, ⚠️ weather, ⚡ other), type, title, SEVERITY (high → #FF1744, otherwise #FFD700), COORDS, and a '📡 SOURCE' link.
- /api/weather merges NASA EONET (open, limit 100), NOAA/NWS active alerts, and GDACS TC/FL/DR.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/components/OsirisMap.tsx

### 9. THREATS & INTEL layers (verified)

Nuclear Facilities (infra-*):
- Dot colour: 'SEISMIC RISK' in status → #E65100; 'Active Conflict Zone' → #D32F2F; 'Decommission' → #546E7A; 'Under Construction' → #FFA726; otherwise #26A69A.
- Radius 4/6/10; glow 8/14/22; label minzoom 5.
- Popup: '☢️ name', city/country, then a grid of STATUS, OWNER, REACTORS and CAPACITY (MWe), coordinates, a REFERENCE link (sourceUrl) and a SATELLITE link (Google Maps 1e3).
- /api/infrastructure: 64 static plants (live total 64). A plant's status becomes 'SEISMIC RISK (Mx.x)' when a USGS M4.5+ quake from the last 24 h is within 150 km.

Global Incidents (gdelt-dots):
- Radius 4, #D32F2F at 0.5 opacity.
- Data comes from /api/gdelt, which is actually the GDACS RSS feed. Types: EQ→earthquake, TC→weather, FL→flood, VO→volcano, WF→wildfire, DR→drought, otherwise incident.
- The popup header is set by kind: 🌐 EARTHQUAKE #FF9500, 🔥 WILDFIRE #FF6B1A, 🌊 FLOOD #00B0FF, 🌀 TROPICAL CYCLONE #00E5FF, 🌋 VOLCANO #FF3D3D, ☀️ DROUGHT #FFD500, otherwise ⚠️ GLOBAL INCIDENT. Body: name, then '[ OPEN SOURCE ↗ ]'.

Live Alert Pins (alert-pin-*):
- Colour by kind: rocket #FF3D3D, event #FF9500, news #00E5FF.
- Region-precision pins are drawn as rings (fill 0.15 opacity).
- A pulse ring on reports under ALERT_FRESH_MS old animates on a 200 ms sine. The selected pin gets a white 13 px ring.
- Label minzoom 5 reads 'Place ·N' when N reports share a place.
- Popup (300 px wide, scrollable): kind label, time-ago, title, source · lean, '📍 place · © OpenStreetMap', Telegram video/thumbnail, 'OPEN POST ↗', and an 'ALSO HERE' list of up to 4 more reports.
- Data: /api/news items that geoparse to a place via Nominatim. Sources are Telegram t.me/s channels plus RSS (BBC, Al Jazeera, Guardian, TASS, SCMP, ToI, AA, Africanews, CNA).

GDELT Events (gdelt-events-dots):
- Colour by CAMEO QuadClass: 1 #00E676, 2 #00E5FF, 3 #FF9500, 4 #FF3D3D, otherwise #9B978E.
- Radius by article count: 1→3, 10→5, 50→8, 200→12.
- Popup: quad_label, name, Goldstein, Avg tone, Articles, Country, 'GDELT 2.0 · date Z', and a SOURCE ARTICLE link.
- /api/gdelt-events reads the GDELT 2.0 15-minute export (limit 600, max 2000).

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/components/OsirisMap.tsx

### 10. NETWORK INTEL layers (verified)

Live Malware:
- malware-glow: #D32F2F at 0.06.
- malware-dots: #D32F2F, radius from zoom × sqrt(url_count) (zoom 1: 1.6–4; zoom 5: 3.2–8; zoom 10: 4.8–12), black stroke.
- malware-new-ring: #FF1744 beacon for 60 s after arrival.
- malware-label: minzoom 5, family name, JetBrains Mono Bold 8px.
- A 'network-mesh' line layer (atmo, glow and core at 0.08, 0.2 and 0.4 opacity) links each node to the next two.
- Popup: [THREAT TYPE], city/country, family, AS, HOST ip:port in #00E5FF, STATUS (online #39FF14, otherwise #FF1744), LIVE URLS, LAST REPORT, first seen / reporter, and a 'URLHAUS REPORT ↗' link.
- Source: URLhaus csv_recent, polled every 60 s on the server and geolocated with the ip-api batch endpoint, streamed over SSE.

Botnet C2 Servers (cyber-heads):
- Radius 2.5/4/6: online #FF6D00, otherwise #555555. Label minzoom 3.
- Popup: 'BOTNET C2 SERVER' with a status chip, family, then C2 ADDRESS, PORT, HOSTED IN, AS, FIRST SEEN, LAST ONLINE, hostname, a disclaimer that the marker sits at the country centroid, and a 'SOURCE: ABUSE.CH FEODO TRACKER ↗' link.
- /api/cyber-attacks reads feodotracker ipblocklist.json (5-minute cache).

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/components/OsirisMap.tsx

### 11. NET & EVENT INTEL (capability-gated, hidden on osirisai.live) (verified)

Internet Outages:
- cf-outage-halo: #FFB300 at 0.12, radius 14/26/40.
- cf-outage-dots: ongoing #FFB300, resolved #8B7325.
- Label: country_name, minzoom 3.
- Popup: ONGOING/RESOLVED OUTAGE, country, description, Cause, Scope, Started, Ended, and a RADAR DETAIL link.

Attack Origins:
- cf-attack-dots: #FF3D3D at 0.35, radius by share (0→4, 5→9, 20→16, 50→24).
- Label: 'CC share%', minzoom 2.
- Popup: 'L3 ATTACK ORIGIN', country, Share %, Code.

Both come from /api/cloudflare-radar (Cloudflare Radar API, token required). The probe on the live site returned {"configured":false,"source":"Cloudflare Radar"}.

Source: https://osirisai.live/api/cloudflare-radar?probe=1

### 12. OSIRIS SDK and DISPLAY layers (verified)

Maritime Lines (sdk_sea):
- Line layer sdk-sea on the 'sdk-links' source, filtered to domain SEA. Colour #1976D2; width 0.8/1.5/2.5 and opacity 0.3/0.5/0.7 at zoom 1/5/10.
- Geometry is the real submarine-cable network from /data/submarine-cables.json. Light-blue background arcs are dropped.
- Popup: '⚓ MARITIME' (#4FC3F7), FROM = cable name, TO = landing points, DOMAIN, SOURCE, and an 'OPEN SOURCE ↗' link to submarinecablemap.com.
- The rail count reads data.sdk_entities: sampled flights (about 60), ships, all earthquakes, GDACS events and geolocated news.
- sdk-air and sdk-intel line layers (cyan and indigo, 3 stacked widths) are defined, but no AIR/INTEL link features are ever built, so they render nothing.

Display layers:
- day_night: a solar-terminator polygon fill, #000022 at 0.35 (#0D0030 in ghost), recomputed every 5 min.
- terrain_3d: an 'osiris-3d-buildings' fill-extrusion from CARTO vector tiles at zoom 14.5 and above.
- terrain_elevation: a DEM terrain loaded from zoom 10 via a cached tile protocol. Tilezen credits.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/components/OsirisMap.tsx

### 13. Map layers without a rail toggle (verified)

Conflict zones ('conflict-icons' symbol layer):
- Always visible, because the check is `activeLayers.conflict_zones !== false` and that key does not exist.
- Icons are canvas-drawn warning triangles: war 'warn-icon' #D32F2F, high 'warn-orange' #E65100, otherwise 'warn-yellow' #F9A825. Icon size 0.6/0.8/1.
- Label is the zone label in Open Sans Bold 7/9/11px, coloured by severity.
- Popup: '⚠️ label', description with '[N live events detected]', SEVERITY, COORDS, and '[ OPEN SOURCE ↗ ]' (liveuamap).
- /api/conflicts on the live site: totalZones 15 (6 war, 5 high, 4 elevated; UKRAINE WAR, GAZA CONFLICT, LEBANON BORDER, SUDAN CIVIL WAR, MYANMAR CONFLICT, YEMEN WAR, SYRIA, DRC EASTERN CONFLICT, RED SEA THREAT, TAIWAN STRAIT, KOREAN DMZ, SAHEL INSTABILITY, SOMALIA, IRAQ INSTABILITY, ETHIOPIA) plus totalLiveEvents 21, drawn as extra war-severity icons.

Dead keys: balloons and radiation have styled layers (balloon-dots, rad-dots with DANGER/WARNING/violet colours) but /api/balloons and /api/radiation return 404, and neither has a toggle. war_alerts is unused.

RECON overlays that are always visible: ip-sweep devices, connections and pulse, and scan-targets (#D32F2F).

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/components/OsirisMap.tsx

### 14. Popup and interaction conventions (verified)

popup() helper: new maplibregl.Popup({closeButton:true, maxWidth:'420px', offset:14}). Only one popup exists at a time; popupRef is removed before a new one opens.

pStyle: background rgba(12,14,26,0.95), backdrop-filter blur(16px), border-radius 10px, padding 16px, font 'JetBrains Mono', plus a 1px border in the accent colour at about 25–40% alpha.

linkStyle: inline-block, margin-top 8px, padding 5px 12px, 10px text, letter-spacing 0.12em, radius 5px, border and background in the accent at about 40% and 10%.

Text colours: field labels #5C5A54 at 9px uppercase, values #E8E6E0 or #B0BEC5, secondary text #9B978E or #8A8880.

All interpolated values pass through htmlEsc, idSafe or urlSafe (http/https only).

There are no hover popups. mouseenter/mouseleave only toggle cursor:pointer on the clickable layers.

Context menu: a double right-click (a single long-press on touch) opens the Region Dossier.

The basemap is CARTO, proxied through /api/proxy-tiles. Globe projection uses sky #04040A.

Style Studio can override the --map-* CSS vars live (STYLE_EVENT). Plane icons are regenerated with map.updateImage, and the CCTV paint is updated with setPaintProperty.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/lib/map-palette.ts

### 15. Theme palette variables (verified)

Core (:root in globals.css): --map-cctv #00e676, --map-sat-comms #00e676, --map-sat-military #ff3d3d, --map-sat-navigation #448aff, --map-sat-earth #90ee90, --map-sat-science #ffd700, --map-sat-other #00e5ff, --map-flight-civil #00e5ff, --map-flight-private #ffd700, --map-flight-gov #ff9500, --map-flight-military #ff0000, --map-flight-unknown #546e7a.

Ghost/Phantom theme overrides: --map-cctv #b388ff, flight-civil #b388ff, flight-private #ce93d8, flight-gov #d500f9, flight-unknown #b388ff. Satellite vars are deliberately left unchanged. In ghost mode the dot images (dot-gold, dot-red and others) are all drawn in phantom purple.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/globals.css

## Recommendations

- Copy LAYER_GROUPS exactly into a typed config (key, label, dataKey, catKey, parent, requires, description) and have both the rail and the map read from it. Order: SDK, AVIATION, MARITIME, SPACE, SURVEIL, HAZARD, THREAT, NETWORK, NETINTEL, DISPLAY. Keep the ALL/NONE button, pin-on-click with ESC to unpin, the cyan active-count badge and sub-layer indentation.
- Seed activeLayers with the same 12 truthy keys so the header reads '12 LAYERS' on first load: maritime, satellites, cctv, cctv_previews, live_news, earthquakes, global_incidents, day_night, cables, sdk_sea, sdk_air, sdk_naval. Better still, count only toggles the user can see and say so in the UI. Persist state to ?layers= with a 1.5 s debounce.
- Keep lazy loading per layer (fetch on first toggle, guarded by a Set, released on failure), and poll only the active layers at the original cadences: flights 5 min, maritime 10 s with AIS / 5 min without, C2 5 min, news and weather 5 min, USGS and markets 15 min. Use SSE for malware.
- Do better than the original on density: add MapLibre clustering (cluster:true, a count bubble in the layer colour) for CCTV (~39.5k), fires, malware and GDACS instead of the original's decimation. Keep the custom WebGL satellite layer, or use deck.gl, for ~18.8k satellites drawn at altitude.
- Reuse the colour tokens listed in the findings verbatim so the replica matches 1:1. Put them in CSS vars (--map-*) so a Style Studio and a Ghost theme (#B388FF family) can override them at runtime.
- Fix the original's defects in the replica: pass mmsi into ship features so the MarineTraffic link works; rename /api/gdelt (it is GDACS) and label it Global Disaster Alerts; either build the sdk_air/sdk_naval links or drop the keys; remove the dead balloons/radiation layers or implement them (for example the SondeHub and Safecast APIs); add a toggle for the always-on conflict-zone layer.
- For the flight-path feature the user asked for: the original's popup already resolves origin and destination through /api/flight-route (adsbdb, hexdb, airplanes.live) and explicitly stopped drawing the straight airport-to-airport line. For the replica, draw a great-circle planned route between the IATA/ICAO airports (OurAirports CSV) plus the actual track (adsb.lol traces, as /api/aircraft already references), and add an airport-code search that lists and highlights flights between two airports.

## Gaps (not verified)

- Could not pin a commit SHA or date for master. The GitHub REST API and github.com were blocked for this session (403 / 'not enabled'), so every source reference is raw.githubusercontent.com/.../master as of 2026-09-30. The live-bundle check stands in for version pinning.
- Did not read the internals of the CameraViewer, LiveFeed player, FlightWatchPanel or StyleStudio panels. Only their triggers and the entity fields passed to them are documented.
- The exact lucide icon for the MARITIME group is minified as `x` in the live bundle. The source import list includes Ship and Anchor, but the MARITIME group's icon line was not captured in the excerpt; Ship is most likely (UNVERIFIED).
- ALERT_FRESH_MS (the age threshold for the alert-pin pulse) and the DOUBLE_RIGHT_MS / DOUBLE_RIGHT_SLOP_PX values were not extracted.
- The full list of the 64 nuclear facilities and the full CCTV region/source list were not enumerated. Only the counts and example sources were taken.
- The README's '16 toggleable layers', '23 live streams' and '13 conflict zones' are out of date. The code and live API give 29 toggles (27 visible on the live site), 15 streams and 15 zones.
