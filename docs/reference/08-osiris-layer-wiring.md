# OSIRIS layer wiring table (key → fetch → data → source → layer ids → visibility)
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
**Question answered:** There is no single wiring table from layer key → fetch URL + transform → dataRef key → GeoJSON source → layer ids → visibility rule. Hidden or always-on keys are not called out either.

## Summary

Full layer wiring for the osiris reference clone (/home/user/simplifaisoul/osiris), read from the code. The chain for each layer runs: activeLayers key (src/app/page.tsx:328-370) → fetch URL + transform (page.tsx:683-855) → one flat dataRef.current bag, shallow-merged by fetchEndpoint (page.tsx:656-680) → MapLibre GeoJSON source (35 are pre-created empty at src/components/OsirisMap.tsx:410-411 and filled by setGeo, OsirisMap.tsx:1813-1816) → layer ids (addLayer calls at OsirisMap.tsx:438-897) → visibility (setVis at OsirisMap.tsx:2369-2410, which skips missing ids via a getLayer guard) → panel label and count (LAYER_GROUPS at src/components/LayerPanel.tsx:52-152, getCount at 252-266). Every layer renderer also sends an empty FeatureCollection when its key is off, so turning a layer off is enforced twice: empty data plus visibility 'none'. Data is fetched at most once per key, recorded in layerFetchedRef. It is never cleared when a layer goes off; only the polled layers refresh. Things a builder would not guess: (a) Keys with no panel toggle: cables (true), sdk_air (true), sdk_naval (true), war_alerts (false), balloons (false), radiation (false). (b) Keys read by the map but missing from the defaults: conflict_zones and internet_outages. (c) There are no /api/balloons or /api/radiation routes, so those two layers can never show data. (d) The 'Maritime Lines' (sdk_sea) row counts sdk_entities, but the layer draws submarine cables. The sdk-air and sdk-intel layers are always empty. (e) Weather is a core feed, so its layer toggle never fetches. (f) Flights are thinned before drawing: commercial keeps every 10th, private and jets every 2nd. (g) Several layers are always on with no key at all.

## Findings

### 0. Fetch plumbing: fetchEndpoint + layerFetchedRef + loadLayerOnce

fetchEndpoint(url, transform?, options?, {skipWhenHidden=false}) at page.tsx:656-680:
- If skipWhenHidden && document.hidden it returns false.
- Calls fetch(url, {...options, cache:'no-store'}).
- On res.ok: dataRef.current = {...dataRef.current, ...(transform ? transform(json) : json)}, then setDataVersion(v+1) and setBackendStatus('connected'); returns true.
- On a non-OK status it returns false silently, with no status change.
- On a thrown error it logs '[OSIRIS] Suppressed error:', calls setBackendStatus('error') and returns false.
- skipWhenHidden is used only by the core background polls (page.tsx:716-721). The comment says skipping a user-initiated load would leave the layer empty.

layerFetchedRef = useRef<Set<string>> (page.tsx:732). The layer-fetch effect (page.tsx:745-855, deps [activeLayers]) adds the key before or while fetching and never removes it. The exception is loadLayerOnce(key, url, transform) (page.tsx:833-839): it marks first, then deletes the mark if fetchEndpoint returns false, so a failed request can retry on the next toggle. Only gdelt_events and cloudflare_radar use loadLayerOnce.

Flat-bag collisions: /api/flights, /api/fires and /api/satellites are merged with no transform (satellites only adds satellites_at). Their root keys total, source and timestamp overwrite each other, which is why newsTransform nests its metadata under news_meta (page.tsx:138-146). /api/flights also drops gps_jamming and providers at the root, and no client code reads gps_jamming.

Files: `src/app/page.tsx:656-680`, `src/app/page.tsx:732`, `src/app/page.tsx:833-839`, `src/app/page.tsx:138-146`, `src/app/api/flights/route.ts:452-470`

### 1. Default activeLayers (exact)

page.tsx:328-370, in order:
- flights:false, private:false, jets:false, military:false
- maritime:true
- satellites:true
- sat_comms:false, sat_military:false, sat_navigation:false, sat_earth:false, sat_science:false
- balloons:false
- cctv:true, cctv_previews:true
- live_news:true
- earthquakes:true
- fires:false, weather:false, radiation:false, infrastructure:false
- global_incidents:true
- alert_pins:false, war_alerts:false
- day_night:true
- cables:true
- sdk_sea:true, sdk_air:true, sdk_naval:true
- terrain_3d:false, terrain_elevation:false
- malware:false, cyber_attacks:false, gdelt_events:false, cf_outages:false, cf_attacks:false

Keys with no LayerPanel row: balloons, radiation, war_alerts, cables, sdk_air, sdk_naval.
Keys the map reads that are not in the defaults: conflict_zones (OsirisMap.tsx:2401) and internet_outages (OsirisMap.tsx:2385).

Files: `src/app/page.tsx:328-370`, `src/components/LayerPanel.tsx:52-152`

### 2. WIRING: AVIATION flights/private/jets/military

Panel: group 'AVIATION'. Rows 'Commercial' (dataKey commercial_flights), 'Private' (private_flights), 'Private Jets' (private_jets), 'Military' (military_flights). All default false.

Fetch: if any of the four is on, fetchEndpoint('/api/flights') runs with no transform. The whole response merges at the root: commercial_flights, private_flights, private_jets, military_flights, gps_jamming, total, source, providers, timestamp. It is fetched once under the fetched-key 'flights' (page.tsx:748-753).

Poll: setInterval every 300000 ms while any of the four is on (page.tsx:861-863), without skipWhenHidden.

