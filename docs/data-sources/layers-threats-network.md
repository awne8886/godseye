## layers-threats-network

Probed **2026-09-30 20:02–20:10 UTC** from the build sandbox with
`curl -sS -m 30 -A 'GODSEYE/0.1.0 (+https://github.com/awne8886/godseye; contact https://github.com/awne8886/godseye/issues)' -H 'Origin: http://localhost:3000'`.
Recorded payloads (trimmed) live in `src/features/{threats,network}/server/__fixtures__/*.2026-09-30.*`.
"CORS" is the `Access-Control-Allow-Origin` answer to that Origin; the browser never calls these hosts
(everything goes through `/api`).

| Upstream | Status · latency · size | CORS | Auth | Licence / attribution | Notes and sample fields |
|---|---|---|---|---|---|
| GDELT `data.gdeltproject.org/gdeltv2/lastupdate.txt` | 200 · 0.19 s · 320 B | `*` | none | GDELT: unlimited use with citation | Lists `…/{YYYYMMDDHHMMSS}.export.CSV.zip` as **`http://`** → fetched over https (same path works). GEO 2.0 API is gone (404); DOC 2.0 throttled (1 req / 5 s) — not used. |
| GDELT `…/20260930200000.export.CSV.zip` (https) | 200 · 0.14 s · 84 kB zip | `*` | none | same | One entry, deflate; 1 233 rows × 61 tab-separated columns (no header). Used: 0 GLOBALEVENTID, 1 SQLDATE, 6/16 actors, 26/28 EventCode/Root, 29 QuadClass (this batch: 1 → 773, 2 → 159, 3 → 116, 4 → 185), 30 Goldstein, 31–33 mentions/sources/articles, 34 AvgTone, 51 ActionGeo_Type (4 → 535, 3 → 234, 2 → 219, 1 → 197, 5 → 20, 0 → 28 dropped), 52 FullName, 53 CountryCode (FIPS), 56/57 lat/long, 59 DATEADDED, 60 SOURCEURL. Aggregated over the newest 4 batches (1 h). |
| GDACS `www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF` | 200 · 0.94 s · 128 kB (89 events) | `*` | none | GDACS terms, attribution | `/MAP` variant answers 400. `alertlevel` capitalised → lower-cased; `fromdate/todate/datemodified` zone-less UTC → `normalizeUtc`; `url.report`. EQ kept here (Global Incidents), unlike the hazards weather layer. |
| Wikidata `query.wikidata.org/sparql` (nuclear plants: `wdt:P31/wdt:P279* wd:Q134447; wdt:P625`) | 200 · 2.6 s · 327 kB | `*` | none (UA required) | CC0 | 401 bindings → 382 plants; status labels: none 122, decommissioned 105, in use 75, cancelled 48 (dropped), proposed 27, under construction 19. Merged with the curated OSIRIS list (64, MIT) within 10 km. |
| INFORM `drmkc.jrc.ec.europa.eu/inform-index/API/InformAPI/Workflows/GetByYear/2026` | 200 · 1.4 s · 648 B | `*` | none | CC BY 4.0 (EC JRC) | WorkflowId 515 "INFORM Risk Mid 2026". |
| INFORM `…/countries/Scores/?WorkflowId=515&IndicatorId=INFORM` | **empty reply** (curl 52) at 0.88 s, then 200 · 1.1 s · 25 kB on retry | `*` | none | same | `[{Iso3, IndicatorScore}]` (AFG 7.8). The server retries (3). |
| World Bank `api.worldbank.org/v2/country/all/indicator/GOV_WGI_PV.EST?source=3&format=json&date=2023&per_page=400` | 200 · 0.47 s · 54 kB (216 rows, 215 values) | `*` | none | CC BY 4.0 | The brief's `PV.EST` id answers 200 with "indicator not found" (0.26 s); `GOV_WGI_PV.EST&source=3` is the live id. Some rows have an empty `countryiso3code` (not joined). |
| DeepStateMap `deepstatemap.live/api/history/last` (HEAD only) | 200 · 0.58 s · ~627 kB (ETag) | `*` | none | Non-commercial with attribution; no proxying to third parties without approval | Served only with `deepstate` (NONCOMMERCIAL=true, not commercial). `api/history/public` 200 · 0.34 s: `{id (unix s), createdAt, updatedAt, description(En) (HTML)}`. |
| URLhaus `urlhaus.abuse.ch/downloads/csv_recent/` | 200 · 0.35 s · 2.9 MB | none | none (bulk files keyless; API needs Auth-Key since 2025-06-30) | CC0 + abuse.ch terms (non-commercial → `nc_sources`) | Last-Modified + ETag; **If-Modified-Since → 304 in 0.27 s**. `# id,dateadded,url,url_status,last_online,threat,tags,urlhaus_link,reporter` (zone-less UTC). Only literal-IP hosts are mapped. |
| Feodo Tracker `feodotracker.abuse.ch/downloads/ipblocklist.json` | 200 · 0.42 s · 1.7 kB | none | none | CC0 + abuse.ch terms | **Last-Modified 2026-06-30** (frozen list) → feed is STALE, never LIVE. `{ip_address, port, status (online/offline), hostname, as_number, as_name, country, first_seen, last_online (date only), malware}`. |
| ThreatFox `threatfox.abuse.ch/export/json/recent/` | 200 · 0.40 s · 4.3 MB | none | none | CC0 + abuse.ch terms | `{id: [ioc]}` 6 861 IOCs: ip:port 3 695, domain 2 269, url 370, hashes 527; botnet_cc 4 868. `first_seen_utc` zone-less UTC. Newest 2 000 served; only ip:port IOCs are geolocated. |
| ip-api `http://ip-api.com/batch` (POST, 2 IPs) | 200 · 0.12 s · 368 B | `*` | none | Free tier non-commercial, HTTP only | `{status,country,countryCode,regionName,city,lat,lon,as,query}`. 15 batch requests/min of ≤ 100 IPs (bucket `ip-api-batch`), results cached 24 h. |
| CISA KEV `www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json` | 200 · 0.46 s · 1.76 MB | none | none | Public domain | `catalogVersion 2026.09.30`, `dateReleased`, 1 730 entries `{cveID,vendorProject,product,vulnerabilityName,dateAdded,dueDate,knownRansomwareCampaignUse,shortDescription}`. |
| NVD `services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2021-44228` | 200 · 0.43 s · 87 kB | `*` | none (`apiKey` header raises the limit) | Public domain; "not endorsed by NVD" | `metrics.cvssMetricV31[0].cvssData.{baseScore 10.0, baseSeverity CRITICAL}`. Keyless bucket 5 requests / 30 s. |
| IODA `api.ioda.inetintel.cc.gatech.edu/v2/outages/events?from&until&entityType=country&limit=200` | 200 · 1.3 s · 4.6 kB (18 events) | reflects Origin | none | Attribution (Georgia Tech IODA) | `{location "country/BM", location_name, start (unix s), duration (s), datasource bgp/gtr/ping-slash24/merit-nt, score, overlaps_window}`; ongoing when start+duration reaches `until`. `outages/alerts` 200 · 0.31 s (21 alerts). |
| Cloudflare Radar `api.cloudflare.com/client/v4/radar/attacks/layer3/top/locations/origin?dateRange=1d` | **400** · 0.27 s (`code 9106 Missing X-Auth-Key, X-Auth-Email or Authorization headers`) | none | `CLOUDFLARE_API_TOKEN` (Bearer, Radar:Read) | CC BY-NC 4.0 → off when COMMERCIAL_DEPLOYMENT | Keyed only. Origins are SHARES by origin country → points, arcs only when a target is reported. |
| AISStream `wss://stream.aisstream.io/v0/stream` (HTTP HEAD) | **405** · 0.86 s | — | `AIS_API_KEY` in the subscription message | AISStream terms (no direct browser connections) | WebSocket-only; relay not exercised without a key. |
| TeleGeography `www.submarinecablemap.com/api/v3/cable/cable-geo.json` | 200 · 0.42 s · 751 kB (730 features) | none | none | CC BY-NC-SA 3.0 → `nc_sources` | Last-Modified 2026-09-22. `{id,name,color,feature_id}` MultiLineString. Bundled → `public/data/cables.json` (merged per id, 0.001°). |
| TeleGeography `…/api/v3/landing-point/landing-point-geo.json` | 200 · 0.51 s · 361 kB (1 925 points) | none | none | same | `{id,name,is_tbd}`. Bundled. |
| Natural Earth `ne_10m_ports.geojson` (GitHub raw) | 200 · 0.18 s · 279 kB (1 081) | `*` | none | Public domain | `{name, scalerank, website}`; scalerank ≤ 6 kept (522). |
| NGA WPI `msi.nga.mil/api/publications/download?type=view&key=16920959/SFH00000/UpdatedPub150.csv` | 200 · 2.0 s · 3.5 MB (3 807 ports) | none | none | US Government work, public domain | `Harbor Size` Large 174 / Medium 376 kept (550); oil/LNG terminal depth > 0 → `energy`. |
| Natural Earth admin-0 50m / 110m, admin-1 10m, marine polys 10m (GitHub raw) | 200 · 0.2–0.7 s · 3.1 MB / 0.8 MB / 40.7 MB / — | `*` | none | Public domain | Conflict-zone polygons (`public/data/zones.json`, 15 zones, union + Douglas-Peucker ≤ 0.03°), country choropleth shapes (`zones-countries.json`), country label points (`LABEL_X/Y` → `country-centroids.json`). |

