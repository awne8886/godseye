# OSIRIS API routes: aviation, space, earth
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.

## Summary

Upstream sources and behaviour of the aviation, space and earth API routes in the osiris reference clone (Next.js 16.3.4 App Router, React 19, maplibre-gl 6.7.0, satellite.js ^7). All routes are GET handlers in src/app/api/<name>/route.ts.

How caching works:
- Every route caches in module-level memory; there is no Redis.
- A shared helper, cachedSource (src/lib/sourceCache.ts), adds a TTL, in-flight deduplication and stale-on-error. It treats an empty result as a failed refresh.
- Routes set CDN hints with `s-maxage` + `stale-while-revalidate` in Cache-Control.
- No /api route has rate limiting. The middleware excludes /api entirely.

/api/flights:
- Takes no parameters.
- Merges two feeds and dedupes by hex: the adsb.fi /mil feed (fetched every cycle) and an OpenSky /states/all?extended=1 snapshot (OAuth2 optional).
- A paced 30-region adsb.fi sweep is the last resort.
- Aircraft are sorted into commercial / private / jet / military buckets using type sets, OpenSky emitter categories, callsign regexes and a jet-cruise heuristic.
- It also derives a gps_jamming grid from nac_p <= 4.
- Response cache TTL is 90 s. It dedupes in-flight requests and falls back to stale data on error.

/api/flight-route:
- Takes `callsign` (required), plus optional `icao24`, `lat`, `lng` and `speed`.
- Races adsbdb, hexdb and airplanes.live with Promise.any. airplanes.live is documented elsewhere in the repo as 403/dead.
- Airport codes are resolved against a hard-coded table of 375 airports (src/lib/airports.ts), with an api.adsbdb.com/v0/airport fallback.
- Implausible routes are rejected.
- It returns origin and destination, a 73-point great-circle `arc` ([lng,lat]), totalDistanceKm, and ETA/progress assuming constant speed.
- Hits are cached for 30 min and misses for 2 min.

/api/aircraft:
- Takes a 6-hex `icao24`.
- Reads the readsb trace file from adsb.lol (/data/traces/{last2}/trace_full_{hex}.json) plus adsbdb aircraft data.
- Returns the airframe identity, the current flown leg as [lng,lat] (downsampled to 700 points), and departure/arrival airports observed from the track (nearestAirport within 25 km).
- Client use: the flight popup shows only the model text. FlightWatchPanel cross-checks airports observed on the track against the schedule lookup and pins only the confirmed airports on the map. Nobody draws the `track` or the `arc`, so today no route line or great-circle path is rendered.

/api/satellites:
- Fetches 43 CelesTrak TLE groups in parallel, dedupes by NORAD id, backfills from the previous cache, and falls back to SatNOGS and then a hard-coded ISS TLE.
- The catalogue is persisted to .next/cache/satellites-tle-cache.json (valid 4 h).
- Every TLE is propagated server-side with SGP4 (satellite.js) on each request.
- Satellites are classified by name keyword into mission + colour, then into 6 categories.

/api/satellites/orbit:
- Takes `id` (NORAD) and optional `t` (epoch ms).
- Reads the TLE from that disk cache and returns one revolution (180 steps) centred on `t`, split at the antimeridian, as [lng, lat, altKm].
- The client draws it at altitude in a custom WebGL layer.

/api/space-weather:
- Reads three NOAA SWPC JSON feeds and turns Kp into storm_level / storm_color.
- Returns null/'Unknown' when there is no reading, never 'Quiet'.
- Has no caching.

Earth routes:
- /api/earthquakes: USGS 2.5_day GeoJSON. The client bypasses this route and calls USGS directly.
- /api/fires: NASA FIRMS global 24h CSV (VIIRS, then MODIS), sampled to about 2,000 points, plus EONET volcanoes.
- /api/weather: EONET + NWS + GDACS RSS, cached 3 min.
- /api/air-quality: OpenAQ v2, likely dead. Not used by the client.
- /api/radar: actually IODA internet outages, not weather radar. Not used by the client.
- /api/sentinel: Element84 STAC Sentinel-1, then Sentinel-2, then Copernicus STAC. `radius` is in degrees. Not used by the client.

System routes:
- /api/stats: aggregates this app's own feeds into counts. 30 s snapshot, single-flight, stale-first. The client fetches it but never renders it.
- /api/health: a static liveness payload.

Tests (vitest) exist for aircraft, space-weather and stats, plus lib tests for orbit, geo and FlightWatchPanel. There are none for flights, flight-route, satellites, fires, weather, earthquakes, air-quality, radar, sentinel or health.

Docs drift (src/app/docs/apiCatalog.ts) — the docs claim three things the code does not do:
- flights "Keyless via adsb.lol"; the code actually uses adsb.fi + OpenSky.
- health `status: 'operational'`; the code returns 'serving'.
- sentinel radius in km; the code treats it as degrees.

## Findings

### 0. /api/flights — upstreams, env, timeouts, pacing

Takes no query params. `export const maxDuration = 60`.

How a request is served:
- Phase 1+2 run in parallel via Promise.allSettled:
  - (a) `stealthFetch('https://opendata.adsb.fi/api/v2/mil', {signal: AbortSignal.timeout(15000)})`.
  - (b) `stealthFetch('https://opensky-network.org/api/states/all?extended=1', {signal: AbortSignal.timeout(30000), headers: {Authorization: 'Bearer <token>'}})`, only when not skipped.
- OpenSky is skipped while `Date.now() < openSkyCooldownUntil` or `Date.now() - osSnapshotTime < openSkyInterval()`.
- openSkyInterval = 90000 ms with credentials, 900000 ms (15 min) anonymous.
- On HTTP 429 from OpenSky it sets a 15-min cooldown (OPENSKY_COOLDOWN = 15*60*1000).

OpenSky auth:
- OAuth2 client_credentials POST to `https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token` (10 s timeout).
- Env: OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET.
- Token is cached until `expires_in` (default 1800) minus 60 s.
- Budget comments in the code: 4000 credits/day authenticated, 400 anonymous, 4 credits per call.

OpenSky parsing:
- The snapshot is replaced only if `states.length > 100`.
- State-vector mapping: s[0] hex, s[1] callsign (trimmed), s[5] lon, s[6] lat, s[7] baro alt (m → ft ×3.28084), s[9] velocity (m/s → kt ×1.94384), s[10] track, s[14] squawk, s[17] category_os (needs extended=1).
- The last good snapshot is reused between polls, so the anonymous map does not flicker.

Phase 3 fallback (only when there is no OpenSky snapshot):
- Sequential sweep of 30 hard-coded REGIONS: `https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/250`, 12 s timeout each, 1100 ms gap between requests (ADSBFI_GAP_MS).
- Reason: adsb.fi soft-throttles with 200 + empty `ac[]` instead of 429.
- REGIONS are (lat,lon): 39.8,-98.5 | 41,-74 | 33,-84 | 42,-88 | 30,-97 | 47,-122 | 34,-118 | 45,-73 | 49,-97 | 50,15 | 51.5,-1 | 47,2 | 40,-4 | 42,13 | 60,15 | 52,22 | 39,35 | 25,45 | 22,78 | 35,105 | 35,136 | 37,127 | 13,100 | 1,104 | -25,133 | -33,151 | 0,20 | -26,28 | -15,-60 | -23,-46.

Dead providers named in comments:
- api.airplanes.live → 403 (key-gated)
- api.adsb.lol/v2 → 200 but always `{"ac":[],"total":0}`
- api.adsb.one/v2 → 403

