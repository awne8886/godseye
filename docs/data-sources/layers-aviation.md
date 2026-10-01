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

Re-probed 2026-10-01 02:08–02:09 UTC (Phase 3 round 2), same UA, `Origin: https://example.org`:

| Upstream | Status | Latency | CORS | Notes |
|---|---|---|---|---|
| `https://api.adsb.lol/v2/point/51.5/-0.1/100` ×6, ~1.7 s apart | 200 ×6 | 0.46–0.70 s | none (no ACAO) | no `Retry-After` / rate-limit headers |
| same, ×20, ~1.3 s apart | 200 ×20 | 0.46–0.71 s | none | no 429 from this client alone; 19 aircraft at night, `seen_pos` median 0.29 s, max 33.8 s, none > 60 s |

So the upstream positions are fresh; the share of aircraft older than the 60 s cap comes from the
sweep period (86 tiles × ≥ 1.2 s ≥ 103 s) plus 429 back-off when several servers share an egress IP.
The spacing stays at the contract's 1.2 s (faster would only invite more 429s). Since round 2 the
rail reports it honestly: each aviation layer publishes `staleCount` ("N OLDER THAN 60 S") and reads
RECENT when more than half its positions are past the cap, STALE at ≥ 90 % (`client/stale.ts`).

Re-probed 2026-10-01 ~04:44–05:10 UTC (Phase 3 round 3b), same UA, `Origin: https://example.org`:

| Upstream | Status | Latency | CORS | Notes |
|---|---|---|---|---|
| `https://api.adsb.lol/v2/point/51.47/-0.45/50` ×2 | 200 ×2 | 0.62–0.78 s | none (no ACAO) | server-side only, as before; no new fixture needed |
| local `/api/flights` (built app) | 200 | ~10 s cold sweep | same-origin | ~1–4k aircraft rows; used by the globe/mercator draw e2e |

Round 3b globe fix (no upstream change): aircraft billboards drew nothing on the globe because
MapLibre leaves back-face culling enabled after the globe tiles and the interleaved deck layers
inherit it; IconLayer flips its quad in Y, so its triangles wind backwards and were culled
(mercator draws no culled geometry, so it was fine). `ICON_PARAMETERS = {cullMode: 'none',
depthCompare: 'always'}` on the icons and rings. Evidence (SwiftShader, z5 over the Channel): plain
IconLayer billboard 0 aircraft drawn; plain IconLayer non-billboard + `cullMode: 'none'` draws;
billboard + `cullMode: 'none'` draws (half-clipped by the globe depth without `depthCompare:
'always'`); SDF + both draws with its outline. The SDF `fs:#main-end` injection was not the cause.

Re-probed 2026-10-01 05:52–06:08 UTC (Phase 3 round 4), same UA, `Origin: http://localhost:3000`,
requests ≥ 2 s apart:

