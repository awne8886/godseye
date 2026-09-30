## layers-aviation

Probed 2026-09-30 18:07–18:20 UTC from the build sandbox with
`curl -sS -m 25 -A 'GODSEYE/0.1.0 (+https://github.com/awne8886/godseye; contact https://github.com/awne8886/godseye/issues)'`
and `-H 'Origin: http://localhost:3000'` for CORS. Recorded bodies (trimmed) live in
`src/features/aviation/__fixtures__/` with `_captured` set.

| Upstream | Status | Latency | CORS | Auth / licence | Sample fields | Used by |
|---|---|---|---|---|---|---|
| `https://api.adsb.lol/v2/point/51.47/-0.45/250` | 200 | 1.01 s | none (no ACAO) | keyless, ODbL 1.0 (attribute "Aircraft data © adsb.lol contributors, ODbL 1.0"); limits "dynamic", no rate headers | `{ac:[…], msg, now (ms), total, ctime, ptime}`; row `hex, type ('adsb_icao'…), flight ('RYR19WT ' space-padded), r, t, dbFlags, alt_baro (ft or "ground"), alt_geom, gs, track, baro_rate, squawk, emergency ("none"), category ('A3'), lat, lon, nac_p, seen_pos, seen, mlat[], tisb[], dst, dir` — 490 aircraft | `/api/flights` tile sweep |
| `https://api.adsb.lol/v2/mil` | 200 | 0.62 s | none | as above | 381 rows, **105 without lat/lon** (only `lastPosition` / `rr_lat`/`rr_lon`); `dbFlags: 1` | `/api/flights` (`noPosition`) |
| `https://api.adsb.lol/v2/ladd` | 200 | 0.79 s | none | as above | 778 rows, 31 without lat/lon; `dbFlags: 8` | `/api/flights` |
| `https://api.adsb.lol/v2/pia` | 200 | 0.50 s | none | as above | 4 rows (`dbFlags: 4`, `flight: 'XAA2358 '`) — small and may truthfully be empty | `/api/flights` |
| `https://api.adsb.lol/v2/callsign/BAW117` | 200 | 0.46 s | none | as above | `{ac:[], total:0}` (not airborne at probe time) | not used (the feed already has callsigns) |
| `https://adsb.lol/data/traces/c4/trace_full_4cafc4.json` | 200 (gzip) | 1.13 s | none | keyless, ODbL; undocumented format | `{icao, r, t, dbFlags, desc, version, timestamp (s), trace:[[Δs, lat, lon, alt_ft|'ground', gs, track, flags, baro_rate, details|null, source ('adsb_icao'/'mlat'/'tisb_…'), alt_geom, geom_rate, ias, roll]…]}`; 6 241 rows / 25 h; `flags & 2` = new leg; lags ~5 min | `/api/aircraft` |
| `https://adsb.lol/data/traces/c4/trace_recent_4cafc4.json` | 200 (gzip) | 0.53 s | none | as above | same shape, last ~10 min (92 rows) — merged after trace_full | `/api/aircraft` |
| `https://api.adsbdb.com/v0/aircraft/4CA1FA` | 200 | 0.50 s | `*` | keyless; route data may not be copied into other databases | `response.aircraft.{type, icao_type, manufacturer, mode_s, registration, registered_owner_country_iso_name, registered_owner, registered_owner_operator_flag_code, url_photo, url_photo_thumbnail}` (photos on airport-data.com, no photographer credit) | `/api/aircraft` identity |
| `https://api.adsbdb.com/v0/aircraft/ffffff` | 404 | **14.7 s** | `*` | — | `{"response":"unknown aircraft"}` → identity null (8 s timeout) | `/api/aircraft` |
| `https://api.adsbdb.com/v0/callsign/BAW117` | 200 | 0.52 s | `*` | as above | `response.flightroute.{callsign, airline{…}, origin{iata_code, icao_code, latitude, longitude, municipality, name, country_iso_name}, destination{…}}` | `/api/flight-route` fallback 2 |
| `https://vrs-standing-data.adsb.lol/routes/BA/BAW117.json` | 200 | 0.26 s | `*` | keyless, CC0 (vradarserver standing data); `Last-Modified: Sun, 20 Sep 2026`, `cache-control: max-age=600`, weak ETag | `{callsign, number, airline_code, airport_codes 'EGLL-KJFK', _airport_codes_iata, _airports[{name, icao, iata, location, countryiso2, lat, lon, alt_feet}]}`; miss = 404 HTML | `/api/flight-route` first |
| `https://hexdb.io/api/v1/route/icao/BAW117` | 200 | 0.42 s | `*` | keyless | `{flight, route 'EGLL-KJFK', updatetime 1333306563}` — **2012**: labelled stale with its update time; miss = 404 `{"status":"404","error":"Route not found."}`; §6.2: the `/route/callsign/` path is gone | `/api/flight-route` fallback 3 |
| `https://hexdb.io/api/v1/airport/icao/EGLL` | 200 | 0.57 s | `*` | keyless, `max-age=14400` | `{country_code, region_name, iata, icao, airport, latitude, longitude}` | coordinates for hexdb routes |

Not used: `api.airplanes.live` (403 "contact us" on every endpoint, docs/reference/25 §15);
adsb.lol `/api/0/routeset` (non-functional, §6.2). Keyed/licensed adapters (not probed here, no
credentials): `re-api.adsb.lol/?all_with_pos&jv2` (`ADSBLOL_REAPI=true`, feeder IP only; 403 from
non-feeders per docs/reference/25 §9), OpenSky `/api/states/all?extended=1` with OAuth2 client
credentials (`OPENSKY_LICENSED=true` + `OPENSKY_CLIENT_ID/SECRET`; written licence required for a live
product), adsb.fi `/api/v2/mil` (`ADSBFI_PERSONAL_USE=true`, 1 req/s, personal non-commercial only).

Coverage: 86 tiles of 250 nm (hex lattice laid out for 230 nm so circles overlap) over the busiest
airspace, one request start every 1.2 s through `providerBucket('api.adsb.lol', 1/1.2)`, ≤ 1 in
flight, ~13 s of tiles per 15 s feed run → a full sweep every ~2 min; global lists every 30 s;
aircraft not re-observed for 240 s are dropped. Sparse regions (Africa interior, oceans outside the
NAT tracks, Russia, South America outside the south-east) are not covered by the keyless path.