Other behaviour:
- Dedupes by lowercase hex (ingestAc).
- Logs `[OSIRIS] ...` warnings.
- When zero aircraft are returned it logs a hint to set the OpenSky credentials.

Files: `src/app/api/flights/route.ts:5-48`, `src/app/api/flights/route.ts:112-144`, `src/app/api/flights/route.ts:220-288`, `src/app/api/flights/route.ts:319-427`

### 1. /api/flights — classification rules (exact)

classifyFlight(f):
- Returns null if `t === 'TWR'` or lat/lon is null.
- callsign = trimmed upper `f.flight` || hex || 'UNKNOWN'.
- altMeters = alt_baro(ft) × 0.3048 when numeric, else 0.
- speed_knots = gs rounded to 1 decimal (else null).
- heading = track || 0.
- isHeli = HELI_TYPES.has(t) || category_os === 8.
- grounded = numeric alt_baro < 100.
- AIRLINE_CODE_RE = /^([A-Z]{3})\d/ gives airline_code.
- CALLSIGN_RE = /^[A-Z0-9]{3,8}$/. isGaCallsign = no airline code && CALLSIGN_RE matches (registration-style callsign).
- cruisesLikeAJet = altMeters > 8500 && speed > 300 kt.

Order of rules:
1. MILITARY if category_os === 14 || (dbFlags & 1) || MILITARY_INDICATORS.has(t) || flight matches /^(RCH|KING|DUKE|EVAC|JAKE|REACH|CONVOY)\d/i.
2. Else COMMERCIAL if AIRLINER_TYPES.has(t) || category_os ∈ {4,5,6}.
3. Else JET if BIZJET_OPERATORS.has(airlineCode) || PRIVATE_JET_TYPES.has(t) || category_os === 7 || (isGaCallsign && cruisesLikeAJet).
4. Else PRIVATE if isGaCallsign || category_os === 2.
5. Else COMMERCIAL (the default).

The type sets:
- MILITARY_INDICATORS = C17 C5M C130 C30J KC10 KC46 KC35 E3CF E3TF E8A B1B B2 B52 F16 F15 F18 F22 F35 A10 F117 RC135 E6B P8A P3 MQ9 RQ4 U2 EP3 RC12 V22 CH47 UH60 AH64 AH1Z MV22 EUFI RFAL TORD TYP GR4.
- AIRLINER_TYPES = A319 A320 A321 A332 A333 A339 A343 A359 A388 B737 B738 B739 B38M B39M B752 B753 B763 B764 B772 B77L B77W B788 B789 B78X E170 E175 E190 E195 CRJ7 CRJ9 AT43 AT72 DH8D.
- BIZJET_OPERATORS = EJA EJM NJE LXJ FJO VJT XOJ JTL WUP GAJ DPJ CLY TWY.
- PRIVATE_JET_TYPES = G150 G200 G280 GLEX G500 G550 G600 G650 G700 GLF2-6 GL5T GL7T GV GIV CL30 CL35 CL60 BD70 BD10 C25A/B/C C500 C510 C525 C550 C560 C56X C680 C700 C750 E35L E50P E55P E545 E550 FA50 FA7X FA8X F900 F2TH LJ35 LJ40 LJ45 LJ60 LJ70 LJ75 PC12 PC24 TBM7 TBM8 TBM9 PRM1 SF50 EA50 VLJ.
- HELI_TYPES = R22 R44 R66 B06 B06T B204…B525 AS32 AS35 AS50 AS55 AS65 EC20…EC75 H125…H225 S55…S92 A109 A119 A139 A169 A189 AW09 MD52 MD60 MDHI MD90 NOTR B47G HUEY GAMA CABR EXE.

Comments say OpenSky has no aircraft type and its emitter category is 'no info' for about 96% of aircraft, so the callsign test carries most of the split.

Files: `src/app/api/flights/route.ts:50-110`, `src/app/api/flights/route.ts:146-218`

### 2. /api/flights — response shape, caching, GPS jamming

Response JSON:
- `commercial_flights`, `private_flights`, `private_jets`, `military_flights` (arrays).
- `gps_jamming`: [{lat, lng, severity, count}].
- `total`: allRaw.length, pre-classification.
- `source`: 'opensky-auth' | 'opensky-anon' | 'regional', with '+stale' appended on the fallback path.
- `providers`: {adsbfi_mil, adsbfi_regional, opensky, opensky_auth: bool, opensky_age_s: number|null}.
- `timestamp`: ISO string.

Per-aircraft fields:
- callsign: string
- lat, lng: rounded to 5 dp
- alt: METRES, integer
- heading: integer degrees
- speed_knots: number|null
- model: `t` or 'Unknown'
- icao24: hex
- registration: `r` or 'N/A'
- squawk: string
- airline_code: 3-letter or ''
- aircraft_category: 'heli' | 'plane'
- category: 'commercial' | 'private' | 'jet' | 'military'
- grounded: bool
- nac_p: number|undefined
- type: 'flight'

GPS jamming:
- A point counts when nac_p <= 4 (JAMMING_NACAP_THRESHOLD) and the aircraft is not grounded.
- Points are binned into a 2° grid. A cell's lat/lng is its centre.
- Only cells with count >= 3 are kept.
- severity = round((1 - avgNacp/4) × 100).

Caching:
- In-memory `cachedData`, CACHE_TTL = 90000 ms.
- A shared `fetchPromise` dedupes concurrent misses.
- Cache-Control: 'public, s-maxage=30, stale-while-revalidate=60'. It switches to 'no-store, max-age=0' when total < 100.

Error contract:
- On failure it returns the stale cachedData (source+'+stale', no-store).
- If there is no cache: 500 {error: 'Failed to fetch flight data'}.

Files: `src/app/api/flights/route.ts:429-520`, `src/app/api/flights/route.ts:297-316`

### 3. /api/flights — client consumption & visuals

Fetching (src/app/page.tsx):
- Fetched once when any of the layers flights/private/jets/military is switched on, then polled every 300000 ms (5 min) while a flight layer is active.
- fetchEndpoint uses `cache: 'no-store'`.

Client-side decimation (OsirisMap.tsx:1837-1840):
- Commercial: only every 10th aircraft is drawn (`toFeatures(data.commercial_flights, 10)`).
- Private and jets: every 2nd.
- Military: all.

Feature properties: callsign, heading, alt, model, speed_knots, registration, icao24. category and aircraft_category are dropped, so helicopters render as planes.

Layers:
- ids fl-commercial / fl-private / fl-jets / fl-military.
- Sources: 'flights' / 'private-fl' / 'jets' / 'military'.
- Icons: 'plane-cyan' / 'plane-green' / 'plane-pink' / 'plane-red', each a 24 px canvas silhouette.
- Symbol layout: icon-size interpolate zoom 1→0.4, 5→0.7, 10→1; icon-rotate ['get','heading']; icon-rotation-alignment 'map'; allow-overlap and ignore-placement true; icon-opacity 0.85.

Colours (CSS vars in globals.css:51-55, defaults in lib/map-palette.ts):
- --map-flight-civil #00e5ff
- --map-flight-private #ffd700
- --map-flight-gov #ff9500 (used for jets)
- --map-flight-military #ff0000
- --map-flight-unknown #546e7a
- Ghost theme: civil #b388ff, private #ce93d8, gov #d500f9.
- The icon names do not match their colours: 'plane-green' is gold and 'plane-pink' is orange.

