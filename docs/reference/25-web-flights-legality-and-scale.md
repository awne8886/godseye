# Legal keyless live ADS-B at OSIRIS scale; how OSIRIS really gets ~13k aircraft
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
**Question answered:** What legal data source can a public deployment use for global, keyless live ADS-B at OSIRIS scale (about 12.9k aircraft)? How exactly does osirisai.live reach that count: OpenSky OAuth global /states/all plus tiled adsb.fi calls at 1.1 s pacing? Does adsb.lol offer any all-world or re-api endpoint to non-feeders, and on what terms?

## Summary

HOW OSIRIS GETS ~13k AIRCRAFT (verified from source and from the live API on 2026-09-30). It does NOT use tiled adsb.fi calls in normal running. Every cycle, src/app/api/flights/route.ts fetches two things in parallel. The first is ONE global OpenSky call, GET https://opensky-network.org/api/states/all?extended=1 (4 credits). It sends an OAuth bearer token only when OPENSKY_CLIENT_ID/SECRET are set. The second is adsb.fi /api/v2/mil. Results are merged and de-duplicated by ICAO hex. The OpenSky snapshot is cached and refreshed every 90 s with credentials, or every 900 s anonymously (96 calls x 4 = 384 of 400 credits a day). A 429 triggers a 15-minute cooldown. The server response is cached for 90 s. The browser polls /api/flights every 300 s and does no dead-reckoning between polls.

The 30-region adsb.fi sweep (250 nm radius, 1.1 s gap) is a last resort. It runs only when no OpenSky snapshot exists, and it is broken. It calls the deprecated https://opendata.adsb.fi/api/v2/lat/../lon/../dist/250, which returns {aircraft:[...]} and not {ac:[...]}. The code reads data.ac, so it always ingests 0. The live endpoint confirms this state: source='opensky-anon', opensky=13024, adsbfi_mil=472, total=13226, opensky_auth=false, opensky_age_s=280. So the production site runs on anonymous OpenSky, and its positions can be up to about 15 minutes old. An independent anonymous OpenSky /states/all call returned 13,151 states (13,075 with a position), which matches the site's count. OSIRIS also sends every request through 'stealthFetch', which spoofs X-Forwarded-For/X-Real-IP with random residential ISP IPs and rotates User-Agents.

LEGALITY. No free, keyless source is clearly licensed for a public live product at global scale.
- OpenSky: the Terms of Use require a prior written license for any 'operational' REST API use, 'including integration into a live product, service, or automated system', even for non-profits (§1, §3(vi)). They also forbid concealing identity (§2(i)) and using multiple accounts to get around limits (§3(v)). The tiers are anonymous 400 credits/day, standard 4,000/day, active feeder 8,000/day and licensed 14,400/hour. A global call costs 4 credits.
- adsb.fi: 'personal, non-commercial use only'. Public endpoints allow 1 request/second, you must cite adsb.fi and link to it, and the all-aircraft /v2/snapshot is for feeders only (it returned 403 in testing).
- airplanes.live: every endpoint returns 403 with the message 'Please contact us at contact@airplanes.live'.
- ADS-B Exchange: the Community API is $10/mo for 10,000 requests, non-commercial, via RapidAPI. Enterprise pricing is not published and requires a minimum annual commitment.
- Flightradar24 API: commercial=1 on all plans. Explorer $9/mo (30k credits), Essential $90/mo (333k), Advanced $900/mo (4.05M).
- adsb.lol: the most permissive option. The API says 'You can use the API for free' and 'The API is available to everyone', with no key today (a key obtained by feeding is planned). Data is under ODbL 1.0 (attribution plus share-alike, commercial use allowed) and rate limits are 'dynamic'.

DOES adsb.lol HAVE AN ALL-WORLD ENDPOINT FOR NON-FEEDERS? No. The public /v2 routes are only /pia, /mil, /ladd, /squawk|/sqk, /type, /registration|/reg, /hex|/icao, /callsign, /point|/lat/lon/dist (radius capped at 250 nm) and /closest. The whole-network readsb 're-api' at https://re-api.adsb.lol supports ?all, ?all_with_pos and ?box. It is ODbL 1.0 and 'only accessible by your station's IP address', and the docs say you can reach it from elsewhere through a VPN or proxy. It returned 403 'Access denied' from here.

