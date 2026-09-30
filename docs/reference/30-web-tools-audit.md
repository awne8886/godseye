# Audit of OSIRIS tools: Directions, Search, World Remote, Space, Markets, Alerts, Draw, ArcGIS
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
**Question answered:** What exactly do the under-specified OSIRIS tools do? ROUTE/Directions: which routing engine (the OSRM public demo, Valhalla or GraphHopper) and what is its usage policy? SEARCH: which geocoder? REMOTE/'World Remote': which Web Bluetooth devices and what data? SPACE: the ISS stream plus what else? MARKETS: which defence equities and commodities, from which source? ALERTS: which sources? DRAW/Save Area: what GeoJSON export schema? ARCGIS: which search endpoint?

## Summary

I resolved all 9 under-specified OSIRIS tools by reading the MIT source at the current HEAD commit d972d9af5c6f45aebf6d60b8a60f229a8abbe2f1. Files came from raw.githubusercontent.com, and the file list came from the jsDelivr flat listing, because the GitHub API and HTML pages return 403 from this sandbox. I checked the production bundle and live endpoints too: chunk 1136nyajv2-oe.js contains api/directions, api/geosearch, api/flight-route, api/aircraft, api/arcgis, navigator.bluetooth/requestDevice, MARAUDER and osiris-aoi-. The live /api/directions response carries provider "valhalla". Findings per tool:
- **ROUTE/Directions:** a server-side proxy. It tries the FOSSGIS Valhalla demo (valhalla1.openstreetmap.de) first, retries once, then falls back to the OSRM demo (router.project-osrm.org) for driving only. It does not use GraphHopper. Features: auto/bicycle/pedestrian modes, via stops, avoid tolls/highways/ferries, up to 2 alternate routes, and an elevation profile from Valhalla /height for walking and cycling. Live navigation has GPS watchPosition, a 45 m off-route threshold, 30 m arrival, voice announcements at 1000/400/150/30 m, and a screen WakeLock.
- **SEARCH:** /api/geosearch. Photon (photon.komoot.io) leads; Nominatim is asked only when Photon returns fewer than 3 hits. All Nominatim traffic goes through one server-side module: one request every 2 s, a 30-day cache saved to disk, refusal beyond a queue of 40. That module was added after Nominatim's sysadmin warned about more than 10 req/s (referenced as osiris issue #16). Coordinates are parsed locally. /api/geo/reverse labels the map location, rounded to a 0.1° grid.
- **REMOTE ('World Remote'):** the 'MARAUDER V8' browser BLE recon panel. It calls navigator.bluetooth.requestDevice({acceptAllDevices:true, optionalServices:[~50 standard GATT services]}), connects, and reads every readable characteristic ('auto-vacuum'). It classifies devices (phones, watches, headphones, speakers, HID, TVs, trackers, locks, lights and so on) by Appearance, services, manufacturer or name, and tags each capture with browser GPS. Captures persist in IndexedDB 'marauder_v8', export to JSON or CSV, and can be plotted on the map. It also has a GATT tree with write and notify. It additionally harvests local IPs via WebRTC and probes 15 localhost ports by fetch timing.
- **SPACE:** 'LIVE FROM SPACE' is only 3 YouTube-nocookie ISS embeds plus a static 'ALT ~408 KM · ORBIT ~93 MIN' label. There is no live ISS position in the panel. The rest of the space data lives elsewhere: satellites from CelesTrak GP/supplemental and SatNOGS TLEs, per-satellite orbit tracks from /api/satellites/orbit, and NOAA SWPC Kp, alerts and flares shown in the Markets panel.
- **MARKETS:** 28 instruments from Yahoo Finance's unofficial v8 chart endpoint in 6 tabs. Defence tab: RTX, LMT, NOC, GD, BA, LHX, PLTR. Energy: WTI, Brent, natural gas. Commodities: gold, silver, copper, wheat, corn. Also indices, crypto and FX. Plus chokepoint supply-chain alerts, a Kp space-weather block, a Gemini AI overview, and candle charts via lightweight-charts from /api/markets/history.
- **ALERTS:** 9 Telegram channels scraped from t.me/s/, 9 RSS wires, USGS quakes, and official warnings from NWS api.weather.gov, GDACS RSS and NASA EONET. Sources are grouped into political blocs, and ~23 YouTube 24/7 news channels are built in.
- **DRAW:** polygon, rectangle, circle and line. Shapes persist to localStorage 'osiris.aoi.shapes.v1'. A sweep finds what is inside a shape across 11 layers. Exports are an all-shapes FeatureCollection, per-AOI contents as GeoJSON or CSV, and copy-GeoJSON. Areas can be armed as tripwires that report arrivals and departures.
- **ARCGIS:** searches the ArcGIS Online catalogue at www.arcgis.com/sharing/rest/search (type 'Feature Service', filter access:public, num 20, optional map bbox). Import runs the chosen service's /{layer}/query with f=geojson, capped at 2000 features, through an SSRF guard.