LayerPanel group 'AVIATION' labels: Commercial / Private / Private Jets / Military.

The gps_jamming field is never rendered by any client code.

Files: `src/app/page.tsx:745-753`, `src/app/page.tsx:858-863`, `src/components/OsirisMap.tsx:224-244`, `src/components/OsirisMap.tsx:390-402`, `src/components/OsirisMap.tsx:794-806`, `src/components/OsirisMap.tsx:1824-1841`, `src/lib/map-palette.ts:53-66`, `src/app/globals.css:44-55`, `src/components/LayerPanel.tsx:61-71`

### 4. Flight click popup (what a replica must show)

Click on any fl-* layer opens a maplibregl.Popup (closeButton, maxWidth '420px', offset 14).

Popup styling:
- Container: `background:rgba(12,14,26,0.95);backdrop-filter:blur(16px);border-radius:10px;padding:16px;font-family:'JetBrains Mono'`.
- Border: 1px rgba(255,255,255,0.08).

Content, top to bottom:
- Header: callsign in #E8E6E0, 15 px bold, letter-spacing .08em; icao24 in #5C5A54.
- 3-column grid with labels in #5C5A54 9 px and values in #B0BEC5: MODEL, ALT (`{m}m`), SPEED (`{kt}kt`), HDG (`°`), REG, POS (lat,lng to 2 dp).
- `IDENTIFYING AIRFRAME…` placeholder, filled asynchronously from /api/aircraft with the model plus `reg · typeCode · operator`, or `AIRFRAME NOT IN REGISTRY`.
- Button `+ WATCH THIS AIRCRAFT`: bg rgba(0,229,255,0.10), border rgba(0,229,255,0.35), colour #7FE9FF. It calls window.osirisWatchFlight({icao24, callsign}).
- `RESOLVING ROUTE…`, replaced from /api/flight-route by:
  - FROM {IATA||ICAO} {city} → TO {IATA||ICAO} {city}
  - a 2 px progress bar (rgba(255,255,255,0.35) on rgba(255,255,255,0.06))
  - `DEP hh:mm TZ` | `{pct}% · {km}km` | `ARR hh:mm TZ` (formatTime: en-US, 24 h, timeZoneName 'short')
  - `NO SCHEDULED ROUTE` when not found, `ROUTE UNAVAILABLE` on error.
- Outbound links:
  - FLIGHTAWARE `https://www.flightaware.com/live/flight/{cs}`
  - ADS-B `https://globe.adsbexchange.com/?icao={icao24}`
  - RADARBOX `https://www.radarbox.com/data/flights/{cs}`

The route request sends callsign with whitespace stripped, plus icao24, lat, lng and speed. The popup HTML is escaped with htmlEsc / idSafe / urlSafe (the XSS helpers).

Files: `src/components/OsirisMap.tsx:956-1078`

### 5. /api/flight-route — inputs, sources, cache, response

Query params:
- `callsign`: required; trimmed and upper-cased. Missing → 400 {error:'callsign required'}.
- `icao24`: lower-cased.
- `lat`, `lng`: parseFloat, default '0'.
- `speed`: knots; 0 → null.
- maxDuration 15.

Cache:
- In-memory Map keyed by CALLSIGN ONLY.
- CACHE_HIT_TTL 30 min, CACHE_MISS_TTL 2 min.
- Cached hits recompute times against the new lat/lng.
- Evicts entries older than 60 min once size > 500.

Sources, raced with Promise.any; each has a 4000 ms timeout and a per-source 3-min cooldown after 429:
1. adsbdb: stealthFetch `https://api.adsbdb.com/v0/callsign/{cs}`. Reads `response.flightroute.origin/destination` with fields icao_code, iata_code, name, municipality, country_iso_name, latitude, longitude.
2. hexdb: stealthFetch `https://hexdb.io/api/v1/route/callsign/{cs}`. Reads a `route` string 'XXXX-YYYY', taking the first and last parts, or `origin`/`destination`.
3. airplanes.live: stealthFetch `https://api.airplanes.live/v2/hex/{icao24}` or `/v2/callsign/{cs}`. Reads `ac[0].oDB/dDB` {icao, iata, lat, lon, name, city, country}, or `from`/`to`, or `route` 'A-B'.

The file header claims airplanes.live uses plain fetch; the code uses stealthFetch.

resolveAirports:
- Rejects oCode === dCode.
- Looks up lookupAirport (local), then lookupAirportAsync (adsbdb), then falls back to upstream-provided coordinates.
- Rejects non-finite coordinates or identical coordinates.

Plausibility check (only when lat and lng are given):
- Rejects routes shorter than 30 km.
- Rejects when the plane is more than 1.5 × route distance from BOTH endpoints.

Responses:
- Miss: {found:false, callsign, icao24} with Cache-Control 's-maxage=60, stale-while-revalidate=120'.
- Hit: {found:true, callsign, icao24, source:'adsbdb'|'hexdb'|'airplaneslive', origin:{iata,icao,name,city,country,lat,lng}, destination:{same}, arc:[[lng,lat]×73], totalDistanceKm:int, departureTime:ISO|null, arrivalTime:ISO|null, progress:0..1}, with Cache-Control 'public, s-maxage=120, stale-while-revalidate=300'.

estimateTimes:
- kmh = speedKt × 1.852 when speed > 50 kt, else 800.
- departure = now − done/kmh.
- arrival = now + left/kmh.
- progress = done/total, clamped to 0..1.
- done and left are haversine distances from the current position.

There is no vitest file for this route.

Files: `src/app/api/flight-route/route.ts:1-41`, `src/app/api/flight-route/route.ts:77-219`, `src/app/api/flight-route/route.ts:221-324`

### 6. Great-circle / geo math already in repo

greatCirclePoints(lat1,lng1,lat2,lng2,n=72) in flight-route/route.ts:
- True spherical slerp: A=sin((1−f)d)/sin d, B=sin(fd)/sin d, converted to xyz and back to [lng,lat].
- Returns n+1 points.
- Returns the 2 endpoints if d < 1e-10.
- Does NOT split or unwrap at the antimeridian, so a trans-Pacific arc jumps from +180 to −180.

src/lib/geo.ts (spherical, R = 6371 km, everything in [lng,lat] order):
- haversine(a,b) km
- bearing(a,b): initial bearing 0–360
- destination(origin, bearingDeg, distKm)
- polygonArea (Chamberlain–Duquette), ringPerimeter, pathLength
- circleToRing(center, radiusKm, 64)
- rectToRing
- formatDistance: '<1 km' shows metres, <100 km shows 1 dp, else `toLocaleString`
- formatArea
- compassPoint: 16-point
- Tested in geo.test.ts.

src/lib/orbit.ts splitAtAntimeridian(path) is reusable for flight arcs: it splits wherever |Δlng| > 180 and drops runs shorter than 2 points.

FlightWatchPanel.tsx:
- greatCircleKm([lng,lat],[lng,lat]).
- onCorridor(here, O, D) := dist(O,here) + dist(here,D) <= direct × 1.15 + 150 km.

airports.ts nearestAirport(lat, lng, maxKm = 25):
- Flat approximation with 111.32 km/deg and a cos(lat) longitude scale.
- Linear scan over 375 airports.

Usage today: the flight `arc` is returned by the route but never drawn (OsirisMap.tsx:1033-1035 says the straight/arc line was removed). No planned-path renderer exists.

