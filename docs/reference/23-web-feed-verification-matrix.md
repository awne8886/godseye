# Per-layer upstream verification matrix (keyless vs keyed, CORS, terms)
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.

## Summary

I checked keyless and free-key upstream sources for every OSIRIS layer by calling the live endpoints on 2026-09-30 (curl with an Origin header, so CORS results come from real responses) and reading the official docs. Most layers still have a working source that needs no key. Several went away or changed auth in 2025-2026, and any build prompt should warn about these:
- **airplanes.live**: now answers HTTP 403 with "Please contact us at contact@airplanes.live". Its api-archive repo was archived on 2026-04-29.
- **OpenSky**: accepts OAuth2 client-credentials only. Basic auth ended on 2026-03-18. Its terms require a written licence for any "operational REST API use … in a live product" and for any for-profit user.
- **UCDP**: the API now returns 401 without an `x-ucdp-access-token`. Tokens are granted by email.
- **ACLED**: login is OAuth with a password grant. The free "Open" tier gives only aggregated data; event-level data needs the Research tier, which is lagged 12 months.
- **GDELT**: the GEO 2.0 API returns 404 (treat it as gone). The DOC 2.0 API returns 429 above one request every 5 seconds. The raw 15-minute files still work.
- **abuse.ch**: an Auth-Key has been mandatory for all APIs since 2025-06-30. The bulk JSON/CSV downloads still work without one.
- **RainViewer**: since 2026-01-01 there is no nowcast and no satellite IR, only the Universal Blue colour scheme, max zoom 7, and 100 requests per IP per minute.
- **NOAA SWPC**: `/products/solar-wind/*` now returns 404; solar wind moved to `/json/rtsw/`. The K-index JSON changed from arrays to objects.
- **CelesTrak**: the default format has been CSV since 2026-05-09, so always pass `FORMAT=json`.
- **Stooq**: needs an API key since about March 2026.
- **CoinCap**: v2 is dead and v3 needs a key.
- **Binance**: `api.binance.com` returns 451 from US IPs; `data-api.binance.vision` works.
- **ipapi.co**: returns 403 without a key and its free tier is now a signup trial.
- **Yahoo Finance**: v7 quote is Unauthorized; only the v8 chart endpoint works.

These sources can be called straight from the browser (they send `Access-Control-Allow-Origin: *`): NOAA SWPC, USGS, EONET, NWS, Open-Meteo, RainViewer, NASA GIBS, CelesTrak, wheretheiss.at, DeepStateMap, ISW ArcGIS, INFORM, World Bank, Wikidata SPARQL, TfL JamCams, Caltrans CWWP2, the Copernicus and Planetary Computer STAC APIs, EOX, CoinGecko, binance.vision, Coinbase, NVD, Shodan InternetDB, cve.circl.lu, dns.google, rdap.org, crt.sh, ip-api (HTTP only), ipwho.is, XposedOrNot, the OpenSanctions bulk files, the GDELT files, OurAirports, Natural Earth, IODA and ArcGIS search.

These need a server proxy because they send no CORS header or restrict it: adsb.lol, adsb.fi, OpenSky, the FIRMS CSVs, gpsjam, Yahoo, the submarine-cable map, the abuse.ch downloads, CISA KEV, most RSS feeds (NYT and DW are the exceptions), and Telegram `t.me/s`. AISStream explicitly forbids direct browser connections.

For the planned flight-path feature, the keyless pieces are:
- OurAirports CSVs: public domain, nightly, CORS `*`.
- adsbdb: callsign to origin/destination with coordinates.
- vradarserver standing-data: callsign to airport-pair CSVs.
- adsb.lol `/api/0/routeset`.
- FAA preferred-routes CSV: US only.
- Great-circle geometry computed in the app.

The real filed or planned waypoint route needs the paid FlightAware AeroAPI: `/flights/{id}/route` returns fixes with lat/lon, and `/airports/{id}/routes/{dest_id}` returns "assigned IFR routings between two airports". Flight Plan Database is a sim-only fallback (100 unauthenticated requests per day; returned 502 in testing).

Legally risky sources: OpenSky (licence needed for live products), airplanes.live (contact-gated), adsb.fi (personal non-commercial only), Insecam (exclude), Liveuamap (blocks automated access), DeepStateMap (no proxying or redistributing its API; commercial use needs approval), Telegram (ToS bans scraping for AI/ML use), TeleGeography (CC BY-NC-SA), OpenSanctions (CC BY-NC), and Yahoo (unofficial API).

## Findings

### 0. Flights: adsb.lol API (primary keyless ADS-B) (verified)

Base https://api.adsb.lol. Paths from OpenAPI: /v2/pia, /v2/mil, /v2/ladd, /v2/sqk/{squawk} (alias /v2/squawk), /v2/type/{type}, /v2/reg/{reg} (alias /v2/registration), /v2/icao/{hex} (alias /v2/hex), /v2/callsign/{cs}, /v2/lat/{lat}/lon/{lon}/dist/{nm} and /v2/point/{lat}/{lon}/{nm} (max 250 nm), /v2/closest/{lat}/{lon}/{nm}, /api/0/airport/{icao}, POST /api/0/routeset with body {planes:[{callsign,lat,lng}]} (returned 201 with an empty body in the test), /0/me, /0/my. There is no public all-world endpoint; the global feed (re-api) is for feeders only. Terms: free to use now, 'In the future, you will require an API key which you can get by feeding'; contact them before production use. Licence ODbL 1.0. Response is {ac:[...], msg, now, total, ctime, ptime}. Aircraft fields include hex, flight, r, t, lat, lon, alt_baro, alt_geom, gs, track, squawk, emergency, category, dbFlags, nic, nac_p, nac_v, sil, sda, gva, nav_modes, mlat, tisb, seen, rssi, lastPosition. /v2/mil returned 443 aircraft live. No Access-Control-Allow-Origin header, so proxy it server-side.

Source: https://api.adsb.lol/api/openapi.json

### 1. Flights: adsb.fi open data (verified)

Base https://opendata.adsb.fi/api/. Endpoints: /v2/hex/{hex}, /v2/icao/{hex}, /v2/callsign/{cs}, /v2/registration/{reg}, /v2/sqk/{squawk}, /v2/mil, /v3/lat/{lat}/lon/{lon}/dist/{nm} (max 250 NM). /v2/snapshot (all aircraft) is for feeder IPs only. Rate limits: 1 request/s public, 1 per 30 s for feeder endpoints. Repeated 4xx responses trigger a temporary IP ban. Terms: 'personal, non-commercial use only'; must cite adsb.fi and link to it. Response format is ADSBx v2 compatible. Live /v2/mil returned 200 with no CORS header, so a proxy is needed.

Source: https://github.com/adsbfi/opendata

### 2. Flights: airplanes.live is now contact-gated (RISK) (verified)

