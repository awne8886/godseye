## feature-flight-paths

Probed 2026-09-30 20:02 UTC from the build sandbox with
`curl -sS -m 90 -A 'GODSEYE/0.1.0 (+https://github.com/awne8886/godseye; contact https://github.com/awne8886/godseye/issues)'`.
Recorded bodies live in `src/features/flight-paths/__fixtures__/` (`_captured` set); the aviation
fixtures (VRS/adsbdb/hexdb BAW117) are reused. Bundled files are produced by
`tools/build-airports.ts` and `tools/build-routes.ts` into `public/data/` (sizes below).

| Upstream | Status | Latency | CORS | Auth / licence | Sample fields / notes | Used by |
|---|---|---|---|---|---|---|
| `https://davidmegginson.github.io/ourairports-data/airports.csv` | 200 | 0.43 s | `*` | keyless, public domain; rebuilt nightly (`Last-Modified: Wed, 30 Sep 2026 01:53:58 GMT`) | 12.7 MB; `id, ident, type, name, latitude_deg, longitude_deg, elevation_ft, continent, iso_country, iso_region, municipality, scheduled_service, icao_code, iata_code, gps_code, local_code, home_link, wikipedia_link, keywords` | build → `airports.min.json` (9,785 rows, 1.47 MB) + `airports-all.json.gz` (49,318 airfields, 1.8 MB) |
| `…/ourairports-data/runways.csv` | 200 | 0.36 s | `*` | public domain | 4.0 MB; `airport_ident, length_ft, width_ft, surface, lighted, closed, le_ident, he_ident, …` | build → `airports-runways.json.gz` (0.29 MB); longest paved runway for diversions |
| `…/ourairports-data/countries.csv`, `regions.csv` | 200 | 0.16 s / 0.22 s | `*` | public domain | 24.6 kB / 485 kB; `code, name` | search fields (country/region names) |
| `https://raw.githubusercontent.com/mwgg/Airports/master/airports.json` | 200 | 0.29 s | `*` | keyless, MIT | 9.0 MB; keyed by ICAO: `{icao, iata, name, city, state, country, elevation, lat, lon, tz}` | build → IANA `tz` joined on icao/gps/ident |
| `https://vrs-standing-data.adsb.lol/routes.csv.gz` | 200 | 0.31 s | `*` | keyless, CC0 1.0; `Last-Modified: Sun, 20 Sep 2026 18:47:40 GMT` | 4.5 MB gzip, 620,700 rows `Callsign,Code,Number,AirlineCode,AirportCodes` (`AAL100,…,KJFK-EGLL`; multi-stop chains); no dates/days of operation | build → `routes-vrs.json.gz` (99,295 chains, 2.4 MB): known services, live matching, IATA→ICAO disambiguation |
| `https://vrs-standing-data.adsb.lol/routes/BA/BAW117.json` | 200 | 0.23 s | `*` | CC0 | `{callsign, airport_codes 'EGLL-KJFK', _airport_codes_iata, _airports[…]}` | `/api/flight/{ident}` via aviation's route lookup |
| `https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat` | 200 | 0.25 s | `*` | keyless, ODbL; **frozen June 2014 — historical only** | 2.4 MB, 67,663 rows `airline, airline_id, src, src_id, dst, dst_id, codeshare, stops, equipment` | build → `routes-openflights.json.gz` (0.40 MB), labelled 2014 |
| `…/openflights/master/data/airlines.dat` | 200 | 0.20 s | `*` | ODbL | 397 kB `id, name, alias, iata, icao, callsign, country, active` | BA117 → BAW117 (active holder preferred, checked against VRS) |
| `https://aviationweather.gov/api/data/metar?ids=EGLL,KJFK&format=json` | 200 | 0.27 s | none | keyless, US public domain; ≤ 100 req/min | `[{icaoId, obsTime (epoch s), temp, dewp, wdir, wspd, wgst?, visib ("6+"/"10+"/number), altim (hPa), rawOb, clouds[{cover, base}], fltCat}]`; 999999 = missing; over quota can be `{error}` in a 200 body | `/api/airports/{code}`, `/api/route/plan`, `/api/flight/{ident}` (5 min cache per station set) |
| `https://aviationweather.gov/api/data/taf?ids=EGLL,KJFK&format=json` | 200 | 0.35 s | none | as above | `[{icaoId, issueTime, validTimeFrom/To (epoch s), rawTAF, fcsts[…]}]` | raw TAF text |
| `https://api.open-meteo.com/v1/forecast?latitude=51.47,55.0,60.0&longitude=-0.45,-30.0,-60.0&hourly=wind_speed_250hPa,wind_direction_250hPa&forecast_hours=1&wind_speed_unit=kn` | 200 | 0.53 s | none | keyless free tier: **non-commercial**, data CC BY 4.0 → capability `openmeteo` (off with `COMMERCIAL_DEPLOYMENT=true`) | multi-coordinate answer = array in request order (single coordinate = object): `hourly.{time ['2026-09-30T20:00'] (GMT), wind_speed_250hPa [91.4], wind_direction_250hPa [180]}`; no 429 seen on this probe | `/api/route/plan` winds aloft: 8 samples → 2° grid, 1 h cell cache, one request per route, 120 req/h process budget (`skipped: 'budget'`) |
| `https://api.adsb.lol/v2/callsign/BAW117` | 200 | 0.49 s | none | keyless, ODbL; through aviation's `adsblolBucket()` (1 per 1.2 s shared) | `{ac:[], total:0}` (not airborne at probe time) | `/api/flight/{ident}` when the flights snapshot does not have the aircraft |
| `https://api.adsbdb.com/v0/callsign/BAW117` | 200 | 0.53 s | `*` | keyless; route data must not be copied into other databases (never bulk-stored) | `response.flightroute.{origin, destination}` | route fallback 2 (aviation module) |
| `https://api.adsbdb.com/v0/aircraft/{registration}` | — (not probed separately; same endpoint as `/aircraft/{hex}`, documented to accept registrations) | — | `*` | as above | `response.aircraft.mode_s` | registration → hex when the aircraft is not in the snapshot |
| `https://hexdb.io/api/v1/route/icao/BAW117` | 200 | 0.43 s | `*` | keyless | `{flight, route 'EGLL-KJFK', updatetime 1333306563}` = **2012-04-01** → labelled stale | route fallback 3 |
| `https://api.flightplandatabase.com/search/plans?fromICAO=EGLL&toICAO=KJFK&limit=2` | **502** | 0.40 s | none | anonymous 100 req/day/IP; waypoints need a key (HTTP Basic, key as username); **flight simulation only**, attribution required | body `error code: 502` | `filedPlans` only with capability `fpdb` (`FPDB_API_KEY`); cached 24 h per pair; failures reported |
| `https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/ATS_Route/FeatureServer/0/query?…` (FAA ADDS airways) | 200 with **`{"error":{"code":429,…"API calls quota exceeded (8661 request units)…"}}`** | 0.53 s | `*` | keyless, US public domain | quota is shared across the ArcGIS org; unusable from shared egress | **not used**: `airways` omitted (optional field) |
| `https://photon.komoot.io/api/?q=heathrow&osm_tag=aeroway:aerodrome&limit=2` | 200 | 4.09 s | none | keyless fair use, ODbL data | GeoJSON features `{properties:{osm_key 'aeroway', osm_value 'aerodrome', name, city, countrycode, extent}, geometry}` | `/api/airports/search` fallback via `src/lib/geocode.ts` (re-ranked against the local index) |