Files: `src/app/api/flight-route/route.ts:43-75`, `src/lib/geo.ts:1-174`, `src/lib/orbit.ts:100-121`, `src/components/FlightWatchPanel.tsx:59-87`, `src/lib/airports.ts:528-552`

### 7. src/lib/airports.ts — airport table and lookup

Airport interface: {iata, icao, name, city, country (ISO2), lat, lng}.

The RAW tuple table has 375 entries of [IATA, ICAO, name, city, ISO2, lat, lng], grouped by region: US, Canada, Mexico, UK, France, Germany, Benelux, Iberia, Italy, Scandinavia, Eastern Europe, Greece/Turkey, Ireland, Middle East, South Asia, East Asia, SE Asia, Oceania, Africa, South America, Central America/Caribbean, Central Asia/Caucasus, Russia. Examples: ['JFK','KJFK','John F Kennedy','New York','US',40.6399,-73.7787]; ['LHR','EGLL','Heathrow','London','GB',51.4700,-0.4543].

Indexes:
- AIRPORTS_BY_ICAO.
- AIRPORTS_BY_IATA, where the first entry wins.

lookupAirport(code):
- Upper-cases the code and checks the ICAO index, then IATA, then the dynamicCache.
- Dynamic cache TTL is 24 h and also caches misses as null.

lookupAirportAsync(code):
- Same local lookup, then plain fetch `https://api.adsbdb.com/v0/airport/{CODE}` (the same URL for ICAO and IATA; 3000 ms timeout).
- Reads `response.airport.{iata_code, icao, name, municipality, country_iso_name, latitude, longitude}` and caches under both codes.
- The code reads `ap.icao`, whereas adsbdb flightroute objects use `icao_code`. Whether adsbdb has an /airport endpoint at all is unverified — treat it as possibly dead.

Other exports: getAllAirports(), nearestAirport(). There is no public/data airport file; public/data contains only submarine-cables JSON.

Files: `src/lib/airports.ts:1-554`, `public/data/submarine-cables.json`

### 8. /api/aircraft — trace + identity

Query params:
- `icao24`: must match /^[0-9a-f]{6}$/ after trim and lower-case, else 400 {error:'icao24 must be a 6-character hex address'}.
- `detail`: 'recent' → trace_recent; otherwise trace_full.
- `legs`: 'all' → the whole 24 h history; otherwise the current leg only.
- maxDuration 20.

Upstreams (in parallel, each wrapped in optional() so a failure becomes null):
- `https://adsb.lol/data/traces/{icao24.slice(-2)}/trace_{full|recent}_{icao24}.json` via httpJson, 12000 ms.
- `https://api.adsbdb.com/v0/aircraft/{icao24}`, 8000 ms. Fields used: response.aircraft {manufacturer, type, registered_owner, registration, icao_type}.

Trace rows are `[Δsec, lat, lon, alt_ft|'ground', gs, track, flags…]`. File-level fields: icao, r, t, desc, ownOp, timestamp.

currentLeg(rows, minGroundRun=4):
- Rewinds past trailing 'ground' rows.
- Walks back to the previous run of at least 4 consecutive ground samples.
- Returns the full rows if the leg would be shorter than 2.

legEndpoints:
- departure = nearestAirport(first point) if the first altitude is null or <= 10000 ft (DEPARTURE_CEILING_FT).
- arrival = nearestAirport(last point) only when the raw trace ends with 'ground'.

downsample(points, 700) keeps the first and last points. model = desc || `${manufacturer} ${type}` || type.

Response (AircraftDetail):
- {icao24, registration|null, typeCode|null, model|null, operator|null (adsbdb registered_owner), track:[[lng,lat]], altitudes:(ft|null)[], points, departure:Airport|null, arrival:Airport|null, source:'adsb.lol'|'adsbdb'}.

Caching and errors:
- cachedSource key `aircraft:{hex}:{full|recent}:{leg|all}`, TTL 2 min.
- Cache-Control 'public, s-maxage=120, stale-while-revalidate=600'.
- 404 {error:'Aircraft not found', icao24}; 500 {error:'Aircraft lookup failed'}.

httpJson (src/lib/httpJson.ts):
- Uses Node https.get, because undici fetch stalls with UND_ERR_CONNECT_TIMEOUT against some hosts.
- UA: `OSIRIS-OSINT/1.0 (+https://github.com/simplifaisoul/osiris)`.
- Decodes gzip/deflate/br by the response header (adsb.lol pre-compresses its traces).
- Rejects on status >= 400; resolves a 304 as an empty body.

Tests: route.test.ts covers shardFor, downsample, parseTrace, currentLeg, nearestAirport and legEndpoints.

Files: `src/app/api/aircraft/route.ts:1-268`, `src/app/api/aircraft/route.test.ts:1-238`, `src/lib/httpJson.ts:1-141`

### 9. FlightWatchPanel — client use of /api/aircraft + /api/flight-route

Adding a watched aircraft:
- window.osirisWatchFlight({icao24, callsign}) appends to watchedFlights.
- Duplicates are ignored and the list is capped at 6 (`.slice(-6)`).

Each Row fetches in parallel:
- `/api/aircraft?icao24=…`
- `/api/flight-route?callsign=…&icao24=…`, without lat/lng, so the server plausibility check is skipped.

resolveEndpoints(ac, schedule):
- If both departure and arrival were observed, use them.
- Otherwise the destination is taken from the schedule only when the schedule origin matches the observed departure (same ICAO or IATA). With no observed departure, onCorridor(last track point, O, D) decides instead.
- The origin is always the observed departure, or null.

page.tsx handleAircraftDetail:
- Collects [origin, destination] into aircraftAirports[icao24].
- OsirisMap draws them as source 'watched-airports' with three layers:
  - glow: circle r13 #FFB300, opacity .16, blur .8
  - dot: r5 #FFFFFF, stroke 2 #FFB300
  - label: IATA||ICAO, Open Sans Bold 11, #FFB300, halo #0C0E1A 1.5, offset [0,1.6]
- The flown `track` is NOT drawn anywhere, although the comments claim it is.

Panel layout:
- Position: top-3, left 120px (12px on mobile), width min(92vw,290px), z-[380].
- Row header: Plane icon + callsign + ICAO24, a Crosshair button (fly to zoom 8) and an X button.
- Body: model or 'Unidentified type'; registration · typeCode · operator; ALT in ft rounded to 25 (toFeet) or 'Ground'; SPEED kt; squawk.
- Route line: ORIG → DEST (or '····') with status 'landed' | 'scheduled' | 'destination unknown'.
- Footer text: '{n} points this leg'; 'No longer in the live feed' in --alert-orange when telemetry is missing.
- Telemetry comes from the latest /api/flights payload, keyed by icao24.

Tests: FlightWatchPanel.test.ts covers toFeet, formatAlt, greatCircleKm, onCorridor and resolveEndpoints.

Files: `src/components/FlightWatchPanel.tsx:1-305`, `src/components/FlightWatchPanel.test.ts`, `src/app/page.tsx:225-273`, `src/app/page.tsx:1356-1372`, `src/components/OsirisMap.tsx:2967-3030`

### 10. stealthFetch helper

stealthFetch(url, init) is a drop-in replacement for fetch.

Headers it injects:
- A random UA from 10 desktop/mobile Chrome/Firefox/Safari/Edge strings (Chrome 131, Firefox 133, Safari 18.2, and others).
- 'Accept-Language: en-US,en;q=0.9'.
- Spoofed 'X-Forwarded-For' and 'X-Real-IP' drawn from 'residential' ISP subnets (Comcast 73.15.x, AT&T 107.77.x, BT 86.128.x, Telekom 91.64.x, and others).

