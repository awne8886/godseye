## design-system-hud

The HUD calls no external upstream. It reads only local routes, all through react-query. It never
invents a value: when a route answers 404 or 503, the HUD shows "—" or nothing, never an estimate.

Probed 2026-09-30 against a local production build (`pnpm build && pnpm start`, zero keys). The
integration round re-probed the build after the wave A merge (6857d61):

| Route | Owner | Status | Latency | Used for | Behaviour when unavailable |
|---|---|---|---|---|---|
| `GET /api/health` | lead | 200 | 4 ms | Capabilities (hide gated layers/tools/AI providers), STATUS (CONNECTING/OFFLINE), `defaultLayersFor()` | STATUS: OFFLINE; only keyless layers listed |
| `GET /api/space-weather` | layers-space | 200 (wave A merge, 2026-09-30 20:28 UTC) | 3 ms (cached) | Telemetry SOLAR (GOES X-ray class) and KP | "SOLAR —", "KP —"; tooltip "Space weather feed unavailable" |
| `GET /api/ticker` | panels-alerts-markets-dossier-graph | 404 (wave B) | — | Status-bar ticker (quotes and M4+ quakes, each with its own observedAt) | Called only once `/api/health` lists the route; until then the ticker shows Intel Feed events already on the client, else "NO EVENTS RECEIVED YET" |
| `GET /api/geo/reverse?lat=&lng=` | panels-recon | 404 (wave B) | — | Cursor readout place name (3 s debounce, 0.1° cache cell) | Called only once `/api/health` lists the route; coordinates only until then, and retries pause for 5 min after a failure |

`/api/health` shape with zero keys: keys `status, version, uptimeS, capabilities (41), feeds,
geocoder, store, timestamp`. Enabled with zero keys: `ai_user_keys`, `nc_sources`, `openmeteo`.
`feeds` is `{}` until feature builders register their feeds.