Nominatim is reached only through `src/lib/geocode.ts` (1 req/s queue, 30-day cache) and only on an
explicit submit (`submit=1`), never for type-ahead. FlightAware AeroAPI (`aeroapi`) is not wired yet.

### Re-probe 2026-09-30 22:4x UTC (Phase 3 round-1 fixes)

Same honest UA (`… probe`), `Origin: https://example.org` to read CORS.

| Upstream | Status | Latency | CORS | Notes |
|---|---|---|---|---|
| `https://davidmegginson.github.io/ourairports-data/airports.csv` | 200 | 0.80 s | `*` | 12.7 MB, `Last-Modified: Wed, 30 Sep 2026 01:53:58 GMT`; index rebuilt from a fresh download — `airports.min.json` `sources` now records the upstream URLs, licences and this `Last-Modified` (no local path) |
| `https://raw.githubusercontent.com/mwgg/Airports/master/airports.json` | 200 | 0.52 s | `*` | 9.0 MB; **no `Last-Modified` header** (ETag only), so `mwggLastModified` is `null`; MIT, used for IANA `tz` only (8,163 of 9,785 default rows) |
| `https://vrs-standing-data.adsb.lol/routes/BA/BAW117.json` | 200 | 0.30 s | `*` | `Last-Modified: Sun, 20 Sep 2026 18:48:17 GMT`; `airport_codes: "EGLL-KJFK"`, `_airport_codes_iata: "LHR-JFK"` |
| `https://api.adsbdb.com/v0/callsign/BAW117` | 200 | 0.69 s | `*` | `response.flightroute{callsign_icao BAW117, callsign_iata BA117, airline{icao BAW, iata BA}, origin, destination}`; looked up per request, never bulk-stored |
| `https://aviationweather.gov/api/data/metar?ids=EGLL&format=json` | 200 | 0.31 s | none | `obsTime 1790806800` (epoch s), `reportTime` rounded, `rawOb "METAR EGLL 302220Z AUTO …"` |
| `https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/ATS_Route/FeatureServer/0/query?where=IDENT='J80'&outFields=IDENT,TYPE_CODE&returnGeometry=false&f=json` (FAA ADDS airways) | 200 (no quota error this time) | 0.94 s | `*` | `geometryType esriGeometryPolyline`, `wkid 4269` (NAD83), `Last-Modified: Thu, 03 Sep 2026`; public domain. **Not wired**: the earlier probe returned a 429 inside a 200 body, and `route-airways` is left out until a cached, quota-aware provider exists |

