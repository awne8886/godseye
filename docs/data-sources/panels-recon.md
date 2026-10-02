## panels-recon

RECON, SEARCH, ROUTE, DRAW, ARCGIS and WORLD REMOTE. Every upstream is called by this server
(never by the browser) with the GODSEYE User-Agent, through `httpJson/httpText` (fixed hosts) or
`safeFetch()` (user-supplied hosts: security-header targets) or `allowListedFetch()` (ArcGIS services: exact-host allow-list). Each lookup
returns `providers: {name: {ok, count, ms, age_s, error?, skipped?}}` and a `timestamp`; a
lookup where no provider answered is a 503 (`source_offline`, or `not_configured` /
`budget_exhausted` when every provider was skipped), never an empty result.

Probed 2026-09-30 (ArcGIS rows re-probed 2026-10-01) from the build sandbox with
`curl -sS -m 25 -A 'GODSEYE/0.1.0 (+https://github.com/awne8886/godseye; contact https://github.com/awne8886/godseye/issues)'`
(the app's `userAgent()`, plain ASCII).
Fixtures recorded from these probes live in `src/components/panels/recon/__fixtures__/`.

### Geocoding and routing

| Upstream | Route(s) | Status | Latency | CORS | Auth / licence | Limits we apply | Notes |
|---|---|---|---|---|---|---|---|
| `photon.komoot.io/api/`, `/reverse` | `/api/geosearch`, `/api/geo/reverse` | 200 | 3.1–3.7 s | `*` | keyless · © OSM contributors (ODbL) | `providerBucket('photon', 2/s)` in `geocode.ts`; 10 min memory cache; reverse cached 30 days per 0.1° cell | Type-ahead only after 300 ms debounce (client) and ≥ 2 chars. Slow from this egress (3 s). Fields: `geometry.coordinates`, `properties.{name,city,state,country,countrycode,osm_value,extent}` |
| `nominatim.openstreetmap.org/search`, `/reverse` | same | 200 | 0.5–1.0 s | `*` | keyless · ODbL · usage policy: ≤ 1 req/s, no autocomplete | lead's `SerialQueue` (1.1 s, ≤ 40 queued) + 30-day SnapshotStore cache | Search only on explicit submit when Photon has no answer; reverse only when Photon fails |
| `ipwho.is/{ip}` | `/api/geo`, `/api/osint/ip`, `/api/osint/sweep` | 200 | 0.45 s | `*` | keyless · 1,000 requests/day, commercial use allowed (ipwhois.io/pricing, 2026-10-02) | `providerBucket('ipwho.is', 1/s)` + a 1,000/UTC-day budget (`ipwhoProbe`): spent → skipped `budget`, FreeIPAPI fallback | `/api/geo` only after the visitor clicks "Centre on my region"; answer rounded to 0.1°, never cached |
| `free.freeipapi.com/api/v1/json/{ip}` | `/api/geo`, `/api/osint/ip` | 200 (v0 path → 307 to v1) | 0.46 s | `*` | keyless (60 req/min) | 1/s | **Changed**: `/api/json/{ip}` now 307-redirects to `/api/v1/json/{ip}`; we call v1 directly |
| `valhalla1.openstreetmap.de/route` (POST) | `/api/directions` | 200 | 0.75 s (auto), 0.9 s (pedestrian) | `*` | keyless FOSSGIS · ODbL | `providerBucket('valhalla', 1/s)` | `alternates: 2` (two locations only), `units: kilometers`, `summary.has_toll/has_highway/has_ferry`; polyline precision 6. `VALHALLA_URL` for self-hosting |
| `valhalla1.openstreetmap.de/height` (POST) | `/api/directions` (walk/bike) | 200 | 0.6 s | `*` | keyless | same bucket | `range: true` → `range_height [[dist, h]…]`; ≤ 120 samples |
| `router.project-osrm.org/route/v1/driving` | `/api/directions` fallback | 200 | 0.55 s | `*` | keyless demo server (fair use) | `providerBucket('osrm', 1/s)` | No instruction text and no toll/highway/ferry flags: phrased from maneuver type/modifier; flags reported false with an explicit "not reported by OSRM" UI note. `OSRM_URL` for self-hosting |
| `routing.openstreetmap.de/routed-foot`, `/routed-bike` | `/api/directions` walk/bike fallback | 200 | 0.7 s | `*` | keyless FOSSGIS | same bucket | Same OSRM v5 API |
| `www.arcgis.com/sharing/rest/search` | `/api/arcgis?q=` | 200 | 0.32 s | reflects Origin | keyless public catalogue | 2/s, 10 min cache | Query restricted to `type:"Feature Service" OR type:"Map Service"` and `access:public` |
| Allow-listed layer queries `…/rest/services/…/(Feature\|Map)Server/<n>/query?f=geojson`, exact hosts only (no `*.arcgis.com` wildcard): ArcGIS Online hosted services on `services.arcgis.com`, `services1`–`services9.arcgis.com`, `services-eu1.arcgis.com`, `services-ap1.arcgis.com` (path `/<orgId>/arcgis/rest/services/…`); Esri's `*.arcgisonline.com` under `/arcgis/rest/services/` only; operator hosts from `ARCGIS_ALLOWED_HOSTS` (exact host, optional port such as `:6443`, https only) | `/api/arcgis?url=` | 200 — probed 2026-10-01 19:30Z: services.arcgis.com USA_Major_Cities_ (2 features); services9.arcgis.com USGS_Seismic_Data_v1; services-eu1.arcgis.com Neptune land-use layer `?f=json`; services-ap1.arcgis.com root; sampleserver6.arcgisonline.com Earthquakes_Since1970 | 0.67 s; 0.42 s; 0.66 s; 0.93 s; 0.22 s | `*` (services, services9, -eu1, -ap1) / reflects Origin (sampleserver6) | service owner's terms | `allowListedFetch(url, arcgisRules())`: exact host (+ operator port) allow-list, and every hop (first request and each redirect) must keep the layer-query path shape (`AllowRule.pathPattern`: `/<orgId>/arcgis/rest/services/…/(Feature\|Map)Server/<n>/query` on hosted hosts), SSRF guard on every hop, URL rebuilt, 3.5 MB cap, 1000 features (`resultRecordCount` + `exceededTransferLimit` → `truncated`). Off-list host or port → 403 `host_not_allowed` before any DNS/network; `http://` → 400 `https_only`; redirect off-list or off-shape (e.g. to `/sharing/rest/…`) → 400 `blocked_target` | Never a raw proxy: only the rebuilt `/query` URL is fetched; properties reduced to primitives. Catalogue results carry `importable` (the arcgis.com "earthquakes" search returned 19 results on services{,1,2,4,9}.arcgis.com and 1 on `mapsdep.nj.gov`, which is shown as "Host not allowed" unless the operator lists it) |
| Same, answering 4xx (wrong service, layer or item) | `/api/arcgis?url=` | probed 2026-10-01 19:30Z: services.arcgis.com `…/USA_Major_Cities_typo/FeatureServer/0/query` → **400** `text/html` "Bad Request"; same service `/FeatureServer/57` → 400; unknown org id → 400; sampleserver6 `…/No_Such_Service/FeatureServer/0/query` → **404** ArcGIS Server HTML page; sampleserver6 `…/Earthquakes_Since1970/FeatureServer/57/query` → **200** with `{"error":{"code":400,"message":"Invalid or missing input parameters.","details":["Invalid Layer or Table ID: 57."]}}` | 0.56 s; 0.31 s; 0.29 s; 0.26 s; 0.20 s | `*` / reflects Origin | — | HTTP 4xx (except 408/429), and an ArcGIS error body with a 4xx `code` under HTTP 200 (498/499 = token required), → **422 `service_error`** with `upstreamStatus`, the ArcGIS message as text (HTML bodies are never relayed), `providers.service.error: "http_<status>"`, no Retry-After: the host answered, so it is not SOURCE OFFLINE. 5xx, 408, 429, timeouts and non-GeoJSON 200s stay 503 `source_offline` with Retry-After 30 | Fixtures: `arcgis-hosted-bad-service-400.txt`, `arcgisonline-sample6-no-such-service-404.html`, `arcgisonline-sample6-layer-57-error.json`. Probe note: the User-Agent must be plain ASCII — a probe UA containing a literal `…` made every `services*.arcgis.com` request answer 502 (Azure Front Door); the app's `userAgent()` is ASCII-only (`contactFrom()`) |
| Same, REST Services Directory casing and over-cap layers | `/api/arcgis?url=` | probed 2026-10-01 23:45Z: services9.arcgis.com `/RHVPKKiFTONKtxq3/ArcGIS/rest/services/USA_Wildfires_v1/FeatureServer/0/query?f=geojson&resultRecordCount=1` → **200** (1.1 kB); reviewer: `…/USA_Wildfires_v1/FeatureServer/1` full layer exceeds the 3.5 MB cap | 0.54 s | `*` | service owner's terms | The layer-query path shapes are case-insensitive (`/<org>/ArcGIS/rest/services/…` is the same service as `/arcgis/`), so the directory form is importable and catalogue hits in that form are `importable: true`; other APIs on the host stay refused in any casing. A layer over 3.5 MB → **422 `layer_too_large`** (host answered; a retry cannot succeed), not 503 | — |

#### Routing snap check (R4-M1), probed 2026-09-30

| Request | Status | Latency | CORS | Result |
|---|---|---|---|---|
| OSRM `route/v1/driving/13.38,52.52;-74,40.7` (Berlin → New York) | 200 `code: Ok` | 0.97 s (full), 0.50 s (simplified) | `*` | `waypoints[0].distance` 4.8 m, `waypoints[1].distance` **5,534,234 m** (snapped to Cabo da Roca, `[-9.497727, 38.78069]`), route 2,827 km. Now answered 422 `no_route` |
| OSRM `route/v1/driving/13.38,52.52;2.35,48.86` (Berlin → Paris) | 200 `code: Ok` | 0.41 s | `*` | waypoints 4.8 m / 39.2 m, route 1,050 km — passes the gate |
| Valhalla `/route` auto Berlin → New York | **400** `error_code 154` "Path distance exceeds the max distance limit: 1500000 meters" | 0.40 s | `*` | provider reported `http_400` |
| Valhalla `/route` auto Berlin → Paris | 200 | 1.42 s | `*` | 1,112 km; `trip.locations` echoes the requested points (no snapped position), so the gate measures the shape's first/last vertex |

Gate (`snapGap`, `SNAP_LIMIT_M = 5000`): start/destination vs the route's first/last vertex, via points vs the nearest vertex, and OSRM `waypoints[].distance` when present (the larger wins). OSRM `NoRoute` is also 422 `no_route`; both engines failing stays 503 SOURCE OFFLINE.

### OSINT (passive, infrastructure only)

| Upstream | Route | Status | Latency | CORS | Auth / licence | Limits | Notes |
|---|---|---|---|---|---|---|---|
| `dns.google/resolve` | `/api/osint/dns` | 200 | 0.27–0.29 s | `*` | keyless | 10/s | `Status` rcode, `Answer[{name,type,TTL,data}]`; `_dmarc.<domain>` TXT added for the DMARC finding |
| `rdap.org/domain/{d}` | `/api/osint/whois` | 200 (→ registry RDAP) | 0.52 s | `*` | keyless | 2/s | Follows the bootstrap redirect (≤ 3 hops); events `registration/expiration/last changed` |
| `crt.sh/?q=%.{d}&output=json&exclude=expired` | `/api/osint/certs` | 200 | 2.4 s (filtered), 5.9 s (unfiltered) | `*` | keyless (Sectigo) | 0.5/s, **20 s timeout + 1 retry**, 45 s deadline, 1 h cache | Flaky (404/13 s seen in Phase 0); zone-less `not_before/not_after` → `normalizeUtc()` |
| user URL (HEAD, GET on 405/501) | `/api/osint/headers` | 200 (example.com) | 0.44 s | n/a | — | `safeFetch`, 5 min cache | Described in the UI as "proxied through this server"; grade A–F with every deduction listed |
| `ip-api.com/json/{ip}` (HTTP only) | `/api/osint/ip` | 200 | 0.11 s | `*` | **non-commercial** → `nc_sources` | 45/min | Adds `proxy/hosting/mobile` flags; skipped (`licence`) on commercial deployments |
| `stat.ripe.net/data/{network-info,as-overview,announced-prefixes,asn-neighbours}` | `/api/osint/ip`, `/api/osint/bgp` | 200 | 0.63–0.97 s | `*` | keyless, `sourceapp=godseye` | **≤ 8 concurrent** (semaphore) and **1000/day** budget (UTC) → `skipped: 'budget'`; 1 h cache | announced-prefixes for AS15169 is 158 KB |
| `internetdb.shodan.io/{ip}` | `/api/osint/shodan`, `/api/osint/sweep` | 200; 404 `{"detail":"No information available"}` = not indexed | 0.26–0.5 s | `*` | keyless, **non-commercial** → `nc_sources` | 2/s, 1 h cache | Sweep: /28–/32 only (≤ 16 lookups), existing scan data, no packets to targets |
| `api.maclookup.app/v2/macs/{oui}` | `/api/osint/mac` | 200 | 0.63 s | none | keyless (free tier) | 2/s, 24 h cache | `found, company, country, blockType, isRand` |
| `cveawg.mitre.org/api/cve/{id}` | `/api/osint/cve` | 200 | 0.35 s | `*` | keyless | 2/s | CVE JSON 5; CVSS from `containers.cna.metrics` |
| `cve.circl.lu/api/cve/{id}` | `/api/osint/cve` (fallback) | 200 | 0.6 s | `*` | keyless | 2/s | Same CVE JSON 5 record |
| `services.nvd.nist.gov/rest/json/cves/2.0?cveId=` | `/api/osint/cve` | 200 | 0.32 s | `*` | keyless 5/30 s; `NVD_API_KEY` (header `apiKey`) 50/30 s | bucket per key state | `cisaExploitAdd/cisaActionDue` = KEV flag |
| `check.torproject.org/torbulkexitlist` | `/api/osint/threats` | 200 | 1.0 s | none | keyless | 30 min cache | Exact IP match only |
| `feodotracker.abuse.ch/downloads/ipblocklist.json` | `/api/osint/threats` | 200 | 0.35 s | none | abuse.ch (not-for-profit use) → `nc_sources` | 15 min cache | |
| `threatfox-api.abuse.ch/api/v1/`, `urlhaus-api.abuse.ch/v1/host/` | `/api/osint/threats` | **401 Unauthorized** without a key | 0.45 s | none | **now require `Auth-Key`** → `ABUSECH_AUTH_KEY` | 1/s | ThreatFox used when the key is set (header, never URL); URLhaus API not wired (bulk feeds belong to layers-threats-network) |
| `otx.alienvault.com/api/v1/indicators/…/general` | `/api/osint/threats` | 502 (keyless, 2026-09-30) | 0.55 s | none | `OTX_KEY` (header `X-OTX-API-KEY`) | 1/s | Keyed only; skipped `not-configured` otherwise |
| `data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv` | `/api/osint/sanctions` | 307 → artifact, 200, 7.58 MB | 1.4 s | `*` | **CC BY-NC 4.0** → `nc_sources` | downloaded once per 24 h; the query never leaves the server | Only screening fields kept (no addresses/birth dates/phones/emails). Also used for exact wallet-identifier hits in `/api/osint/crypto` when already loaded |
| `mempool.space/api/address/{a}` | `/api/osint/crypto` (BTC) | 200 | 0.32 s | `*` | keyless | 2/s | balance = funded − spent (sats) |
| `eth.blockscout.com/api/v2/addresses/{a}` (+ `/counters`) | `/api/osint/crypto` (ETH) | 200 | 0.34–0.55 s | `*` | keyless | 2/s | `is_scam`, `reputation`, `public_tags`, `transactions_count` |
| `api.mainnet-beta.solana.com` (POST `getBalance`) | `/api/osint/crypto` (SOL) | **403 "Access forbidden"** from this egress | 0.19–0.4 s | `*` | keyless public RPC | 1/s | Reported as `http_403`; Helius not wired (its key would go in the URL, which §0.6 forbids) |
| `api.xposedornot.com/v1/breaches?domain=` | `/api/osint/leaks` | 200 (`"No breaches found"` for example.com; Adobe for adobe.com) | 0.37–0.45 s | `*` | keyless | 1/s, 24 h cache | **Organisation domains only**; email/phone input refused (400 `personal_identifier`) |

### Optional scanner backend

`/api/scanner` is off unless the operator sets `SCANNER_URL` + `SCANNER_KEY` (`scanner`
capability). Passive types: ssl, headers, rdns, subdomains, tech, whois, geoloc. Active types
(quick, vuln) also need `SCANNER_ALLOW_ACTIVE=true`. The target is validated by the SSRF guard and
the backend receives the pinned IP (`target=`) plus the hostname (`host=`); the key is sent as
`Authorization: Bearer …` (OSIRIS put it in the query string). No redirects are followed.
Not probed: no backend exists in this environment.

### Browser-only

World Remote uses Web Bluetooth (`navigator.bluetooth.requestDevice`) with the browser's own
device chooser and reads `battery_service` / `device_information` only. No network requests, no
WebRTC, no local-network or port probing (OSIRIS's WorldRemote did both; a static test fails if
those APIs appear in `src/components/panels/remote/**`).