The OSIRIS source comment says adsb.lol /v2 'always returns {"ac":[],"total":0}'. That is out of date. A 250 nm London /v2/point query returned 756 aircraft. A paced 30-tile sweep using OSIRIS's REGIONS returned 7,214 unique aircraft (30 of 30 HTTP 200, 2 empty tiles, 89 s at a 1.1 s gap). That is about 55% of OpenSky's global count, so reaching OSIRIS scale needs a denser grid or re-api access as a feeder.

## Findings

### 0. OSIRIS flights pipeline: primary source (verified)

Phase 1+2 run in parallel through Promise.allSettled: stealthFetch(`${ADSBFI_BASE}/mil`) with ADSBFI_BASE='https://opendata.adsb.fi/api/v2', plus stealthFetch('https://opensky-network.org/api/states/all?extended=1', osInit). The Bearer token comes from the client_credentials flow at https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token, only when OPENSKY_CLIENT_ID/SECRET are set. OpenSky interval: openSkyInterval() = creds ? 90000 : 900000 ms. The snapshot is reused between refreshes only if it had more than 100 states. On a 429: OPENSKY_COOLDOWN = 15 min. Response cache CACHE_TTL = 90000 ms. Concurrent requests share one in-flight promise (fetchPromise). Merge is ingestAc(): military first, then the OpenSky snapshot, de-duplicated by lower-cased hex. OpenSky state-vector mapping: s[0] hex, s[1] callsign, s[5] lon, s[6] lat, s[7] baro altitude m→ft (x3.28084), s[9] m/s→kt (x1.94384), s[10] track, s[14] squawk, s[17] category (needs extended=1). Classifier buckets: commercial/private/jet/military plus heli. Also builds gps_jamming: NACp ≤4 points on a 2° grid, count ≥3. Response fields: total, source ('opensky-auth'|'opensky-anon'|'regional'), providers{adsbfi_mil, adsbfi_regional, opensky, opensky_auth, opensky_age_s}.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/flights/route.ts

### 1. OSIRIS regional adsb.fi sweep is a broken last resort, not the steady state (verified)

REGIONS has 30 hard-coded centres at 250 nm radius. They are fetched one after another with ADSBFI_GAP_MS = 1100 (about 33 s), but only when there is no OpenSky snapshot (`if (!openSkyWorked)`). fetchAdsbFiRegion() calls `${ADSBFI_BASE}/lat/${lat}/lon/${lon}/dist/250` = the deprecated v2 endpoint and returns `data.ac || []`. Live probe: https://opendata.adsb.fi/api/v2/lat/51.5/lon/-0.1/dist/250 returned keys ['now','aircraft','resultCount','ptime'] with 785 aircraft under 'aircraft', and no 'ac' key. So the fallback always yields 0 aircraft. The v3 equivalent /api/v3/lat/51.5/lon/-0.1/dist/250 returned keys ['ac','msg','now','total','ctime','ptime'] with 785 aircraft. The fix is to use /v3 (or read .aircraft).

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/flights/route.ts

### 2. Live osirisai.live flight provenance (2026-09-30) (verified)

GET https://osirisai.live/api/flights returned: commercial 8911, private 3171, jets 590, military 375, gps_jamming 0, total 13226, source 'opensky-anon', providers {adsbfi_mil:472, adsbfi_regional:0, opensky:13024, opensky_auth:false, opensky_age_s:280}. The public site therefore runs WITHOUT OpenSky credentials on the anonymous 900 s refresh, and roughly 98% of aircraft come from OpenSky. The front end (src/app/page.tsx) polls /api/flights every 300000 ms ('5 min (was 2 min)'). No flight dead-reckoning or extrapolation code was found in the repo (GitHub code search for extrapolate / 'dead reckoning' / speed_knots returned nothing outside the route). Displayed positions can be about 15-20 minutes old.

Source: https://osirisai.live/api/flights

### 3. OSIRIS stealthFetch header spoofing (verified)

