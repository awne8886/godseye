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
| `https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/ATS_Route/FeatureServer/0/query?…` (FAA ADDS airways) | 200 with **`{"error":{"code":429,…"API calls quota exceeded (8661 request units)…"}}`** | 0.53 s | `*` | keyless, US public domain | quota is shared across the ArcGIS org; unusable from shared egress | superseded in round 6: bundled build-time snapshot (see below) |
| `https://photon.komoot.io/api/?q=heathrow&osm_tag=aeroway:aerodrome&limit=2` | 200 | 4.09 s | none | keyless fair use, ODbL data | GeoJSON features `{properties:{osm_key 'aeroway', osm_value 'aerodrome', name, city, countrycode, extent}, geometry}` | `/api/airports/search` fallback via `src/lib/geocode.ts` (re-ranked against the local index) |

Nominatim is reached only through `src/lib/geocode.ts` (1 req/s queue, 30-day cache) and only on an
explicit submit (`submit=1`), never for type-ahead. FlightAware AeroAPI (`aeroapi`) is wired behind `AEROAPI_KEY` since round 6 (see below).

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

### Re-probe 2026-10-01 02:30 UTC (Phase 3 round-2b, R2-M2 corridor inference)

Honest UA (`GODSEYE/0.1 (open-source monitor; probe)`). adsb.lol `/v2/point` is read only to capture
test fixtures here — the live route endpoint never polls it (it reads aviation's flights snapshot).

| Upstream | Status | Latency | CORS | Notes |
|---|---|---|---|---|
| `https://api.adsb.lol/v2/point/51/-30/250` (mid-Atlantic, on the LHR–JFK corridor) | 200 | 0.69 s | none (server-side only) | `{ac: [], now: 1790821791501}` — **no aircraft**: no ADS-B ground coverage over the open ocean, so oceanic corridor inference has nothing to work with there (a truthful empty, not an outage) |
| `https://api.adsb.lol/v2/point/51.5/-8/250` (west of Ireland) | 200 | 0.65 s | none | 39 rows; readsb jv2 fields `hex, flight, r, t, alt_baro, gs, track, lat, lon, category, dbFlags?`; eastbound NAT exits for many European destinations (DAL22, AFR343, KLM250 …) |
| `https://api.adsb.lol/v2/point/41.5/-70/150` (New England, ~300 km from JFK) | 200 | 0.87 s | none | 58 rows incl. domestic regional legs (RPA E75L), cargo (FDX1273, UPS1017), USAF (DUCE53, `dbFlags 1`), bizjet (SIO007 GLEX) — the classes R2-M2 found mis-inferred |

Both populated responses (airborne rows, fields trimmed) are the unit-test fixture
`src/features/flight-paths/__fixtures__/adsblol-point-lhr-jfk-ends.json`. Licence: adsb.lol data ODbL 1.0.

### Re-probe 2026-10-01 03:35 UTC (Phase 3 round 3, B1/M1 direction checks)

Honest UA (`GODSEYE/0.1 (open-source monitor; probe)`).

| Upstream | Status | Latency | CORS | Notes |
|---|---|---|---|---|
| `https://api.adsb.lol/v2/callsign/AAL606` | 200 | 0.55 s | none (server-side only) | 1 row: hex `ad049a` N938NN B738, `alt_baro 2675`, `baro_rate -832`, `track 180`, 33.02,-97.03 — on final into DFW (it departed JFK 00:31Z), confirming the observed JFK→DFW leg |
| `https://vrs-standing-data.adsb.lol/routes/AA/AAL606.json` | 200 | 0.23 s | `*` | `airport_codes "KDFW-KJFK-KDFW"` — a multi-stop chain: JFK→DFW is its second leg. Aviation's `pickLeg` is direction-blind and picked DFW→JFK; FLIGHT mode now labels the observed leg "the JFK→DFW leg of standing-data route KDFW→KJFK→KDFW" |
| `https://api.adsb.lol/v2/callsign/UAL374` | 200 | 0.48 s | none | live row present |
| `https://vrs-standing-data.adsb.lol/routes/UA/UAL374.json` | 200 | 0.28 s | `*` | `airport_codes "KORD-KLAX"` only — the aircraft observed departing LAX eastbound is shown as flown LAX→ORD with `routeBasis: observed-reverse` |

Recorded flight/trace JSON from this server at 03:11–03:13Z (adsb.lol trace via `/api/aircraft`) is
the fixture set `src/features/flight-paths/__fixtures__/r3/` (AAL606, UAL374, AAL869, UAL1673; plans for
the globe-framing tests at 03:15Z). Licence: adsb.lol ODbL 1.0; VRS standing data CC0.

### Re-probe 2026-10-01 05:40 UTC (Phase 3 round 4, B1 unobserved turnaround / M1 terminal direction)

Honest UA (`GODSEYE/0.1 (open-source monitor; feature-flight-paths round-4 probe)`), `Origin: https://example.org`, 3 s between requests.

| Upstream | Status | Latency | CORS | Notes |
|---|---|---|---|---|
| `https://api.adsb.lol/v2/callsign/SKW541T` | 200 | 0.60 s | none (server-side only) | 1 row: hex `a08f6b` N135SY E75L, `alt_baro "ground"`, gs 11.2 kt at 39.857,-104.669 — back on the ground at **DEN**, confirming the reviewer's 05:17Z observation that this VRS KDEN-KDRO service was flying DRO→DEN after a 37-min coverage gap (landing + turnaround at DRO, 6,685 ft, never seen) |
| `https://api.adsb.lol/v2/point/37.15/-107.75/100` (Durango) | 200 | 0.63 s | none | readsb jv2 rows (`hex, flight, r, t, alt_baro, alt_geom, gs, track, baro_rate, lat, lon, dst, dir`); no ground coverage at DRO itself — why the turnaround is a gap in the trace |
| `https://adsb.lol/data/traces/6b/trace_recent_a08f6b.json` | 200 | 0.59 s | none | gzip-encoded readsb trace (`timestamp`, `trace[]` rows `[dt, lat, lon, alt|"ground", gs, track, flags, vr, …]`) — read only through layers-aviation's `/api/aircraft` |

Fixtures from the reviewer's live capture at 05:15–05:21Z (same server, adsb.lol trace via `/api/aircraft`,
`/api/airports/search?submit=1`) are `src/features/flight-paths/__fixtures__/r4/` (SKW541T and JAL908 traces;
Atlantis / London / qwerty searches), each with a `_captured` note. Licence: adsb.lol ODbL 1.0.