Timeouts: a hard 30 s timeout via an AbortController, which is chained to the caller's signal.

Used by: flights (adsb.fi, OpenSky), flight-route (all three sources), weather (EONET, GDACS), satellites (SatNOGS fallback).

This is an evasion hack. A replica should use an honest UA plus caching instead.

Files: `src/lib/stealthFetch.ts:1-117`

### 11. /api/satellites — TLE sources, classification, shape

No params. maxDuration 60.

Refresh condition: refetches when the cache is empty, when it has fewer than 5000 satellites, or when it is older than 3600000 ms (1 h).

Primary source: 43 CelesTrak URLs fetched in parallel with plain fetch (30 s timeout, `cache:'no-store'`, UA 'OSIRIS/4.2 (satellite-tracker)').
- Base URL: `https://celestrak.org/NORAD/elements/gp.php?GROUP={g}&FORMAT=tle`.
- Groups: active, gps-ops, glonass-operational, galileo, beidou, oneweb, iridium-NEXT, globalstar, orbcomm, intelsat, ses, other-comm, x-comm, stations, education, engineering, science, weather, resource, sarsat, planet, goes, argos, dmc, spire, military, radar, geodetic, tdrss, geo, cubesat, tle-new, amateur, last-30-days, visual, supplemental, fengyun-1c-debris, cosmos-2251-debris, iridium-33-debris, cosmos-1408-debris, nnss, musson.
- Plus Starlink from `https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=tle`.
- A response counts as rate-limited (and yields []) if it contains 'has not updated since' or is shorter than 100 chars.

Merging: dedupe by NORAD id (line1 characters 2–7), then backfill from the previous cache. The merged set is accepted only if it has more than 500 entries; it is then saved to `.next/cache/satellites-tle-cache.json` as {time, sats}. The disk cache is loaded at module init if it is under 4 h old.

Fallbacks:
- SatNOGS: `https://db.satnogs.org/api/tle/?format=json` (stealthFetch, 15 s) using fields tle0/tle1/tle2.
- Emergency fallback: a hard-coded ISS TLE named 'ISS (FALLBACK)'.

parseTLEText handles both the 3-line and 2-line formats (2-line entries are named `SAT-{norad}`).

Propagation: every TLE is propagated each request via propagateTLE; there is no cap.

MISSION_CLASSIFY: first substring match in insertion order wins:
- USA → Military Recon #FF3D3D; NROL → NRO Classified #FF3D3D
- LACROSSE → SAR Imaging #00E5FF
- MENTOR, ORION, TRUMPET → SIGINT #FFFFFF
- GPS, NAVSTAR, GLONASS, GALILEO, BEIDOU → Navigation #448AFF
- SBIRS, DSP → Early Warning #FF00FF
- STARLINK, ONEWEB → Commercial Comms #00E676; PLANET → Earth Imaging #00E676; WORLDVIEW → Commercial Imaging #00E676
- ISS, TIANGONG → Space Station #FFD700
- COSMOS → Russian Military #FF6B6B; YAOGAN → Chinese Recon #FF6B6B
- FENGYUN, GOES, NOAA, METEOSAT → Weather #87CEEB
- LANDSAT, SENTINEL → Earth Observation #90EE90; TERRA, AQUA → Earth Science #90EE90
- HUBBLE, JAMES WEBB → Space Telescope #FFD700
- Default: Unknown #00E5FF

Category:
- Names containing ' DEB', 'DEBRIS' or ' R/B' → other.
- Commercial Comms / Commercial Imaging → comms.
- Navigation → navigation.
- Weather / Earth Observation / Earth Science → earth_obs.
- Military Recon / NRO / SIGINT / Early Warning / Russian Military / Chinese Recon / SAR Imaging → military.
- Space Station / Space Telescope → science.
- Anything else → other. 'Earth Imaging' (PLANET) therefore falls to other.

Response:
- {satellites:[{name, lat (4 dp), lng (4 dp), alt (km, int), mission, color, category, noradId}], total, category_counts:{cat:n}, source (e.g. 'celestrak (N TLEs: x new, y cached)' | 'memory-cache' | 'satnogs-api' | 'emergency-fallback'), raw_count, timestamp}.
- Cache-Control 'public, s-maxage=120, stale-while-revalidate=300'; 'no-store' when fewer than 10 satellites.
- Error: 500 {satellites:[], error:'Failed to fetch satellite data'}.

Client: fetched ONCE when any satellite sub-layer is enabled and never re-polled. The client stores `satellites_at` = timestamp so orbit requests can anchor to it. LayerPanel 'SPACE TRACKING' labels: All Satellites, Starlink / Comms, Military / Intel, GPS / Navigation, Earth Observation, Stations / Telescopes.

Files: `src/app/api/satellites/route.ts:1-348`, `src/app/page.tsx:754-763`, `src/components/LayerPanel.tsx:80-92`

### 12. SGP4 + /api/satellites/orbit

src/lib/orbit.ts (wraps satellite.js):
- propagateTLE(line1, line2, when) uses twoline2satrec → propagate → eciToGeodetic(gstime).
- Returns {lat, lng (wrapped to ±180), altKm (above the WGS84 ellipsoid)}.
- Returns null on satrec.error, a non-finite result, or altKm < 80 or > 60000.
- orbitalPeriodMinutes = 1440 / meanMotion, where meanMotion = line2.substring(52,63).
- orbitPath(l1, l2, steps=180, from) samples one full period evenly in time and skips failed points (no interpolation).
- splitAtAntimeridian.
- Tests in orbit.test.ts.

Orbit route query params:
- `id`: NORAD, must match /^\d{1,6}$/, else 400 {error:'numeric NORAD id required'}.
- `t`: epoch ms. Ignored when non-finite, <= 0, or more than 7 days from now.
- dynamic='force-dynamic'.

Catalogue: read from the disk cache `.next/cache/satellites-tle-cache.json` and re-read every 5 min (CACHE_TTL_MS). Not found → 404 {error:'not in catalogue', noradId}.

Window: from = anchor − period/2, then 180 steps across one full period (181 samples), so the satellite sits mid-track. Fewer than 2 points → 422 {error:'could not propagate'}.

Response:
- {noradId, name, periodMinutes, anchoredAt: ISO, segments: [[ [lng (4 dp), lat (4 dp), altKm (int)] ]]}.
- Cache-Control 'public, s-maxage=600, stale-while-revalidate=3600'.

Client:
- A click on a satellite does GPU picking and fetches `/api/satellites/orbit?id={norad}&t={satellites_at ms}`.
- A stale-response guard ensures only the latest selection is drawn.
- The orbit is drawn with layer.setOrbit(segments, colour) as a WebGL LINE_STRIP at display elevation with alpha 0.85.

SatelliteCard fields: ALTITUDE (km), ORBIT (LEO < 2000, MEO < 35000, GEO <= 36500, else HEO), PERIOD, SPEED (2π(R+alt)/period), LATITUDE, LONGITUDE, NORAD ID, CLASS.
- Status strings: 'PLOTTING ORBIT…' / 'ORBIT TRACK ON GLOBE' / 'NO TRACK — TLE UNAVAILABLE'.
- Link 'TRACK ON N2YO' → `https://www.n2yo.com/satellite/?s={norad}`.