src/lib/stealthFetch.ts: 'Generates randomized HTTP headers to distribute API requests across a pool of spoofed residential IP addresses and browser fingerprints'. It sets X-Forwarded-For/X-Real-IP to random IPs drawn from Comcast/AT&T/Verizon/BT/Telekom/Orange and similar ranges, and rotates 10 browser User-Agents. This conflicts with OpenSky ToU §2(i) ('use false information, or otherwise conceal Your identity') and is bad practice toward every provider. Do NOT replicate it.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/lib/stealthFetch.ts

### 4. OSIRIS docs/env on flights (verified)

README table: 'Aviation | Commercial, Private, Military, Jets | OpenSky Network'. .env.example: 'OpenSky Network — aviation (higher rate limits than the keyless feed). Free account. Since March 2025 OpenSky uses OAuth2 ... create a new API client, and copy the client_id / client_secret.'

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/.env.example

### 5. OpenSky Terms of Use: live product needs a written license (verified)

Tl;dr at the top of the page: 'Operational REST API use: Use of the REST API in any operational capacity — including integration into a live product, service, or automated system (even if only internal) — requires a previous written agreement, even for non-profit or governmental entities.' §1: the license is 'solely for the purpose of non-profit research and non-profit education'; 'Operational use of the REST API in any live product, service, or automated system also requires a written license'. §3(vi) says the same. §3(iii): no redistribution of data sets. §3(v): no multiple accounts 'to circumvent technical restrictions'. §2(i): no concealing identity. §4(i): publications, including web pages, must send OpenSky a link and cite Schäfer et al., 'Bringing up OpenSky...', IPSN 2014. Contact: contact[at]opensky-network.org.

Source: https://opensky-network.org/about/terms-of-use

### 6. OpenSky REST API credits and limits (verified)