GET https://api.airplanes.live/v2/mil returned HTTP 403 with JSON {"error":"Please contact us at contact@airplanes.live. Your email MUST include any links, a description of the project..."}. The docs pages (airplanes.live/api-guide, /api-docs) are behind a Cloudflare JS challenge. The GitHub repo airplanes-live/api-archive was archived (read-only) on 2026-04-29. A third-party evaluation dated 2026-09-18 reports the same 403 and no CORS headers. The api.adsb.one mirror also returns 403. Do not use it as a default source.

Source: https://github.com/vasilyevstan/LiveTrafficStan/issues/6

### 3. Flights: OpenSky Network auth, limits and licence (RISK) (verified)

Auth is OAuth2 client credentials only. Token URL: https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token. Tokens last 30 minutes. Basic auth has been retired since 2026-03-18 (per search results / python README). Daily credits: anonymous 400 at 10 s resolution; standard user 4,000 at 5 s; active feeder (≥30% uptime) 8,000; licensed 14,400 per hour. A bbox query costs 1–4 credits. Endpoints: /states/all, /states/own, /flights/all (max 2 h window), /flights/departure and /flights/arrival (max 2 days, batch-updated nightly so only the previous day is available), /tracks (max 30 days back). Live anonymous /flights/departure returned 403; /states/all returned 200 with x-rate-limit-remaining and Access-Control-Allow-Origin fixed to https://opensky-network.org, so browsers need a proxy. Terms of Use: 'Any use by a for-profit or commercial entity … requires a written license' and 'Use of the REST API in any operational capacity — including integration into a live product, service, or automated system (even if only internal) — requires a previous written agreement, even for non-profit'. Academic use requires citing Schäfer et al. (IPSN 2014).

Source: https://opensky-network.org/about/terms-of-use

### 4. Flights: ADS-B Exchange (paid) (verified)

No free or keyless tier. RapidAPI Community plan costs $10/month for 10,000 requests and is non-commercial only. Commercial use and history need the Enterprise product. Data is advertised as 'unfiltered'. The api-lite URL now redirects to /community/developer-hub/.

Source: https://www.adsbexchange.com/community/developer-hub/

### 5. Flight routes: adsbdb (callsign → origin/destination) (verified)

GET https://api.adsbdb.com/v0/callsign/BAW283 returned 200 keyless: {response:{flightroute:{callsign, callsign_iata, airline{name,icao,iata,country,callsign}, origin{icao_code,iata_code,name,municipality,latitude,longitude,elevation,country_iso_name}, destination{...}}}}. Other endpoints: /v0/aircraft/{modeS|registration}, /v0/airline/{icao|iata}, /v0/mode-s/{hex}, /v0/n-number/{n}, /v0/stats. Code is MIT-licensed. Route data comes from David Taylor and Jim Mason; aircraft data from PlaneBase. Rate limits are not documented. CORS not checked.

Source: https://github.com/mrjackwills/adsbdb

### 6. Flight routes: VRS standing-data (static callsign→airport-pair CSVs) (verified)

Keyless CSV per airline: https://raw.githubusercontent.com/vradarserver/standing-data/main/routes/schema-01/{FirstLetter}/{AIRLINE}-all.csv. Columns: Callsign, Code, Number, AirlineCode, AirportCodes (e.g. 'BAW1,BAW,1,BAW,EGLL-KJFK'). Multi-leg routes are joined with '-'. Licence not checked.

Source: https://raw.githubusercontent.com/vradarserver/standing-data/main/routes/schema-01/B/BAW-all.csv

### 7. Airports: OurAirports CSVs (airport-code lookup for route feature) (verified)

https://davidmegginson.github.io/ourairports-data/{airports,runways,navaids,countries,regions,airport-frequencies}.csv. airports.csv is 12.7 MB. Updated nightly (last update 2026-09-30). Public Domain. Fields: ident, type, name, latitude_deg, longitude_deg, iata_code, icao_code, gps_code, municipality, iso_country. Served with Access-Control-Allow-Origin: *.

Source: https://ourairports.com/data/

### 8. Flight routes: FAA Preferred IFR Routes (US only, keyless) (verified)

https://www.fly.faa.gov/rmt/data_file/prefroutes_db.csv returned 200. Header: Orig, Route String, Dest, Hours1, Hours2, Hours3, Type, Area, Altitude, Aircraft, Direction, Seq, DCNTR, ACNTR. Route strings name airways and fixes; plotting them needs fix coordinates, which navaids.csv only partly covers.

Source: https://www.fly.faa.gov/rmt/data_file/prefroutes_db.csv

### 9. Flight routes: FlightAware AeroAPI (paid; real filed waypoint routes) (verified)

Auth header x-apikey. From the OpenAPI spec: '/flights/{id}/route' returns route_distance and fixes[] with name, latitude, longitude, etc.; '/flights/{id}/track'; '/flights/{id}/map'; '/airports/{id}/routes/{dest_id}' 'Returns information about assigned IFR routings between two airports'; '/schedules/{date_start}/{date_end}'. Data is available for up to 10 days back; older needs the historical endpoints. Pricing is per query and was not checked.

Source: https://www.flightaware.com/commercial/aeroapi/resources/aeroapi-openapi.yml

### 10. Flight routes: Flight Plan Database (sim-only fallback) (verified)

Base https://api.flightplandatabase.com. API key via HTTP Basic (key as username) is optional. Unauthenticated limit: 100 requests per 24 h. Endpoints: GET /search/plans?fromICAO=&toICAO=, GET /plan/{id} (route nodes with lat/lon/ident/type), POST /auto/generate (key required), GET /nav/airport/{ICAO}, GET /weather/{ICAO}. Terms: 'for flight simulation use only and must not be used for real-world aviation'; attribution and a disclaimer are required. Live search returned HTTP 502 twice, so it is unreliable.

Source: https://flightplandatabase.com/dev/api

### 11. Flights: AviationStack free tier (verified)

Free plan: 100 requests per month, HTTPS included, non-commercial only.

Source: https://aviationstack.com/pricing

### 12. Satellites: CelesTrak GP (verified)

URL format https://celestrak.org/NORAD/elements/gp.php?{GROUP|CATNR|INTDES|NAME|SPECIAL}=value&FORMAT={TLE|3LE|2LE|XML|KVN|JSON|JSON-PRETTY|CSV}. Default format has been CSV since 2026-05-09, so always pass FORMAT=json. Groups include stations, active, starlink, visual, gps-ops, weather, geo, etc. Data updates every 2 h. For Active and Starlink, at most one download per update is enforced. 50 HTTP 301/403/404 errors in 2 h gets the IP firewalled, as does more than 100 MB/day per IP. JSON fields: OBJECT_NAME, OBJECT_ID, NORAD_CAT_ID, EPOCH, MEAN_MOTION, ECCENTRICITY, INCLINATION, RA_OF_ASC_NODE, ARG_OF_PERICENTER, MEAN_ANOMALY, BSTAR. Live: Access-Control-Allow-Origin: *; GROUP=active JSON is about 6.99 MB. Cache server-side for 2 h and propagate with satellite.js (SGP4) in the client.

Source: https://celestrak.org/NORAD/documentation/gp-data-formats.php

### 13. Satellites: N2YO (free key) (verified)