Map effect (OsirisMap.tsx:1825-1841): toFeatures(arr, decimate) keeps rows where i % decimate === 0. Properties: callsign, heading||0, alt, model, speed_knots, registration, icao24.
- source 'flights' ← commercial_flights, decimate 10 → layer fl-commercial, icon plane-cyan
- source 'private-fl' ← private_flights, decimate 2 → fl-private, plane-green
- source 'jets' ← private_jets, decimate 2 → fl-jets, plane-pink
- source 'military' ← military_flights, no decimation → fl-military, plane-red

Layer style (OsirisMap.tsx:795-806): symbol; icon-size interpolates by zoom 1→0.4, 5→0.7, 10→1; icon-rotate = get heading; icon-rotation-alignment map; allow-overlap and ignore-placement true; icon-opacity 0.85.

Visibility: setVis per key (2388-2391).

Panel counts use the full, undecimated arrays.

Click handler (OsirisMap.tsx:977-1076): popup, then /api/aircraft?icao24=, then /api/flight-route?callsign=&icao24=&lat=&lng=&speed=. The popup shows FROM/TO IATA, a progress bar, 'DEP hh:mm', '<pct>% · <km>km', 'ARR hh:mm'. It falls back to 'NO SCHEDULED ROUTE' or 'ROUTE UNAVAILABLE'. No route line is drawn on the map.

Files: `src/app/page.tsx:748-753`, `src/app/page.tsx:861-863`, `src/components/OsirisMap.tsx:795-806`, `src/components/OsirisMap.tsx:1825-1841`, `src/components/OsirisMap.tsx:977-1076`

### 3. WIRING: MARITIME maritime

Panel: 'Maritime / Naval'. dataKey 'maritime_ships,maritime_ports,maritime_chokepoints'; the count is the sum of the three arrays. Default true.

Fetch: /api/maritime → {maritime_ports:d.ports, maritime_chokepoints:d.chokepoints, maritime_ships:d.ships}, once (page.tsx:770-773).

Poll: a self-rescheduling setTimeout (page.tsx:880-889). vesselGapMs() = (dataRef.current.maritime_ships?.length ?? 0) > 0 ? 10_000 : 300_000.

Sources (OsirisMap.tsx:2175-2180):
- 'maritime' (ports; props name, country, type, volume, fleet, rank)
- 'maritime-choke' (name, traffic, risk)
- 'maritime-ships' (name = s.name || s.mmsi?.toString(); type = s.type || 'cargo'; speed, heading, destination, flag)

Layers:
- maritime-glow, maritime-dots: type naval #D32F2F, energy #E65100, else #26C6DA
- maritime-label: minzoom 4
- choke-glow: #E65100
- choke-dots: risk CRITICAL #D32F2F, HIGH #E65100, ELEVATED #F9A825, else #26A69A
- choke-label: minzoom 3
- ship-dots, ship-label (minzoom 5): military #D32F2F, tanker #E65100, cargo #26C6DA, else #B0BEC5

Visibility: all of these follow activeLayers.maritime (2396-2398).

Files: `src/app/page.tsx:770-773`, `src/app/page.tsx:871-890`, `src/components/OsirisMap.tsx:2175-2180`, `src/components/OsirisMap.tsx:674-705`, `src/components/OsirisMap.tsx:889-897`

### 4. WIRING: SPACE satellites + sat_* sub-layers

Panel: group 'SPACE TRACKING'.
- 'All Satellites' (satellites; count = data.satellites.length)
- 'Starlink / Comms' (catKey comms)
- 'Military / Intel' (military)
- 'GPS / Navigation' (navigation)
- 'Earth Observation' (earth_obs)
- 'Stations / Telescopes' (science)
Sub-layer counts read data.category_counts[catKey] || 0.

Fetch: when any satellite key is on, '/api/satellites' is fetched once with d => ({...d, satellites_at: d.timestamp}) (page.tsx:755-763). It is never polled. The root receives satellites, total, category_counts, source, raw_count, timestamp and satellites_at.

Server categories (api/satellites/route.ts:296-307): comms, navigation, earth_obs, military, science, other. 'other' (including debris) is only visible through 'All Satellites'.

Map (OsirisMap.tsx:1950-1987):
- If satellites is on, everything is drawn.
- Otherwise rows are filtered by the enabled categories. If none are enabled, the source is emptied and the selection cleared.
- Source 'satellites' feeds layers sat-glow and sat-dots, which are always hidden: setVis([...], false) at 2376, and they are added with visibility 'none'.
- The visible rendering is the custom WebGL layer 'sat-3d' (createSatelliteLayer, OsirisMap.tsx:668-671), fed by satLayerRef.setPoints(toSatPoints(rows)). Points carry altKm = s.alt; size is 2.2 if category is 'science' or the name matches /ISS|TIANGONG/i, else 1.
- If no satellite key is on, satRowsRef is set to [] and setPoints([]) is called (2378).

Click: a GPU pick, then /api/satellites/orbit?id=&t=<satellites_at> (1172).

Files: `src/components/LayerPanel.tsx:80-92`, `src/app/page.tsx:755-763`, `src/components/OsirisMap.tsx:655-671`, `src/components/OsirisMap.tsx:1950-1987`, `src/components/OsirisMap.tsx:2372-2378`, `src/app/api/satellites/route.ts:296-340`

### 5. WIRING: SURVEILLANCE cctv / cctv_previews / live_news