States, tracks and flights each have their own credit bucket. Tiers: Anonymous 400/day (bucketed by IP, most-recent data only, 10 s resolution); Standard user 4,000/day; Active feeder (≥30% uptime per month) 8,000/day; Licensed user 14,400/hour. /states/all cost by bbox area: ≤25 sq° = 1, 25-100 = 2, 100-400 = 3, >400 or global = 4. /flights/* and /tracks/*: live or <24 h = 4 credits, 1-2 day partitions = 30. The X-Rate-Limit-Remaining header shows the balance. When exhausted: 429 plus X-Rate-Limit-Retry-After-Seconds. OAuth2 client-credentials is the only auth method (basic auth removed). Global poll ceilings: anonymous ~every 864 s, standard every 86.4 s, feeder every 43.2 s, licensed 1/s. Test from this environment: an anonymous /states/all returned 13,151 states (13,075 with position) and x-rate-limit-remaining 382. The anonymous per-IP pool is shared on proxy/VPS IPs.

Source: https://openskynetwork.github.io/opensky-api/rest.html

### 7. adsb.fi open data terms and endpoints (verified)

Base https://opendata.adsb.fi/api/. Public endpoints: /v2/hex, /v2/icao, /v2/callsign, /v2/registration, /v2/sqk, /v2/mil, /v3/lat/{lat}/lon/{lon}/dist/{≤250 NM} (v2 lat/lon is deprecated and uses a different format). Feeder-only: /v2/snapshot ('all aircraft refreshed twice a minute'), which returned 403 from a non-feeder IP in testing. Limits: public 1 req/s, feeder snapshot 1 per 30 s. Responses with 400/401/403/404/429 count toward the limit, and 'excessive invalid HTTP requests' cause a temporary IP block. Terms: 'adsb.fi open data is for personal, non-commercial use only... You must cite adsb.fi and include a link to our home page.' 'Please contact us if you have commercial or higher request rate requirements.' /v2/mil returned 443 aircraft live.

Source: https://github.com/adsbfi/opendata

### 8. adsb.lol public API: endpoints, terms, license (verified)

FastAPI app description: 'The adsb.lol API is a free and open source API'; 'Terms of Service: You can use the API for free. In the future, you will require an API key which you can get by feeding to adsb.lol. Rate limits are dynamic based on the environment load. If you get 4xx errors, you are doing something wrong.' 'License: ... all data ADSB.lol makes public is ODbL.' The OpenAPI spec lives at /api/openapi.json, and /docs returned 502/503 during the check. Public /v2 routes in api_v2.py: /pia, /mil, /ladd, /squawk/{sq}|/sqk, /type/{type}, /registration|/reg, /hex|/icao, /callsign, /point/{lat}/{lon}/{radius}|/lat/{lat}/lon/{lon}/dist/{radius} (server clamps radius to min(r,250)), /closest. There is NO /v2/all. Output is ADSBx-v2 compatible ('drop-in replacement'). The docs page https://www.adsb.lol/docs/open-data/api/ says 'The API is available to everyone.' Source repo is BSD-3-Clause.

Source: https://raw.githubusercontent.com/adsblol/api/main/src/adsb_api/app.py

### 9. adsb.lol re-api (all-world) is feeder-only (verified)

Docs: 're-api is the readsb HTTP API, available to all ADSB.lol feeders.' 'License: ODbL 1.0.' 'You can access the API at https://re-api.adsb.lol. This is the readsb API of our entire network, unfiltered and unmodified. It is only accessible by your station's IP address, so if you want to access it from another location, you will need to use a VPN, or a proxy.' Example: https://re-api.adsb.lol?circle=52,2,200. From a non-feeder IP, https://re-api.adsb.lol/?all returned HTTP 403 'Access denied', and https://adsb.lol/re-api/?all returned 207 with an empty body. The readsb query syntax supports ?all, ?all_with_pos (position within the last minute), ?box=S,N,W,E, ?circle, ?closest, ?find_hex/find_callsign/find_reg (≤1000), &filter_mil/pia/ladd and &jv2 (ADSBx v2 JSON).

Source: https://www.adsb.lol/docs/feeders-only/re-api/

### 10. readsb re-api query syntax (verified)

'/?all_with_pos' returns all aircraft with a position received in the last minute (40 min for ADS-C). '/?all' adds Mode S-only aircraft seen in the last 30 s. '/?box=<lat south>,<lat north>,<lon west>,<lon east>'. The circle and closest queries add dst/dir fields. '&jv2' gives adsbexchange-v2-compatible output.

Source: https://raw.githubusercontent.com/wiedehopf/readsb/dev/README-json.md

### 11. adsb.lol site license and privacy (verified)

The Privacy and License page is run by @iakat and gives an 'as is' warranty disclaimer. Users indemnify ADSB.lol for 'use of the data in a manner not in conformance with the above notice'. Feeders' contributed data is waived under CC0. Hosting: Netcup (Germany), with Cloudflare as CDN. Public data and API are under ODbL 1.0 (per the API description and docs pages). ODbL allows commercial and public use but requires attribution, and share-alike if a derived database is made public.

Source: https://www.adsb.lol/privacy-license/

### 12. adsb.lol tiled sweep, measured at OSIRIS REGIONS (verified)

30 sequential GETs to https://api.adsb.lol/v2/point/{lat}/{lon}/250 using OSIRIS's 30 region centres, with a 1.1 s gap: 30 of 30 HTTP 200, 2 tiles empty, 7,214 unique hex, 89.4 s wall time (about 1.9 s average response). No rate-limit headers were seen on responses. That is about 55% of OpenSky's global 13.1k, so more tiles are needed for full coverage. Single London 250 nm tile: 756 aircraft, versus 785 from adsb.fi v3 for the same circle. This contradicts OSIRIS's code comment that adsb.lol /v2 'always {"ac":[],"total":0}'.

Source: https://api.adsb.lol/v2/point/51.5/-0.1/250

### 13. adsb.lol historical data (for past tracks) (verified)

'Historical data is dumped daily by: readsb-prod-0 readsb-prod-1 readsb-staging-0 https://github.com/adsblol/globe_history. The data is made available by GitHub releases... a file per aircraft, a JSON GZIP file'. License ODbL 1.0. The repo page returned 403 through this environment's proxy, so the release contents were not inspected.

Source: https://www.adsb.lol/docs/open-data/historical/

### 14. adsb.lol airport / route helpers (relevant to the airport-to-airport feature) (verified)

api_routes.py exposes GET /api/0/airport/{icao}, GET /api/0/route/{callsign}, GET /api/0/route/{callsign}/{lat}/{lng} ('Route plus plausible flag') and POST /api/0/routeset with body {planes:[{callsign,lat,lng}]}. Data comes from https://github.com/vradarserver/standing-data/. Live test: /api/0/airport/EGLL returned {icao:'EGLL', iata:'LHR', name:'London Heathrow Airport', lat:51.4706, lon:-0.461941, alt_feet:83, countryiso2:'GB'}. /api/0/route/BAW283 returned 302, and POST /api/0/routeset returned 201 with an empty body. Route lookup is therefore UNVERIFIED as working at test time.

Source: https://raw.githubusercontent.com/adsblol/api/main/src/adsb_api/utils/api_routes.py

### 15. airplanes.live API status (verified)

https://api.airplanes.live/v2/mil and /v2/point/51.5/-0.1/50 both return HTTP 403 with {"error": "Please contact us at contact@airplanes.live. Your email MUST include any links, a description of the project, and any information you deem appropriate."}. The api-guide page sits behind a Cloudflare challenge and its terms could not be read (UNVERIFIED).

Source: https://api.airplanes.live/v2/mil

### 16. ADS-B Exchange paid options (verified)

Developer Hub: 'The Community API (formerly API Lite) is built for non-commercial use', '$10/mo', '10,000 requests', '500ms updates', 'Query by location, hex, callsign, squawk', delivered through RapidAPI ('Personal Use Aircraft Data API'). For commercial use it points to Enterprise. 10k/month is about 333/day, which cannot sustain a 30-tile sweep more often than roughly every 2 h. Enterprise (data-products page): Live Positions via API or gRPC streaming at 5 s/500 ms/250 ms, with Global/Regional/Fleet options. 'ongoing subscription services with minimum annual commitments'. No prices published; sales contact required.

Source: https://www.adsbexchange.com/community/developer-hub/

### 17. Flightradar24 API plans (commercial-licensed paid fallback) (verified)

Parsed from the page's embedded data: Explorer $9/mo ($99/yr), 30,000 credits/mo, rate_limit 10. Essential $90/mo ($990/yr), 333,000 credits, rate_limit 30. Advanced $900/mo ($9,900/yr), 4,050,000 credits, rate_limit 200. All three have commercial=1. 'Live flight positions light' and 'full' are on all plans. 'Live flight positions count' and airport details are Essential and above. The rate-limit unit (probably per minute) and credits per returned flight are UNVERIFIED.

Source: https://fr24api.flightradar24.com/subscriptions-and-credits

## Recommendations

- Tell the builder the truth about OSIRIS. Its ~13k count is ONE anonymous OpenSky /states/all call refreshed every 900 s, plus adsb.fi /v2/mil every 90 s, de-duplicated by hex. It is not a tiled sweep. Do not describe it as '30 tiles at 1.1 s'. That path is dead code, and it is broken because it reads .ac from the deprecated adsb.fi v2 lat/lon endpoint, which returns .aircraft.
- Default pipeline. Use a server-side FlightsProvider adapter interface. The default is `adsblol-tiles`: keyless, ODbL 1.0, no key needed today. Sweep https://api.adsb.lol/v2/point/{lat}/{lon}/250 across a denser tile grid than OSIRIS's 30. 30 tiles gave about 7.2k aircraft, so target about 60-90 tiles: a hex-packed grid of 250 nm circles about 430 nm apart over populated land, plus North Atlantic, North Pacific and Gulf corridors. Requests should be sequential with at most 1 in flight, 1.0-1.5 s between starts, and a full sweep every 90-180 s. Stream results into the cache as each tile arrives. De-duplicate by hex, keeping the newest by `seen_pos`. Add exponential backoff on any 4xx/5xx, and log per-tile counts so empty tiles are visible.
- Optional `adsblol-reapi` adapter. When the deployer runs an adsb.lol feeder (or routes through the feeder IP, which the docs explicitly allow via VPN or proxy), call https://re-api.adsb.lol/?all_with_pos&jv2 once every 5-10 s. That returns the whole network in one request. Gate it on env ADSBLOL_REAPI=true.
- OpenSky adapter: OFF by default. Enable it only with OPENSKY_CLIENT_ID/SECRET AND an explicit OPENSKY_LICENSED=true or a clearly labelled non-commercial research mode. The UI and README must state that the ToU require a written license for any live product. Poll interval = 4 credits / (daily quota / 86400 s): 86 s standard, 43 s feeder, 1 s licensed. Honour X-Rate-Limit-Remaining and X-Rate-Limit-Retry-After-Seconds. Never pool anonymous credits.
- adsb.fi adapter. /v2/mil and /v3/lat/lon/dist (v3 only, never the v2 lat/lon) are allowed only when ADSBFI_PERSONAL_USE=true, because the terms are 'personal, non-commercial only'. Keep to at most 1 req/s globally, avoid invalid requests (4xx count toward the limit), and cite adsb.fi with a link.
- Paid adapters for commercial deployments: FR24 API (Explorer $9, Essential $90, Advanced $900 per month, all commercial-flagged) and ADS-B Exchange Enterprise (annual minimum, streaming via gRPC). Treat the ADSBx $10/mo Community API as non-commercial and too small, at 10k requests a month.
- Forbid the OSIRIS stealthFetch pattern: no spoofed X-Forwarded-For/X-Real-IP and no rotating fake User-Agents. Send an honest UA with a project URL and contact address. Spoofing breaks OpenSky ToU §2(i) and risks bans everywhere.
- Freshness and visuals. Serve one in-memory snapshot from the server through a single-flight promise. Let clients fetch it every 10-15 s using ETag/If-None-Match, or push over SSE. On the client, dead-reckon each aircraft every animation frame from gs (kt) and track (deg), capping extrapolation at about 60 s. OSIRIS does neither: it polls every 5 min, and its anonymous OpenSky data is up to 15 min old.
- Status bar and provenance. Show the source name, aircraft count and snapshot age for every provider, as OSIRIS's providers{} object does. Always render an attribution line: 'Aircraft data © adsb.lol contributors, ODbL 1.0'. Add the adsb.fi link or the OpenSky citation (Schäfer et al., IPSN 2014) when those adapters are active. Warn in the UI if total < 100.
- Airport-to-airport feature. Use https://api.adsb.lol/api/0/airport/{ICAO} for airport coordinates (verified working). Treat /api/0/route/{callsign} and POST /api/0/routeset (vradarserver standing-data) as best-effort, because they returned 302 and an empty 201 during testing. Bundle OurAirports or vradarserver standing-data locally as the authoritative IATA/ICAO lookup and great-circle fallback. Filter live aircraft for a city pair by matching callsign routes against origin and destination.

## Gaps (not verified)

- Could not see the osiris git commit history or blame for route.ts: the GitHub REST API and MCP GitHub tools are not enabled for simplifaisoul/osiris in this session. The analysis reflects the master branch as fetched from raw.githubusercontent.com on 2026-09-30.
- Whether the osirisai.live operator holds a written OpenSky license is UNVERIFIED. The live API shows opensky_auth=false (anonymous), which suggests it does not.
- adsb.lol's actual numeric rate limits are undocumented ('dynamic'). No rate-limit headers were seen. The maximum safe tile rate and how many tiles are needed to reach ~13k aircraft are UNVERIFIED (only 30 tiles, 7,214 aircraft, were tested).
- api.adsb.lol/docs and /api/openapi.json returned 502/503 during testing. The route list comes from source code (api_v2.py, api_routes.py), not the live OpenAPI spec.
- Whether adsb.lol has changed its policy to require a key for /v2 is not stated beyond 'In the future, you will require an API key'. No date was found.
- The adsb.lol /api/0/route and /api/0/routeset endpoints did not return data during testing (302 and empty 201), so it is unknown whether they currently work.
- airplanes.live API terms page is behind a Cloudflare challenge; the terms and any non-commercial allowance are UNVERIFIED beyond the 403 'contact us' message.
- Flightradar24 credits per returned flight for live-positions endpoints, and the unit of the 'rate_limit' values (10/30/200), are UNVERIFIED.
- ADS-B Exchange Enterprise pricing is not published, and the endpoint list for the $10 Community API was not independently checked on RapidAPI.
- The adsblol/globe_history GitHub repo returned 403 through the proxy. The release format is known only from the adsb.lol docs page.
- Whether ODbL share-alike obliges a site that only displays live adsb.lol data (a 'Produced Work') to share anything was not legally analysed. Attribution is clearly required.