satellite-layer.ts:
- A custom MapLibre layer using projectTileFor3D.
- displayElevation maps sqrt(alt), clamped to [150, 36000] km, onto [620, 2500] km.
- SAT_MAX_ZOOM = 7.
- Marker px = clamp(size × 260 / clip.w, 2.5, 16), +9 px with a ring when selected. ISS/TIANGONG/science use size 2.2.
- The pick pass reuses the same vertex shader as the visible pass.

Files: `src/lib/orbit.ts:1-121`, `src/app/api/satellites/orbit/route.ts:1-119`, `src/lib/orbit.test.ts`, `src/components/OsirisMap.tsx:1120-1209`, `src/components/SatelliteCard.tsx:1-158`, `src/lib/satellite-layer.ts:28-111`, `src/lib/satellite-layer.ts:173-190`

### 13. /api/space-weather

Fetches three NOAA SWPC feeds in parallel via Promise.allSettled, each with plain fetch and an 8 s timeout:
- `https://services.swpc.noaa.gov/json/planetary_k_index_1m.json`
- `https://services.swpc.noaa.gov/json/alerts.json`
- `https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json`

Kp reading:
- Uses the last element's `kp_index ?? Kp` (parseFloat) and time_tag.
- kpIndex stays null when there is no valid reading.

Storm levels (label and colour):
- null → 'Unknown' #555555
- >= 8 → 'Extreme (G5)' #FF1744
- >= 7 → 'Severe (G4)' #FF3D3D
- >= 6 → 'Strong (G3)' #FF9500
- >= 5 → 'Moderate (G2)' #FFD700
- >= 4 → 'Minor (G1)' #FFD700
- >= 3 → 'Unsettled' #D4AF37
- otherwise 'Quiet' #00E676

Alerts: the first 10 entries → {id: product_id, issue_datetime, message (first 200 chars)}.

Flares: the first 5 entries that have max_class → {class, begin, peak, end}.

Response: {kp_index, kp_available, storm_level, storm_color, kp_timestamp, alerts, solar_flares, timestamp}. No Cache-Control header and no server cache.

Error: 500 {kp_index:null, kp_available:false, storm_level:'Unknown', storm_color:'#555', alerts:[], solar_flares:[], error}.

Client:
- Fetched once, 5 s after load, and never polled.
- Status bar shows `SOLAR: Kp{n}` coloured with storm_color, or 'N/A' when there is no reading.
- MarketsPanel shows `Kp {n} — {storm_level}` and 'Latest flare: {class}'. The space-weather object is also fed to the AI overview.

Tests: route.test.ts covers classification, the Kp-fetch-failure case (Unknown, not Quiet), and a genuinely quiet reading.

Files: `src/app/api/space-weather/route.ts:1-99`, `src/app/api/space-weather/route.test.ts`, `src/app/page.tsx:706-712`, `src/app/page.tsx:1438`, `src/components/MarketsPanel.tsx:203-218`

### 14. /api/earthquakes (+ client bypass)

Upstream: plain fetch `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson`, 10 s timeout.

Per-quake fields:
- {id, lat, lng, depth (coordinates[2]), magnitude (mag), place, time (ms), url, tsunami, type, felt, alert}.

Response: {earthquakes, total, timestamp}.
- Cache-Control 'public, s-maxage=60, stale-while-revalidate=120'.
- USGS not ok → 200 {earthquakes:[], error:'USGS unavailable'}.
- Exception → 500.

Client bypass: the client never calls this route.
- page.tsx fetches the same USGS URL directly with an identical transform and polls every 900000 ms (15 min), skipping when the tab is hidden.
- GlobalStatusBar also fetches USGS directly and shows the 5 most recent M4.0+ quakes.

Map rendering:
- 'eq-circles' layer: radius interpolated by magnitude (2.5→4, 5→12, 7→24); colour 2.5 #F9A825 → 4 #E65100 → 6 #D32F2F; opacity .55; blur .3; stroke #F9A825 at .25.
- 'eq-label' for M >= 4.5: 'M{mag}'.
- Popup: 'M{mag} EARTHQUAKE', place, DEPTH, COORDS, and a link `https://earthquake.usgs.gov/earthquakes/eventpage/{id}` (or NIGGG-BAS for source 'NIGGG-BAS').

Files: `src/app/api/earthquakes/route.ts:1-57`, `src/app/page.tsx:683-716`, `src/components/GlobalStatusBar.tsx:80-126`, `src/components/OsirisMap.tsx:456-464`, `src/components/OsirisMap.tsx:1104-1118`

### 15. /api/fires

dynamic='force-dynamic'. FIRMS sources are tried sequentially (15 s timeout, UA 'OSIRIS-Intelligence-Platform/3.5'):
1. `https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv` → source 'NASA-FIRMS (VIIRS)'.
2. `https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv` → source 'NASA-FIRMS (MODIS)'.
- A body is accepted if it contains 'latitude' and is longer than 200 chars.

CSV parsing:
- Columns are looked up by header name: latitude, longitude, bright_ti4 (falling back to brightness), confidence, acq_date, acq_time, frp.
- Rows are strided to about 2000 points: step = ceil(lines/2000).
- Each fire: {lat (3 dp), lng (3 dp), brightness, confidence (raw string: VIIRS n/l/h, MODIS 0-100), date, time, frp, type:'fire'}.

Volcanoes: `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=volcanoes&limit=50` (10 s timeout). Each is appended as {lat, lng, brightness:500, confidence:'high', date, time:'', frp:100, title:`[VOLCANO] ${title}`, type:'volcano'}.

Response: {fires, total, source ('Unknown' if none), timestamp}.
- Cache-Control 'public, s-maxage=600, stale-while-revalidate=1200'.
- No in-memory cache.
- FIRMS_API_KEY is listed in the docs but never read.

Client:
- Fetched once when the layer turns on; never polled.
- 'fires-heat' circle: #E65100, opacity .45, blur .5, radius zoom 1→2, 5→4, 10→8.
- Popup: '🔥 ACTIVE FIRE DETECTED', BRIGHTNESS {K}, and link `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;l:noaa20-viirs,viirs,modis_a,modis_t;@{lng},{lat},10z`.

Files: `src/app/api/fires/route.ts:1-123`, `src/app/page.tsx:764-768`, `src/components/OsirisMap.tsx:466-470`, `src/components/OsirisMap.tsx:1211-1224`

### 16. /api/weather (severe weather / natural events)

Wrapped in cachedSource('weather:events', collectEvents, 3 × 60_000). If every provider fails it throws, so the last good list is served.

Three upstreams in parallel, each with a 10 s timeout:
- EONET: stealthFetch `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100`.
  - Uses the last geometry, and only when it is a Point.
  - Skips wildfires and earthquakes.
  - severeStorms → 'Severe Storm', icon cyclone, high.
  - volcanoes → 'Volcano Eruption', icon volcano, high.
  - seaIce → 'Iceberg / Sea Ice', icon ice, medium.
  - Anything else → category title, icon alert, low.
- NWS: fetch `https://api.weather.gov/alerts/active?status=actual&message_type=alert` with Accept application/geo+json and UA 'OSIRIS Severe Weather Layer'.
  - Position is the Point, the average of the polygon's first ring, or the first MultiPolygon ring.
  - Severity: Extreme/Severe → high, Moderate → medium, else low.
  - Fields used: headline, event, effective/sent, expires, areaDesc, '@id'.
