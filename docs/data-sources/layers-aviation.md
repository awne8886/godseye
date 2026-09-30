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

Re-probed 2026-09-30 22:42–22:43 UTC (Phase 3 round 1), same UA and Origin:

| Upstream | Status | Latency | CORS | Notes |
|---|---|---|---|---|
| `https://api.adsb.lol/v2/point/51.5/-0.1/100` ×6, 1.2 s apart | 200 ×6 | 0.63–1.08 s | none (no ACAO) | 71 aircraft at night, ~41 kB; no rate-limit or Retry-After headers on 200; `seen_pos` median 0.27 s, max 57.7 s |
| `https://api.adsb.lol/v2/point/40.7/-74.0/250` | 200 | 2.15 s | none | 932 aircraft, 477 kB; `seen_pos` median 0.28 s / p90 4.6 s; 15 rows kept as `__fixtures__/adsblol-point-classify.json` (classifier table test: GL5T/GLF5 under A3 → jet, E55P/LJ45 under A2 → jet, A1 designator callsigns → commercial, A6 at 5 000 ft with a registration callsign → private, EC35 A7 → private + helicopter) |
| `https://vrs-standing-data.adsb.lol/routes/BA/BAW123.json` | 200 | 0.28 s | `*` | `airport_codes 'EGLL-OTHH'` (LHR→DOH): the R2 off-route example, now rejected by the 1.5 × route-length gate when the aircraft is over the Pacific |
| `https://api.adsbdb.com/v0/aircraft/A71329` | 200 | 0.69 s | `*` | Global 7500 `GL7T`, N555MZ, owner Phenix Jet (US) — the R2-M1 example; OSIRIS buckets it `jet` |

Not used: `api.airplanes.live` (403 "contact us" on every endpoint, docs/reference/25 §15);
adsb.lol `/api/0/routeset` (non-functional, §6.2). Keyed/licensed adapters (not probed here, no
credentials): `re-api.adsb.lol/?all_with_pos&jv2` (`ADSBLOL_REAPI=true`, feeder IP only; 403 from
non-feeders per docs/reference/25 §9), OpenSky `/api/states/all?extended=1` with OAuth2 client
credentials (`OPENSKY_LICENSED=true` + `OPENSKY_CLIENT_ID/SECRET`; written licence required for a live
product), adsb.fi `/api/v2/mil` (`ADSBFI_PERSONAL_USE=true`, 1 req/s, personal non-commercial only).

Coverage: 86 tiles of 250 nm (hex lattice laid out for 230 nm so circles overlap) over the busiest
airspace, one request start every 1.2 s through `providerBucket('api.adsb.lol', 1/1.2)`, ≤ 1 in
flight (`adsblolSerial`, shared with the global lists). Since Phase 3 round 1 (R2-M2) one background
worker (`server/tile-sweeper.ts`) reads tiles back to back instead of 25 s slices separated by a 15 s
idle TTL (~60 % duty → full sweep 170–270 s, 50–78 % of positions older than the 60 s
dead-reckoning cap); dense tiles are re-read more often (`(count + 1) × age`), every tile within
165 s, and a 429 backs off for at least its `Retry-After`. Simulated with 86 skewed tiles at
1.5 s/request: 38 % of aircraft behind a tile read > 60 s ago vs 54 % for round-robin at the same
rate (`tile-sweeper.test.ts`). Upstream `seen_pos` is not the cause: median 0.28 s, p90 4.6 s,
max 57 s over 932 rows. Global lists every 30 s; aircraft not re-observed for 300 s are dropped.
The real fix for full-world freshness is the `ADSBLOL_REAPI` feeder upgrade (one request per run).
Live check 2026-09-30 23:12–23:17 UTC (production build on :3150, cold start, sampled every 20 s):
share of rows older than 60 s was 0.5–4 % for the first minute and 40–79 % at 3–5 min, median age
57–114 s, 8.1k aircraft. api.adsb.lol answered `http_429` in 7 of 16 samples. At least two other
GODSEYE servers were sweeping from the same sandbox egress IP at the same time; whether those 429s
carried `Retry-After` was not captured. The exponential back-off (15 s … 5 min) then dominates the sweep. A single
deployment per IP should see fewer 429s. This was not measured here. Sparse regions (Africa interior, oceans outside the
NAT tracks, Russia, South America outside the south-east) are not covered by the keyless path.