Bundled files (prepared 2026-09-30, each carries `_meta` with source, licence and method):
`public/data/{zones,zones-countries,cables,ports,chokepoints,nuclear-curated}.json` and
`src/features/threats/shared/country-centroids.json`.

Re-probe 2026-09-30 22:49 UTC (Phase 3 round-1 fixes; honest UA, `Origin: https://example.org`):

| Upstream | Status · latency · size | CORS | Notes |
|---|---|---|---|
| CISA KEV JSON | 200 · 0.77 s · 1.76 MB | none | `catalogVersion 2026.09.30`, `dateReleased 2026-09-30T16:59:23.0688Z`. `dateAdded` is a calendar date only → Intel Feed events say "(date only)". `/api/cyber-threats?limit=20` serves the newest additions (`total` = full count). |
| URLhaus `csv_recent/` | 200 · 0.45 s · 2.95 MB | none | Unchanged format. Every added host now reaches clients (detections in chunks of 200) followed by `status {retired, total}`. |
| Feodo `ipblocklist.json` | 200 · 0.44 s · 1.8 kB | none | Unchanged (frozen list, STALE). |
| IODA `v2/outages/events?from&until&limit=5` | 200 · 8.9 s · 1.8 kB | reflects Origin | Slow this time (8.9 s); within the feed timeout. |
| TeleGeography `cable-geo.json` / `landing-point-geo.json` | 200 · 0.49 s · 751 kB / 200 · 0.54 s · 361 kB | none | Unchanged; bundled copy still current. |