Base https://api.n2yo.com/rest/v1/satellite/ with &apiKey=. Hourly limits: tle 1000, positions 1000, visualpasses 100, radiopasses 100, above 100. Register for a free key.

Source: https://www.n2yo.com/api/

### 14. ISS position: wheretheiss.at and open-notify (verified)

https://api.wheretheiss.at/v1/satellites/25544 (plus /positions, /tles, /coordinates/{lat,lon}) needs no key. Live headers: X-Rate-Limit-Limit 350 per 5-minute interval; Access-Control-Allow-Origin: *. Fields: latitude, longitude, altitude, velocity, visibility, footprint, timestamp. Alternative: http://api.open-notify.org/iss-now.json, which is HTTP only and sends ACAO *.

Source: https://wheretheiss.at/w/developer

### 15. Live from Space video (ISS) (verified)

Official video: YouTube awQzjn72bI0, 'Live High-Definition Views from the International Space Station (Official NASA Stream)', author NASA (checked via oEmbed). Warning: z9DLawplyEs has the title 'Live Video from the ISS (Official NASA Stream)' but its oEmbed author is 'Technical Talk India', a re-streamer, so do not use it. A stable alternative is the channel embed https://www.youtube.com/embed/live_stream?channel=<NASA channel id>.

Source: https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=awQzjn72bI0&format=json

### 16. Space weather: NOAA SWPC JSON (breaking changes) (verified)

Working keyless endpoints (all ACAO *, cache max-age=60):
- /products/noaa-planetary-k-index.json — now an array of objects {time_tag,Kp,a_running,station_count}, no longer array-of-arrays
- /products/noaa-planetary-k-index-forecast.json
- /products/alerts.json — {product_id, issue_datetime, message}
- /products/noaa-scales.json — R/S/G scales
- /products/kyoto-dst.json
- /products/10cm-flux-30-day.json
- /json/goes/primary/xrays-{6-hour,1-day,3-day,7-day}.json — {time_tag, satellite, flux, energy '0.05-0.4nm'/'0.1-0.8nm'}
- /json/ovation_aurora_latest.json
- /json/planetary_k_index_1m.json
- /json/solar_regions.json
- /json/rtsw/rtsw_wind_1m.json — proton_speed, proton_density, proton_temperature
- /json/rtsw/rtsw_mag_1m.json

BREAKING: https://services.swpc.noaa.gov/products/solar-wind/ (plasma-7-day.json, mag-7-day.json) now returns 404; use /json/rtsw/ instead. Public domain (US federal).

Source: https://services.swpc.noaa.gov/products/

### 17. Earthquakes: USGS GeoJSON feeds (verified)

https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{significant|4.5|2.5|1.0|all}_{hour|day|week|month}.geojson. Updated every minute. Properties: mag, place, time, updated, tsunami, alert, sig, url, magType, nst, rms, gap. Depth is coordinates[2]. Live: ACAO *, cache max-age=60. Public domain.

Source: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php

### 18. Fires: NASA FIRMS keyless global CSVs (verified)

No key needed (live 200):
- https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv
- .../noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv
- .../noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv
- .../modis-c6.1/csv/MODIS_C6_1_Global_24h.csv

VIIRS columns: latitude, longitude, bright_ti4, scan, track, acq_date, acq_time, satellite, confidence, version, bright_ti5, frp, daynight. MODIS uses brightness and bright_t31 instead. Last-Modified headers were about 1 h old, so they refresh roughly hourly. No CORS header, so proxy them. The _48h/_7d variants follow the same pattern but were not tested.

Source: https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv

### 19. Fires: NASA FIRMS Area API (free MAP_KEY) (verified)

URL: /api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north|world}/{DAY_RANGE 1-5}[/{YYYY-MM-DD}]. Sources: VIIRS_SNPP_NRT, VIIRS_NOAA20_NRT, VIIRS_NOAA21_NRT, MODIS_NRT, LANDSAT_NRT (US/Canada only). Limit: 5000 transactions per 10 minutes; large requests use several transactions. The MAP_KEY is free to request.

Source: https://firms.modaps.eosdis.nasa.gov/api/area/

### 20. Natural events: NASA EONET v3 (verified)

Endpoints: https://eonet.gsfc.nasa.gov/api/v3/events, /events/geojson, /categories, /sources, /layers, /magnitudes. Parameters: status=open|closed|all, limit, days, start, end, bbox, category, source, magID, magMin, magMax. No key. Live: ACAO *. The response Content-Type header says application/rss+xml but the body is JSON, so parse it explicitly. Fields: id, title, closed (null means ongoing), categories[], sources[], geometry[] with magnitudeValue, magnitudeUnit, date, type, coordinates.

Source: https://eonet.gsfc.nasa.gov/docs/v3

### 21. Weather alerts: NWS API (US only) (verified)

https://api.weather.gov/alerts/active with area=, zone=, point=lat,lon. A User-Agent header is required. Rate limits are undisclosed; retry after about 5 s. Formats: GeoJSON by default, plus JSON-LD, CAP and ATOM via Accept. Live: ACAO *. The 'limit' parameter is rejected with 400 'Query parameter "limit" is not recognized'.

Source: https://www.weather.gov/documentation/services-web-api

### 22. Weather/air quality: Open-Meteo (verified)

Forecast https://api.open-meteo.com/v1/forecast is keyless with ACAO *. Free tier is non-commercial only: under 10,000 calls/day, 5,000/hour, 600/minute. Licence CC BY 4.0, attribution required. Ad-supported or commercial sites need a paid plan. Air quality: https://air-quality-api.open-meteo.com/v1/air-quality?current=pm2_5,us_aqi — timed out and hit a TLS error from this test environment, so availability is not confirmed.

Source: https://open-meteo.com/en/terms

### 23. Radar: RainViewer (degraded 2026) (verified)

Index: https://api.rainviewer.com/public/weather-maps.json (ACAO *). Tiles: {host}{path}/{256|512}/{z}/{x}/{y}/{color}/{options}.png. Transition timeline:
- 2025-08-01: processed images removed
- 2025-09-01: composites removed for free users
- 2025-12-31: Weather Radar Database API ended
- 2026-01-01: nowcast removed, satellite IR removed, only the Universal Blue colour scheme, max zoom 7, 100 requests/IP/minute

Live JSON confirms nowcast:[] and satellite.infrared:[]. Personal/educational use only, with a link to rainviewer.com. LibreWXR is a self-hostable drop-in replacement.

Source: https://www.rainviewer.com/api/transition-faq.html

### 24. Imagery: NASA GIBS WMTS (keyless) (verified)

Example: https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/{YYYY-MM-DD}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg returned 200 with ACAO *. VIIRS_Black_Marble (2016-01-01, Level8, png) also returned 200. NASA open data.

Source: https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/2026-09-29/GoogleMapsCompatible_Level9/3/3/4.jpg

### 25. Air quality: OpenAQ v3 (free key) and WAQI (token) (verified)