**Naming collision:** OSIRIS already has an undocumented /api/flight-route (callsign → origin/destination via adsbdb, hexdb and airplanes.live, returning a 72-segment great-circle arc) and /api/aircraft (actual flown track from adsb.lol traces). There is no airport-code-to-airport-code planner, and the ROUTE button is road-only. So the requested flight-path tool needs its own entry point. OSIRIS's fallback airport lookup calls api.adsbdb.com/v0/airport/{code}, which I verified now returns 'unknown endpoint'. Only its ~350 hard-coded airports actually resolve.

## Findings

### 0. ROUTE/Directions — engine (verified)

/api/directions?from=lat,lng&to=lat,lng&mode=auto|bicycle|pedestrian&via=lat,lng|lat,lng&avoid=tolls,highways,ferries. The primary engine is Valhalla at https://valhalla1.openstreetmap.de/route?json={locations,costing,costing_options (use_tolls/use_highways/use_ferry = 0),alternates:2,directions_options:{units:'kilometers'}}. The polyline has precision 6. If Valhalla fails it waits 400 ms and retries once. The fallback, used only when mode=auto, is the OSRM demo at https://router.project-osrm.org/route/v1/driving/{lng,lat;...}?steps=true&overview=full&geometries=geojson. OSIRIS builds the instruction text itself because OSRM ships none. GraphHopper is not used. Response shape: {provider:'valhalla'|'osrm', mode, distance (m), duration (s), geometry: LineString, steps[{instruction,distance,duration,location,type}], hasHighway/hasToll/hasFerry, elevation[{distance,height}], ascent, descent, routes[] (best first)}. Elevation comes from valhalla1.openstreetmap.de/height, sampled at up to 120 points, and only for walking and cycling. Cache: s-maxage=300. A live probe on 2026-09-30 returned provider:'valhalla'.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/d972d9af5c6f45aebf6d60b8a60f229a8abbe2f1/src/app/api/directions/route.ts

### 1. ROUTE — client UX and live navigation (verified)

DirectionsBar ('Turn-by-turn routing over /api/directions (Valhalla + OSRM)'): From/To autocomplete from /api/geosearch; add or remove via stops; reverse the route; travel-mode switch; avoid toggles; 'my location' via /api/geo (IP) and navigator.geolocation.watchPosition. The live navigation engine in lib/navigation.ts snaps the GPS fix to the route with OFF_ROUTE_M = 45 and ARRIVAL_M = 30, and announces at bands of 1000, 400, 150 and 30 m. NavigationView speaks with the speechSynthesis API (mutable) and holds a screen WakeLock.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/d972d9af5c6f45aebf6d60b8a60f229a8abbe2f1/src/lib/navigation.ts

### 2. OSRM demo server usage policy (verified)

Verbatim from the wiki: 'the demo server usage is restricted to reasonable, non-commercial use-cases. Do not exceed 1 request per second. We provide no guarantees wrt. uptime, latency, or data updates.' The server is sponsored by FOSSGIS and serves 'worldwide car, foot and bike profiles' at router.project-osrm.org and routing.openstreetmap.de. The routing.openstreetmap.de/about excerpt of the German FOSSGIS policy: 'Display the required attribution and display a link to "fix the map". Use a valid user agent and, if applicable, a correct referrer. One request per second max. No scraping, no heavy usage.' The OSIRIS code comment 'The public OSRM demo only carries the driving profile' is inaccurate. I verified that https://routing.openstreetmap.de/routed-foot/route/v1/driving/... returns code 'Ok'; routed-car and routed-bike are the sibling paths.

Source: https://raw.githubusercontent.com/wiki/Project-OSRM/osrm-backend/Demo-server.md

### 3. Valhalla FOSSGIS demo server usage policy (verified)