### Re-probe 2026-10-01 02:1x UTC (Phase 3 round-2 fixes)

Honest UA (`GODSEYE/0.1.0 (godseye open-source monitor; probe)`).

| Upstream | Status | Latency | CORS | Notes |
|---|---|---|---|---|
| `https://vrs-standing-data.adsb.lol/routes.csv.gz` | 200 | 0.33 s | `*` | 4,500,164 B, `Last-Modified: Sun, 20 Sep 2026 18:47:39 GMT`, ETag `"6ab02a4b-44aac4"`; `routes-vrs.json.gz` rebuilt from this download (99,295 chains) — provenance is now `source` = this URL + `lastModified` `2026-09-20T18:47:39.000Z` (no local path) |
| `https://adsb.lol/data/traces/1a/trace_recent_a2551a.json` (N24990, B789, UAL61) | 200 | 0.51 s | none (server-side only) | gzip JSON `{icao, r, t, desc, timestamp, trace:[[Δs, lat, lon, alt, gs, track, flags, …]]}`; at 02:09Z the aircraft was climbing out of MEL at FL330 near 34.4°S 151.9°E — the leg after the parked-at-MEL observation that exposed R4-M1 |
| `https://vrs-standing-data.adsb.lol/routes/UA/UAL61.json` | 200 | 0.28 s | `*` | `airport_codes "YMML-KSFO"`, `_airport_codes_iata "MEL-SFO"` |
| `https://api.adsbdb.com/v0/callsign/UAL61` | 200 | 11.7 s (slow) | `*` | `flightroute` BRU → (EWR) → IAH — disagrees with VRS (MEL-SFO); the route chain prefers VRS, and the corroboration rule (observed departure beats schedule) arbitrates. Looked up per request, never bulk-stored |
