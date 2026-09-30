# Flight Path Planner data sources (verified)
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.

## Summary

I checked every data source by fetching its docs or calling it live on 2026-09-30, and all are reachable from a server-side proxy. A route feature with no API keys is possible.
(1) Airports: OurAirports airports.csv is public domain, rebuilt nightly, and allows cross-origin requests. It has 86,154 rows (4,335 with scheduled service, 9,053 with an IATA code) and now has an explicit icao_code column. It has no timezone field; mwgg/Airports (MIT, ~29k entries, includes tz) fills that gap.
(2) Which flights fly a given origin→destination pair: the key find is the Virtual Radar Server (VRS) standing-data route table mirrored by adsb.lol. It is CC0, served with CORS *, last modified 2026-09-20, has 620,700 callsign→route rows, and is available as one 4.5 MB gzip (routes.csv.gz) or per callsign as JSON. Example: KJFK-EGLL (JFK→Heathrow) maps to 68 callsigns such as AAL100, BAW112 and DAL1. Jonty/airline-route-data (59,291 routes from 4,038 airports, updated weekly, with flight minutes and km) adds airport-level route and carrier info, but it has no licence and is scraped from flightsfrom.com. OpenFlights routes.dat has been frozen since June 2014 and is historical only.
(3) One specific flight: adsbdb (keyless, CORS *) and hexdb.io (keyless, CORS *) resolve callsign → origin/destination with coordinates. adsb.lol /v2/callsign and adsb.fi /v2/callsign return live positions and accept comma-separated callsign lists (tested). Neither sends CORS headers, so both must go through a Next.js proxy. The adsb.lol trace_full_{hex}.json file gives the whole day's actual track for an aircraft (readsb format, undocumented). The comment in OSIRIS src/app/api/flights/route.ts saying adsb.lol always returns empty is contradicted by today's tests: 205 aircraft within 60 nm of Heathrow (LHR) and live BAW4LV data. airplanes.live does return 403 here. OpenSky still allows anonymous /states/all (400 credits/day). Historical /flights/* now needs an OAuth2 login ("You cannot access historical flights"), and CORS is locked to opensky-network.org.
(4) Waypoints and planned routes: FlightPlanDatabase (FPD) needs no key for search (100 requests/day per IP). Returning waypoints (includeRoute=true) needs a free key. It is licensed for flight simulation only, requires attribution, and /plan/{id} returned 502 during testing. FlightAware AeroAPI (x-apikey header, Personal tier $5 free credit/month, 10 result sets/min, non-commercial) has real filed routes: /flights/{id}/route with decoded fixes (continental US only), /airports/{id}/routes/{dest_id} with the most-filed IFR routings, and /schedules/{start}/{end}?origin=&destination= from 3 months back to 1 year ahead. US airways and fixes are free from the FAA: NASR 28-day CSV zips and the ADDS ArcGIS FeatureServer (ATS_Route, DesignatedPoint). OpenAIP needs a free key and is CC BY-NC 4.0. EUROCONTROL NM B2B is limited to operational stakeholders; the Aviation Data Repository for Research (ADRR) is free for R&D but at least 2 years delayed.
Geometry and UX: Turf greatCircle (turf 7.4.0, built on arc.js, npoints default 100, splits into a MultiLineString at the antimeridian). MapLibre's own example instead unwraps longitudes by ±360 so the line stays continuous; OSIRIS runs maplibre-gl 6.7.0, which has setProjection({type:'globe'}), line-gradient (needs lineMetrics:true) and line-dasharray. FlightAware shows the actual track as a solid line and the ATC planned route as a dashed line; Flightradar24 (FR24) colours the trail by altitude, draws a black dotted line for estimated positions, and has a progress bar plus a speed/altitude graph. Place-name resolution: Nominatim allows at most 1 request/second, requires caching and a User-Agent, and forbids autocomplete. Photon allows search-as-you-type with osm_tag=aeroway:aerodrome and CORS *, but ranks poorly ("paris" returned Paris Municipal, Arkansas first). So the main place→airport search should be a local fuzzy index over OurAirports (MiniSearch or Fuse.js).

## Findings

### 0. OSIRIS current flights implementation (baseline) (verified)

OSIRIS master branch (the repo uses master, not main) depends on maplibre-gl 6.7.0, react-map-gl ^8.1.1 and next 16.3.4. It has no turf and no deck.gl. src/app/api/flights/route.ts uses OpenSky /states/all?extended=1 (OAuth2 token from https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token) plus adsb.fi (https://opendata.adsb.fi/api/v2, paced with ADSBFI_GAP_MS=1100). Each flight object has callsign, lat, lng, alt, heading, speed_knots, model, icao24, registration, squawk and airline_code, but no origin, destination or route. A code comment says api.airplanes.live returns 403, api.adsb.lol/v2 always returns an empty ac[], and api.adsb.one returns 403. My tests on 2026-09-30 contradict the adsb.lol claim (see the adsb.lol finding).

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/flights/route.ts

### 1. OurAirports airports.csv (primary airport DB) (verified)

URL: https://davidmegginson.github.io/ourairports-data/airports.csv (12.7 MB; also runways.csv, navaids.csv, countries.csv, regions.csv, airport-frequencies.csv, airport-comments.csv). Licence (quoted): "All data is released to the Public Domain, and comes with no guarantee of accuracy or fitness for use." Update frequency (quoted): "we update every night". Headers observed: access-control-allow-origin: *, cache-control max-age=600. Columns: id, ident, type, name, latitude_deg, longitude_deg, elevation_ft, continent, iso_country, iso_region, municipality, scheduled_service, icao_code, iata_code, gps_code, local_code, home_link, wikipedia_link, keywords. My count: 86,154 lines. Types: small_airport 42,764; heliport 23,224; closed 13,548; medium_airport 4,106; seaplane_base 1,273; large_airport 1,175; balloonport 63. scheduled_service=yes: 4,335. Rows with an IATA code: 9,053. There is no timezone column.

Source: https://ourairports.com/data/

### 2. OurAirports navaids.csv / countries / regions (verified)

navaids.csv (~11,009 lines) columns: id, filename, ident, name, type (NDB/VOR/DME...), frequency_khz, latitude_deg, longitude_deg, elevation_ft, iso_country, dme_frequency_khz, dme_channel, dme_latitude_deg, dme_longitude_deg, dme_elevation_ft, slaved_variation_deg, magnetic_variation_deg, usageType, power, associated_airport. It has navaids only: no enroute fixes/waypoints and no airways. countries.csv: id, code, name, continent, wikipedia_link, keywords. regions.csv: id, code, local_code, name, continent, iso_country, wikipedia_link, keywords. runways.csv: le_/he_ ident, lat, lon and heading_degT (useful for drawing runway endpoints).

Source: https://davidmegginson.github.io/ourairports-data/navaids.csv

### 3. mwgg/Airports (timezone supplement) (verified)

https://raw.githubusercontent.com/mwgg/Airports/master/airports.json is MIT-licensed. It has ~29k entries keyed by ICAO, each with icao, iata, name, city, state, country, elevation, lat, lon and tz (IANA). Timezones come from TimeZoneDB/TimeAPI. Use it to join tz onto OurAirports and show local departure/arrival times.

Source: https://github.com/mwgg/Airports

### 4. OpenFlights airports/airlines/routes (verified)

Licence: Open Database License (ODbL). airports.dat fields: Airport ID, Name, City, Country, IATA, ICAO, Latitude, Longitude, Altitude, Timezone, DST, Tz database timezone, Type, Source. airlines.dat fields: Airline ID, Name, Alias, IATA, ICAO, Callsign, Country, Active. routes.dat fields: Airline, Airline ID, Source airport, Source airport ID, Destination airport, Destination airport ID, Codeshare, Stops, Equipment (67,663 rows). Staleness (quoted): "The third-party that OpenFlights uses for route data ceased providing updates in June 2014. The current data is of historical value only." Raw URLs: https://raw.githubusercontent.com/jpatokal/openflights/master/data/{airports,airlines,routes}.dat. airlines.dat is useful for airline IATA↔ICAO↔callsign-telephony mapping (e.g. BA↔BAW↔SPEEDBIRD).

Source: https://openflights.org/data.php

### 5. VRS standing-data routes mirrored by adsb.lol (KEY zero-key origin→destination source) (verified)

Full table: https://vrs-standing-data.adsb.lol/routes.csv.gz (application/gzip, 4,500,164 bytes, last-modified 2026-09-20, access-control-allow-origin: *). Also routes.csv, airports.csv(.gz) and LICENSE (CC0 1.0 Universal). The CSV has 620,701 lines with header Callsign,Code,Number,AirlineCode,AirportCodes, e.g. 'AAL100,AAL,100,AAL,KJFK-EGLL'. AirportCodes is hyphen-separated ICAO codes, and multi-stop routes have more than 2 codes. KJFK-EGLL matched 68 callsigns (DAL1, DAL3, AAL100, AAL104, AAL106, AAL142, BAW112, BAW114...). Per-callsign JSON: https://vrs-standing-data.adsb.lol/routes/{first 2 chars}/{CALLSIGN}.json, e.g. /routes/BA/BAW4LV.json returns {callsign, number, airline_code, airport_codes:'KLAS-EGLL', _airport_codes_iata:'LAS-LHR', _airports:[{name, icao, iata, location, countryiso2, lat, lon, alt_feet, alt_meters}]}. It is served with cache-control max-age=600. The old https://api.adsb.lol/api/0/route/{cs} returns a 302 redirect to this JSON with a '#deprecated' fragment. Callsign normalisation regex (from the schema README): ^(?<code>[A-Z]{2,3}|[A-Z][0-9]|[0-9][A-Z])(?<number>\d[A-Z0-9]*). IATA codes are swapped for ICAO, leading zeros are stripped, and the number is at most 4 characters. The data is user-submitted to the VRS SDM site, so routes are 'as last reported' with no day-of-week or date validity.

Source: https://vrs-standing-data.adsb.lol/

### 6. adsb.lol API (live positions, ODbL) (verified)

OpenAPI spec at https://api.adsb.lol/api/openapi.json (Swagger UI at /docs). Licence: ODbL 1.0. ToS (quoted): "You can use the API for free. In the future, you will require an API key which you can get by feeding to adsb.lol." Rate limits (README): "dynamic based on the environment load". GET endpoints: /v2/callsign/{cs}, /v2/hex/{hex} (alias /v2/icao), /v2/reg/{reg} (alias /v2/registration), /v2/type/{type}, /v2/sqk/{sq} (alias /v2/squawk), /v2/mil, /v2/ladd, /v2/pia, /v2/point/{lat}/{lon}/{radius} (alias /v2/lat/{lat}/lon/{lon}/dist/{r}, max 250 nm), /v2/closest/{lat}/{lon}/{radius}, /api/0/airport/{icao} (VRS airport data), /0/me, /0/my. POST /api/0/routeset takes body {planes:[{callsign,lat,lng}]}, but it returned HTTP 201 with an empty body in my tests, so treat it as non-functional. Tested live: /v2/point/51.47/-0.46/60 returned total 205, and /v2/callsign/BAW4LV,UAL901,AAL100 (comma list) returned BAW4LV. The response is ADSBx-v2 shape: ac[] with hex, flight, r, t, alt_baro, alt_geom, gs, track, baro_rate, squawk, lat, lon, nav_altitude_mcp, nav_altitude_fms, nav_heading, seen_pos, mlat[], plus now/total. No Access-Control-Allow-Origin header was returned, so it must be proxied server-side.

Source: https://api.adsb.lol/api/openapi.json

### 7. adsb.lol trace files (actual flown track, undocumented) (verified)

GET https://adsb.lol/data/traces/{last 2 hex chars}/trace_full_{hex}.json (whole day) or trace_recent_{hex}.json. Responses are gzip-encoded and returned 200 without a Referer header. There is no CORS header, so proxy it. Example: /data/traces/2c/trace_full_407f2c.json returned {icao, r, t, desc, timestamp, trace:[[secsAfterTimestamp, lat, lon, alt_ft|'ground'|null, gs_kts, track, flags, vert_rate, details|null, source, geom_alt, geom_rate, ias, roll]...]}. Flags bitfield: 1=stale, 2=start of new leg, 4=geometric vertical rate, 8=geometric altitude. This is the tar1090 web-map internal format, not a public API, and may change.

Source: https://raw.githubusercontent.com/wiedehopf/readsb/dev/README-json.md

### 8. adsb.fi open data API (verified)

Base https://opendata.adsb.fi/api/. Endpoints: /v2/hex/{hex}, /v2/icao/{hex}, /v2/callsign/{cs} (comma list works; tested), /v2/registration/{reg}, /v2/sqk/{sq}, /v2/mil, /v3/lat/{lat}/lon/{lon}/dist/{nm} (max 250 nm). /v2/snapshot is for feeders only (IP-authenticated). Limits (quoted): "The public endpoints are rate limited to 1 request per second, and the feeder endpoint to 1 request every 30 seconds." Terms (quoted): "adsb.fi open data is for personal, non-commercial use only." No CORS header was observed. The response is ADSBx v2 compatible.

Source: https://github.com/adsbfi/opendata

### 9. airplanes.live API (verified)

https://api.airplanes.live/v2/callsign/BAW123 returned HTTP 403 from this environment with the body {"error": "Please contact us at contact@airplanes.live. Your email MUST include any links, a description of the project..."}. The api-guide and api-docs pages sit behind a Cloudflare challenge or return 403. The OSIRIS source also reports 403 on every endpoint. The archived README (ADSB One, same codebase) documents the /v2/hex, callsign, reg, type, squawk, mil, ladd, pia and point/{lat}/{lon}/{radius} endpoints with a limit of 1 request per second. Treat it as unusable without a key or agreement.

Source: https://github.com/airplanes-live/api-archive/blob/main/README.md

### 10. adsbdb.com (callsign→route, aircraft) (verified)

Keyless GET endpoints; CORS access-control-allow-origin: * observed. Routes: https://api.adsbdb.com/v0/callsign/{CALLSIGN}, /v0/aircraft/{MODE_S|REGISTRATION}, /v0/aircraft/{MODE_S}?callsign={CS} (aircraft and route in one call), /v0/airline/{ICAO|IATA}, /v0/mode-s/{hex}, /v0/n-number/{N}, /v0/stats, plus random variants. Live response for BAW123: response.flightroute{callsign, callsign_icao, callsign_iata, airline{name, icao, iata, country, country_iso, callsign}, origin{country_iso_name, country_name, elevation, iata_code, icao_code, latitude, longitude, municipality, name}, destination{same}}. Some routes also include midpoint. Aircraft fields: type, icao_type, manufacturer, mode_s, registration, registered_owner*, url_photo, url_photo_thumbnail. No rate limit is documented. LICENCE CAVEAT (README, quoted): route data "may not be copied, published, or incorporated into other databases without the explicit permission of David J Taylor, Edinburgh." So use it for per-request lookups only and never bulk-cache it into a DB. Code is MIT.

Source: https://github.com/mrjackwills/adsbdb

### 11. hexdb.io (callsign→route fallback) (verified)

Keyless, CORS *. Endpoints: GET https://hexdb.io/api/v1/route/icao/{callsign} (BAW123 returned {"flight":"BAW123","route":"EGLL-OTHH","updatetime":1747593022}), /api/v1/route/iata/{callsign} (BA123 returned 404), /api/v1/airport/icao/{icao}, /api/v1/airport/iata/{iata}, /api/v1/aircraft/{hex}, and the legacy plain-text endpoint /callsign-route-iata?callsign=BAW123 (returns 'LHR-DOH'). Terms (quoted): "Please do not scrape the database"; IPs making excessive requests may be blocked. Data comes from PlaneBase/PlanePlotter, Jim Mason, Steve Hibberd, ip2location and Airport-Data.

Source: https://hexdb.io/

### 12. OpenSky Network REST API (verified)

Base https://opensky-network.org/api. Auth is the OAuth2 client_credentials flow at https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token, with Bearer tokens that live 30 minutes; basic auth is deprecated. Credits: anonymous 400/day (by IP, 10 s resolution, latest data only); authenticated 4,000/day (5 s resolution, history up to 1 h); active feeders 8,000/day; licensed users 14,400/hour. /states/all cost by area: ≤25 sq° = 1, 25–100 = 2, 100–400 = 3, >400 or global = 4. /flights/* and /tracks/* cost 4 credits for live/<24h and 30 for 1–2 day partitions, rising after that. Exhausted credits return 429 with X-Rate-Limit-Retry-After-Seconds. Endpoints: /states/all (time, icao24, lamin/lomin/lamax/lomax, extended=1; state vector has 18 fields), /flights/all (≤2 h), /flights/aircraft (≤2 days; built by a nightly batch, previous day or earlier only), /flights/arrival and /flights/departure (airport=ICAO, begin, end; previous day or earlier), /tracks/all?icao24=&time=0 (experimental; path of [time, lat, lon, baro_altitude, true_track, on_ground]; ≤30 days back). Tested anonymously: states/all bbox returned 200 with x-rate-limit-remaining: 389. flights/departure returned 403 "You cannot access historical flights" (so login is required), and tracks/all returned 404. The undocumented /routes?callsign=BAW123 worked anonymously but was stale: {route:[EGLL,OTHH], updateTime:2020-12-17}. CORS: access-control-allow-origin: https://opensky-network.org only, so server-side calls are required.

Source: https://openskynetwork.github.io/opensky-api/rest.html

### 13. FlightPlanDatabase API (waypoint plans) (verified)

Base https://api.flightplandatabase.com. Auth is HTTP Basic with the API key as username and a blank password; keys come from account settings and need a verified email. Limits are a rolling 24 h window. Observed anonymous headers: x-limit-by: IP, x-limit-cap: 100, X-Limit-Used. Keyed limits are higher and can be raised on request. Over-limit returns 429. GET /search/plans takes fromICAO, toICAO, fromName, toName, distanceMin/Max, tags, limit (default 20, max 100), page, sort=created|updated|popularity|distance, and includeRoute (true requires auth). GET /plan/{id} returns id, fromICAO, toICAO, fromName, toName, distance, maxAltitude, waypoints, likes, downloads, createdAt, updatedAt, tags, and route.nodes[] {type APT|VOR|NDB|FIX|DME|LATLON|UKN, ident, lat, lon, alt, name, via{ident, type SID|STAR|AWY-HI|AWY-LO|NAT|PACOT}}. Also /nav/airport/{icao}, /nav/NATS, /nav/PACOTS (North Atlantic and Pacific organised tracks), /search/nav?q=&types=, /weather/{icao} (METAR/TAF). The server exposes X-Limit-* via access-control-expose-headers. Terms (quoted): "for flight simulation use only and must not be used for real-world aviation"; attribution is required wherever the data is shown. Reliability: the API root returned 200, but /search/plans, /plan/1 and /nav/airport/EGLL all returned 502 during testing.

Source: https://flightplandatabase.com/dev/api

### 14. FlightAware AeroAPI (keyed upgrade: real filed routes and schedules) (verified)

Server https://aeroapi.flightaware.com/aeroapi, header x-apikey (OpenAPI spec v4.17.1 at https://flightaware.com/commercial/aeroapi/resources/aeroapi-openapi.yml). Pricing: Personal tier has $5 free per month ($10 for ADS-B feeders), no minimum, 10 result sets/minute, personal/academic use only. Standard is $100/month minimum at 5 result sets/second. Premium is $1,000/month minimum at 100 result sets/second. Sample costs: flight search $0.050, position $0.010, track $0.012, historical track $0.060, and /flights/{id}/route $0.010 per result set. Route-related endpoints: GET /flights/{id}/route returns {route_distance, fixes[{name, latitude, longitude, distance_from_origin, distance_this_leg, distance_to_destination, outbound_course, type}]}. It only decodes navaids inside the continental US (otherwise type='UNKNOWN') and covers up to 10 days back; older flights use /history/flights/{id}/route. GET /airports/{id}/routes/{dest_id}?sort_by=count|last_departure_time&max_file_age returns routes[{aircraft_types, count, filed_altitude_max, filed_altitude_min, last_departure_time, route, route_distance}] (assigned IFR routings between two airports). GET /airports/{id}/flights/to/{dest_id} covers non-stop and one-stop flights. GET /schedules/{date_start}/{date_end} takes origin, destination, airline, flight_number, include_codeshares, include_regional, max_pages and cursor. It returns scheduled[] with ident(_icao/_iata), actual_ident, aircraft_type, scheduled_out, scheduled_in, origin(_icao/_iata/_lid), destination(...), fa_flight_id and seats per cabin, from 3 months back to 1 year ahead. GET /flights/{ident} includes route (text), filed_altitude, filed_airspeed, route_distance (statute miles), progress_percent, filed_ete, and scheduled/estimated/actual out, off, on and in times. GET /flights/{id}/track returns positions.

Source: https://www.flightaware.com/commercial/aeroapi/

### 15. AeroDataBox (keyed schedules/FIDS) (verified)

RapidAPI gateway https://aerodatabox.p.rapidapi.com/ (headers X-RapidAPI-Key, X-RapidAPI-Host) or direct https://api.aerodatabox.com/ (X-Api-Key). Pricing: free RapidAPI plan with 400 units/month at 1 request/second (7-day trial wording). Paid plans run up to $200/month for 500,000 units at up to 8 requests/second. API.market plans run $7.50/month (5,000 units) to $187.50 (500,000). Tier 1 costs 1 unit, Tier 2 costs 2 and Tier 3 costs 6. FIDS window is 12 h on lower tiers and 48 h on Scale plans. Endpoints: /flights/airports/{codeType}/{code}/{fromLocal}/{toLocal} (FIDS, Tier 2; params direction, withLeg, withCancelled, withCodeshared, withCargo, withPrivate, withLocation). Filter those results by destination to get today's ORIG→DEST flights. Others: /flights/{searchBy}/{searchParam}/{dateLocal} (flight status by number, Tier 2); /airports/{codeType}/{codeFrom}/distance-time/{codeTo} (great-circle distance and estimated flight time, optional flightTimeModel=ML01, Tier 2); /airports/search/term?q= and /airports/search/location (Tier 2); /airports/{codeType}/{code}/stats/routes/daily (popular routes with daily counts, Tier 3).

Source: https://doc.aerodatabox.com/docs/openapi-rapidapi-v1.json

### 16. aviationstack (keyed) (verified)

Free plan: 100 requests/month, non-commercial, HTTPS included, real-time flights only. No historical flights, airline routes, autocomplete or future schedules on the free plan. Basic is $49.99/month for 10,000 requests; Professional $149.99 for 50,000; Business $499.99 for 250,000. Routes and schedules start at Basic; future flights start at Professional. Base https://api.aviationstack.com/v1 with the access_key query param. /flights filters include dep_iata, arr_iata and flight_iata; the other endpoints are /routes, /timetable and /flightsFuture. I could not fetch the full field list because the docs page is JS-rendered.

Source: https://aviationstack.com/pricing

### 17. AirLabs (keyed) (verified)

Routes: https://airlabs.co/api/v9/routes?api_key=… with params dep_iata/dep_icao, arr_iata/arr_icao, airline_icao/airline_iata, flight_icao/flight_iata/flight_number, limit (max 500, 50 for free keys) and offset. Returns dep/arr times (local and UTC), terminals, duration in minutes, days of operation and aircraft_icao ('Last used aircraft ICAO type on this flight'). Schedules: https://airlabs.co/api/v9/schedules?dep_iata=…, with the same filters plus _fields. Returns dep_time, dep_estimated, dep_actual, gates, terminals, arr_* fields, status, duration and delays. Quoted: "At the moment, the Schedules API returns results up to 10 hours ahead at most." Free keys are capped at 50 results. Homepage price points: 10k queries $19, 100k $99, 1M $499. The free tier's monthly quota (1,000/month per a search snippet) is UNVERIFIED on a primary page.

Source: https://airlabs.co/docs/schedules

### 18. Aviation Edge and FlightLabs (keyed, expensive) (verified)

Aviation Edge: Developer $7 first month, then $299/month for 30,000 calls. Business $15, then $599 for 100,000. Business Gold $39, then $1,499 for 500,000. All tiers include Flight Tracker, Schedules, Historical/Future Schedules, Routes, Nearby and Autocomplete. FlightLabs: Starter $249.99 (4,000 calls), Basic $499.99 (10,000), Pro $1,499.99 (100,000) and higher tiers, with a 7-day free trial. Endpoints include real-time flights, by flight number or callsign, schedules, future flights prediction and airline routes. Both are poor value compared with AeroAPI or AeroDataBox for this feature.

Source: https://aviation-edge.com/premium-api/

### 19. Jonty/airline-route-data (airport-level routes + flight time) (verified)

https://raw.githubusercontent.com/Jonty/airline-route-data/main/airline_routes.json is 22.9 MB with CORS *, 4,038 airports and 59,291 outbound routes. Keyed by IATA; each airport has city_name, continent, country, country_code, display_name, elevation, iata, icao, latitude, longitude, name, timezone and routes[{iata, km, min, carriers[{iata, name}]}]. JFK→LHR: km 5555, min 425, carriers AA, BA, DL, VS, B6. The README says it is updated weekly. The scraper pulls from https://www.flightsfrom.com. There is no LICENSE file (404), so legal status is unclear and it should only be an optional enrichment.

Source: https://github.com/Jonty/airline-route-data

### 20. FAA NASR 28-day subscription (US airways/fixes) (verified)

The page lists cycles effective 2026-10-01 and 2026-09-03. Per-cycle pages link, for example, https://nfdc.faa.gov/webContent/28DaySub/28DaySubscription_Effective_2026-09-03.zip (legacy TXT), the per-group CSVs https://nfdc.faa.gov/webContent/28DaySub/extra/03_Sep_2026_{AWY,FIX,APT,CDR,DP,...}_CSV.zip and the full CSV https://nfdc.faa.gov/webContent/28DaySub/extra/03_Sep_2026_CSV.zip, plus AIXM 5.0/5.1 zips. CDR (Coded Departure Routes) and DP are useful for US planned routings. Starting with the 3 Sept 2026 cycle there are format changes (NASR 26-01 DPN 10.1). nfdc.faa.gov returned 503 to this environment (Akamai), so the downloads are unverified here. Coverage is the US only. Public-domain status is UNVERIFIED on this page (US federal data is generally public domain).

Source: https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/

### 21. FAA ADDS ArcGIS (queryable US airways/fixes, keyless) (verified)

The ATS_Route polyline FeatureServer is https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/ATS_Route/FeatureServer/0 (maxRecordCount 2000, WKID 4269). Fields include IDENT, TYPE_CODE, LEVEL_, MEA_E_VAL, MOCA_VAL, TRUETRK, MAGTRK, LENGTH_VAL, STARTPT_ID, ENDPT_ID, US_LOW, US_HIGH and PACIFIC. Query with /query?where=IDENT='J80'&outFields=*&f=geojson. The same org also has DesignatedPoint, NavaidComponent, US_Airport, Class_Airspace, Special_Use_Airspace and more. Licence text: "The data provided is for public use."

Source: https://adds-faa.opendata.arcgis.com/datasets/faa::ats-route/about

### 22. OpenAIP (global navaids/airspaces, free key) (verified)

Core API https://api.core.openaip.net/api (spec at /api/system/specs/v1/schema.json). The key goes in the x-openaip-api-key header or the apiKey query param; create it on the profile 'API Clients' page. An unauthenticated call returned 403. Endpoints: /airports, /navaids, /reporting-points, /airspaces, /obstacles, /hotspots, /hang-glidings, /rc-airfields, /special-rules-areas (each with /{id}). There is also a tiles API at api.tiles.openaip.net. Rate limits exist on 'several endpoints' but no numbers are given; the docs ask you to cache. Attribution link to https://www.openaip.net is required. Licence: CC BY-NC 4.0 (quoted on openaip.net). It is VFR-oriented, not a source of IFR airway networks.

Source: https://api.core.openaip.net/api/system/specs/v1/schema.json

### 23. EUROCONTROL access (verified)

NM B2B (quoted): "available mainly to air navigation service providers (ANSP), aircraft operators (AO), airports, ground handling agents, computerised flight plan service providers (CFSP) and airspace management cells (AMC)". Access needs a certificate: the first two per location are free, then €200 each. It provides AIP data (Points, Routes, Aerodromes, Airspaces) in AIXM 5.1.1 and flight-plan services. It is not realistic for OSIRIS. The Aviation Data Repository for Research (ADRR) is free for R&D after OneSky Online registration. It has flight plans and actual trajectories from March 2015 with at least a 2-year delay (search-snippet level only; page not fetched).

Source: https://www.eurocontrol.int/service/network-manager-business-business-b2b-web-services

### 24. Turf.js great circle / along / nearestPointOnLine (verified)

@turf/turf latest is 7.4.0 (MIT). @turf/great-circle depends on 'arc' (arc.js). Signature greatCircle(start, end, {properties, npoints=100, offset=10}) returns Feature<LineString|MultiLineString>. Quoted: "If the start and end points span the antimeridian, the resulting feature will be split into a MultiLineString." along(line, distance, {units}) returns a Point. nearestPointOnLine(lines, pt, {units}) uses new property names as of v7.4: lineStringIndex, segmentIndex, totalDistance (was location), lineDistance, segmentDistance, pointDistance (was dist). The old names keep working until the next major release. Use totalDistance for distance flown and pointDistance for cross-track distance.

Source: https://raw.githubusercontent.com/Turfjs/turf/master/packages/turf-nearest-point-on-line/README.md

### 25. MapLibre rendering: antimeridian, globe, gradient/dashed lines (verified)

maplibre-gl latest is 6.11.2 (OSIRIS pins 6.7.0). The official example 'display-line-that-crosses-180th-meridian' does not split the line: it shifts longitudes by ±360 so the LineString is continuous. For a line built from many great-circle points, unwrap each point so |lon[i]-lon[i-1]| < 180. Globe: map.setProjection({type:'globe'}). line-gradient only works with GeoJSON sources that have lineMetrics:true and uses the ['line-progress'] expression; it can be combined with line-dasharray (example 'create-a-gradient-dashed-line-using-an-expression'). Also relevant: examples 'animate-a-point-along-a-route' and 'animate-a-line'. deck.gl is an alternative: ArcLayer has greatCircle:true (LNGLAT only), numSegments (default 50), getHeight, getTilt and getSourceColor/getTargetColor, which gives 3D arcs; OSIRIS does not currently depend on deck.gl.

Source: https://maplibre.org/maplibre-gl-js/docs/examples/display-line-that-crosses-180th-meridian/

### 26. FlightAware planned-vs-actual UX (verified)

FAQ (quoted): "The solid line displayed on a FlightAware map is a connected series of points between every position report received for that aircraft. Generally, we receive a position every 15-60 seconds. The dashed line is the planned route of flight per air traffic control." When the position is uncertain, it uses 'various airplane icons, radius circles and white lines (as opposed to a solid line)'. Forum threads describe the planned route as dashed blue lines.

Source: https://www.flightaware.com/about/faq

### 27. Flightradar24 trail UX (verified)

The trail colour encodes altitude: white below 100 m/300 ft; yellow above 100 m/300 ft; then green to light blue as altitude increases; dark blue, purple and red at the highest altitudes (above 6,000 m/19,700 ft). Quoted: "A black dotted line means the aircraft is outside our coverage area and its position is being estimated." A FR24 tweet (via search snippet) says out-of-coverage estimates are based on great-circle routes to the destination. The flight info panel has a progress bar (time and distance elapsed and remaining) and a speed and altitude graph; that part comes from search snippets because the FR24 blog returned 403 (UNVERIFIED on the primary page).

Source: https://support.fr24.com/support/solutions/articles/3000115027-why-does-the-aircraft-s-trail-change-colour-

### 28. Nominatim usage policy (verified)

Absolute maximum of 1 request/second. You must send a valid HTTP Referer or User-Agent identifying the app. Quoted: "Results must be cached on your side". Auto-complete search is NOT allowed, and neither are systematic or grid queries, scraping or reselling. Bulk jobs must be single-threaded, and scripts running longer than a day are limited to 4 requests/minute. ODbL attribution is required. For heavy use, self-host. Tested: search?q=heathrow+airport&format=jsonv2 returned category 'aeroway', type 'aerodrome', with lat/lon and a boundingbox.

Source: https://operations.osmfoundation.org/policies/nominatim/

### 29. Photon (komoot) geocoder (verified)

Public server https://photon.komoot.io, Apache-2.0, supports search-as-you-type and typo tolerance, returns GeoJSON. Terms (quoted): "You are welcome to use the API for your project as long as the number of requests stay in a reasonable limit. Extensive usage will be throttled or completely banned." Tested /api/?q=paris&osm_tag=aeroway:aerodrome&limit=3 with Access-Control-Allow-Origin: *. Results in order: Paris Municipal Airport (US), Aéroport de Paris-Orly, Paris-Le Bourget. CDG was not in the top 3, so re-rank the results against OurAirports type and scheduled_service.

Source: https://github.com/komoot/photon

### 30. Local fuzzy search libraries (verified)

npm latest versions: minisearch 7.2.0 (MIT), fuse.js 7.5.0 (Apache-2.0), flexsearch 0.8.212 (Apache-2.0), arc 1.0.0 (BSD). Index OurAirports iata_code, icao_code, ident, gps_code, name, municipality, keywords (e.g. 'LON, London' style metro aliases) and iso_country/region names.

Source: https://registry.npmjs.org/minisearch/latest

## Recommendations

- (1) AIRPORT LOOKUP (primary, zero-key): at build time or on the first server request, download OurAirports airports.csv plus countries.csv and regions.csv, and join tz from mwgg/Airports on ICAO/ident. Keep only types large_airport, medium_airport and small_airport, plus any row with an IATA code (about 15–20k rows), and serve a compact JSON (~1–2 MB gz) from /api/airports, revalidated every 24 h. Resolve input in this order: exact 3-letter match on iata_code; exact 4-letter match on icao_code, then gps_code, then ident; otherwise a MiniSearch fuzzy query over name, municipality, keywords and country/region name. Rank by boosts: large_airport +3, medium +2, scheduled_service=yes +3, has IATA +1, exact municipality match +2. Metro-area queries such as 'London' or 'New York' return a group (LHR/LGW/STN/LTN/LCY/SEN; JFK/EWR/LGA). Fallback for a free-text place with no airport match: Photon (osm_tag=aeroway:aerodrome, debounced 300 ms, called through a server proxy). If Photon also fails, geocode the city with Nominatim (1 request/second, cached, custom UA) and pick the nearest large or medium airports within 150 km with scheduled service. Never use Nominatim for autocomplete.
- (2) GENERIC ROUTE A→B (zero-key): always draw the great-circle geodesic. Generate 128–256 points with arc.js or Turf greatCircle, then UNWRAP longitudes (MapLibre ±360 technique) instead of using the MultiLineString split, so the line renders continuously in both Mercator and globe. Show distance (km/nm), initial bearing, and an estimated block time: distance/780 km/h + 30 min, or the km/min values from Jonty data when present. Overlay KNOWN SERVICES: build a reverse index from the VRS routes.csv.gz (CC0, refreshed weekly by a server cron) mapping 'ORIG-DEST' to callsigns and airline. That lists every known flight number on the pair (e.g. KJFK-EGLL has 68 callsigns) and joins airlines.dat names and logos. Also match multi-stop routes where A and B appear in order. Optional planned-waypoint layer: FlightPlanDatabase /search/plans?fromICAO&toICAO&sort=popularity, then /plan/{id}. Label it 'Sim-community plan (FlightPlanDatabase)', add attribution, disclaim that it is not for real-world navigation, cache aggressively (100 requests/day anonymous), and degrade gracefully on 502. Include /nav/NATS and /nav/PACOTS as optional oceanic-track overlays. US pairs: optionally overlay FAA ADDS ATS_Route polylines (J/Q/V/T airways) near the corridor.
- (3) SPECIFIC FLIGHT (callsign or flight number to route plus live position): normalise input with the VRS regex. IATA flight numbers such as 'BA123' convert to ICAO callsigns such as 'BAW123' via airlines.dat. Route lookup chain, all server-side and cached 6–24 h: VRS per-callsign JSON (vrs-standing-data.adsb.lol/routes/{cs[0:2]}/{CS}.json, CC0), then adsbdb /v0/callsign/{CS} (runtime only; do not persist because of the licence), then hexdb.io /api/v1/route/icao/{CS}, then OpenSky /routes?callsign= (stale). Live position: reuse the OSIRIS global flights feed first (it already holds ~12.9k aircraft keyed by callsign/icao24). Otherwise call adsb.lol /v2/callsign/{CS} (comma lists supported), falling back to adsb.fi /v2/callsign/{CS} (1 request/second, non-commercial). Flown track: adsb.lol /data/traces/{hex[-2:]}/trace_full_{hex}.json (undocumented; wrap it in try/fallback), else OpenSky /tracks/all?icao24&time=0 with OAuth. Enrich the aircraft with adsbdb /v0/aircraft/{hex} (type, registration, owner, photo).
- (4) SCHEDULES (which flights fly A→B today, with times): the zero-key default is 'known callsigns' from the VRS index. Show them as 'reported to operate this route' without times, and mark each LIVE if the callsign is currently airborne in the ADS-B feed. Optional keyed upgrades, auto-enabled by env var: AEROAPI_KEY (FlightAware /schedules/{d1}/{d2}?origin=&destination= for timetables, /airports/{o}/routes/{d} for the most-filed real IFR route strings, /flights/{id}/route for decoded fixes (US only), and filed_altitude/route_distance/progress_percent); AERODATABOX_KEY (FIDS departures filtered by arrival airport, distance-time ML01, stats/routes/daily); AIRLABS_KEY (schedules up to 10 h ahead, routes with days-of-week). Do not use aviationstack's free tier (100 requests/month, no routes or schedules).
- LIVE AIRCRAFT BETWEEN TWO AIRPORTS (algorithm): (a) take the candidate callsign set from the VRS index for A→B (and optionally B→A); (b) intersect it with the live feed, or batch-query adsb.lol /v2/callsign/{cs1,cs2,...}; (c) as a fallback for unknown callsigns, keep aircraft whose cross-track distance to the great circle is under 100 km (Turf nearestPointOnLine pointDistance), whose track is within ±35° of the local route bearing, whose altitude is above 8,000 ft, and whose along-track fraction is 0.02–0.98; flag these 'inferred'. For each aircraft, progress = totalDistance/routeLength; remaining = routeLength − totalDistance; ETA = now + remaining/(gs_kts × 1.852) h, blended toward 480 kt cruise when gs is under 200 kt or the aircraft is climbing or descending, plus about 10 min for approach. Show the result as a percentage progress bar and local ETA using the destination tz.
- VISUAL SPEC (a better take on FlightAware and FR24, OSIRIS gold/near-black theme): planned great circle as a dashed line (line-dasharray [2,2], gold #D4AF37 at 60% opacity, width 1.5–2) with a faint glow underlay (width 6, blur 4, 15% opacity). FPD or AeroAPI waypoint route as a dotted cyan line with small diamond markers and ident labels at zoom ≥5. Flown track as a SOLID line with line-gradient keyed to altitude (FR24-style ramp: white <300 ft, yellow, green, cyan, blue, purple, red >19,700 ft). Because line-gradient uses line-progress rather than a data value, precompute the altitude-to-progress stops, or render the track as short segments with a data-driven line-color. Remaining leg from the aircraft to the destination as a dashed line. Airport markers are pulsing rings with IATA labels. The aircraft icon rotates with track, animated by interpolating between polls. In 3D globe mode, optionally add a deck.gl ArcLayer (greatCircle:true, getHeight 0.3) for a 'flight arc' look. Side panel: origin→destination header with IATA, city, local times and timezone; distance; progress bar; an altitude and speed profile chart using lightweight-charts (already an OSIRIS dependency), with the flown profile solid and a typical-profile ghost (climb about 2,000 ft/min to FL350, descent 3:1) dashed; a list of known flight numbers with LIVE badges; source badges and attribution.
- API SURFACE to add under /api/flightpath (Next.js route handlers, all server-side because adsb.lol, adsb.fi and OpenSky send no usable CORS): GET /api/flightpath/airports?q= (local search); GET /api/flightpath/route?from=&to= (great circle, stats, known callsigns, live matches, optional FPD plan); GET /api/flightpath/flight?callsign= or ?flight= (route, live state, trace, aircraft). Cache in memory with an LRU and s-maxage: routes 24 h, callsign routes 6 h, live 10–15 s, traces 30 s. Respect 1 request/second pacing for adsb.fi and Nominatim. Add env keys FPD_API_KEY, AEROAPI_KEY, AERODATABOX_KEY, AIRLABS_KEY and OPENAIP_API_KEY, all optional with graceful degradation. Add a keyboard shortcut ('P' for Paths), a left-rail AVIATION sub-toggle 'Flight Paths', and deep-link URL params ?from=JFK&to=LHR or ?flight=BA117.
- COMPLIANCE: show attribution for OurAirports (public domain), VRS standing-data (CC0), adsb.lol (ODbL: share-alike on any redistributed DB), adsb.fi (non-commercial), FlightPlanDatabase (attribution; sim-only disclaimer), OpenAIP (CC BY-NC 4.0), OpenFlights (ODbL) and OSM/Nominatim/Photon (ODbL). Do not bulk-store adsbdb route data. Treat Jonty/airline-route-data (no licence, scraped from flightsfrom.com) as opt-in only.

## Gaps (not verified)

- FlightPlanDatabase: the exact anonymous vs keyed daily caps are only partly known (anonymous x-limit-cap 100 by IP was observed; the keyed cap is not published). /search/plans and /plan/{id} returned 502 during testing, so the live response shape was not confirmed beyond the docs. Whether Access-Control-Allow-Origin is sent was not confirmed.
- adsb.lol POST /api/0/routeset returned 201 with an empty body. Unclear whether it is deprecated or needs other input. Its dynamic rate-limit thresholds are unpublished.
- adsbdb and hexdb.io: numeric rate limits are not documented.
- airplanes.live: current terms and rate limit could not be read (Cloudflare challenge or 403). The API returned 403 with a 'contact us' message from this environment's IP.
- OpenSky: the /flights/departure and /flights/arrival response schemas (estDepartureAirport, estArrivalAirport, firstSeen, lastSeen, etc.) were not re-read from the docs page. Anonymous access to them is now refused ('You cannot access historical flights'). /tracks/all anonymous returned 404 for the tested hex.
- FAA NASR: nfdc.faa.gov downloads returned 503 to this environment, so the zip contents and the public-domain statement were not verified directly.
- OpenAIP: numeric rate limits are not published.
- AirLabs: exact free-tier monthly quota and commercial-use terms. The pricing page is JS-templated or 404; the '1,000 calls/month free' figure comes only from a search snippet (UNVERIFIED).
- aviationstack: full response field list (the docs page is JS-rendered).
- FlightLabs pricing was read from the homepage; the /pricing URL returned 404.
- Flightradar24: panel details (progress bar, speed/altitude graph) and the 'red dashed great circle' blog claim come from search snippets; the FR24 blog and X returned 403/402. Their official paid API (fr24api.flightradar24.com) pricing could not be read.
- Jonty/airline-route-data: last commit date not retrieved. Licence is absent (LICENSE file returns 404).
- No free, global, licence-clean source of real filed IFR flight plans or airway networks exists. Real planned routes outside the US need paid AeroAPI (and even then fix decoding is continental US only) or EUROCONTROL research data with a 2-year delay. Global airway data (Navigraph, X-Plane earth_awy.dat) is licence-restricted and was not evaluated.