- GDACS: stealthFetch `https://www.gdacs.org/xml/rss.xml`, parsed with regex.
  - Only these event types: TC → 'Tropical Cyclone' (icon cyclone), FL → 'Flood' (flood), DR → 'Drought' (drought).
  - alertlevel red → high, orange → medium, else low.
  - id `gdacs-{type}-{eventid}-{episodeid}`.

WeatherEvent shape: {id, title, category, type, icon, severity: 'low'|'medium'|'high', lat, lng, date?, expires?, area?, source (url), provider: 'NASA EONET'|'NOAA/NWS'|'GDACS'}.

Response: {events, total, timestamp}.
- Cache-Control 'public, s-maxage=120, stale-while-revalidate=600'.
- Error: 500 {events:[], error}.

Client: a core feed loaded at boot (drives the Live Alerts panel) and polled every 300000 ms, skipping when the tab is hidden.

Files: `src/app/api/weather/route.ts:1-347`, `src/app/page.tsx:689-693`, `src/app/page.tsx:720`, `src/components/LiveAlerts.tsx:82`

### 17. /api/air-quality, /api/radar, /api/sentinel (routes the client never calls)

/api/air-quality:
- Upstream: fetch `https://api.openaq.org/v2/latest?limit=500&parameter=pm25&order_by=lastUpdated&sort=desc` (10 s timeout, Accept json).
- PM2.5 levels: > 150 'Hazardous' #8B0000; > 100 'Unhealthy' #FF1744; > 55 'Unhealthy (Sensitive)' #FF9500; > 35 'Moderate' #FFD700; else 'Good' #00E676.
- Response: {stations:[{id:`aq-${location}`, name, city, country, lat, lng, pm25, unit, level, color, lastUpdated}], total, timestamp}. No cache header.
- OpenAQ v2 is believed retired (v3 needs an X-API-Key), so this route likely returns empty — not verified here.

/api/radar (actually internet outages from IODA, not weather radar):
- Upstream: fetch `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?from={now-86400}&until={now}&entityType=country&limit=200` (12 s timeout, UA 'OSIRIS/4.2').
- Maps `location` 'country/XX' to a built-in COUNTRY_CENTROIDS table stored as [lng,lat].
- Jitter: lng += ((i×137.5)%200−100)/100×2 and lat += ((i×251.3)%200−100)/100×2.
- Output: {outages:[{id, lat, lng, country, code, score, level (severity), from, until, datasource}], total, timestamp, source:'IODA — Georgia Tech Internet Outage Detection'}.
- Cache-Control s-maxage=300, swr=600.
- Upstream not ok → 200 with source 'IODA (offline)'.
- The docs call it GPS interference, which is wrong.

/api/sentinel:
- Query params: lat, lng (default '0', so the isNaN guard never fires on missing params), radius (default 2, used as DEGREES for bbox ±radius), days (default 30).
- Upstream chain:
  - POST `https://earth-search.aws.element84.com/v1/search` {collections:['sentinel-1-grd'], bbox, datetime, limit:20, sortby datetime desc} (20 s).
  - If empty, the same with 'sentinel-2-l2a' (12 s).
  - If empty, POST `https://catalogue.dataspace.copernicus.eu/stac/search` {collections:['SENTINEL-1'], limit:10} (12 s).
- Scene fields: {id, datetime, platform, orbit, polarization, mode, resolution, pass_direction, cloud_cover, bbox, thumbnail, preview, geometry_type, area_km2}.
- Response adds {source:'element84'|'element84-s2'|'copernicus', total, bbox, datetime, timestamp}.
- Cache-Control s-maxage=300, swr=600.

Files: `src/app/api/air-quality/route.ts:1-70`, `src/app/api/radar/route.ts:1-87`, `src/app/api/sentinel/route.ts:1-135`

### 18. /api/stats and /api/health

/api/stats:
- maxDuration 60.
- Fetches its OWN routes on `new URL(req.url).origin`, all in parallel with 20 s timeouts: /api/flights, /api/satellites, /api/cctv, /api/weather, /api/infrastructure, /api/gdelt.
- Counts:
  - flights = the four bucket lengths summed
  - sats = satellites.length
  - cctv = cameras.length
  - weather = events.length
  - nuclear = infrastructure.length
  - incidents = gdelt events.length
- Snapshot TTL_MS = 30_000 with a single in-flight computation (`inflight ??=`).
- A stale snapshot is returned immediately while it refreshes in the background.
- A failed feed keeps its last count; a computation that reached no feed is not treated as fresh.
- Response: {stats:{flights, sats, cctv, weather, nuclear, incidents}, timestamp}, Cache-Control 'public, s-maxage=30, stale-while-revalidate=60'.
- No snapshot + failure → 500 {error:'Failed to compute stats'}.
- Exports clearStatsSnapshot() as a test hook.
- Tests (route.test.ts): counts, a burst of 50 concurrent calls → 6 fetches, TTL, stale-first, keep-last-good, zero-reach not fresh, 500 with no snapshot.
- Client: page.tsx fetches it once into globalStats, which is never rendered.

/api/health:
- Static response: {status:'serving', scope:'process', checks_performed:'none', detail:'The application process is up and answering requests. Upstream feed availability is not checked by this endpoint — query the individual routes for that.', platform:'OSIRIS', version:'1.0.0', uptime_seconds, nominatim: nominatimStats() (counts plus cached and queueDepth), timestamp}.

Files: `src/app/api/stats/route.ts:1-137`, `src/app/api/stats/route.test.ts`, `src/app/api/health/route.ts:1-40`, `src/app/page.tsx:495-503`

### 19. Shared cache helper cachedSource

cachedSource<T>(key, fetcher: () => Promise<T[]>, ttlMs = 30 min) returns a memoised getter.

Behaviour:
- Serves from memory while `now < expiresAt` and the data is non-empty.
- Concurrent callers share the in-flight promise.
- An empty result while cached data exists keeps the old data.
- On an exception with cached data: serve the cached data and retry after 60 s.
- On an exception with no data: cache [] for 60 s.
- Evicts once there are more than 500 keys (MAX_ENTRIES), in insertion order, never dropping an in-flight entry.

Also exports peekSource, isStale, seedSource and clearSourceCache.

Arrays only, so /api/aircraft wraps its single object in a one-element array.

Files: `src/lib/sourceCache.ts:1-132`

### 20. Docs vs code drift (don't copy the docs blindly)

Mismatches between apiCatalog.ts / .env.example and the code:
- apiCatalog says /api/flights is 'Keyless via adsb.lol'; the code uses adsb.fi + OpenSky, and states adsb.lol is dead.
- apiCatalog says /api/health status is `operational` with an `endpoints` key; the code returns 'serving' and has no endpoints key.
- apiCatalog gives /api/sentinel radius in km; the code uses degrees.
- apiCatalog calls /api/radar 'GPS interference'; the code reads IODA internet outages.
- apiCatalog lists FIRMS_API_KEY for /api/fires; it is never read.
- apiCatalog describes /api/weather as EONET only; the code also uses NWS + GDACS.
- .env.example says only SCANNER_* are read; the code does read OPENSKY_CLIENT_ID/SECRET.
- README mentions N2YO_API_KEY; it is unused except for the external link.

Files: `src/app/docs/apiCatalog.ts:59-173`, `.env.example`, `README.md:56`, `README.md:211-214`

## Worth copying