Valhalla docs: 'Usage of the demo server follows the usual fair-usage policy as OSRM & Nominatim demo servers (somewhat enforced by rate limits)'. Apps published to end users should announce themselves in GitHub Discussions and send an identifying 'X-Client-Id' header, e.g. 'X-Client-Id: newroutingapp.io'. Maintainer nilsnolde in discussion #3373: 'we rate limit to 1 call/user/sec and 100 calls/sec total'. OSIRIS's httpJson sends User-Agent 'OSIRIS-OSINT/1.0 (+https://github.com/simplifaisoul/osiris)' but no X-Client-Id. /status on 2026-09-30 reported version 3.9.0 with actions route, isochrone, height, trace_route, optimized_route, sources_to_targets and others.

Source: https://valhalla.github.io/valhalla/

### 4. SEARCH — geocoder (verified)

The SearchBar placeholder reads 'SEARCH ADDRESS, CITY, OR COORDINATES...'. Coordinates are parsed client-side; everything else goes to /api/geosearch?q=&lat=&lng= (the lat/lng is a map-centre bias, rounded to 0.1° for cache keys). Photon leads: https://photon.komoot.io/api/?q=&limit=8&lang=en[&lat&lon]. Nominatim search (limit 6) runs only if Photon returns fewer than 3 hits, and hits with importance >= 0.5 are promoted. Results are de-duplicated within ~100 m and return {name, context, lat, lng, kind: country|region|city|street|address|poi|place, source}. Zoom by kind: address 18, street 16, poi 16, city 12, region 8, country 5, place 13. Cache: 10 min server-side, s-maxage 600. A live test of q=heathrow returned Heathrow, Florida first and Heathrow Airport third. Because Photon returned 3 or more hits, Nominatim's prominence boost never ran, so airport lookups need a dedicated airport index.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/d972d9af5c6f45aebf6d60b8a60f229a8abbe2f1/src/app/api/geosearch/route.ts

### 5. Nominatim gateway and policy (verified)

lib/nominatim.ts is 'the one door to nominatim.openstreetmap.org'. The browser never calls Nominatim. The server sends at most one request every 2 s (a 1 s floor outside tests), caches answers for 30 days (failures for 10 min), writes the cache to disk at .cache/nominatim.json, refuses requests beyond a queue of 40, and has an ATTRIBUTION constant of '© OpenStreetMap contributors'. The file header says the module exists because on 2026-09-20 Nominatim's sysadmin reported more than 10 req/s and a likely ban (osiris issue #16). /api/geo/reverse rounds lat/lng to 0.1°, uses zoom 10, and returns a 'city, state, country' label. OSMF Nominatim policy: 'an absolute maximum of 1 request per second'; a valid identifying User-Agent or Referer; visible attribution; results must be cached; and for auto-complete, 'you must not implement such a service on the client side using the API'. Photon's page: 'please be fair - extensive usage will be throttled. We do not guarantee for the availability'.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/d972d9af5c6f45aebf6d60b8a60f229a8abbe2f1/src/lib/nominatim.ts

### 6. REMOTE / 'World Remote' — Web Bluetooth (verified)

WorldRemote.tsx is the 'MARAUDER V8 — Browser-based BLE Recon Engine'. Scanning calls navigator.bluetooth.requestDevice({acceptAllDevices:true, optionalServices:ALL_OPT}), where ALL_OPT is about 50 16-bit GATT services: Generic Access, Device Info 0x180A, Battery 0x180F, Heart Rate 0x180D, HID 0x1812, Environmental Sensing 0x181A, audio 0x1843–0x184E, plus Xiaomi, Tile, Google, Eddystone and others. The browser's chooser picks one device per scan; there is no passive scanning. A 'Deep probe + auto-vacuum' connects over GATT, enumerates every service and characteristic, and reads every readable value: manufacturer, model, serial, firmware/hardware/software revision, battery, Appearance and TX power. Devices are classified by Appearance, then service, then manufacturer, then name regex into Phone, Computer, Watch, Headphones, Speaker, TV, Keyboard, Mouse, Gamepad, Light, Printer, Tracker (Tile/AirTag), Smart Lock, Scale or Env Sensor. Every capture is tagged with a browser GPS fix. Other features: a GATT tree with hex write (with or without response) and startNotifications, an RSSI history, a packet log (SCAN, PROBE, READ, WRITE, NOTIFY and more), an IndexedDB vault 'marauder_v8', exports to marauder_<ts>.json/.csv, and 'VIEW ON MAP' via the onPlaceOnMap callback. There is also a 'NETWORK RECON' section: WebRTC local-IP harvest, the navigator.connection type/downlink/RTT, and a timing probe of 15 localhost ports (80, 443, 8080, 3000, 5000, 8443, 8888, 9090, 3001, 4200, 5173, 1883, 8883, 5353, 631).

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/d972d9af5c6f45aebf6d60b8a60f229a8abbe2f1/src/components/WorldRemote.tsx