cctv — 'CCTV Cameras', dataKey cameras, default true.
- Its own effect (page.tsx:733-743) runs loadCameraCatalog (src/lib/camera-catalog.ts).
- Request: /api/cctv?region=all with cache 'no-store'.
- Retry: remaining = data.pendingRegions (filtered by /^[a-z-]+$/). At most 3 attempts, delay attempts*15_000 ms.
- Merge: mergeCameraCatalog by String(id) into dataRef.cameras. No poll.
- Source 'cctv' (id, name, city, country, source, feed_url, stream_url, stream_type, external_url).
- Layers: cctv-glow (#000000, opacity 0.35), cctv-dots (palette.cctv), cctv-label (minzoom 10). Visibility follows cctv.

cctv_previews — 'Live Previews', parent 'cctv', dataKey '' (no count), default true. It has no source or layer. It gates the CctvPreviews DOM overlay: active = !!cctv && !!cctv_previews (OsirisMap.tsx:3292-3297). While cctv is off, the row renders dimmed at opacity-40 with the tooltip 'Turn the layer above on to use this'.

live_news — 'Live News Feeds', dataKey live_feeds, default true.
- /api/live-news → live_feeds: d.feeds (the static LIVE_FEEDS list), fetched once and never polled.
- Source 'live-news' (name, city, country, url, category, embed_allowed = f.embed_allowed !== false).
- Layers news-glow, news-dots, news-label (minzoom 4), colour #EC407A.
- LiveNewsPreviews overlay: active = !!live_news, feeds = data.live_feeds (3300-3313).

Files: `src/app/page.tsx:733-743`, `src/lib/camera-catalog.ts:1-40`, `src/components/OsirisMap.tsx:2155-2158`, `src/components/OsirisMap.tsx:2234-2237`, `src/components/OsirisMap.tsx:3292-3313`, `src/components/LayerPanel.tsx:93-102`

### 6. WIRING: HAZARD earthquakes / fires / weather

earthquakes — 'Earthquakes', default true.
- Core feed, fetched regardless of the toggle, straight from the browser (not through /api/earthquakes): https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson
- eqTransform → earthquakes: [{id, lat, lng, depth, magnitude, place, time, url, tsunami, type, felt, alert}] (page.tsx:685-687).
- Poll: 900000 ms with skipWhenHidden.
- Source 'earthquakes' (id, magnitude, place, depth, source).
- eq-circles: radius by magnitude 2.5→4, 5→12, 7→24; colour 2.5 #F9A825, 4 #E65100, 6 #D32F2F; opacity 0.55.
- eq-label: filter magnitude >= 4.5, text 'M'+magnitude.
- Visibility follows earthquakes.

fires — 'Active Fires', default false.
- /api/fires with no transform → root keys fires, total, source, timestamp (server s-maxage=600). Fetched once, never polled.
- Source 'fires' carries brightness only.
- Layer fires-heat: circle #E65100, opacity 0.45, blur 0.5.

weather — 'Severe Weather', dataKey weather_events, default false.
- Core feed: /api/weather → weather_events: d.events. Fetched on mount whatever the toggle, polled every 300000 ms with skipWhenHidden (page.tsx:692, 720).
- The mount effect calls layerFetchedRef.add('weather') (page.tsx:693), so the layer-toggle branch at page.tsx:790-793 never runs.
- Source 'weather' (title, type, icon, severity, source, id).
- weather-glow #7E57C2; weather-dots: icon cyclone #7E57C2, volcano #D32F2F, else #7E57C2; weather-label.

Files: `src/app/page.tsx:685-693`, `src/app/page.tsx:716-720`, `src/app/page.tsx:765-768`, `src/app/page.tsx:789-793`, `src/components/OsirisMap.tsx:457-470`, `src/components/OsirisMap.tsx:1913-1916`, `src/components/OsirisMap.tsx:2160-2168`, `src/app/api/fires/route.ts:69-77`

### 7. WIRING: THREAT infrastructure / global_incidents / alert_pins / gdelt_events

infrastructure — 'Nuclear Facilities', default false.
- /api/infrastructure → infrastructure: d.infrastructure, once, no poll.
- Source 'infrastructure' (name, city, country, status, reactors, capacityMW, owner, sourceUrl).
- Layers infra-glow, infra-dots, infra-label (minzoom 5). Colour #E65100 if status contains 'SEISMIC RISK', else #26A69A.

global_incidents — 'Global Incidents', dataKey gdelt, default true.
- /api/gdelt → gdelt: d.events, fetched-key 'gdelt', once, no poll.
- Source 'gdelt' (name, url, kind = e.type).
- Layer gdelt-dots: radius 4, #D32F2F, opacity 0.5.

alert_pins — 'Live Alert Pins', default false. It can also be toggled from the LiveAlerts panel (onTogglePins, page.tsx:1548).
- Data comes from the core /api/news poll: newsTransform, every 300000 ms with skipWhenHidden. alert_pins = news.filter(n => n.place).
- The map builds alertPinsRef on every change, even when the layer is off. It keeps reports with place, finite coords [lat,lng], and an id in alertPinIds (the ids LiveAlerts' filters leave showing).
- Properties: id; kind (rocket | event | else 'news'); stack (reports sharing the same 'lat,lng'); fresh (now − published < ALERT_FRESH_MS = 15*60_000); title; source_name; lean; published; link; place_name; place_label; precision; media_kind; video; thumb; duration.
- setGeo('alert-pins', on ? ref : []).
- Layers: alert-pin-glow, alert-pin-dots, alert-pin-pulse (filter fresh == true), alert-pin-selected (filter id == ''), alert-pin-label (minzoom 5).
- Pulse animation on a 200 ms interval: radius 9 + sin(t/260)*3.5; stroke-opacity 0.55 + sin(t/260)*0.25.

gdelt_events — 'GDELT Events', default false.
- loadLayerOnce('gdelt_events', '/api/gdelt-events?limit=600', d => ({gdelt_events: d.events})), no poll.
- Source 'gdelt-events' (name, country, quad, quad_label, tone, goldstein, articles, url, date).
- Layer gdelt-events-dots: radius by articles 1→3, 10→5, 50→8, 200→12; colour matched on quad.

Files: `src/app/page.tsx:794-803`, `src/app/page.tsx:841-844`, `src/app/page.tsx:1548`, `src/components/OsirisMap.tsx:1989-2009`, `src/components/OsirisMap.tsx:2170-2173`, `src/components/OsirisMap.tsx:2239-2303`, `src/components/OsirisMap.tsx:133`

### 8. WIRING: NETWORK malware (SSE) / cyber_attacks

malware — 'Live Malware', dataKey malware_threats, default false.
- Not fetched. Pushed over new EventSource('/api/malware/stream') while the layer is on (page.tsx:907-965).
- Events: 'snapshot' clears and refills a Map keyed by ip. 'detections' upserts, and sets detected_at = Date.now() only when filled && event.fresh. 'status' sets filled = true and deletes event.retired ips.
- onerror sets 'error' only when readyState === CLOSED.
- Source 'malware-nodes': ip, malware, status, threat_type, country, city, port, asn, as_name, url_count ?? 1, first_seen, last_seen, reference, reporter, detected_at ?? 0.
- Source 'malware-new': arrivalBeacons(), 200 ms tick. The ring radius is rewritten each tick as interpolate(age) 0 → 6 + sin(now/200)*2, 1 → 26.
- Source 'network-mesh': each node i is linked to nodes (i+1) % n and (i+2) % n (OsirisMap.tsx:2100-2120).
- Layers: malware-glow (#D32F2F, 0.06), malware-dots (#D32F2F), malware-label (minzoom 5, text = malware), malware-new-ring.
- Visibility: those four follow malware. network-mesh-atmo, network-mesh-glow and network-mesh-core follow activeLayers.internet_outages || activeLayers.malware.

cyber_attacks — 'Botnet C2 Servers', default false.
- /api/cyber-attacks → cyber_attacks: d.indicators, once, then polled every 300000 ms (page.tsx:891-897). The poll's delete/add of the fetched mark does nothing.
- Source 'cyber-heads', rows kept only if lat and lng are numbers: id, ip, port, malware, status, hostname, country, as_number, as_name, first_seen, last_online.
- Layer cyber-heads: colour #FF6D00 if status == 'online', else #555555. Layer cyber-labels: minzoom 3, text colour #333333 on a #000 halo.

Files: `src/app/page.tsx:824-828`, `src/app/page.tsx:891-897`, `src/app/page.tsx:907-965`, `src/components/OsirisMap.tsx:494-563`, `src/components/OsirisMap.tsx:2037-2151`, `src/components/OsirisMap.tsx:2384-2386`

### 9. WIRING: NETINTEL cf_outages / cf_attacks (capability-gated)

Panel: group 'NETINTEL', fullLabel 'NET & EVENT INTEL', icon Megaphone.
- 'Internet Outages' (cf_outages, dataKey cf_outages, requires 'cloudflare')
- 'Attack Origins' (cf_attacks, dataKey cf_attack_origins, requires 'cloudflare')

Capability: on mount, fetch('/api/cloudflare-radar?probe=1') → {configured, source:'Cloudflare Radar'} → setCapabilities({cloudflare: !!p.configured}) (page.tsx:437-440). Layers with requires are filtered out, and a group left with no layers disappears (LayerPanel.tsx:247-250).

Fetch: if either key is on, loadLayerOnce('cloudflare_radar', '/api/cloudflare-radar', d => ({cf_outages: d.outages ?? [], cf_attack_origins: d.attack_origins ?? []})). No poll.

Sources:
- 'cf-outages': country, country_name, scope, cause, event_type, description, start, end, ongoing, url
- 'cf-attacks': country, country_name, share

Layers:
- cf-outage-halo: #FFB300, opacity 0.12
- cf-outage-dots: ongoing #FFB300, else #8B7325
- cf-outage-label: minzoom 3, text = country_name
- cf-attack-dots: #FF3D3D, radius by share 0→4, 5→9, 20→16, 50→24
- cf-attack-label: minzoom 2, text = country + ' ' + share + '%'

Name clash: the panel label 'Internet Outages' is the key cf_outages. The unrelated, undeclared key internet_outages only gates the malware mesh.

Files: `src/components/LayerPanel.tsx:133-141`, `src/components/LayerPanel.tsx:245-250`, `src/app/page.tsx:437-440`, `src/app/page.tsx:846-852`, `src/components/OsirisMap.tsx:586-613`, `src/components/OsirisMap.tsx:2011-2035`, `src/app/api/cloudflare-radar/route.ts:155-200`

### 10. WIRING: OSIRIS SDK sdk_sea ('Maritime Lines') + hidden cables/sdk_air/sdk_naval

Panel: group 'SDK', fullLabel 'OSIRIS SDK', icon Network. Its only row is {key:'sdk_sea', label:'Maritime Lines', dataKey:'sdk_entities'}.

Data — hidden key cables (default true). A raw fetch, not fetchEndpoint: fetch(`/data/submarine-cables.json?v=${Date.now()}`) → dataRef.submarine_cables = cablesData.features (page.tsx:805-819). It is marked fetched even on failure, never polled, and a failure only logs 'Cables fetch failed'.
- public/data/submarine-cables.json is 665,094 bytes with 717 features. Properties: id, name, color, feature_id, coordinates, length_km. Geometry is MultiLineString.
- public/data/submarine-cables-filtered.json is byte-identical and unused.

Map effect (OsirisMap.tsx:2194-2232):
- setGeo('sdk-entities', []) always runs; no layer reads that source.
- If no SDK key is on, 'sdk-links' is emptied.
- If sdk_sea && submarine_cables: skip features whose properties.color is in {#9BB5CC, #A0B8CD, #8EABC2} or the lowercase forms. That drops 270+180+140 = 590, leaving 127 cables.
- Each kept cable is pushed with properties {domain:'SEA', fromName: name || 'Submarine Cable', toName: landing_points || '', source:'Global Subsea Cable Network', url:'https://www.submarinecablemap.com/', ...cable.properties, color:'#1976D2'}.

Layers on source 'sdk-links':
- sdk-sea: filter domain == SEA; line-color coalesce(get color, '#1976D2'); width zoom 1→0.8, 5→1.5, 10→2.5; opacity 1→0.3, 5→0.5, 10→0.7.
- sdk-air-atmo, sdk-air-glow, sdk-air (#4DD0E1, #80DEEA, #B2EBF2) and sdk-intel-atmo, sdk-intel-glow, sdk-intel (#7986CB, #9FA8DA, #C5CAE9) are defined, but no code ever emits AIR or INTEL features, so they are always empty.

Visibility (2405-2407):
- sdk_sea !== false → ['sdk-sea', 'sdk-sea-glow', 'sdk-sea-atmo']. The last two ids do not exist and are skipped by the getLayer guard.
- sdk_air !== false → the AIR layers.
- sdk_naval !== false → the INTEL layers.

Click popup: labels '⚓ MARITIME' (#4FC3F7), '✈ AIR CORRIDOR', '🛡 NAVAL INTEL'.

Panel count (page.tsx:975-1048): sdk_entities is built whenever any of sdk_sea, sdk_air or sdk_naval is on:
- flights: all four arrays, step max(1, floor(n/60)), domain AIR, source 'ADS-B / OpenSky'
- ships: step max(1, floor(n/60)), domain SEA, source 'AIS Stream'
- all earthquakes: domain LAND, name 'M<mag> <place>', source 'USGS'
- all gdelt: domain INTEL, source 'GDELT Project'
- news with coords: coordinates [n.coords[1], n.coords[0]], domain INTEL
- It is written to dataRef with no setDataVersion bump, so the count lags by one render.
- sdk_air and sdk_naval stay true with no UI, so turning sdk_sea off leaves sdk_entities populated and the row still shows a count. The count never matches what the layer draws (cables).

Files: `src/components/LayerPanel.tsx:53-60`, `src/app/page.tsx:805-819`, `src/app/page.tsx:971-1048`, `src/components/OsirisMap.tsx:839-886`, `src/components/OsirisMap.tsx:1398-1422`, `src/components/OsirisMap.tsx:2192-2232`, `src/components/OsirisMap.tsx:2405-2407`, `public/data/submarine-cables.json`

### 11. WIRING: DISPLAY day_night / terrain_3d / terrain_elevation

day_night — 'Day / Night Cycle', dataKey '', default true.
- No fetch. computeSolarTerminator() (OsirisMap.tsx:93) writes one Polygon into source 'day-night' every 300000 ms. When off, the source gets EMPTY_FC.
- Layer day-night-fill: fill-color #000022 (ghost theme #0D0030), fill-opacity 0.35.

terrain_3d — '3D Buildings', description 'City detail · zoom 14.5+'.
- When on, addLayer 'osiris-3d-buildings': fill-extrusion on source 'carto', source-layer 'building', minzoom 14.5.
- Colour by render_height: 0 #1a1a2e, 20 #16213e, 50 #0f3460, 120 #533483, 300 #e94560. Height and base ramp in between zoom 14.5 and 15.5. Opacity 14.5→0, 15→0.7.
- Eases pitch to 50 if the current pitch is below 40. Turning it off removes the layer (2562-2621).

terrain_elevation — '3D Terrain', description 'Mountains · zoom 10+'.
- Passed as terrainEnabled = terrain_elevation && mapProjection === 'globe' (page.tsx:1257).
- lib/map-terrain: TERRAIN_SOURCE 'osiris-terrain-dem', TERRAIN_MIN_ZOOM 10, TERRAIN_SETTLE_MS 500.
- Status texts: 'Terrain at zoom 10+ · zoom in', 'Terrain starts when you stop moving', 'Loading nearby terrain…', 'Terrain unavailable; the map is still usable.', 'Terrain on'.

Turning either terrain key on calls on3DModeSelected → setMapProjection('globe'). The 'g' key and selectFlatMap force both keys false and switch the projection (page.tsx:372-375, 519-522).

Files: `src/components/LayerPanel.tsx:142-151`, `src/components/LayerPanel.tsx:220-232`, `src/components/OsirisMap.tsx:1798-1810`, `src/components/OsirisMap.tsx:454`, `src/components/OsirisMap.tsx:2562-2621`, `src/app/page.tsx:1257`, `src/lib/map-terrain.ts:4-10`

### 12. Odd / hidden keys: conflict_zones, war_alerts, balloons, radiation, internet_outages

conflict_zones — not in the defaults and has no toggle.
- OsirisMap itself runs fetch('/api/conflicts') once per map mount, in an effect gated on mapReady (OsirisMap.tsx:2306-2365). Nothing goes into dataRef.
- zones → {label, severity, description + (eventCount > 0 ? ` [${eventCount} live events detected]` : ''), sourceUrl, eventCount}.
- liveEvents (lat and lng required) → {label: (title || 'CONFLICT EVENT').substring(0,60).toUpperCase(), severity:'war', description, sourceUrl: url}.
- On error it falls back to 6 hard-coded zones: UKRAINE WAR 48.5,31.2; GAZA CONFLICT 31.35,34.35; SUDAN CIVIL WAR 15,30; YEMEN WAR 15.5,48; MYANMAR CONFLICT 19.5,96.5; SYRIA (high) 35,38.5; each with a liveuamap sourceUrl.
- Layer conflict-icons: symbol with canvas warning triangles — warn-icon #D32F2F for war, warn-orange #E65100 for high, warn-yellow #F9A825 otherwise. Text colours match. Icon-size by zoom 1→0.6, 4→0.8, 8→1.
- Visibility: activeLayers.conflict_zones !== false. The URL restore only iterates the default keys, so this layer is effectively always on.
- It is the first layer added, so it draws beneath day-night-fill.
- OsirisMap is rendered with key={osirisTheme}, so switching theme remounts the map, rebuilds every layer and re-fetches /api/conflicts.

war_alerts — default false, no UI, nothing reads it. Sources 'war-alerts-targets' and 'war-alerts-lines' are created (OsirisMap.tsx:410) but no layer or setGeo uses them.

balloons and radiation — default false, no LayerPanel row.
- page.tsx fetches /api/balloons → balloons: d.balloons and /api/radiation → radiation: d.stations, once each, and polls them every 300000 ms (page.tsx:774-783, 865-870).
- Neither route exists: src/app/api has no balloons/ or radiation/ directory, and next.config and nginx have no rewrite. Both return 404, fetchEndpoint returns false silently, and the fetched mark is kept.
- The layers exist: balloon-dots and balloon-label (colour from get 'color'); rad-glow, rad-dots and rad-label (text reading + ' nSv/h'; colour DANGER #D32F2F, WARNING #E65100, else #7E57C2).
- The only way to enable them is ?layers=.

internet_outages — undeclared. It appears only in the network-mesh OR gate.

Files: `src/components/OsirisMap.tsx:410-411`, `src/components/OsirisMap.tsx:434-450`, `src/components/OsirisMap.tsx:2306-2365`, `src/components/OsirisMap.tsx:2401`, `src/components/OsirisMap.tsx:811-837`, `src/app/page.tsx:357`, `src/app/page.tsx:774-783`, `src/app/page.tsx:865-870`, `src/app/page.tsx:1252-1253`

### 13. Always-on / keyless map layers

No activeLayers key controls these:
- IP sweep: layers sweep-connections (dash [2,4], opacity 0.3), sweep-pulse-ring, sweep-device-glow, sweep-device-dots, sweep-device-labels (minzoom 13, text device_type\nip). Sources ip-sweep-connections, ip-sweep-pulse, ip-sweep-devices. Forced visible with setVis(..., true) at 2409 and fed by the sweepData prop. The effect flies to zoom 14, pitch 50, bearing -20 over 3000 ms, then adds devices in batches of 5 every 100 ms.
- scan-targets-glow, scan-targets-dots, scan-targets-label: source 'scan-targets', #D32F2F, no setVis.
- watched-airport-glow (#FFB300, r13, opacity 0.16), watched-airport-dot (white, #FFB300 stroke 2), watched-airport-label (text = iata || icao, #FFB300, halo #0C0E1A). The source 'watched-airports' is added and removed dynamically from aircraftAirports (OsirisMap.tsx:2968-3035).
- Directions layers: directions-alt-line, directions-line-casing, directions-line, directions-active-line, directions-endpoint-halo, directions-endpoint.
- User location layers: user-accuracy-fill, user-accuracy-line, user-dot-pulse, user-dot, user-dot-core (#4285F4).
- Drawing: draw-*-temp.
- ArcGIS: `${sourceId}-fill`, `${sourceId}-line`, `${sourceId}-circle`.
- Basemap: satellite-layer raster, with ArcGIS World_Imagery tiles inserted below day-night-fill.

Files: `src/components/OsirisMap.tsx:754-792`, `src/components/OsirisMap.tsx:2408-2496`, `src/components/OsirisMap.tsx:2717-2810`, `src/components/OsirisMap.tsx:2840-2894`, `src/components/OsirisMap.tsx:2968-3035`

### 14. Core (non-layer) feeds and cadences

Mount effect (page.tsx:683-729):
- USGS earthquakes: immediately, then every 900000 ms.
- /api/news via newsTransform → {news, news_meta:{sources, fetchedAt}, alert_pins}: immediately, then every 300000 ms. The comment says the route caches each Telegram channel for 3 min.
- /api/weather: immediately, then every 300000 ms.
- /api/markets → {markets: d}: starts after 800 ms. Retries while markets.count is 0, at 15000 ms gaps, up to attempt < 3. Then polls every 900000 ms.
- /api/space-weather: fetched once after 5000 ms into component state (setSpaceWeather), not dataRef.
- All the polls above use skipWhenHidden.

Other mount work:
- /api/stats → globalStats.
- /api/cloudflare-radar?probe=1.
- /api/geo: IP-based home location, cancelled on the first pointerdown or keydown.

LiveAlerts' refresh button calls fetchEndpoint('/api/news', newsTransform) directly.

Files: `src/app/page.tsx:683-729`, `src/app/page.tsx:435-470`, `src/app/page.tsx:494-500`, `src/app/page.tsx:1548`

### 15. URL layer persistence and init-order nuance

Write: with a 1500 ms debounce, history.replaceState to `${pathname}?layers=${truthy keys joined by ','}` (page.tsx:483-492).

Restore on mount (page.tsx:423-433): for each key in the defaults object, next[k] = active.includes(k).
- Keys outside the defaults (conflict_zones, internet_outages) can never be set.
- An empty ?layers= is falsy, so the defaults are kept.

SharePanel builds `${origin}/?lat=..&lon=..&zoom=..&layers=..`. Its fallback base is 'https://osiris.vercel.app' (SharePanel.tsx:17-34).

Init order: the restore effect (page.tsx:420) and the layer-fetch effects (733, 745) run in the same first commit with the default activeLayers. So the default-on layers (maritime, satellites, cctv, live_news, global_incidents, cables) are always fetched on load, even when the URL turns them off.

Files: `src/app/page.tsx:420-433`, `src/app/page.tsx:483-492`, `src/components/SharePanel.tsx:17-34`

### 16. Panel count semantics (getCount) and HUD entity count

getCount(dk, catKey) (LayerPanel.tsx:252-266):
- An empty dk returns null, so no number is shown.
- If catKey is set and data.category_counts exists, it returns category_counts[catKey] || 0.
- Otherwise it splits dk on ',' and sums the lengths of the arrays found. If none of them is an array it returns null, so the number stays hidden until data arrives.
- The number is rendered with toLocaleString, tabular-nums, at white/45 when active and white/20 when inactive.

The rail badge counts active layers per group, excluding sub-layers that have a parent. It is a cyan pill: background rgba(0,229,255,0.9), text #04040A.

The group button 'ALL' / 'NONE' turns all of the group's layers on or off.

The HUD ActiveEntityCount (page.tsx:91-97) sums every array at the dataRef root. That double-counts sdk_entities (a re-sample of flights, ships, quakes, gdelt and news), alert_pins (a subset of news) and submarine_cables, and it includes cameras, satellites and so on.

Files: `src/components/LayerPanel.tsx:252-266`, `src/components/LayerPanel.tsx:365-424`, `src/app/page.tsx:91-97`

### 17. Layer z-order (bottom to top, by addLayer order)

1. conflict-icons
2. day-night-fill
3. eq-circles, eq-label
4. fires-heat
5. cctv-glow, cctv-dots, cctv-label
6. malware-glow, malware-dots, malware-new-ring, malware-label
7. network-mesh-atmo, network-mesh-glow, network-mesh-core
8. cyber-heads, cyber-labels
9. gdelt-dots
10. gdelt-events-dots
11. cf-outage-halo, cf-outage-dots, cf-outage-label
12. cf-attack-dots, cf-attack-label
13. weather-glow, weather-dots, weather-label
14. infra-glow, infra-dots, infra-label
15. sat-glow, sat-dots (hidden)
16. sat-3d (custom WebGL)
17. maritime-glow, maritime-dots, maritime-label
18. choke-glow, choke-dots, choke-label
19. news-glow, news-dots, news-label
20. alert-pin-glow, alert-pin-dots, alert-pin-pulse, alert-pin-selected, alert-pin-label
21. sweep-connections, sweep-pulse-ring, sweep-device-glow, sweep-device-dots, sweep-device-labels
22. scan-targets-glow, scan-targets-dots, scan-targets-label
23. fl-commercial, fl-private, fl-jets, fl-military
24. balloon-dots, balloon-label
25. rad-glow, rad-dots, rad-label
26. sdk-sea, sdk-air-atmo, sdk-air-glow, sdk-air, sdk-intel-atmo, sdk-intel-glow, sdk-intel
27. ship-dots, ship-label

Added later on top: route and directions layers, osiris-3d-buildings, watched-airports.

Files: `src/components/OsirisMap.tsx:438-897`

### 18. Click-target list mismatches

CLICKABLE_LAYERS (OsirisMap.tsx:1123-1127) decides whether the satellite GPU pick defers to another layer. It lists 'flight-dots', 'military-dots', 'jet-dots' and 'private-dots', none of which exist, and omits the real fl-commercial, fl-private, fl-jets and fl-military.

Result: clicking an aircraft also runs the satellite pick. If a satellite sits under the cursor, it calls popupRef.current?.remove() and replaces the flight popup with the satellite card.

Other dead bindings:
- The hover list (1457) binds 'sdk-sea-glow' and 'sdk-sea-atmo', which do not exist.
- map.on('click', 'scm-dots') (1478) targets a layer that is never added in OsirisMap.
Whether maplibre-gl 6.7.0 warns about these bindings was not checked.

Files: `src/components/OsirisMap.tsx:1123-1127`, `src/components/OsirisMap.tsx:1457`, `src/components/OsirisMap.tsx:1478`, `src/components/OsirisMap.tsx:977`, `package.json:24`

## Worth copying

- One source → several layers (glow / dots / label, with label minzoom 3-10) and a single setVis(ids[], bool) guarded by map.getLayer(id). Define it as a declarative LAYER_REGISTRY {key, label, group, fetch:{url, transform, pollMs, adaptive?}, dataKeys[], source, layerIds[], countKey} so the fetch, panel, visibility and count come from one table instead of four files.
- Clear data and hide visibility together: setGeo(source, on ? features : []) plus visibility 'none'. The GPU then holds nothing for layers that are off.
- loadLayerOnce: mark the key before awaiting so a re-render cannot double-fetch, then release the mark if nothing landed so one failed request does not leave the layer empty for the session.
- skipWhenHidden only for background polls, never for user-initiated loads, and a boolean return value so callers can retry.
- Adaptive polling: a self-rescheduling setTimeout. Maritime polls every 10 s when vessels are present and every 5 min when the reply is a constant document.
- Server-sent events for event-like feeds (snapshot / detections / status with retired ids), keyed by id so a re-report updates in place, plus a 1-minute arrival ring driven by a shared 200 ms sine pulse.
- Capability probe endpoint (?probe=1 → {configured}) that hides credential-gated toggles and drops groups left empty.
- Sub-layer rows with a parent key: indented with an elbow stem, opacity-40 plus a tooltip while the parent is off, and excluded from the rail's active badge.
- Pins for reports that name a place carry a stack count for shared coordinates and a fresh flag (under 15 min) that drives a pulse-only layer filtered on fresh == true.
- Keep the display representation separate from the hit-test: satellites are drawn in a custom WebGL layer with a GPU pick pass, while the hidden circle layers stay defined for code that references the source.
- Drop the background cable arcs by colour (#9BB5CC / #A0B8CD / #8EABC2) to get the clean submarinecablemap look: 127 of 717 cables kept, drawn #1976D2 with zoom-scaled opacity 0.3→0.7.
- Decimate dense point feeds per class before setData (commercial every 10th, private and jets every 2nd, military all) while panel counts report the full totals.

## Weaknesses to fix in GODSEYE

- There is no single wiring table. Layer keys, fetch branches, polls, sources, setVis ids and panel dataKeys live in page.tsx, OsirisMap.tsx and LayerPanel.tsx and have drifted apart. The replica should drive all of them from one typed registry.
- The flat dataRef bag with shallow spread merges lets untransformed responses (/api/flights, /api/fires, /api/satellites) overwrite each other's total, source and timestamp. The replica should namespace every feed (data[feedKey] = {items, meta}).
- The 'Maritime Lines' (sdk_sea) count reads sdk_entities (sampled flights, ships, quakes, gdelt, news) while the layer draws submarine cables. The count and the drawing never match.
- The sdk-air and sdk-intel layer families are always empty, because no AIR or INTEL link features are generated. sdk_air and sdk_naval default true with no toggle, so sdk_entities is built whenever sdk_sea is off. The 'sdk-entities' source is always empty and unused.
- The Maritime Lines layer depends on the hidden key cables, which has no UI. A ?layers= URL that omits 'cables' would stop cables from loading on toggle; this is masked only because the first commit uses the defaults.
- Balloons and radiation are fully wired on the client (fetch, 5-minute poll, layers, click popups) but /api/balloons and /api/radiation do not exist, so they 404 forever. They also have no panel row.
- war_alerts and the 'war-alerts-targets' / 'war-alerts-lines' sources are dead.
- conflict_zones is visible unless it is exactly false, with no toggle, and the URL cannot set it, so conflict icons can never be hidden. They sit under day-night-fill, and /api/conflicts is fetched once per map mount (re-fetched on theme switch) with no refresh.
- internet_outages gates the malware mesh but is not a real key. The panel's 'Internet Outages' is cf_outages, which does not show the mesh.
- Weather is a core feed and layerFetchedRef.add('weather') at mount makes the toggle's fetch branch dead code. This is fine behaviour but confusing wiring.
- fires, satellites, live_news, infrastructure, gdelt, gdelt_events, cloudflare radar, cameras and cables are fetched once and never refreshed. Satellite positions go stale; the code relies on satellites_at for orbit requests.
- The satellite pick's CLICKABLE_LAYERS uses nonexistent flight layer ids, so aircraft clicks can be stolen by a satellite behind them. Dead listeners are also bound to 'scm-dots', 'sdk-sea-glow' and 'sdk-sea-atmo'.
- ActiveEntityCount sums every root array, so the 'live entities' HUD number double-counts (sdk_entities, alert_pins, cables).
- The sdk_entities effect writes to dataRef without bumping dataVersion, so its count lags a render.
- cyber-labels text is #333333 on a #000 halo, which is nearly invisible on a dark map.
- The cable dataset is fetched with ?v=Date.now(), which defeats all caching of a 665 KB static file, and the -filtered.json copy is an identical duplicate.
- Flight route data is shown only as popup text. No planned-route polyline is drawn on the map; only the watched-airport dots exist. The requested airport-to-airport flight-path feature needs its own source and layers (for example a great-circle LineString source, a casing and dash layer, and endpoint markers).

## Gaps (not verified)

- Did not check how maplibre-gl 6.7.0 treats map.on('click' or 'mouseenter', '<nonexistent layer>'): silently, with a warning, or with an error.
- Did not read the full paint expressions for gdelt-events-dots (the quad colour match), malware-dots radius by url_count, network-mesh paint, the alert-pin label text expression, or alertColor/cameraColor, beyond their names.
- Did not trace LiveAlerts' logic for computing pinnedAlertIds (onPinnedChange), or IntelFeed/MarketsPanel reads of the dataRef keys.
- Did not inspect the upstream sources inside /api/gdelt (a comment mentions GDACS report links), /api/maritime (AIS), /api/weather (NOAA/NWS, GDACS, NASA EONET per the comment) or /api/news; only their response keys were verified.
- Did not open src/lib/sdk/LatticeAdapter.ts or PolybolosClient.ts (their EventSource usage) or the engine/ directory. They may hold intended AIR/INTEL mesh data that is not wired into the map.
- The CctvPreviews and LiveNewsPreviews overlay internals (tile sizing, viewport limits) were not read.