OpenAQ v3 needs a key in the X-API-Key header (register at explore.openaq.org). Limits: 60/minute and 2,000/hour; 429 when exceeded, and repeated abuse can lead to a ban. Headers: x-ratelimit-limit/used/remaining/reset. WAQI needs a token; the token=demo works for /feed/here/ (ACAO *). Quota: 1,000 requests/second. Terms: no paid apps, no redistribution or caching, attribution to WAQI and the source EPAs required.

Source: https://docs.openaq.org/using-the-api/rate-limits

### 26. GPS jamming: gpsjam.org daily H3 data (verified)

Keyless files: https://gpsjam.org/data/manifest.csv (rows: date, suspect flag, hex count, source) and https://gpsjam.org/data/{YYYY-MM-DD}-h3_4.csv with columns hex, count_good_aircraft, count_bad_aircraft (H3 resolution 4, gzip content-encoding). Updated daily soon after midnight UTC; history from 2022-02-14. Formula: percent_bad = 100*(bad-1)/(good+bad), based on ADS-B NACp. No CORS header. No licence stated.

Source: https://gpsjam.org/faq

### 27. GPS interference: self-computed from ADS-B (verified)

adsb.lol aircraft objects carry nic, nac_p, nac_v, sil, sda and gva, so a live interference layer can be built by binning low-NACp/NIC aircraft into H3 cells, the same way gpsjam does. No specific threshold was checked; commonly cited cutoffs such as NACp<8 were not confirmed. No public Flightradar24 GPS-jamming API was found.

Source: https://api.adsb.lol/api/openapi.json

### 28. Sentinel imagery: Copernicus Data Space STAC and OData (keyless search) (verified)

STAC: https://stac.dataspace.copernicus.eu/v1/search?collections=sentinel-2-l2a&bbox=...&sortby=-properties.datetime works without auth and returns ACAO *. Properties include eo:cloud_cover and datetime. The legacy catalogue.dataspace.copernicus.eu/stac is deprecated from 2025-11-17. OData: https://catalogue.dataspace.copernicus.eu/odata/v1/Products?$filter=... is keyless with ACAO *. The thumbnail asset https://datahub.creodias.eu/odata/v1/Assets({uuid})/$value 301-redirects to zipper.creodias.eu. Full-resolution assets are s3://eodata and need credentials. 400+ collections.

Source: https://documentation.dataspace.copernicus.eu/APIs/STAC.html

### 29. Sentinel imagery: Sentinel Hub on CDSE (free account) (verified)

Needs a free CDSE account and an OAuth client created under User Settings > OAuth clients; web origins can be set for single-page apps. Token URL: https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token. Base URL: https://sh.dataspace.copernicus.eu. Token requests are rate-limited (429).

Source: https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/Authentication.html

### 30. Imagery: Microsoft Planetary Computer and EOX cloudless (verified)

Planetary Computer STAC https://planetarycomputer.microsoft.com/api/stac/v1/search works keyless (ACAO *). The SAS token endpoint /api/sas/v1/token/sentinel-2-l2a and the tiler /api/data/v1/mosaic/info both returned 200 without a key. EOX tiles https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg returned 200 with CORS. EOX per-year licences (2016 believed CC BY 4.0, later years NC-SA) were not confirmed.

Source: https://planetarycomputer.microsoft.com/api/stac/v1/search?collections=sentinel-2-l2a&bbox=13,52,13.5,52.5&limit=1

### 31. Conflicts: ACLED (free account, OAuth; tiered) (verified)

Token: POST https://acleddata.com/oauth/token with username (email), password, grant_type=password, client_id=acled, scope=authenticated. Access token lasts 24 h; refresh token 14 days. Read endpoint: https://acleddata.com/api/acled/read with 'Authorization: Bearer'. Default 5,000 rows per call; paginate. Tiers: 'Open' gives aggregated data only. 'Research' gives event data with a 12-month lag. Partner and Enterprise tiers have API access to current event data. EULA applies.

Source: https://acleddata.com/api-documentation/getting-started

### 32. Conflicts: UCDP GED API now needs a token (CHANGED) (verified)

https://ucdpapi.pcr.uu.se/api/gedevents/25.1?pagesize=1 returned 401: 'API token required. Add header: x-ucdp-access-token: <your-token>'. Get a token by emailing the UCDP contact address listed at ucdp.uu.se/apidocs with a project description; replies take 3–5 working days. Limit: 5,000 requests/day, and errors count toward it. Datasets: gedevents (latest 26.1), candidate monthly (26.0.x) and quarterly, ucdpprioconflict, dyadic, nonstate, onesided, battledeaths.

Source: https://ucdp.uu.se/apidocs/

### 33. Conflicts/news: GDELT DOC 2.0 (throttled) and GEO 2.0 (gone) (verified)

DOC API: https://api.gdeltproject.org/api/v2/doc/doc?query=...&mode=artlist|timelinevol|timelinetone|tonechart|...&format=json|rss|csv&maxrecords≤250&timespan (up to 3 months). Operators: sourcecountry, sourcelang, theme, near, domain, tone. A live call returned 429: 'Please limit requests to one every 5 seconds'. GEO 2.0 (/api/v2/geo/geo) returned 404 for both html and geojson on 2026-09-30, so treat it as discontinued. Context 2.0 (/api/v2/context/context) and TV (/api/v2/tv/tv) returned 200.

Source: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/

### 34. Conflicts: GDELT 2.0 raw 15-minute files (verified)

https://data.gdeltproject.org/gdeltv2/lastupdate.txt (HTTPS, ACAO *) lists the latest {ts}.export.CSV.zip (events with ActionGeo lat/lon, about 76 KB), {ts}.mentions.CSV.zip and {ts}.gkg.csv.zip (about 6 MB), every 15 minutes. Best keyless replacement for the GEO API: parse server-side and aggregate.

Source: https://data.gdeltproject.org/gdeltv2/lastupdate.txt

### 35. Frontlines: DeepStateMap (Ukraine) (verified)

https://deepstatemap.live/api/history/public lists snapshots (id, description). https://deepstatemap.live/api/history/last returns {id, map: FeatureCollection with Polygons}. Both send ACAO *. Licence: non-commercial API use is for volunteer/charitable organisations and Ukrainian defence; commercial use needs prior approval via https://api.deepstatemap.live/request. Attribution (text reference, logo or link) is required. 'Unauthorized distribution, publication, proxying … of the API to third parties' is prohibited. A daily GeoJSON mirror exists at github.com/cyterat/deepstate-map-data.

Source: https://deepstatemap.live/license-en.html

### 36. Frontlines: ISW / Critical Threats ArcGIS feature services (verified)

The ISW ArcGIS org https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services?f=json lists 325 services. Examples: ClaimedRussianTerritoryinUkraine_V2_view (82 features), Assessed_Russian_Advances_in_May_2026_view (1,979), AssessedRussianAdvanceInUkraine_V2_view (returned 0), plus Israel/Lebanon/Syria layers. Query pattern: /FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson (maxRecordCount 1000; ACAO *). Layer names change monthly and some views are empty, so discover them through ArcGIS search. Licence/terms not checked; ISW content is copyrighted.

Source: https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services?f=json