| Upstream | Status | Latency | CORS | Notes |
|---|---|---|---|---|
| `https://vrs-standing-data.adsb.lol/routes/{XX}/{CS}.json` ×45 (R2's 43 multi-leg callsigns + UAL1118, WZZ1738) | 200 ×45 | 0.05–0.60 s | `*` | every `airport_codes` unchanged since R2's 05:2x scan; `_airports[].{icao, lat, lon, alt_feet}` kept as `__fixtures__/route-legs-2026-10-01.json` (with R2's observed positions/tracks; 2-airport coordinates from OurAirports) |
| `HEAD …/routes/UA/UAL1118.json`, `…/DA/DAL709.json` | 200 ×2 | 0.21–0.49 s | `*` | `Last-Modified: Sun, 20 Sep 2026 18:47–18:48 GMT` |
| `https://api.adsb.lol/v2/callsign/DAL709` | 200 | 0.38 s | none | a7f2d2 at 35.893,-110.562, FL350, trk 066 — eastbound from SAN: the KSAN→KJFK leg (R2 BLOCKING-1) |
| `https://api.adsb.lol/v2/callsign/DAL571` | 200 | 0.15 s | none | a6893e at 35.918,-111.019, FL330, trk 065 — the KSAN→KBOS leg |
| `https://api.adsb.lol/v2/callsign/AFR832` | 200 | 0.14 s | none | `total: 0` (landed at CDG) |
| `https://api.adsb.lol/v2/callsign/UAL1118`, `/WZZ1738`, `/v2/point/51.5/-0.1/100` | **429** ×3 | 0.13 s | none | no `Retry-After`; this sandbox shares its egress IP with the running app's tile sweeper — the reason for the sweep hysteresis below |
| VRS `alt_feet` / adsbdb `elevation` | — | — | — | now carried as `RouteAirport.elevationFt`: "low" near an end is AGL (< 3,000 ft above the field), as in the FLIGHT view |

Round 4 behaviour (no new upstream): `/api/flight-route` uses `icao24` (exact snapshot position;
the aircraft's flown track from `/api/aircraft`'s cached trace lookup to corroborate a reversed
leg). The tile provider stays `ok` while any tile was read since the last run and is held for one
sweep period (165 s) through a 429 burst; `/api/flights` and the SSE stream never report LIVE while
the positions provider is `ok: false` (RECENT ≤ 360 s of last-good age, else STALE).

Re-probed 2026-10-01 16:06–16:16 UTC (Phase 3 round 5), same UA, `Origin: https://example.org`,
requests ≥ 2 s apart (adsb.lol) / 1.2 s (VRS):

| Upstream | Status | Latency | CORS | Notes |
|---|---|---|---|---|
| `https://api.adsb.lol/v2/callsign/SWA1241` | 200 | 3.63 s | none (no ACAO) | abd254 now 37.98,-89.99, 19,850 ft descending, trk 336 (a later leg toward St Louis); no rate-limit headers |
| `https://api.adsb.lol/v2/callsign/UAL1789` | 200 | 9.01 s | none | `total: 0` (landed) |
| `https://api.adsb.lol/v2/callsign/SWA1332` | 200 | 0.76 s | none | ac1747 now 41.50,-81.70, 3,400 ft, trk 252 (landing at Cleveland — a later leg) |
| `https://adsb.lol/data/traces/54/trace_full_abd254.json` | 200 | 2.84 s | none | 2,070 rows. SWA1241 took off **BWI** 12:43:36Z (51 km from DCA), landed **CLT** 13:42:09Z — not VRS's KSMF-KLAS-KDCA |
| `https://adsb.lol/data/traces/cc/trace_full_a2bbcc.json` | 200 | 0.80 s | none | 4,009 rows. UAL1789 took off **IAD** 12:55:47Z, landed **San Antonio** 15:46:22Z — not VRS's KRDU-KIAD-KORF (the FLIGHT view had shown "flown IAD→RDU") |
| `https://adsb.lol/data/traces/47/trace_full_ac1747.json` | 200 | 0.79 s | none | 3,750 rows. SWA1332 took off **Dallas Love** 11:20:21Z, landed **BWI** 13:52:18Z — not VRS's KMCO-KATL-KMDW |
| `https://adsb.lol/data/traces/1d/trace_full_a5d31d.json` (16:49Z) | 200 | 0.98 s | none | 2,998 rows. UAL374 (VRS ORD-LAX) took off **LAX** 02:28:47Z, landed **Phoenix** 03:24:56Z — flight-paths' r3 fixture expects "flown LAX→ORD"; the shared `headingFor` test refuses it (request to feature-flight-paths) |
| `https://vrs-standing-data.adsb.lol/routes/{SW,UA,SW,DA}/{SWA1241,UAL1789,SWA1332,DAL3069}.json` | 200 ×4 | 0.22–0.39 s | `*` | `airport_codes` KSMF-KLAS-KDCA, KRDU-KIAD-KORF, KMCO-KATL-KMDW, KATL-KBNA-KATL; `Last-Modified: Sun, 20 Sep 2026 18:47–18:48 GMT` |

Kept as `src/features/aviation/__fixtures__/route-r5-2026-10-01.json`: the trace row nearest the
position R2 recorded at 13:2xZ (≤ 1.9 km away), the current leg up to it (`currentLeg`, ≤ 60 points),
where that leg really ended, and the VRS airports (with `alt_feet`).

Round 5 behaviour (no new upstream): when the observed track points away from the leg's destination
(> 60 km from both ends, cos < −0.3) `/api/flight-route` reads the flown track and withholds the leg
unless a take-off corroborates one (`src/features/aviation/corroborate.ts`, the FLIGHT view's rule
plus a direct-bearing test for "toward"); all three cases above are withheld. A round trip asked
without a position (DAL3069 KATL-KBNA-KATL) is withheld as "leg unknown", never ATL→ATL.
adsb.lol's `now` ran up to ~1 s ahead of this server's clock (R2: `meta.observedAt` 23–1067 ms after
`fetchedAt`): positions are now dated from `min(now, receipt)` rounded down, so no observation is
reported after the fetch that carried it.