### 7. SPACE — Live from Space (verified)

SpaceCam.tsx ('LIVE FROM SPACE', a 24/7 badge) embeds three YouTube feeds via youtube-nocookie.com/embed/{id}?autoplay=1&mute=1&playsinline=1&modestbranding=1&rel=0: '4K EARTH' (Sen's 4K cameras on the ISS) fO9e9jnhYK8, 'EARTH VIEW' (ISS external nadir camera) tj4knR4r1UU, and 'OVERVIEW CAM' OKQEMp2555A. The code comment says 11 candidate streams were tested and 'the official NASA ISS video ids are all UNPLAYABLE now'. There is an expanded full-screen player (a bigger player makes YouTube serve HD; ESC closes it) and a static text 'ALT ~408 KM · ORBIT ~93 MIN'. The panel fetches no live ISS position. Other space data elsewhere in OSIRIS: /api/satellites (CelesTrak gp.php?GROUP=..., supplemental Starlink TLEs, and db.satnogs.org/api/tle as backup), /api/satellites/orbit (one full orbit from the cached TLE, split at the antimeridian, using satellite.js), and /api/space-weather (NOAA SWPC planetary_k_index_1m, alerts.json, and GOES xray-flares-latest).

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/d972d9af5c6f45aebf6d60b8a60f229a8abbe2f1/src/components/SpaceCam.tsx

### 8. MARKETS — instruments and source (verified)

The source is Yahoo Finance's unofficial https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1mo, called with a spoofed Chrome UA, 5 concurrent workers, one retry pass, a per-symbol last-good cache, and a 60 s TTL. Tabs and symbols:
- INDICES: ES=F, NQ=F, ^VIX, DX-Y.NYB, ^TNX
- DEFENSE: RTX, LMT, NOC, GD, BA, LHX, PLTR
- ENERGY: CL=F (WTI), BZ=F (Brent), NG=F
- COMMODITIES: GC=F, SI=F, HG=F, ZW=F, ZC=F
- CRYPTO: BTC-USD, ETH-USD, SOL-USD, XRP-USD
- FX: EURUSD=X, USDJPY=X, GBPUSD=X, USDCNY=X

That is 28 in total; the live count was 28. Each quote carries price, change_percent (versus the previous session close), a 1-month sparkline, currency and market_open. scm_alerts come from /api/maritime chokepoints: a HIGH or CRITICAL risk at Hormuz, Suez or Panama produces a text alert. The panel also shows a space-weather block (Kp index, storm level, latest flare) and a Gemini AiOverview. Clicking a ticker opens candles from /api/markets/history, with ranges 1m, 15m, 24H, 1W, 1M, 6M and 1Y, drawn with lightweight-charts ^5.2.0.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/d972d9af5c6f45aebf6d60b8a60f229a8abbe2f1/src/app/api/markets/route.ts

### 9. ALERTS — sources (verified)

LiveAlerts reads data.news, data.earthquakes and data.weather_events.
- **/api/news, Telegram** (scraped from https://t.me/s/{handle}; overridable with OSIRIS_TELEGRAM_CHANNELS): Osintdefender, WarMonitors, rybar_in_english, DDGeopolitics, KyivIndependent_official, QudsNen, AlMayadeenEnglish, intelslava, PressTV.
- **/api/news, RSS wires:** BBC World, The Guardian, Al Jazeera, Times of Israel, TASS, Anadolu, SCMP, CNA, Africanews.
- **Blocs:** each source is tagged western, russian, regional or independent.
- **Kinds:** ROCKET, EVENT or NEWS, with theatre threading and cross-post 'also reported by'.
- **Earthquakes:** USGS, top 15.
- **Weather warnings:** api.weather.gov/alerts/active (status=actual, message_type=alert), GDACS https://www.gdacs.org/xml/rss.xml, and NASA EONET v3 events?status=open&limit=100. Severity is high/medium/low, labelled SEVERE, MODERATE or ADVISORY.
- **Live video:** about 23 built-in 24/7 YouTube live_stream channel embeds (NBC, CBS, ABC, Bloomberg, C-SPAN, CBC, Sky, France 24, DW, Euronews, TRT, Ukrinform, Al Jazeera, Al Mayadeen, LBCI, NHK, CNA, WION, Arirang, ABC AU, Africanews, SABC, teleSUR).
- **Other:** per-source health, pins on the map, and a Gemini AI overview.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/d972d9af5c6f45aebf6d60b8a60f229a8abbe2f1/src/components/LiveAlerts.tsx

### 10. DRAW / Save an Area — GeoJSON export schema (verified)

DrawMode is 'polygon' | 'rectangle' | 'circle' | 'line'. Minimum points: polygon 3, line 2, rectangle 2 corners, circle centre plus rim. Shapes persist to localStorage key 'osiris.aoi.shapes.v1' as a StoredShape array {id, name, kind, geojson, areaKm2, perimeterKm, color, createdAt, meta}. There are three exports:
- **All shapes:** file osiris-aoi-YYYY-MM-DD.geojson, MIME application/geo+json. A FeatureCollection whose features carry properties {name, kind, area_km2 (4 dp), perimeter_km (4 dp), color, created (ISO), radius_km (circles only)}.
- **Per-AOI contents as GeoJSON:** file <name>-contents-<stamp>.geojson. Point features with properties {aoi, layer, layer_label, label, detail}.
- **Per-AOI contents as CSV:** file <name>-contents-<stamp>.csv, RFC 4180, columns aoi, layer, label, detail, lat, lng (6 dp).

'Copy GeoJSON' copies a single shape's Feature to the clipboard. The contents sweep (lib/aoi.ts) checks a bbox first, then point-in-polygon, across 11 layers: commercial_flights, private_flights, private_jets, military_flights, maritime_ships, satellites, cameras, earthquakes, infrastructure, gdelt and weather_events. It shows at most 50 items per group, but counts and memberIds are exact. A polygon can be armed as a 'tripwire': it is re-swept on each data refresh and arrival/departure events are logged.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/d972d9af5c6f45aebf6d60b8a60f229a8abbe2f1/src/lib/aoi-export.ts

### 11. ARCGIS — search and import endpoints (verified)

/api/arcgis has two modes.
- **Search:** ?q=&bbox=west,south,east,north calls https://www.arcgis.com/sharing/rest/search?q=&type=Feature Service&filter=access:public&num=20&f=json[&bbox]. It maps results to {id, title, url, snippet, owner, numViews, extent, tags}, retries twice with a 20 s timeout, and caches for s-maxage 120.
- **Import:** ?service=<https .../rest/services/.../(Feature|Map)Server[/N]>&bbox=. It rejects IP-literal hosts and rebuilds the URL with the URL object, never string concatenation. If no layer is named, it reads ?f=json to pick the first non-group layer and refuses tile-only services. It then queries /{layer}/query with where=1=1, esriGeometryEnvelope, esriSpatialRelIntersects, inSR/outSR 4326, outFields=*, resultRecordCount=2000, f=geojson. All fetches go through safeFetch, the SSRF guard. There is a rate limit of 30 per IP.

The panel offers presets (Pipelines, Power Grid, Critical Infrastructure, Military base installation, Emergency shelter evacuation), 10 layer colours, and per-layer visibility and opacity. A live keyless search on 2026-09-30 returned total 10000. The /docs page's one-line description ('Queries a configured ArcGIS feature service') is out of date.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/d972d9af5c6f45aebf6d60b8a60f229a8abbe2f1/src/app/api/arcgis/route.ts

### 12. Existing flight-path code (collision / reuse) (verified)

/api/flight-route?callsign=&icao24=&lat=&lng=&speed= races ADSBDB (api.adsbdb.com/v0/callsign/{cs}), HexDB (hexdb.io/api/v1/route/callsign/{cs}) and airplanes.live (api.airplanes.live/v2/hex/{icao24} or /callsign/) with Promise.any and a 4 s timeout each. Found routes are cached 30 min, misses 2 min, with a 3 min cooldown after a 429. It rejects routes shorter than 30 km or where the aircraft is more than 1.5× the route length from both ends. It returns {found, source, origin, destination, arc (72-segment slerp great circle), totalDistanceKm, departureTime, arrivalTime, progress}, with ETA assuming 800 km/h when speed is unknown. A live test with BAW117 returned EGLL→KJFK from adsbdb. /api/aircraft?icao24= returns the actual flown track and altitudes from https://adsb.lol/data/traces plus the operator from api.adsbdb.com/v0/aircraft. FlightWatchPanel pins several aircraft and calls both endpoints. None of this is airport-code-to-airport-code: there is no endpoint that takes two IATA/ICAO codes.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/d972d9af5c6f45aebf6d60b8a60f229a8abbe2f1/src/app/api/flight-route/route.ts

### 13. OSIRIS airport DB and a broken fallback (verified)

lib/airports.ts holds about 350 hard-coded airports as [IATA, ICAO, name, city, country, lat, lng], plus lookupAirportAsync(), which falls back to https://api.adsbdb.com/v0/airport/{code}. On 2026-09-30 that URL returned {"response":"unknown endpoint: /v0/airport/LHR"}, so the fallback is dead. The adsbdb callsign endpoint still works and embeds origin and destination coordinates. For a complete airport index, OurAirports publishes airports.csv (12.7 MB; mirror at https://davidmegginson.github.io/ourairports-data/airports.csv) and states 'All data is released to the Public Domain'.

Source: https://ourairports.com/data/

### 14. Production bundle confirmation and undocumented endpoints (verified)

The osirisai.live homepage chunk /_next/static/chunks/1136nyajv2-oe.js contains api/directions, api/geosearch, api/flight-route, api/aircraft, api/arcgis, navigator.bluetooth (3 occurrences), requestDevice, MARAUDER and osiris-aoi-. No client chunk contains router.project-osrm, valhalla, photon or nominatim URLs, which confirms those calls are proxied server-side. The repo has routes the /docs 57-endpoint list does not mention: directions, geosearch, geo/reverse, flight-route, aircraft, satellites/orbit, markets/history, cloudflare-radar, gdelt-events, chain/daily, osint/crypto, osint/fingerprint, osint/username, cctv/resolve and cctv/texas/snapshot. Stack from package.json: next 16.3.4, react 19.2.4, maplibre-gl 6.7.0, react-map-gl ^8.1.1, framer-motion, lucide-react, lightweight-charts, satellite.js ^7, hls.js, react-force-graph-2d, rss-parser, @google/generative-ai and sharp.

Source: https://osirisai.live/_next/static/chunks/1136nyajv2-oe.js

## Recommendations

- Name the new tool 'FLIGHT PATH' (or 'FLIGHTS') with its own toolbar button, keyboard shortcut and panel. Keep 'ROUTE' strictly for road turn-by-turn.
- Give the flight-path tool 2 modes. 'Generic' mode: two airport inputs (IATA, ICAO, city or airport name) autocompleted from a bundled OurAirports airports.csv index (public domain, filtered to large/medium airports plus anything with an IATA code), drawn as a great circle with ≥128 segments, split at the antimeridian, with distance in km/nm and an estimated block time. 'Specific' mode: callsign/flight number/ICAO24 → planned origin and destination via adsbdb /v0/callsign (with hexdb and airplanes.live as fallbacks, raced as OSIRIS does), then overlay the actual flown track from adsb.lol traces. Also plot the aircraft's current ADS-B position on the planned arc.
- Do not copy OSIRIS's adsbdb /v0/airport/{code} fallback. It returns 'unknown endpoint'. Resolve codes from a local airport index instead.
- Label the result as 'planned great-circle, not the filed ATC route'. Real filed routes (airways/waypoints) need paid or authenticated data such as FlightAware AeroAPI or FAA SWIM (UNVERIFIED, not researched here), so leave a provider interface for them.
- ROUTE/Directions: copy the OSIRIS pattern. Put a server-side proxy at /api/directions with Valhalla first (auto/bicycle/pedestrian, alternates, avoid options, /height elevation for walking and cycling) and OSRM as fallback. The builder prompt must also require:
- a per-user limit of ≤1 request/second and debounced requests;
- an identifying User-Agent and an 'X-Client-Id' header on Valhalla calls;
- OSM attribution plus a 'fix the map' link;
- response caching;
- an env-configurable engine base URL (VALHALLA_URL, OSRM_URL) so production can self-host.

State plainly that router.project-osrm.org and valhalla1.openstreetmap.de are demo servers for reasonable, non-commercial use only, with no uptime guarantee. For the OSRM foot and bike fallback, use routing.openstreetmap.de/routed-foot and /routed-bike rather than skipping it.
- SEARCH: use Photon as the primary type-ahead, server-side with a 10-minute cache. Call Nominatim only server-side, through one rate-limited queue (≥1 s between requests, 30-day cache, refuse on overflow) with an identifying UA and the '© OpenStreetMap contributors' attribution. Never call Nominatim from the browser: OSMF policy forbids client-side autocomplete. Add local airport, entity (callsign/NORAD/MMSI) and coordinate matching ahead of the geocoders, because Photon ranks Heathrow, FL above LHR.
- WORLD REMOTE: copy the Web Bluetooth GATT inspector: requestDevice with acceptAllDevices and the optionalServices list, GATT read/notify/write, Appearance-based classification, battery and device info, an IndexedDB vault, JSON/CSV export, and 'view on map' via user-consented geolocation. Document the limits: Chromium-only, HTTPS, a user gesture, one device per chooser, no passive scan. Tell the builder not to copy OSIRIS's WebRTC local-IP harvest and localhost port-timing probe, or at minimum put them behind an explicit opt-in with a warning. They are covert network fingerprinting of the visitor.
- SPACE: copy the 3-feed ISS YouTube-nocookie panel, but have the builder check each video ID is live and embeddable at build time and hide dead ones. Improve on OSIRIS by showing the ISS's live position and ground track, computed from the CelesTrak TLE for NORAD 25544 with satellite.js, next to the video. Keep the SWPC Kp/flare block.
- MARKETS: keep the same 28 symbols and 6 tabs (INDICES, DEFENSE, ENERGY, COMMODITIES, CRYPTO, FX), sparkline plus market_open flag, lightweight-charts candles with ranges 1m, 15m, 24H, 1W, 1M, 6M and 1Y, and chokepoint-driven supply-chain alerts. Put Yahoo v8 behind a provider interface with a 60 s cache, ≤5 concurrent requests and a per-symbol last-good fallback, because the endpoint is unofficial and undocumented.
- ALERTS: copy the 3 streams (Telegram/RSS news with bloc/lean tags and cross-post threading; USGS quakes; NWS, GDACS and EONET official warnings with severity) plus the 24/7 live TV grid. Make the channel and wire lists config-driven.
- DRAW: copy the exact GeoJSON schema and localStorage key. Add KML or shapefile export and in-app import of GeoJSON files as improvements. Keep the tripwire/watch feature.
- ARCGIS: copy both modes (catalog search at www.arcgis.com/sharing/rest/search restricted to public Feature Services with the viewport bbox; import via layer /query?f=geojson capped at 2000 features, with layer discovery and an SSRF guard).
- Tell the builder that the OSIRIS /docs page understates the API: about 72 non-CCTV routes exist versus 57 documented. It should read the repo at a pinned commit (raw.githubusercontent.com/simplifaisoul/osiris/<sha>/...) rather than rely on the docs.

## Gaps (not verified)

- I could not read the full FOSSGIS usage policy (German) at fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/: an Anubis bot wall blocked it. Only the English excerpt on routing.openstreetmap.de/about.html is verified.
- I could not open GitHub issue simplifaisoul/osiris#16 (the Nominatim ban warning): github.com HTML and the API return 403 from this sandbox. It is cited only through the source-code comment in lib/nominatim.ts.
- Yahoo Finance terms of use for the unofficial v8 chart endpoint: UNVERIFIED. I found no official public API documentation.
- Whether the 3 ISS YouTube IDs (fO9e9jnhYK8, tj4knR4r1UU, OKQEMp2555A) are live right now: UNVERIFIED. I did not probe YouTube.
- Usage terms and rate limits for adsbdb, hexdb.io, airplanes.live and adsb.lol traces: not researched.
- Sources for filed ATC flight plans or airway routes (e.g. FlightAware AeroAPI, FAA SWIM, Eurocontrol B2B): not researched. They are named in the recommendations but UNVERIFIED.
- I did not read DrawHud.tsx's measurement readout in detail. It is 134 lines of live area and distance HUD while drawing.
- Keyboard shortcuts in the README (F flights, E earthquakes, S satellites, D day/night) conflict with /docs (F fullscreen, S share, L layers...). I did not check KeyboardShortcuts.tsx to settle which is current.