Re-probe 2026-10-01 05:35–05:48 UTC (Phase 3 round-4 fixes; UA `GODSEYE/0.1.0 (open-source monitor; layers-threats-network probe)`, `Origin: https://example.org`):

| Upstream | Status · latency · size | CORS | Notes |
|---|---|---|---|
| GDELT `lastupdate.txt` | 200 · 0.30 s · 319 B | `*` | At 05:35:58 it named batch **`20261001054500`** (label 9.5 min in the future); its own Last-Modified 05:35:25. |
| GDELT `…/20261001054500.export.CSV.zip` (HEAD + GET) | 200 · 0.25 s · 58.7 kB | `*` | **Last-Modified 05:34:20** for a batch labelled 05:45:00; all 945 rows carry DATEADDED `20261001054500`. → DATEADDED is capped at the batch's observed publish time (min of label, Last-Modified, fetch); `window.to` is that time and `window.latestLabel` keeps GDELT's label. |
| NVD `cves/2.0?cveId=CVE-2021-44228` | 200 · 0.31 s · 87 kB | `*` | Keyless 5 / 30 s unchanged. Lookups are queued through `nvdBucket` and each response states `nvd.{queued, etaS, ratePer30s, lastLookupAt, awaitingAnalysis}`. |
| IODA `v2/outages/events?from&until&entityType=country&limit=200` | 200 · 1.40 s · 4.9 kB (19 events) | reflects Origin | Ongoing events have `start + duration == until` (clipped to the query, not an observation) → `lastSignalAt` = onset for ongoing events, recovery for ended ones; `meta.observedAt` = newest of those. |
| INFORM `Workflows/GetByYear/2026` | 200 · 1.22 s | `*` | Unchanged. |
| World Bank `GOV_WGI_PV.EST?source=3&date=2023` | 200 · 6.92 s · 54 kB | `*` | Slow this time (6.9 s; was 0.47 s); within the 60 s feed deadline. Rows with a WGI value but no INFORM score are listed by `/api/country-risk` and not shaded; scored states without a 1:110m outline are drawn at their Natural Earth label point. |

Re-probe 2026-10-01 18:23–18:46 UTC (Phase 3 round-5 fixes; UA `GODSEYE/0.1.0 (open-source monitor; layers-threats-network probe)`, `Origin: https://example.org`):