### Re-probe 2026-10-01 16:49 UTC (Phase 3 round 5, B1 observed-reverse / B2 city resolution)

Honest UA (`GODSEYE/0.1 (open-source monitor; feature-flight-paths round-5 probe)`), `Origin: https://example.org`, 3 s between requests.

| Upstream | Status | Latency | CORS | Notes |
|---|---|---|---|---|
| `https://api.adsb.lol/v2/callsign/SWA2816` | 200 | 0.72 s | none (server-side only) | 1 row: hex `aa7ac8` N7744A B737, FL380, `baro_rate 0`, track 241° over Mississippi — a later leg of the day |
| `https://adsb.lol/data/traces/c8/trace_full_aa7ac8.json` | 200 | 1.86 s (140 kB gzip) | none | readsb trace: took off **MCO** 13:09Z, descended through 2,950 ft at 14:26Z and was **on the ground at RDU** (35.87,-78.79) 14:31–14:37Z — confirming the reviewer's B1 finding that round 5 showed it "AS FLOWN MCO→MDW" with an ETA at MDW (VRS lists only MDW→MCO). |

The airport search and city resolution use only the bundled OurAirports index (public domain) and the VRS
standing-data index (CC0; per-airport service counts for ranking); Photon was not called for this round.

Fixtures (reviewer R4's live capture, 2026-10-01 14:04–14:31Z, phase3/round5) in
`src/features/flight-paths/__fixtures__/r5/`: `observed-reverse-live.json` (all 25 observed-reverse
`/api/flight` answers with their adsb.lol traces, thinned, and vertical rates), `route-live-matched.json`
(every MATCHED aircraft of `/api/route/live?reverse=1` on 20 busy pairs plus LIT-LAS, with the
flights-snapshot row), and `search-{St_Petersburg,Bali,Bangalore,Kiev}.json` (`/api/airports/search?submit=1`
answers). Licence: adsb.lol ODbL 1.0; VRS standing data CC0; OurAirports public domain.

### Re-probe 2026-10-02 00:10 UTC (Phase 3 round 6: AeroAPI, FAA airways, R4 m7)

| Upstream | Status | Latency | CORS | Auth / licence | Notes |
|---|---|---|---|---|---|
| `https://aeroapi.flightaware.com/aeroapi/flights/BAW117` (no key) | **401** `{"reason":"INVALID_API_KEY"}` | 0.64 s | none sent | `x-apikey` header; personal tier is non-commercial, 10 result sets/min, billed per result set | Keyless can only answer 401. The adapter (`server/aeroapi.ts`) is wired behind the `aeroapi` capability (`AEROAPI_KEY`, off when `COMMERCIAL_DEPLOYMENT=true`), 1 request / 10 s, burst 2 (≤ 8 result sets/min). Round 6 fix: non-blocking admission (`tryTake`; no free token → `skipped: budget` or last good value, never a queue), every request carries the cache's abort signal and a 12 s deadline, and `/api/route/plan` waits ≤ 2.5 s before reporting `aeroapi: {ok:false, error:'pending'}` while the refresh fills the 24 h cache in the background. Test fixture `aeroapi-v4-docs-shaped.json` is **shaped from the published OpenAPI document** (`https://www.flightaware.com/commercial/aeroapi/resources/aeroapi-openapi.yml`, 200, 891 kB, fetched the same minute), not a live capture: `flights[].segments[]` (`/airports/{id}/flights/to/{dest_id}`), `fixes[] {name, latitude, longitude, type}` + `route_distance` (`/flights/{id}/route`, decodes continental-US fixes only), `flights[] {ident_icao, ident_iata, fa_flight_id, origin.code_icao, destination.code_icao, scheduled_out, actual_off, actual_on, cancelled}` (`/flights/{ident}`). A live fixture needs the owner's key. |
| `https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/ATS_Route/FeatureServer/0?f=json` (FAA ADDS) | 200 | 0.46 s | `*` | keyless; US Government work, public domain ("for public use") | `Last-Modified: Thu, 03 Sep 2026 11:59:04 GMT`; layer description still cites the 2021 cycle. |
| `…/ATS_Route/FeatureServer/0/query?where=1=1&returnCountOnly=true&f=json` | 200 `{"count":18445}` | 0.70 s | `*` | — | 18,445 segments, extent lng −180…188.4. |
| `…/query?where=1=1&outFields=IDENT,TYPE_CODE&outSR=4326&f=geojson&orderByFields=OBJECTID&resultOffset=…&resultRecordCount=2000` (10 pages, 2 s apart) | 200 ×10, no 429 this time | ≈ 2.4 s/page | `*` | — | Densified LineStrings (~15 vertices per segment). `tools/build-airways.ts` → `public/data/airways-us.min.json` (839 kB): 1,737 airways (CONV 778, RNAV 708, OCEAN 244, AKCAP 4, GRNAV 2, UCON 1), 38,167 vertices after 0.01° Douglas–Peucker; `sources [{url, lastModified}]`. A 429 inside a 200 body waits ≥ 61 s and retries (recorded `faa-adds-429-in-200.json`). Fixture `faa-adds-ats-route-J80.json` (27 segments, `where=IDENT='J80'`, 0.70 s). No runtime ArcGIS call: `/api/route/plan` reads the snapshot (`providers.faa_adds`, age = snapshot age). Round 6 fix: `age_s` is counted from the FAA `Last-Modified` (`sources[0].lastModified`), not the build time; the plan carries `airwaysSource {name, url, licence, lastModified, builtAt}` and the PATHS legend shows an `AIRWAYS (FAA, REFERENCE)` row dated by it. |
| `https://photon.komoot.io/api/?q=Glastonbury&limit=8` | 200 | 0.75 s | `*` | ODbL (OSM), fair use | First feature (town, GB) kept as `photon-place-Glastonbury.json` for the R4 m7 "nearest airports to {place}" disclosure test. |