- Single-flight + TTL + stale-on-error caching everywhere (cachedSource pattern; flights' shared fetchPromise; stats' 'stale beats slow' snapshot that answers immediately and refreshes behind). Treat empty upstream results as a failed refresh, not truth.
- Report per-provider counts in the payload (`providers: {adsbfi_mil, opensky, opensky_age_s, …}`) so a silently-dead feed (200 + empty) is visible instead of blanking the map.
- Keep the last good OpenSky snapshot between budgeted polls (90 s authed / 900 s anon) and merge in a cheap always-fresh military feed; 15-min back-off on 429; OAuth2 client_credentials token cached until expires_in−60 s.
- Aircraft bucketing heuristic: military first (dbFlags&1, type list, RCH/REACH/… callsign regex), then airliner type/heavy category, then bizjet operator list/type list/'registration callsign cruising >8500 m and >300 kt', then GA registration callsign → private.
- Flight route resolution by racing several callsign→route sources with Promise.any, per-source 429 cooldowns, 30-min hit / 2-min miss cache, and a plausibility gate (route ≥30 km and aircraft within 1.5× route length of an endpoint).
- Trust the observed track over schedule data: derive departure from a low (≤10,000 ft) first trace point near an airport (≤25 km, cos-lat corrected), arrival only when the trace ends in 'ground', accept a scheduled destination only when its origin matches the observed departure or the aircraft is on-corridor (detour ≤ direct×1.15+150 km). Label 'scheduled' vs 'landed' vs 'destination unknown' honestly.
- Current-leg extraction from 24 h readsb traces (split on ≥4 consecutive ground samples) and endpoint-preserving downsampling to 700 points.
- Proper spherical slerp great-circle generator (73 points) + haversine distance + ETA/progress estimate; combine with orbit.ts splitAtAntimeridian for drawable arcs.
- Real SGP4 via satellite.js returning geodetic lat and height above WGS84; reject altKm <80 or >60000; orbit track centred on the marker's own propagation epoch (t param, ignored if >7 days off) with half a period either side, split at the antimeridian.
- Satellites drawn at altitude with a MapLibre custom layer using projectTileFor3D (works in globe and mercator), sqrt altitude compression into a visible band, constant-pixel instanced quads, GPU picking with the same vertex shader, orbit drawn in the satellite's colour, and hidden above zoom 7.
- TLE catalogue persisted to disk with 4 h validity and backfill of groups that failed this cycle; detect CelesTrak's rate-limit text body.
- Space weather: never report 'Quiet' on missing data (kp_index null, storm_level 'Unknown'); ship storm_color so the client needs no lookup table.
- Node https-based JSON fetch (httpJson) with an honest identifying UA, content-encoding-aware decode, and conditional GET (ETag/Last-Modified) for large dumps.
- Client: layer-aware lazy loading (fetch only when a layer is toggled on), polling that skips when document.hidden, XSS-escaped popup HTML, async popup sections ('IDENTIFYING AIRFRAME…', 'RESOLVING ROUTE…') filled in after the first render, deep links to FlightAware/ADSBExchange/RadarBox/N2YO/USGS/FIRMS.
- Theme-driven map palette via CSS custom properties (--map-flight-civil etc.) re-read at runtime to recolour canvas-generated plane icons.

## Weaknesses to fix in GODSEYE

- No planned-route or great-circle line is drawn at all. /api/flight-route computes `arc` and /api/aircraft returns the flown `track`, but the client renders neither; watched aircraft only get amber airport pins. No endpoint accepts origin/destination airport codes, which is the new feature to build. greatCirclePoints is also not antimeridian-safe.
- The map shows only 10% of commercial aircraft (client decimation `toFeatures(..., 10)`) and 50% of private and jets. Positions refresh every 5 min with no dead-reckoning or interpolation, so aircraft teleport.
- `category` and `aircraft_category` are dropped before rendering, so helicopters use the plane icon and nothing is colour-coded by altitude. There is no emergency-squawk highlighting (7500/7600/7700) and no search by callsign, registration or hex on the map.
- OpenSky `category_os === 14` is treated as military, but OpenSky's category 14 is 'Unmanned Aerial Vehicle' — verify against the OpenSky docs. adsb.fi reports `alt_baro: 'ground'` as a string, which the classifier turns into alt 0 with grounded=false.
- The gps_jamming grid is computed but never rendered. OpenSky has no nac_p, so in steady state jamming comes only from the adsb.fi military feed, making it statistically meaningless.
- /api/flight-route caches by callsign only, so icao24 is ignored for cache hits and the plausibility check is not re-run for a different position. It still races airplanes.live, which the flights route documents as 403/key-gated. The ETA assumes constant ground speed along a great circle, with an 800 km/h default.
- The airport DB is only 375 hard-coded airports. Its async fallback calls `api.adsbdb.com/v0/airport/{code}`, which is unverified and reads `ap.icao` rather than `icao_code`. A replica needs a full global dataset (e.g. OurAirports, ~70k airports, IATA/ICAO/name/city/lat/lon) for airport-code search.
- stealthFetch spoofs X-Forwarded-For/X-Real-IP and rotates browser UAs to evade rate limits. This is ethically and legally dubious; use honest UAs, caching and optional API keys instead.
- Satellites route: propagates ~19k TLEs on every request (multi-MB JSON). It refetches all 43 CelesTrak groups whenever the catalogue has fewer than 5000 entries. It is fetched once and never re-polled, so markers go stale. Substring mission classification gives false positives ('USA', 'ISS', 'DSP', 'ORION'). The orbit route depends on a disk cache under .next/cache, which breaks on read-only or serverless hosts.
- The client ignores /api/earthquakes and hits USGS directly from the browser, in two places. /api/air-quality (OpenAQ v2, likely retired), /api/radar (IODA) and /api/sentinel are dead code from the UI's perspective. The /api/stats result is fetched but never rendered.
- Space weather is fetched once and never refreshed, with no server cache or Cache-Control. Fires are fetched once per session. FIRMS is naively strided to 2000 points, losing hotspot density and ignoring confidence and FRP when sampling.
- /api/sentinel treats `radius` as degrees and defaults a missing lat/lng to 0,0 instead of returning 400. The docs contradict the code in several places (flights source, health status value, radar meaning, env vars).
- No tests exist for /api/flights classification, /api/flight-route, /api/satellites, fires, weather, earthquakes, air-quality, radar, sentinel or health.
- There is no rate limiting on /api routes (the middleware excludes /api), and self-fetching aggregation in /api/stats depends on the request origin.

## Gaps (not verified)

- Did not read the full OsirisMap.tsx (3000+ lines) or globals.css beyond the relevant sections, so other flight or satellite visual details (the rest of the satellite-layer render loop, map pitch and globe settings) are only partly covered.
- Upstream liveness was not verified (read-only; no network calls). The following status claims come from code comments or general knowledge, not live checks: adsb.fi rate behaviour, airplanes.live 403, adsb.lol v2 empty, OpenAQ v2 retirement, whether an adsbdb /v0/airport endpoint exists, and the meaning of OpenSky category 14.
- Whether the NOAA alerts.json and xray-flares-latest.json feeds are newest-first was not verified, which affects which items the slice(0,10) and slice(0,5) keep.
- 'Generic flights between two airports' (schedules by airport pair) has no source in this repo. The builder must pick one: for example OpenSky /api/flights/departure and /arrival (historical, needs auth), adsb.lol's routeset API, AeroDataBox or FlightAware AeroAPI (keyed), or OurAirports plus great-circle for a purely geometric planned path. None of these are referenced in the repo.
- The engine/, intel/, runs/ and scratch/ directories were not inspected for aviation-related code; this report focused on src/app/api and src/lib.