### 37. Conflicts: Liveuamap (avoid) (UNVERIFIED)

The homepage and /terms returned 403 to automated requests. No free public API was found; terms not checked. Do not scrape it.

Source: https://liveuamap.com/terms

### 38. Country risk: INFORM Risk API (keyless) (verified)

GET https://drmkc.jrc.ec.europa.eu/inform-index/API/InformAPI/Workflows/GetByYear/2026 returns WorkflowId 515, 'INFORM Risk Mid 2026'. GET https://drmkc.jrc.ec.europa.eu/inform-index/API/InformAPI/countries/Scores/?WorkflowId=515&IndicatorId=INFORM returns [{Iso3, IndicatorId, IndicatorScore}], e.g. AFG 7.8. Scale 0–10: Low ≤3.5, Medium 3.5–5, High 5–6.5, Very High ≥6.5. Also /inform-index/api/informapi/countries/trends?workflowid=0.

Source: https://drmkc.jrc.ec.europa.eu/inform-index/API/InformAPI/countries/Scores/?WorkflowId=515&IndicatorId=INFORM

### 39. Country risk: World Bank WGI and Fragile States Index (verified)

WGI Political Stability: https://api.worldbank.org/v2/country/all/indicator/GOV_WGI_PV.EST?source=3&format=json&date=2023 (ACAO *; last updated 2026-09-25). The old PV.EST id without source=3 returns 'indicator not found'. Other WGI ids: GOV_WGI_CC/GE/RL/RQ/VA.EST. Fragile States Index Excel files cover 2006–2023, e.g. https://fragilestatesindex.org/wp-content/uploads/2023/06/FSI-2023-DOWNLOAD.xlsx. 2024+ files are not listed and no licence is stated. The Global Peace Index 2025 was found only as PDFs.

Source: https://fragilestatesindex.org/excel/

### 40. News RSS availability (live test) (verified)

OK: feeds.bbci.co.uk/news/world/rss.xml, www.aljazeera.com/xml/rss/all.xml, www.theguardian.com/world/rss, www.france24.com/en/rss (all no CORS header); rss.nytimes.com/services/xml/rss/nyt/World.xml and rss.dw.com/rdf/rss-en-all (both ACAO *). Failed: www.reuters.com/world/rss (401; Reuters has no official RSS), feeds.apnews.com (unreachable, 502), feeds.npr.org/1004/rss.xml (403, CORS limited to apps.npr.org).

Source: https://feeds.bbci.co.uk/news/world/rss.xml

### 41. OSINT news: Telegram public channel previews (verified)

https://t.me/s/{channel} returns about 20 posts per page as HTML: .tgme_widget_message_text, .tgme_widget_message_date, .tgme_widget_message_photo_wrap (image in a style url), data-post='channel/id'. Paginate with ?before={id}. No CORS, so parse server-side. Telegram's 'Content Licensing and AI Scraping Terms' prohibit 'scraping, indexing, harvesting, aggregation' of platform data for AI/ML development. Do not send scraped posts into model training, and keep volume low.

Source: https://telegram.org/tos/content-licensing

### 42. Live TV: YouTube 24/7 news channel IDs (verified)

Channel IDs confirmed via youtube.com/feeds/videos.xml?channel_id=:
- Al Jazeera English UCNye-wNBqNL5ZzHSJj3l8Bg (current live video gCNeDWCI0vo, checked via oEmbed)
- DW News UCknLrEdhRCp1aegoMqRaCZg
- FRANCE 24 English UCQfwfsi5VrQ8yKZ-UWmAEFg
- Sky News UCoMdktPbSTixAyNGwb-UYkQ
- Bloomberg Television UCIALMKvObZNtJ6AmdCLP7Lg
- NBC News UCeY0bbntWzzVIaj2z3QigXg
- BBC News UC16niRr50-MSBwiO3YDb3RA

Embed pattern: https://www.youtube.com/embed/live_stream?channel={ID} (returned 200) or /embed/{videoId}. Using the official YouTube embed player is the legal route; do not re-host or restream HLS.

Source: https://www.youtube.com/feeds/videos.xml?channel_id=UCNye-wNBqNL5ZzHSJj3l8Bg

### 43. Markets: Yahoo Finance and Stooq (verified)

Yahoo https://query1.finance.yahoo.com/v8/finance/chart/{SYM}?range=1d&interval=5m returns 200 keyless with no CORS header, so proxy it. Returns meta and indicators.quote. https://query1.finance.yahoo.com/v7/finance/quote returns {'error':{'code':'Unauthorized'}} because it needs a crumb. Both are unofficial with ToS risk. Stooq has required an API key since about March 2026 (pandas-datareader issue #1012); live requests got a connection reset or a JS challenge page.

Source: https://github.com/pydata/pandas-datareader/issues/1012

### 44. Crypto: CoinGecko, CoinCap, Binance, Coinbase, Kraken (verified)

CoinGecko https://api.coingecko.com/api/v3/simple/price works keyless (ACAO *) with a limit shared per IP. A free Demo key (header x_cg_demo_api_key) gives 100 calls/minute plus a monthly cap. Failed requests count toward the limit. CoinCap: api.coincap.io/v2 is unreachable; rest.coincap.io/v3 returns 'Unauthorized' without a key. Binance api.binance.com returns 451 from US IPs; https://data-api.binance.vision/api/v3/ticker/24hr returns 200 (ACAO *). https://api.exchange.coinbase.com/products/BTC-USD/ticker returns 200 (ACAO *). https://api.kraken.com/0/public/Ticker works.

Source: https://docs.coingecko.com/docs/common-errors-rate-limit

### 45. Markets: Finnhub free key (UNVERIFIED)

The docs page did not render. The free limit (commonly cited as 60 calls/minute) and commercial terms were not confirmed.

Source: https://finnhub.io/docs/api/rate-limit

### 46. CCTV: TfL JamCams (keyless) (verified)

https://api.tfl.gov.uk/Place/Type/JamCam returns 890 cameras with ACAO *. Each has id, commonName, lat, lon and additionalProperties including available and imageUrl (https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/{id}.jpg); a videoUrl mp4 is also believed to be present. TfL open-data terms and attribution text were not checked (page returned 403).

Source: https://api.tfl.gov.uk/Place/Type/JamCam

### 47. CCTV: Caltrans CWWP2 (keyless) and 511NY (key) (verified)

Caltrans: https://cwwp2.dot.ca.gov/data/d{N}/cctv/cctvStatusD{NN}.json (e.g. d7/cctvStatusD07.json) sends ACAO *. Records hold cctv.location with district, locationName, latitude, longitude, route, direction; the image URL fields were not inspected. 511NY: a developer key is required (key=...&format=json), throttled to 10 calls per 60 s, under a Developer's Access Agreement.

Source: https://511ny.org/developers/help

### 48. CCTV: Windy Webcams API v3 (free key) (verified)

Header x-windy-api-key. Image URL tokens expire after 10 minutes on the free tier and 24 h on Professional; expired tokens return 401. Call the API on every page load rather than caching image URLs.

Source: https://api.windy.com/webcams/docs