| Upstream | Status · latency · size | CORS | Notes |
|---|---|---|---|
| CISA KEV JSON (plain GET) | 200 · 0.54–0.71 s · 1.76 MB | none | `ETag "1adda5-65cb6389188a8"`, `Last-Modified Wed, 30 Sep 2026 16:59:23 GMT`, `Cache-Control max-age=502`. Unchanged since the 2026-09-30 release. |
| CISA KEV JSON, `If-None-Match` + `If-Modified-Since` | **304** · 0.29–0.31 s · 0 B | none | The KEV feed now sends both validators once it has a snapshot; the revalidation that follows each NVD batch (so `/api/health` restates `providers.nvd`) costs a 304, not 1.76 MB. |
| CISA KEV JSON, `If-None-Match` only | 200 · 0.39–0.46 s · 1.76 MB | none | The CDN ignores the ETag alone → never send it without `If-Modified-Since` (http.ts sends both when both are known). |
| CISA KEV JSON, `If-Modified-Since` only | 304 · 0.46 s | none | — |

Probe 2026-10-02 00:35–00:40 UTC (Phase 3 round-6, alert pins counted in conflict zones; UA `GODSEYE-probe`, `Origin: https://example.org`):

| Upstream | Status · latency · size | CORS | Notes |
|---|---|---|---|
| Live Alerts via `runNews()` (in-process; owner panels-alerts-markets-dossier-graph) | 120 items · 16/21 sources ok (BBC, Guardian, NYT, DW, CNA, Times of Israel failed from this sandbox) | n/a (server) | Conflicts reads `newsFeed.get()` in-process, never `/api/news`. Places: 27 settlement, 12 region, 43 country, 38 none; only settlement/region pins inside a zone count (6 of 120: Kyiv ×2, Odesa, Gaza City, Gaza Strip, Khartoum). Aden (45.02 E, 12.79 N) sits just outside the bundled Yemen outline and is not counted. Fixture `news-items.2026-10-02.json` (18 items, fields as served). Licence: links to publishers; headlines only. |
| `t.me/s/KyivIndependent_official` | 200 · 0.73 s | none | Public channel preview; no `Access-Control-Allow-Origin` (server-side only). |
| Al Jazeera `xml/rss/all.xml` | 200 · 0.48 s | none | Wire RSS; server-side only. |

Round-6 verification fix 2026-10-02 (no new upstream; the conflicts feed still reads `newsFeed.get()` in-process): only AlertItems with `kind` `rocket` or `event` become conflict events; `kind=news` headlines are dropped even inside a zone (in the recorded fixture this removes the Africanews Khartoum item and a TASS Kyiv item classed news). In-zone alert events now carry the AlertItem's `source` (as `sourceHandle`), `sourceName`, `lean`, `bloc` and `alertKind`; the card selection source is that handle (e.g. `t.me/rybar_in_english`) and the card shows a Channel · stance row.

Re-probe 2026-10-02 11:40 UTC (Phase 3 round-8 fixes; UA `GODSEYE/0.1 (+https://github.com/godseye; probe)`, `Origin: https://example.org`, IPv4):

| Upstream | Status · latency · size | CORS | Notes |
|---|---|---|---|
| GDELT `lastupdate.txt` (https) | 200 · 0.40 s · 3 lines | `*` | Named batch `20261002114500`; Last-Modified 11:36:01 (label again ahead of publication). Plain `http://` answers 301 → https from this sandbox; we fetch https. |
| GDELT `…/20261002114500.export.CSV.zip` | 200 · 0.15 s · 66 kB | `*` | 989 rows, all 61 columns; 185 QuadClass 3/4 rows with ActionGeo_Type ≥ 2. Unchanged format. |
| `/api/conflicts` on a local `next start` (GDELT + news in-process) | 200 · 3.1 s | n/a | `live` with `gdelt {ok, count 67}` and `alerts {ok, count 12}`: every counted alert carries weapon/combat language (strikes, drones, explosions, attacks). |

Round-8 verification fixes (no new upstream): (1) the alert classifier's `kind=event` also matches `earthquake` and `fire`, so the conflicts feed now also requires kinetic text (`isKineticAlertText`: weapon/combat terms, or explosion/casualty/siren terms with no hazard, fire or accident named; idioms such as "hunger strike" and "heart attack" removed first). A deterministic keyword test, never called AI; it errs towards not counting. (2) When GDELT has never answered (no last-good pull) the conflicts state is capped at RECENT (it read LIVE from in-zone alerts alone); `providers.gdelt.age_s` is then `null`. Zones with no in-zone event stay REFERENCE.