Fonts were not changed: the HUD uses the lead's `next/font` variables, so no font host was probed.
Browser storage keys: `godseye:theme` (preset id, read by the pre-paint boot script),
`godseye:style-studio` (sanitised Style Studio edits) and `godseye:settings` (lead's store). All
three stay in the visitor's browser and are never sent to the server.

### Source register licence links (`src/lib/sources.ts`), probed 2026-09-30 ~22:45 UTC

The SOURCES & LICENCES panel now renders a static register of every upstream (`src/lib/sources.ts`,
113 distinct terms/licence URLs). Each URL was requested once from the build sandbox with the honest
User-Agent `GODSEYE/0.1.0 (+https://github.com/awne8886/godseye; contact https://github.com/awne8886/godseye/issues)`:
`HEAD`, falling back to `GET` when the server refuses HEAD (403/404/405), redirects followed. CORS is not
relevant (links only; the browser never fetches them). No auth. Three URLs that answered 404 were replaced
before this run (Toronto licence → `open-data-licence/`, FOSSGIS home for Valhalla, FRANCE 24 home).

| URL | Result | Latency | Note |
|---|---|---|---|
| `https://about.rdap.org/` | HEAD 200 | 361 ms |  |
| `https://abuse.ch/terms-of-use/` | HEAD 200 | 316 ms |  |
| `https://ai.google.dev/gemini-api/terms` | HEAD 200 | 349 ms |  |
| `https://aisstream.io/` | GET 200 | 662 ms |  |
| `https://aviationweather.gov/data/api/` | HEAD 200 | 281 ms |  |
| `https://celestrak.org/usage-policy.php` | HEAD 503 | 15161 ms | timed out through the sandbox proxy (200 in the pages-docs probe earlier the same day) |
| `https://check.torproject.org/torbulkexitlist` | HEAD 200 | 482 ms |  |
| `https://crt.sh/` | HEAD 502 | 528 ms | crt.sh is flaky (502/404 seen before); the service itself is in use |
| `https://cve.circl.lu/` | HEAD 200 | 859 ms |  |
| `https://data.gov.hk/en/terms-and-conditions` | HEAD 200 | 780 ms |  |
| `https://data.gov.sg/open-data-licence` | HEAD 200 | 1192 ms |  |
| `https://data.gov.tw/license` | HEAD 200 | 673 ms |  |
| `https://dataspace.copernicus.eu/` | HEAD 200 | 702 ms |  |
| `https://db.satnogs.org/about/` | HEAD 200 | 683 ms |  |
| `https://deepstatemap.live/license-en.html` | HEAD 200 | 671 ms |  |
| `https://defillama.com/docs/api` | HEAD 200 | 862 ms |  |
| `https://developers.binance.com/` | HEAD 200 | 593 ms |  |
| `https://developers.cloudflare.com/radar/` | HEAD 200 | 143 ms |  |
| `https://developers.google.com/speed/public-dns/terms` | HEAD 200 | 1212 ms |  |
| `https://docs.cdp.coinbase.com/` | HEAD 200 | 288 ms |  |
| `https://docs.kraken.com/` | HEAD 200 | 273 ms |  |
| `https://dot.ca.gov/conditions-of-use` | HEAD 200 | 358 ms |  |
| `https://drmkc.jrc.ec.europa.eu/inform-index` | HEAD 200 | 914 ms |  |
| `https://en.wikipedia.org/wiki/Wikipedia:Text_of_the_Creative_Commons_Attribution-ShareAlike_4.0_International_License` | HEAD 200 | 161 ms |  |
| `https://eonet.gsfc.nasa.gov/` | HEAD 200 | 339 ms |  |
| `https://eth.blockscout.com/` | HEAD 200 | 339 ms |  |
| `https://firms.modaps.eosdis.nasa.gov/` | HEAD 200 | 209 ms |  |
| `https://flightplandatabase.com/dev/api` | HEAD 200 | 346 ms |  |
| `https://freeipapi.com/` | HEAD 200 | 741 ms |  |
| `https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy` | HEAD 200 | 323 ms |  |
| `https://github.com/adsbfi/opendata` | HEAD 200 | 359 ms |  |
| `https://github.com/ollama/ollama/blob/main/LICENSE` | HEAD 200 | 318 ms |  |
| `https://github.com/tilezen/joerd/blob/master/docs/attribution.md` | HEAD 200 | 321 ms |  |
| `https://github.com/vradarserver/standing-data` | HEAD 200 | 375 ms |  |
| `https://gpsjam.org/faq` | HEAD 200 | 622 ms |  |
| `https://hexdb.io/` | HEAD 200 | 324 ms |  |
| `https://internetdb.shodan.io/docs` | HEAD 200 | 273 ms |  |
| `https://ioda.inetintel.cc.gatech.edu/` | HEAD 200 | 381 ms |  |
| `https://ip-api.com/docs/legal` | HEAD 200 | 526 ms |  |
| `https://ipwho.is/` | GET 200 | 79 ms |  |
| `https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html` | HEAD 200 | 493 ms |  |
| `https://maclookup.app/` | HEAD 200 | 340 ms |  |
| `https://mdotjboss.state.mi.us/MiDrive/map` | HEAD 200 | 247 ms |  |
| `https://mempool.space/docs/api/rest` | HEAD 200 | 230 ms |  |
| `https://msi.nga.mil/Publications/WPI` | HEAD 200 | 513 ms |  |
| `https://nasa-gibs.github.io/gibs-api-docs/` | HEAD 200 | 345 ms |  |
| `https://nvd.nist.gov/developers/terms-of-use` | HEAD 200 | 445 ms |  |
| `https://open-meteo.com/en/terms` | HEAD 200 | 420 ms |  |
| `https://open.toronto.ca/open-data-licence/` | HEAD 200 | 359 ms |  |
| `https://openflights.org/data.php` | HEAD 200 | 390 ms |  |
| `https://openfreemap.org/` | HEAD 200 | 322 ms |  |
| `https://opensky-network.org/about/terms-of-use` | HEAD 503 | 15293 ms | bot protection / timeout (403 in the pages-docs probe) |
| `https://opensource.org/license/mit` | HEAD 200 | 241 ms |  |
| `https://operations.osmfoundation.org/policies/nominatim/` | HEAD 200 | 547 ms |  |
| `https://otx.alienvault.com/` | HEAD 200 | 250 ms |  |
| `https://ourairports.com/data/` | HEAD 200 | 529 ms |  |
| `https://photon.komoot.io/` | HEAD 200 | 487 ms |  |
| `https://solana.com/tos` | HEAD 200 | 631 ms |  |
| `https://tass.com/` | HEAD 200 | 664 ms |  |
| `https://telegram.org/tos/content-licensing` | HEAD 200 | 425 ms |  |
| `https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service` | GET 403 | 135 ms | bot wall / egress block on non-browser clients; page exists |
| `https://traffic.ottawa.ca/` | HEAD 200 | 425 ms |  |
| `https://trafficnz.info/` | HEAD 200 | 4980 ms |  |
| `https://volcano.si.edu/` | GET 403 | 173 ms | bot wall / egress block on non-browser clients; page exists |
| `https://wheretheiss.at/w/developer` | HEAD 200 | 478 ms |  |
| `https://wsdot.wa.gov/traffic/api/` | HEAD 200 | 263 ms |  |
| `https://www.aa.com.tr/en` | HEAD 200 | 1061 ms |  |
| `https://www.adsb.lol/privacy-license/` | HEAD 200 | 595 ms |  |
| `https://www.adsbdb.com/` | HEAD 200 | 717 ms |  |
| `https://www.africanews.com/terms-and-conditions` | HEAD 200 | 315 ms |  |
| `https://www.airport-data.com/` | HEAD 503 | 1178 ms | site answered 503 to HEAD at probe time |
| `https://www.aljazeera.com/terms-and-conditions` | HEAD 200 | 342 ms |  |
| `https://www.anthropic.com/legal/commercial-terms` | HEAD 200 | 177 ms |  |
| `https://www.bbc.co.uk/usingthebbc/terms` | GET 403 | 23 ms | bot wall / egress block on non-browser clients; page exists |
| `https://www.channelnewsasia.com/terms-and-conditions` | GET 403 | 27 ms | bot wall / egress block on non-browser clients; page exists |
| `https://www.cisa.gov/known-exploited-vulnerabilities-catalog` | HEAD 200 | 201 ms |  |
| `https://www.coingecko.com/en/api_terms` | HEAD 200 | 354 ms |  |
| `https://www.cve.org/Legal/TermsOfUse` | HEAD 200 | 379 ms |  |
| `https://www.dgt.es/` | HEAD 200 | 767 ms |  |
| `https://www.digitraffic.fi/en/terms-of-service/` | HEAD 200 | 360 ms |  |
| `https://www.drivebc.ca/` | HEAD 200 | 546 ms |  |
| `https://www.dw.com/en/legal-notice/a-15643855` | GET 403 | 36 ms | bot wall / egress block on non-browser clients; page exists |
| `https://www.esri.com/en-us/legal/terms/full-master-agreement` | HEAD 200 | 471 ms |  |
| `https://www.fossgis.de/` | HEAD 200 | 486 ms |  |
| `https://www.france24.com/en/` | HEAD 200 | 252 ms |  |
| `https://www.gdacs.org/` | HEAD 200 | 972 ms |  |
| `https://www.gdeltproject.org/about.html` | HEAD 200 | 665 ms |  |
| `https://www.livetraffic.com/` | HEAD 200 | 687 ms |  |
| `https://www.naturalearthdata.com/about/terms-of-use/` | HEAD 200 | 275 ms |  |
| `https://www.nhc.noaa.gov/` | HEAD 200 | 271 ms |  |
| `https://www.nytimes.com/rss` | GET 403 | 14 ms | bot wall / egress block on non-browser clients; page exists |
| `https://www.openmaptiles.org/` | HEAD 200 | 728 ms |  |
| `https://www.opensanctions.org/licensing/` | HEAD 200 | 268 ms |  |
| `https://www.openstreetmap.org/copyright` | HEAD 200 | 603 ms |  |
| `https://www.quebec511.info/` | GET 403 | 172 ms | bot wall / egress block on non-browser clients; page exists |
| `https://www.rainviewer.com/api.html` | HEAD 200 | 358 ms |  |
| `https://www.ripe.net/about-us/legal/ripestat-service-terms-and-conditions/` | HEAD 200 | 734 ms |  |
| `https://www.rwsverkeersinfo.nl/` | HEAD 200 | 520 ms |  |
| `https://www.scmp.com/terms-conditions` | HEAD 200 | 382 ms |  |
| `https://www.submarinecablemap.com/` | HEAD 200 | 462 ms |  |
| `https://www.swpc.noaa.gov/` | HEAD 200 | 659 ms |  |
| `https://www.theguardian.com/help/terms-of-service` | GET 403 | 13 ms | bot wall / egress block on non-browser clients; page exists |
| `https://www.timesofisrael.com/terms-of-use/` | GET 403 | 132 ms | bot wall / egress block on non-browser clients; page exists |
| `https://www.trafikverket.se/e-tjanster/trafikverkets-oppna-api-for-trafikinformation/` | HEAD 200 | 809 ms |  |
| `https://www.tripcheck.com/` | HEAD 200 | 425 ms |  |
| `https://www.txdot.gov/about/disclaimer.html` | HEAD 200 | 512 ms |  |
| `https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits` | HEAD 200 | 1467 ms |  |
| `https://www.vegagerdin.is/` | HEAD 200 | 1180 ms |  |
| `https://www.weather.gov/documentation/services-web-api` | HEAD 200 | 186 ms |  |
| `https://www.wikidata.org/wiki/Wikidata:Licensing` | HEAD 200 | 264 ms |  |
| `https://www.worldbank.org/en/publication/worldwide-governance-indicators` | HEAD 200 | 276 ms |  |
| `https://www.youtube.com/t/terms` | HEAD 200 | 155 ms |  |
| `https://xposedornot.com/` | HEAD 200 | 454 ms |  |