### 49. CCTV: Insecam (exclude — legal/privacy risk) (verified)

Insecam is a Russian-based directory of unsecured IP cameras that use default passwords. The UK Information Commissioner condemned it and moved to shut it down in 2014. It was still running in 2025. Embedding it creates GDPR and privacy exposure; use only official DOT and tourism webcams.

Source: https://en.wikipedia.org/wiki/Insecam

### 50. Infrastructure: Wikidata SPARQL nuclear plants (verified)

https://query.wikidata.org/sparql with Accept: application/sparql-results+json sends ACAO *. Query ?item wdt:P31/wdt:P279* wd:Q134447; wdt:P625 ?coord returns 382 nuclear power plants with coordinates. Data is CC0. Send a descriptive User-Agent.

Source: https://query.wikidata.org/sparql

### 51. Infrastructure: Overpass, WRI GPPD, GEM Nuclear Tracker (verified)

Overpass overpass-api.de: fewer than 10,000 queries/day and under 1 GB/day; apps should divide those by 100. Commercial use should self-host. User-Agent or Referer is required. The main instance is overloaded; private.coffee is an alternative. WRI Global Power Plant Database v1.3.0 is CC BY 4.0 and 'not currently maintained … no planned updates (early 2022)'. GEM Global Nuclear Power Tracker covers 1,825 units, was last released August 2026, and downloads from Google Sheets; its licence was not stated on the page.

Source: https://wiki.openstreetmap.org/wiki/Overpass_API

### 52. Maritime: AISStream.io (free key, server relay only) (verified)

WebSocket wss://stream.aisstream.io/v0/stream. Send a JSON subscription within 3 s: {APIKey, BoundingBoxes:[[[lat,lon],[lat,lon]]], FiltersShipMMSI (≤200), FilterMessageTypes}. Messages are binary frames of UTF-8 JSON; types include PositionReport, ShipStaticData and 23 others. Limits: 3 subscribed connections per account, 3 open connections per IP, 1 subscription update/s. 'Direct browser connections are not permitted; proxy only the information your clients need.' No durability guarantee, so reconnect with backoff.

Source: https://aisstream.io/documentation

### 53. Maritime: AISHub, World Port Index, Natural Earth ports (verified)

AISHub requires membership and a username: https://data.aishub.net/ws.php?username=...&format=1&output=json, at most once per minute or it returns nothing. NGA World Port Index CSV https://msi.nga.mil/api/publications/download?type=view&key=16920959/SFH00000/UpdatedPub150.csv returned 200 (octet-stream); updated monthly. Natural Earth ports https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_ports.geojson returned 200 (about 279 KB, ACAO *).

Source: https://aishub.net/api

### 54. Submarine cables: TeleGeography (verified)

https://www.submarinecablemap.com/api/v3/cable/cable-geo.json (about 751 KB, FeatureCollection with id, name, color, feature_id) and /api/v3/landing-point/landing-point-geo.json (about 361 KB) returned 200 with no CORS header, so proxy or bundle them. Licence is CC BY-NC-SA 3.0 (per search results and a third-party licence issue), so no commercial use and share-alike applies. The official GitHub repo URL returned 404; forks exist.

Source: https://www.submarinecablemap.com/api/v3/cable/cable-geo.json

### 55. Internet outages: IODA (keyless) and Cloudflare Radar (free token) (verified)

IODA https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts?from={unix}&until={unix} returned 200 keyless, with CORS reflecting the Origin. Other endpoints: outages/events, signals/raw, entities. Cloudflare Radar base https://api.cloudflare.com/client/v4/radar/ needs a token (Custom Token with Account > Radar > Read). The API is free and the data is CC BY-NC 4.0. The Outage Center endpoint (/radar/annotations/outages) returned 400 without a token.

Source: https://developers.cloudflare.com/radar/

### 56. Cyber: abuse.ch (Auth-Key mandatory since 2025-06-30; bulk still keyless) (verified)

All abuse.ch APIs have required an Auth-Key header since 2025-06-30; urlhaus-api.abuse.ch/v1/urls/recent/ returned 401. Keyless bulk files returned 200 with no CORS header:
- https://feodotracker.abuse.ch/downloads/ipblocklist.json and ipblocklist_recommended.json
- https://urlhaus.abuse.ch/downloads/json_recent/ and /csv_recent/
- https://threatfox.abuse.ch/export/json/recent/

Terms: free for not-for-profit use under fair-use query limits; excessive use may require a paid Spamhaus subscription.

Source: https://abuse.ch/blog/community-first/

### 57. Cyber: NVD, CISA KEV, CIRCL, Shodan InternetDB, OTX (verified)

- NVD: https://services.nvd.nist.gov/rest/json/cves/2.0 returned 200 (ACAO *; apiKey header allowed). The exact limits (widely cited as 5 requests/30 s without a key, 50 with) could not be read from the NVD pages.
- CISA KEV: https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json returned 200 with no CORS header.
- CIRCL: https://cve.circl.lu/api/last/{n} (ACAO *) and /api/vulnerability/{CVE} both work keyless.
- Shodan InternetDB: https://internetdb.shodan.io/{ip} is keyless with ACAO *. Returns ip, ports, cpes, hostnames, tags, vulns; updated weekly; free for non-commercial use, commercial needs an enterprise licence.
- AlienVault OTX: /api/v1/pulses/subscribed returns 403 without a key; /api/v1/indicators/IPv4/{ip}/general works keyless.

Source: https://internetdb.shodan.io/

### 58. OSINT lookups: DNS, RDAP, CT logs, RIPEstat, MAC (verified)

- dns.google: https://dns.google/resolve?name=&type= (ACAO *).
- RDAP: https://rdap.org/domain/{d} 302-redirects to the authoritative RDAP server (ACAO *).
- crt.sh: https://crt.sh/?q={domain}&output=json (ACAO *; can be slow).
- RIPEstat: https://stat.ripe.net/data/{call}/data.json. Keyless, max 8 concurrent requests per IP; register if over 1,000/day; add a sourceapp parameter; JSONP via callback.
- MAC lookup: https://api.macvendors.com/{mac} is keyless at 1,000/day and 1 request/s, with no CORS header. https://api.maclookup.app/v2/macs/{mac} returned 200.

Source: https://stat.ripe.net/docs/data_api

### 59. IP geolocation: ip-api, ipapi.co, ipwho.is, IPinfo Lite, freeipapi (verified)

- ip-api.com: free tier is HTTP only (http://ip-api.com/json/{ip}), 45 requests/minute (X-Rl, X-Ttl headers), non-commercial, ACAO *.
- ipapi.co: https://ipapi.co/8.8.8.8/json/ returned 403 from the test IP. The free plan is now a signup 'trial', 1,000/day and 'not for production'.
- ipwho.is: https://ipwho.is/{ip} is keyless, 1,000/day per client IP (counted per domain when called via CORS), commercial use allowed, ACAO *.
- IPinfo Lite: https://api.ipinfo.io/lite/{ip}?token= needs a free token; unlimited country and ASN lookups.
- freeipapi: the path moved to https://free.freeipapi.com/api/v1/json/{ip} (old path 307-redirects).

Source: https://ipwhois.io/documentation

### 60. OSINT: breach and infostealer lookups (verified)

XposedOrNot: https://api.xposedornot.com/v1/check-email/{email} is keyless with ACAO *; 2 requests/s per IP plus hourly and daily caps; the domain-breach endpoint needs a key; paid plans start at $5/month. Hudson Rock Cavalier: https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-domain?domain= returned 200 keyless on a retry (the first attempt timed out at 40 s). Its terms and rate limits were not checked.

Source: https://xposedornot.com/api_doc

### 61. Sanctions: OpenSanctions (verified)

The hosted API https://api.opensanctions.org/search/default?q= returns 401 without a key. Commercial pricing is €0.10 per query after a 30-day trial; non-commercial exemptions exist. Data licence is CC BY-NC 4.0. Keyless bulk files: https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv (307-redirects to a dated artifact, ACAO *). For keyless search, self-host the yente matching API.

Source: https://www.opensanctions.org/api/

### 62. Geocoding: Nominatim and Photon (verified)

Nominatim (OSMF): absolute maximum 1 request/s. A valid User-Agent or Referer is required. No autocomplete, grid or bulk queries, or scraping. Cache results. Scripts that run for more than 24 h are limited to 4 requests/minute. ODbL attribution. Photon: https://photon.komoot.io/api/?q=&lat=&lon=&limit=&lang= and /reverse, GeoJSON, built for type-ahead. Fair use only: 'extensive usage will be throttled'.

Source: https://operations.osmfoundation.org/policies/nominatim/

### 63. Basemaps: OpenFreeMap, CARTO, Esri (verified)

OpenFreeMap: no key and no limits, commercial use allowed (MIT). Styles: Positron, Bright, Liberty, Dark, Fiord (e.g. https://tiles.openfreemap.org/styles/dark returned 200). Required attribution: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap'. CARTO: 5M requests/month free for non-commercial use, 1M/month free for businesses; '© OpenStreetMap contributors, © CARTO'. basemaps.cartocdn.com/dark_all tiles still return 200 without a key. Esri World_Imagery tile returned 200; its terms were not checked.

Source: https://openfreemap.org/

### 64. Other keyless extras (routing, disasters, ArcGIS, volcano) (verified)

- OSRM demo: https://router.project-osrm.org/route/v1/driving/... returned 200 (ACAO *); its demo-server policy was not checked.
- ArcGIS Online search: https://www.arcgis.com/sharing/rest/search?q=&f=json is keyless with a reflected CORS origin.
- GDACS: https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF returned 200 (the /MAP variant returned 400); https://www.gdacs.org/xml/rss.xml returned 200.
- NOAA NHC: https://www.nhc.noaa.gov/CurrentStorms.json returned 200.
- Smithsonian GVP: https://volcano.si.edu/news/WeeklyVolcanoRSS.xml returned 200.
- ReliefWeb v2 returned 403 with appname=test; it probably needs an approved appname (not confirmed).
- Global Fishing Watch v3 returns 401 without a token.

Source: https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF

### 65. Reference implementations to study (verified)

bilawalsidhu/gods-eye-view is MIT-licensed, built with vanilla JS, CesiumJS and Vite, uses Google Photorealistic 3D Tiles and the OpenAI Realtime voice API. It has 19 layers (flights 11k+, military, vessels, satellites, about 3,600 CCTV cameras projected in 3D, ALPR cameras, datacenters, dams, 712 submarine cables, USGS, FIRMS, wind, radar, lightning, transit) and shader modes CRT, NVG, FLIR/Ironbow, Noir and Snow on keys 1–7. BigBodyCobain/Shadowbroker DATA-ATTRIBUTION.md is a ready-made attribution table: adsb.lol ODbL, OpenSky, Airframes.io ACARS, CelesTrak, USGS, FIRMS, GIBS, SWPC, GDELT, DeepState, aisstream, Global Fishing Watch CC BY 4.0, Planetary Computer, CDSE, Shodan, Smithsonian GVP, OpenAQ CC BY 4.0, NWS, WRI GPPD CC BY 4.0, Wikidata CC0, KiwiSDR, OpenMHZ, Meshtastic, APRS-IS, CARTO, Esri, IODA.

Source: https://github.com/BigBodyCobain/Shadowbroker/blob/main/DATA-ATTRIBUTION.md

## Recommendations

- Build every upstream call behind a Next.js route handler under /api/* with a per-source cache (e.g. a Map or LRU with TTL) and stale-while-revalidate. Never call a source from the browser if it lacks ACAO * or has an IP-shared quota. Those include adsb.lol, adsb.fi, OpenSky, the FIRMS CSVs, gpsjam, Yahoo, TeleGeography, the abuse.ch downloads, CISA KEV, most RSS feeds, Telegram, AISStream and GDELT DOC.
- Zero-key default vs optional key upgrade, one line per layer:
- FLIGHTS: adsb.lol /v2/point tiled plus /v2/mil, /v2/ladd, /v2/pia (ODbL, cite adsb.lol) → OPENSKY_CLIENT_ID/SECRET, only if the user has a written OpenSky licence; ADSBX RapidAPI key ($10/month, non-commercial).
- ROUTES/PLANNED PATH: OurAirports CSV, adsbdb callsign route, VRS standing-data, FAA prefroutes (US), great-circle geodesic → FLIGHTAWARE_AEROAPI_KEY for /flights/{id}/route fixes and /airports/{o}/routes/{d} IFR routings.
- SATELLITES: CelesTrak GP (FORMAT=json, cached 2 h) plus satellite.js → N2YO_API_KEY for passes.
- ISS: wheretheiss.at plus the official NASA YouTube stream awQzjn72bI0.
- SPACE WEATHER: SWPC /products + /json/rtsw + /json/goes (no key).
- QUAKES: USGS feeds (no key).
- FIRES: FIRMS Global_24h CSVs → FIRMS_MAP_KEY (Area API, 5 days, bbox).
- WEATHER: EONET v3, NWS alerts, Open-Meteo, RainViewer past radar (z≤7), GIBS → none needed.
- AIR QUALITY: Open-Meteo air quality → OPENAQ_API_KEY / WAQI_TOKEN.
- GPS JAMMING: gpsjam daily H3 CSV plus live NACp/NIC binning from adsb.lol.
- IMAGERY: CDSE STAC and Planetary Computer STAC search, GIBS/EOX tiles → CDSE OAuth client (Sentinel Hub Process API).
- CONFLICT: GDELT 15-min export files, GDELT DOC (≤1 request/5 s, cached), DeepStateMap /api/history/last (non-commercial, with attribution), ISW ArcGIS layers → ACLED_EMAIL/PASSWORD (OAuth), UCDP_TOKEN.
- COUNTRY RISK: INFORM API, World Bank WGI (source=3), bundled FSI xlsx.
- NEWS: BBC, Al Jazeera, Guardian, France24, DW, NYT RSS plus Telegram t.me/s (low volume, not for AI training).
- LIVE TV: YouTube embed/live_stream?channel=IDs.
- MARKETS: Yahoo v8 chart via proxy (flagged unofficial), CoinGecko keyless, binance.vision, Coinbase, Kraken → FINNHUB_KEY / COINGECKO_DEMO_KEY.
- CCTV: TfL JamCams, Caltrans CWWP2, other open DOT feeds → WINDY_WEBCAMS_KEY, 511 keys.
- INFRASTRUCTURE: Wikidata SPARQL nuclear plants, bundled WRI GPPD / GEM snapshots, Overpass (throttled).
- MARITIME: bundled WPI CSV and Natural Earth ports, static chokepoints → AIS_API_KEY (AISStream, server WebSocket relay only).
- CABLES: TeleGeography GeoJSON (CC BY-NC-SA; attribution; non-commercial).
- OUTAGES: IODA → CLOUDFLARE_RADAR_TOKEN.
- CYBER: CISA KEV, NVD 2.0, cve.circl.lu, Feodo/URLhaus/ThreatFox bulk files → ABUSECH_AUTH_KEY, NVD_API_KEY, OTX_KEY.
- OSINT: dns.google, rdap.org, crt.sh, RIPEstat (sourceapp=), InternetDB, ipwho.is/ip-api, macvendors, XposedOrNot, OpenSanctions bulk CSV → OPENSANCTIONS_KEY, IPINFO_TOKEN, SHODAN_KEY.
- GEOCODING: Photon for autocomplete, Nominatim for final lookups (1 request/s, cached).
- BASEMAP: OpenFreeMap (no key) or CARTO dark_all → MapTiler/Stadia key.
- Tell the build agent the API changes that break older code:
- Use /json/rtsw/rtsw_wind_1m.json instead of /products/solar-wind/*.
- The K-index JSON is now an array of objects.
- Always pass FORMAT=json to CelesTrak.
- GDELT GEO 2.0 is 404, so build geo-events from the GDELT export files.
- UCDP now needs a token and ACLED uses OAuth with lagged data on the free tier.
- RainViewer has no nowcast or IR and max zoom 7.
- The abuse.ch APIs need an Auth-Key, but the bulk exports do not.
- airplanes.live and adsb.one are gated or dead.
- Stooq needs a key, CoinCap v2 is dead, and Binance returns 451 from US IPs.
- ipapi.co returns 403 without a key.
- The freeipapi path moved to /api/v1/json/{ip}.
- NWS /alerts/active rejects 'limit'.
- Planned flight-path feature: accept IATA/ICAO codes or a place name. Resolve them with OurAirports airports.csv (bundle a slimmed JSON of large and medium airports with iata_code/icao_code), falling back to Photon geocoding. Draw the generic route as a geodesic great circle (turf.greatCircle or a custom slerp) with an animated dash and a progress marker. For a specific flight, resolve callsign → origin/destination with adsbdb or VRS standing-data, overlay the live adsb.lol position, and show the flown track from adsb.lol trace history (if available) or from client-side accumulation. When a FlightAware AeroAPI key is present, draw the filed route (/flights/{id}/route fixes) and the historically assigned IFR routings (/airports/{o}/routes/{d}). For US pairs without a key, parse FAA prefroutes route strings, resolve navaids from OurAirports navaids.csv, and mark unresolved fixes.
- Legal and ToS guardrails for the prompt:
- Show a Data Sources/Attribution panel: ODbL for adsb.lol and OSM, CC BY for Open-Meteo, 'Powered by' for WAQI, RainViewer link, DeepStateMap link or logo, CC BY-NC-SA notice for TeleGeography, CC BY-NC for OpenSanctions and Cloudflare Radar.
- Disable OpenSky, adsb.fi, Yahoo, TeleGeography and DeepStateMap when COMMERCIAL_MODE=true.
- Never include Insecam or other unsecured-camera directories.
- Never scrape Liveuamap.
- Keep Telegram scraping low-volume and out of any LLM training path.
- Send identifying User-Agent headers (required by NWS, Nominatim, Overpass and Wikidata).
- Honour per-source rate limits with a token-bucket in the proxy: GDELT 1 request/5 s, Nominatim 1 request/s, adsb.fi 1 request/s, OpenSky credits, CelesTrak 1 download per 2 h per group, AISHub 1 request/min.
- Pre-compute large static layers into /public/data as JSON or GeoJSON at build time: WPI ports, Natural Earth ports, chokepoints, submarine cables, WRI or GEM nuclear and power plants, the Wikidata nuclear list, the OurAirports slim file, FSI scores. This lowers upstream load and makes an offline demo possible.
- Tell the build agent to verify every endpoint again at build start with a scripted health check that hits /api/health and reports status, latency and CORS per source. Several sources (airplanes.live, GDELT GEO, SWPC solar-wind, Stooq, CoinCap) broke within the past 12 months.

## Gaps (not verified)

- Finnhub free-tier rate limit and commercial terms: the docs page did not render.
- NVD API 2.0 exact limits (5 vs 50 requests per rolling 30 s): the NVD pages did not render the numbers, so this rests on common knowledge only.
- OpenSky 2026-03-18 basic-auth retirement date comes from search results and the python README, not an OpenSky announcement page; the OpenSky ToS page gave a 503 via WebFetch but was read with curl.
- EOX Sentinel-2 cloudless per-year licences (CC BY 4.0 vs CC BY-NC-SA 4.0): the licence page was not fetched.
- TeleGeography CC BY-NC-SA 3.0 licence is confirmed only by search results and third-party issues; the official GitHub repo URL returned 404.
- Hudson Rock Cavalier OSINT API terms and rate limits; first request timed out.
- Liveuamap terms and API: every request returned 403.
- gpsjam.org data licence is not stated; the reuse terms are unknown.
- No public Flightradar24 GPS-jamming API was found or checked.
- Global Peace Index machine-readable data (only PDFs found); Fragile States Index 2024+ Excel files are not listed.
- ISW ArcGIS licence/terms; layer names rotate and some views return 0 features.
- TfL open-data licence and attribution text (page returned 403); JamCam videoUrl field not inspected.
- Caltrans CWWP2 image URL field names were not inspected (output truncated).
- Open-Meteo air-quality endpoint timed out from this environment, so availability is not confirmed.
- OSRM demo server usage policy was not fetched.
- ReliefWeb v2 appname requirement: 403 seen but the policy was not read.
- Global Fishing Watch API key terms were not fetched.
- adsb.lol /api/0/routeset returned 201 with an empty body for a test callsign; the working request semantics are unclear.
- FlightAware AeroAPI per-query pricing and any free monthly credit were not checked.
- The OSIRIS source repo (github.com/simplifaisoul/osiris) could not be inspected: the GitHub API and raw paths were blocked or 404 in this session, so its exact upstream choices (e.g. how it reaches about 12.9k flights) could not be confirmed.
- AISStream '3 subscribed connections per account' comes from the doc summary; the exact wording was not re-checked.
- OpenFlights routes.dat staleness (believed frozen around 2014) was not checked this session.
