# OSIRIS API routes: geopolitical, media, markets, surveillance, infrastructure, geo
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.

## Summary

This slice covers the OSIRIS (osirisai.live) API routes for geopolitics, media, markets, surveillance/CCTV, infrastructure and geo. I read every route file listed and the lib helpers they call. Nothing was run, so camera counts come from source comments.

**Architecture.** Every route is a Next.js App Router handler. All caching is in-process in Node: `lib/sourceCache.ts` (`cachedSource`: TTL, in-flight dedupe, stale-on-error), module-level maps, and a few disk snapshots under `.cache/`: `cctv-catalog.json` and `nominatim.json`. There is no Redis and no database.

**Static data lives in TypeScript, not in `public/data`.** `public/data` holds only `submarine-cables.json` and `submarine-cables-filtered.json`. They are byte-identical, 665,094 bytes each, a GeoJSON FeatureCollection of 717 features (590 LineString, 127 MultiLineString). Feature properties are `id`, `name`, `color`, `feature_id`, `coordinates` (label point) and `length_km`. Everything else is an inline TS constant or a generated `.generated.ts` file:
- 15 conflict zones
- 52 ports and 10 chokepoints
- 64 nuclear facilities
- 14 SCM suppliers
- 20 country-risk rows
- 15 live-news channels
- 9 Telegram channels and 9 wire RSS feeds
- 28 market tickers
- about 900 generated public/Skyline webcams across three files: 300 public-webcam rows, 341 in `world-skyline.generated.ts`, 260 in `asia-skyline.generated.ts`

**Upstreams.**
- GDACS RSS (misnamed `/api/gdelt`)
- GDELT 2.0 15-minute export ZIPs
- BBC/Al Jazeera/NYT RSS for `/api/conflicts`; despite its comments this route does not use GDELT
- DeepState map
- USGS
- Photon, Nominatim and Wikidata/Wikipedia REST
- `t.me/s` HTML scraping for Telegram
- Yahoo v8 chart
- CoinGecko
- DefiLlama, NVD and OpenSanctions
- Cloudflare Radar (needs `CLOUDFLARE_API_TOKEN`)
- aisstream.io websocket (needs `AIS_API_KEY`)
- ArcGIS Online
- CARTO tiles through a proxy
- ipapi.co, then freeipapi, then ip-api for IP location
- Valhalla, falling back to OSRM, for directions
- About 56 CCTV region fetchers covering DOTs and national feeds: TfL, WSDOT, Caltrans, Canada 511s, IBI 511 (UT/NV/LA/FL/GA/NC/AZ), MDOT, ODOT, INDOT GraphQL, TxDOT, HK TD XML, Taiwan THB, NZTA XML, Rijkswaterstaat, Trafikverket via Kolla, CamStreamer, Fintraffic, Vegagerðin, DGT, ASFINAG, Via Lietuva, Edmonton, OpenCCTV, SkylineWebcams, plus many hardcoded YouTube embeds.

**CCTV engineering (the heaviest part).** A saved, prebuilt, gzipped catalogue with an ETag. Regions refresh in a pool of 4 with a 12 s budget and a 5-minute backoff. The server reports `pendingRegions` and the client retries only those. Frames load live in the browser from the source, or through an allow-listed proxy. The viewer supports jpg (5 s cache-busted refresh), mjpeg, mp4, hls (hls.js), and iframe (YouTube, ipcamlive, CamStreamer, rtsp.me). Channel `/live` and SkylineWebcams links are resolved server-side to YouTube embeds.

**Nominatim.** All Nominatim traffic goes through one server-side queue in `lib/nominatim.ts`: one request per 2 s, at most 40 queued (beyond that it refuses), answers cached 30 days and persisted to disk, failures cached 10 minutes. Its counters (`served`/`fromCache`/`sent`/`refused`/`failed`/`cached`/`queueDepth`) are exposed at `/api/health`.

## Findings

### 0. /api/conflicts — known zones + RSS keyword mapping

GET, no params, `dynamic='force-dynamic'`.

**Static zones.** KNOWN_CONFLICTS has 15 zones. Fields: `id`, `label`, `severity`, `lat`/`lng`, `region`, `description`, `sourceUrl` (liveuamap subdomains), `queries[]`, `bounds`.

| id | label | severity | lat, lng |
|---|---|---|---|
| ukraine | UKRAINE WAR | war | 48.5, 31.2 |
| gaza | GAZA CONFLICT | war | 31.35, 34.35 |
| lebanon | LEBANON BORDER | high | 33.377, 35.483 |
| sudan | SUDAN CIVIL WAR | war | 15.0, 30.0 |
| myanmar | MYANMAR CONFLICT | war | 19.5, 96.5 |
| yemen | YEMEN WAR | war | 15.5, 48.0 |
| syria | SYRIA | high | 35.0, 38.5 |
| drc | DRC EASTERN CONFLICT | war | -1.0, 28.5 |
| red-sea | RED SEA THREAT | high | 16.0, 40.0 |
| taiwan-strait | TAIWAN STRAIT | elevated | 24.0, 119.5 |
| korean-dmz | KOREAN DMZ | elevated | 38.3, 127.0 |
| sahel | SAHEL INSTABILITY | high | 14.0, 5.0 |
| somalia | SOMALIA | high | 5.0, 46.0 |
| iraq | IRAQ INSTABILITY | elevated | 33.3, 44.4 |
| ethiopia | ETHIOPIA | elevated | 9.0, 38.7 |

The severity type also allows `moderate`, but no zone uses it.

**Live data.** Despite the header comment ("GDELT GEO 2.0 / DOC API"), the route only fetches three RSS feeds with a Chrome UA, 8 s timeout and `cache: 'no-store'`:
- `http://feeds.bbci.co.uk/news/world/rss.xml`
- `https://www.aljazeera.com/xml/rss/all.xml`
- `https://rss.nytimes.com/services/xml/rss/nyt/World.xml`

**Matching.** Items are split on `<item>` and read by regex (title/link/description). An item matches a zone when every term of one query appears in title+desc, or when the text contains the zone's `region` slug. Only the first matching zone counts.

**Event placement.** Each event sits at the zone anchor plus a deterministic offset: `(eventId%5-2)*0.1` for lat and `((eventId*3)%5-2)*0.1` for lng. Events are deduped by title.

**Response.**
- `zones[]`: `{id, label, severity, lat, lng, description, sourceUrl, region, events (≤20 inside bounds), eventCount, lastUpdated}`
- `liveEvents` (≤500): `{id:'osint-live-N', lat, lng, title≤150, url, type:'conflict', timestamp}`
- `totalZones`, `totalLiveEvents`, `activeWarzones`, `timestamp`, `sources:['OSINT RSS News']`, `refreshInterval:300`

**Caching.** `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`. On error it returns fallback zones, `refreshInterval:60` and `no-cache`.

**Client.** `OsirisMap.tsx` fetches once when the map is ready; there is no polling. Layer `conflict-icons` is a symbol layer with canvas warning icons:
- war: `#D32F2F`
- high: `#E65100`
- otherwise: `#F9A825`

Label text uses the same colours with a black halo 1.5 and font 'Open Sans Bold'. On fetch failure the client draws a hard-coded fallback of 6 zones.

Files: `src/app/api/conflicts/route.ts:42-118`, `src/app/api/conflicts/route.ts:147-271`, `src/app/api/conflicts/route.ts:301-314`, `src/components/OsirisMap.tsx:430-450`, `src/components/OsirisMap.tsx:2306-2362`

### 1. /api/frontlines — DeepState

GET `https://deepstatemap.live/api/history/last` with a 10 s timeout. The response is passed through raw: `{frontlines: <DeepState JSON>, timestamp}`.

Cache-Control: `public, s-maxage=1800, stale-while-revalidate=3600`.

If the upstream answers but is not OK, the route returns `{frontlines:null, error:'DeepState unavailable'}`. Exceptions return 500.

Nothing in the UI calls this route; it appears only in `apiCatalog`. The geometry shape is DeepState's own and is not normalised here, so its structure is unknown from this repo.

Files: `src/app/api/frontlines/route.ts`

### 2. /api/gdelt — actually GDACS disaster RSS ('Global Incidents' layer)

GET `https://www.gdacs.org/xml/rss.xml` with a 15 s timeout and `next.revalidate: 300`.

**Parsing.** Items are split on `<item>` to avoid ReDoS. The route reads `title`, `link`, `description`, `geo:lat`, `geo:long` and `gdacs:eventtype`. Entities are decoded (`&amp;` last) so GDACS report links work.

**Type mapping.**
- EQ → earthquake
- TC → weather
- FL → flood
- VO → volcano
- WF → wildfire
- DR → drought
- anything else → incident

The code comment notes that a live sample was 330 wildfires out of 369 events.

**Response.** `{events:[{id:'gdacs-N', lat, lng, name, url, html:'<a href=…>title</a><br/><i>desc</i>', type}], total, timestamp, source:'GDACS RSS API'}`.

Cache-Control: `public, s-maxage=300, stale-while-revalidate=600`; `maxDuration` is 60.

**Client.** Fetched once when layer `global_incidents` (label 'Global Incidents') is toggled on; no polling. Map layer `gdelt-dots`: radius 4, `#D32F2F`, opacity 0.5.

Files: `src/app/api/gdelt/route.ts`, `src/app/page.tsx:800-803`

### 3. /api/gdelt-events — GDELT 2.0 15-min Events export (real geocoded events)

**Params.**
- `quad`: CSV of 1–4
- `min_articles`: default 1
- `limit`: default 600, max 2000

**Fetch sequence (`src/lib/gdeltEvents.ts`).**
1. GET `http://data.gdeltproject.org/gdeltv2/lastupdate.txt` (12 s) and take the line containing `.export.CSV.zip`.
2. Download that ZIP (20 s). Requests use Node `http`/`https.get` with `family: 4` (pins IPv4 because AAAA stalls) and follow 3xx across http→https.
3. Unzip with no library: check the local-header signature `0x04034b50`, read method/compSize/nameLen/extraLen, then `inflateRawSync`.
4. If the archive 404s, walk back 1–3 fifteen-minute windows (rewriting the `YYYYMMDDHHMMSS` stamp).

**Row parsing.** The TSV has 61 columns. Columns used:
- 0 globalEventId, 1 sqlDate
- 26 eventCode, 28 rootCode
- 29 quadClass, 30 goldstein
- 31 numMentions, 32 numSources, 33 numArticles, 34 avgTone
- 52 actionGeoFullName, 53 country
- 56 lat, 57 long
- 59 dateAdded, 60 sourceUrl

Rows with empty coordinates or 0,0 are skipped.

**Event shape.** `{id, lat, lng, name, country, event_code, root_code, quad, quad_label, goldstein, tone (2dp), articles, sources, url, date(ISO)}`. Quad labels:
- 1 Verbal Cooperation
- 2 Material Cooperation
- 3 Verbal Conflict
- 4 Material Conflict

**Response.** `{events, total, scanned, window:'<file>.export.CSV.zip', source:'GDELT 2.0 Events', timestamp}`.

Cache-Control: `public, s-maxage=300, stale-while-revalidate=600`. Errors return 502.

**Client.** Loaded once via `loadLayerOnce('/api/gdelt-events?limit=600')`, keeping the flag on failure. Map layer `gdelt-events-dots`:
- radius interpolated on `articles`: 1→3, 10→5, 50→8, 200→12
- colour by quad: 1 `#00E676`, 2 `#00E5FF`, 3 `#FF9500`, 4 `#FF3D3D`, else `#9B978E`
- opacity 0.75, black stroke

Files: `src/app/api/gdelt-events/route.ts`, `src/lib/gdeltEvents.ts`, `src/components/OsirisMap.tsx:570-583`, `src/app/page.tsx:841-844`

### 4. /api/country-risk — editorial baseline + USGS quakes + exchange hours

**Baseline.** `RISK_FACTORS` has 20 countries with editorial base scores:

| Code | Base | Code | Base | Code | Base | Code | Base |
|---|---|---|---|---|---|---|---|
| UA | 85 | RU | 72 | IL | 78 | PS | 90 |
| SY | 82 | YE | 88 | MM | 76 | SD | 84 |
| AF | 80 | KP | 70 | IR | 68 | CN | 35 |
| TW | 45 | VE | 60 | HT | 85 | LB | 65 |
| PK | 55 | SO | 82 | LY | 72 | ET | 62 |

Each row also carries `tags` and USGS place `names`.

**Scoring.** `quake_magnitude` sums the magnitude of USGS `4.5_day.geojson` events whose place string, normalised to space-delimited words, contains ` <name> `. `risk_score = min(100, base + quake)`. `risk_level` comes from the base only:
- ≥80 CRITICAL
- ≥60 HIGH
- ≥40 ELEVATED
- else LOW

`BASELINE_REVIEWED='2026-09-15'`.

**Exchanges.** Open/closed status for 12 exchanges is computed with `Intl` in each exchange's timezone (weekday check, decimal hours):
- NYSE, NASDAQ 9.5–16
- LSE 8–16.5
- TSE 9–15
- SSE 9.5–15
- HKEX 9.5–16
- BSE 9.25–15.5
- FRA 8–20
- TSX 9.5–16
- ASX 10–16
- KRX 9–15.5
- MOEX 10–18.5

**Response.** `{countries:[{code, base_risk, quake_magnitude, risk_score, risk_level, tags, basis:'editorial'}] sorted desc, methodology:{basis, summary, baseline_reviewed, countries_covered, observed_component, quakes_available}, exchanges:[{name, country, open}], open_exchanges, total_exchanges, timestamp}`.

There is no Cache-Control header. No UI consumer was found.

Files: `src/app/api/country-risk/route.ts`, `src/lib/country-risk.ts`

### 5. /api/region-dossier — double right-click panel

**Params.** `lat`, `lng`.

**Step 1 — place.** `placeAt()` calls Photon reverse: `https://photon.komoot.io/reverse?lat=<3dp>&lon=<3dp>&lang=en&radius=50` (8 s). On failure it retries once after 800 ms. Results are cached 24 h under key `dossier:place:<lat3>,<lng3>`. This deliberately does not use the Nominatim queue.

**Steps 2–3, run in parallel (`Promise.allSettled`).**
- Wikipedia summary: `https://en.wikipedia.org/api/rest_v1/page/summary/<city||country>` (5 s). Returns `{title, extract≤500, thumbnail}`.
- Country facts, cached 24 h as `dossier:wd:<country>`:
  1. enwiki `action=query&prop=pageprops&ppprop=wikibase_item&redirects=1&titles=<country>` gives the QID.
  2. Wikidata REST `https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items/<QID>/statements` (8 s).
  3. Properties read: P36 capital, P30 continent, P37 languages (≤4), P38 currencies (≤3), P35 head of state, P1906 office (read from the country, not the person), P41 flag, P1082 population, P2046 area. `current()` prefers rank=preferred, else statements without a P582 end qualifier.
  4. Labels are batched through `wbgetentities&props=labels&languages=en&ids=a|b|c`.
  5. Flag URL is `https://commons.wikimedia.org/wiki/Special:FilePath/<file>`.

The code notes SPARQL was abandoned as unreliable.

**Response.** `{coordinates, location:{city, state, country, country_code, display_name (deduped join)}, country:{name, official_name, capital, population, area, region, subregion, languages, currencies, flag_url, timezones:[]}, head_of_state:{name, position}|null, wikipedia, attribution:'© OpenStreetMap contributors', timestamp}`.

Cache-Control: `public, s-maxage=3600, stale-while-revalidate=7200` when a place is found, otherwise `no-store`.

**UI.** Panel titled 'REGION DOSSIER', loading text 'COMPILING INTEL...'. Fields: LOCATION, COUNTRY, CAPITAL, POPULATION, REGION, LANGUAGES, AREA km², HEAD OF STATE, INTELLIGENCE BRIEF.

Files: `src/app/api/region-dossier/route.ts`, `src/app/page.tsx:565-572`, `src/app/page.tsx:1900-1928`

### 6. /api/news — Live Alerts feed (Telegram t.me/s scraping + wire RSS)

**Telegram channels (9).** Format is handle / name / lean / bloc:
- Osintdefender / OSINTdefender / 'Global incident OSINT' / independent
- WarMonitors / War Monitor / 'Global conflict monitor' / independent
- rybar_in_english / Rybar / 'Russian military OSINT' / russian
- DDGeopolitics / DD Geopolitics / 'Multipolar / Russian' / russian
- KyivIndependent_official / Kyiv Independent / 'Ukrainian newsroom' / western
- QudsNen / Quds News Network / 'Palestinian / Gaza & West Bank' / regional
- AlMayadeenEnglish / Al Mayadeen English / 'Lebanese / Resistance Axis' / regional
- intelslava / Intel Slava Z / 'Russian military OSINT' / russian
- PressTV / Press TV / 'Iranian state broadcaster' / regional

**Wire feeds (9).**
- bbc: `https://feeds.bbci.co.uk/news/world/rss.xml` (western)
- guardian: `https://www.theguardian.com/world/rss` (western)
- aljazeera: `https://www.aljazeera.com/xml/rss/all.xml` (regional)
- timesofisrael: `https://www.timesofisrael.com/feed/` (regional)
- tass: `https://tass.com/rss/v2.xml` (russian)
- anadolu: `https://www.aa.com.tr/en/rss/default?cat=world` (regional)
- scmp: `https://www.scmp.com/rss/91/feed` (regional)
- cna: `https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml` (regional)
- africanews: `https://www.africanews.com/feed/rss` (regional)

**Fetching.** Channel pages come from `https://t.me/s/<handle>` with a Chrome UA and 8 s timeout. Each channel is cached 3 min (`CHANNEL_TTL_MS`), each wire 5 min (`WIRE_TTL_MS`).

**Limits.**
- `POSTS_PER_CHANNEL` 8
- `ITEMS_PER_WIRE` 5
- `MAX_POST_AGE_MS` 72 h
- Whole feed built at most once per 60 s (`FEED_TTL_MS`), single-flight via a module-level `building` promise; a failed build serves the last good feed with `s-maxage=30`

**Telegram parser (`lib/telegram.ts`).**
- Split the page on `class="tgme_widget_message_wrap`; skip `service_message`.
- Require `data-post="chan/123"` and `tgme_widget_message_date … <time datetime>`; posts without a timestamp are dropped, never back-dated.
- Text comes from `tgme_widget_message_text js-message_text` using a balanced-div scan, so a reply's quoted parent is not taken as the post's own text.
- `stripSignOff()` removes footers: rules, @handles, 'VK | RuTube…', hashtags-only lines, 'support us/subscribe…'.
- `splitHeadline()` normalises NFKC, strips emoji/flags, detects BREAKING prefixes (breaking / just in / urgent / flash / срочно / молния / última hora), clips the headline to 140 chars at a sentence and keeps a 'Speaker:' line together with its quote.
- Media: photo wraps and `tgme_widget_message_video_thumb`, background-image thumbnails, duration, and the `<video src>` only when it is on `telesco.pe` or `cdn-telegram.org`.
- Also read: forwarded_from, reply link, and views ('4.02K' → 4020).

**Cross-post merge.** `fingerprint()` takes the first 24 words longer than 1 char, lowercased, with links and handles removed. Posts are merged when the fingerprint has ≥6 words; the earliest post leads and the rest become `also_reported_by`, excluding self-reposts.

**Risk scoring.** Keyword count only, over whole words with plural/verb suffixes: war, missile, strike, attack, crisis, tension, military, conflict, defense, clash, nuclear, invasion, bomb, drone, weapon, sanctions, ceasefire, escalation, killed, destroyed, operation, casualty, frontline, threat. Score is `min(10, 1 + 2*matches)`.

**Location.**
- Fallback `KEYWORD_COORDS` has 15 anchors (ukraine, kyiv, russia, moscow, israel, gaza, iran, lebanon, syria, yemen, china, taiwan, 'united states'=DC, europe, 'middle east').
- `placeItems()` then runs `locateReport()` with `budgetedLookup(15)`, i.e. at most 15 new Nominatim questions per refresh, newest items first, and waits at most 2500 ms.
- `alertKind`: 'rocket' if the title plus first 300 chars mention rocket/missile/ballistic/HIMARS/ATACMS/Iskander/ракет…; 'event' if there is an event topic or verb (attack/raid/clash/explosion/arrest…); otherwise 'news'.

**Item shape.** `{id: md5(url), title, summary, description, link, published, source ('t.me/<handle>' or wire hostname), source_name, lean, bloc, flag, media, forwarded_from, reply_to, views, also_reported_by[{source, source_name, lean, bloc, link, published}], alert_kind, place{name, label, precision}|null, risk_score, risk_method:'keyword-count', risk_keywords[], keyword_assessment (≥8 only), coords[lat,lng]|null, coords_default, location_precision:'country-anchor'|'settlement'|'region'|null, coords_anchor}`.

**Response.** `{news (sorted newest), total, sources[{handle, name, lean, bloc, kind:'telegram'|'wire', count, latest}], timestamp}`.

Cache-Control: `public, s-maxage=60, stale-while-revalidate=120`.

**Client.** Polls every 300000 ms (5 min), skipped when the tab is hidden.

**Colours (`lib/alert-digest.ts`).**
- Blocs: western `#4F9CFF`, russian `#A78BFA`, regional `#2DD4BF`, independent `#C8C2B4`
- Kinds: ROCKET `#FF3D3D`, EVENT `#FF9500`, NEWS `#00E5FF`

Files: `src/app/api/news/route.ts`, `src/lib/telegram.ts`, `src/lib/alert-places.ts`, `src/lib/alert-digest.ts:15-34`, `src/lib/alert-digest.ts:110-200`, `src/app/page.tsx:715-722`

### 7. Place-name geoparsing for alerts (lib/alert-places.ts)

`placeCandidates(text[0:600])` finds place-name candidates as follows:
- A regex matches capitalised phrases, allowing Arabic particles (al-/el-/ad-…) and joining words (al/de/bin/abu/on…), up to 4 words.
- A large NOT_PLACES stoplist cuts each phrase: sentence openers, months, institutions, demonyms, leaders' names and country names.
- Words after a title (president/governor/king/sheikh…) are skipped.
- A candidate is 'locative' when preceded by in/near/at/on/over/outside/…/hit/struck/targeted, or by '<village|town|city|…|northeast> of'.
- Items in a list after a locative name inherit it.
- At most 3 candidates are kept, locative ones first.

**Theatre countries.** `THEATRE_COUNTRIES` maps each `classify()` theatre to ISO codes, e.g. russia-ukraine → ua, ru, by, md.

**Two lookup passes.**
1. Nominatim search inside the theatre countries: `q`, `limit=5`, `featureType=settlement`, `countrycodes`.
2. A worldwide search.

**Accepting a result (`pickRow`).** The name must share a word or a 4-letter prefix with the query. Then:
- Locative candidates in the theatre pass accept any settlement.
- Non-locative candidates need city/town with importance ≥0.5.
- The world pass needs city/town with importance ≥0.6.

Specificity ranks hamlet/village/suburb = 3, town = 2, city = 1. A region type is the fallback, with precision 'region'.

**Label.** First part, the first Latin-script area, and the country.

Files: `src/lib/alert-places.ts`

### 8. lib/nominatim.ts — the rate-limited queue shown in /api/health

All Nominatim calls go through `nominatim(endpoint:'search'|'reverse', params, {cacheOnly})`. The host is `https://nominatim.openstreetmap.org`.

**Request defaults.** `format=jsonv2&accept-language=en`. Requests go through `httpJson` (Node https) with User-Agent `OSIRIS-OSINT/1.0 (+https://github.com/simplifaisoul/osiris)` and an 8 s timeout.

**Throttling.**
- `MIN_GAP_MS` = 2000 by default, set by `OSIRIS_NOMINATIM_GAP_MS`; floored at 1000 outside tests.
- Requests are serialised on a promise chain.
- `MAX_QUEUE` = 40. When that many are queued, or when `cacheOnly` is set and there is no cache hit, the call returns null and counts as refused.

**Cache.**
- Key is endpoint plus params sorted into a query string.
- Hits are kept 30 days (`HIT_TTL`), failures 10 min (`FAIL_TTL`, stored as null).
- `MAX_ENTRIES` 20000, oldest evicted first.
- In-flight requests are deduplicated.
- Persisted to `OSIRIS_NOMINATIM_CACHE` or `.cache/nominatim.json`, written at most once per 60 s via a tmp file and rename; set the env var to 'off' to disable.

**Stats.** `nominatimStats()` returns `{served, fromCache, sent, refused, failed, cached, queueDepth}`. It is exposed at `/api/health` as `nominatim`, alongside `{status:'serving', scope:'process', checks_performed:'none', uptime_seconds}`.

`ATTRIBUTION` = '© OpenStreetMap contributors'. The code references GitHub issue #16: OSM's sysadmin complained about more than 10 req/s.

Files: `src/lib/nominatim.ts`, `src/app/api/health/route.ts`

### 9. /api/live-news — 15 broadcast channels

Static list. Fields: `id`, `name`, `city`, `country`, `lat`/`lng`, `url`, `embed_allowed`, `category`, `language:'en'`.

**External only (`embed_allowed:false`)** — `url` is `https://www.youtube.com/channel/<ID>/live` unless noted:
- nbcnews (UCeY0bbntWzzVIaj2z3QigXg)
- cbsnews (UC8p1vwvWtl6T73JiExfWs1g)
- abcnews (UCBi2mrWuNuyYy4gbM6fU18Q)
- bloomberg (UC_vQ72b7v5n2938v9d5c80w, category finance)
- cspan (UCb--64Gl51jIEVE-GLDAVTg, category government)
- cbc (UCKy1dAqELon0zgzZPOz9SVw)
- cgtn (UCgrNz-aDmcr2uuto8_DL2jg, category state)
- rt: `https://rumble.com/c/RTNewsEN`

**Embeddable (`embed_allowed:true`)** — URL form `https://www.youtube.com/embed/live_stream?channel=<ID>&autoplay=1&mute=1`:
- skynews (UCoMdktPbSTixAyNGwb-UYkQ)
- france24en (UCQfwfsi5VrQ8yKZ-UWmAEFg)
- dwnews (UCknLrEdhRCp1aegoMqRaCZg)
- aljazeera (UCNye-wNBqNL5ZzHSJj3l8Bg)
- nhkworld (UCSPEjw8F2nQDtmUKPFNF7_A)
- cna (UC83jt4dlz1Gjl58fzQrrKZg)
- wion (UC_gUM8rL-Lrg6O3adPW9K1g)

There are no HLS streams.

**Response.** `{feeds, total, categories:['mainstream','government','finance','conflict','state'], timestamp}`. Cache-Control: `public, s-maxage=86400, stale-while-revalidate=172800`.

**Client.**
- Fetched once when layer `live_news` ('Live News Feeds') is enabled.
- Map dots in `#EC407A`.
- Map preview tiles (`LiveNewsPreviews.tsx`): MIN_ZOOM 13, MAX_TILES 4, 208×117 px. `embedUrl()` forces autoplay/mute/playsinline/rel=0/modestbranding/`enablejsapi=1` and only accepts `youtube.com/embed/`. Dead tiles are detected by posting `{event:'listening', id, channel:'widget'}` to the iframe and dropping the tile on an `onError` message.
- Clicking a feed opens it in the viewer; `embed_allowed:false` opens externally.

Files: `src/app/api/live-news/route.ts`, `src/components/LiveNewsPreviews.tsx:35-148`, `src/app/page.tsx:574-581`

### 10. /api/markets and /api/markets/history — Yahoo v8 chart

**Tickers (28), by group.**
- indices: ES=F 'S&P 500', NQ=F 'Nasdaq 100', ^VIX, DX-Y.NYB 'Dollar Index', ^TNX 'US 10Y'
- stocks: RTX, LMT, NOC, GD, BA, LHX, PLTR
- oil: CL=F 'WTI Crude', BZ=F 'Brent Crude', NG=F 'Natural Gas'
- commodities: GC=F Gold, SI=F Silver, HG=F Copper, ZW=F Wheat, ZC=F Corn
- crypto: BTC-USD, ETH-USD, SOL-USD, XRP-USD
- fx: EURUSD=X, USDJPY=X, GBPUSD=X, USDCNY=X

**Quote fetch.** URL `https://query1.finance.yahoo.com/v8/finance/chart/<sym>?interval=1d&range=1mo`, Chrome UA, 8 s timeout.
- price = `meta.regularMarketPrice`
- spark = non-null daily closes (2dp)
- prevClose = second-to-last close (not `chartPreviousClose`, which would give a monthly move)
- `market_open` from `meta.currentTradingPeriod.regular` start/end

Five concurrent workers, then one retry pass for misses. A `lastGood` Map keeps the previous quote per symbol. Wrapped in `cachedSource('markets', 60_000)`.

**SCM alerts.** The route self-fetches `${origin}/api/maritime` (3 s). When a chokepoint's risk is CRITICAL or HIGH it adds:
- '🚨 HORMUZ <risk>: High risk of WTI/Brent Crude price spike due to congestion.'
- '🚨 SUEZ …: Potential supply chain delays impacting European markets and Energy.'
- '🚨 PANAMA …: LNG and Agriculture (Corn/Wheat) shipment delays expected.'

**Response.** `{indices:{<name>:Quote}, stocks, oil, commodities, crypto, fx, scm_alerts[], count, timestamp}`, where Quote = `{group, name, symbol, price, change_percent, up, spark[], currency, market_open}`. Cache-Control: `no-store`.

**Client polling.** First load at 800 ms, retried every 15 s up to 3 times while count is 0, then polled every 900000 ms (15 min) and skipped when hidden.

**History route.** Params `symbol` (required) and `range`, which is case-sensitive (`1m` is minutes, `1M` is a month):

| range | interval | Yahoo range |
|---|---|---|
| 1m | 1m | 1d |
| 15m | 15m | 2d |
| 24H | 5m | 1d |
| 1W | 30m | 5d |
| 1M (default) | 1d | 1mo |
| 6M | 1d | 6mo |
| 1Y | 1wk | 1y |

Candles are `{time (epoch s), open, high, low, close, volume}`; bars with any null OHLC are dropped. Response `{symbol, range, interval, currency, candles}` with `Cache-Control: public, max-age=60`. The client (`MarketChart.tsx`) renders it with the lightweight-charts library.

Files: `src/app/api/markets/route.ts`, `src/app/api/markets/history/route.ts`, `src/components/MarketChart.tsx:7-30`, `src/app/page.tsx:694-721`

### 11. /api/crypto and /api/chain/daily

**`/api/crypto`.** Calls `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd` (15 s, `next.revalidate: 60`). Returns a bare array `[{symbol:'BTC'|'ETH'|'SOL', price}]`, or `[]` on error. No UI consumer was found.

**`/api/chain/daily`.**
- Params: `days` (1–120, default 30) and `refresh=1`.
- Rate limit: `isRateLimited(getClientIp, 30, 60_000)`, 429 when exceeded.
- Cache-Control: `public, s-maxage=1800, stale-while-revalidate=3600`.
- `buildDailyBrief` runs its sources sequentially, with a 30-min in-process cache (90 s if any section is degraded).

Sources:
- DefiLlama `https://api.llama.fi/hacks` (25 s), filtered by date and mapped to `{name, date, amount_usd, chain, classification, technique, target_type, bridge_hack, returned_funds, source}`.
- NVD `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=<kw>&pubStartDate&pubEndDate&resultsPerPage=40` for the keywords blockchain, cryptocurrency, wallet and 'smart contract', with a 1200 ms gap and a maximum span of 119 days.
- OpenSanctions `https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv` (24 h TTL, via `lib/sanctions.ts`). Wallets are classified by regex (ETH `0x[40hex]`, BTC bc1/1/3, XMR `4…95`, TRX `T…34`).

Output: `{generated_at, window_days, exploits≤40, cves≤40, sanctioned_wallets≤40, totals{exploit_count, exploit_losses_usd, cve_count, critical_cves(cvss≥9), sanctioned_wallet_count}, degraded[], sources}`.

The `ChainBrief` panel auto-refreshes every 15 min (`AUTO_REFRESH_MS`) when the tab is visible.

Files: `src/app/api/crypto/route.ts`, `src/app/api/chain/daily/route.ts`, `src/lib/chainFeeds.ts`, `src/lib/sanctions.ts:20-22`, `src/components/ChainBrief.tsx:15-80`

### 12. /api/scm-suppliers

There are 14 hard-coded suppliers: TSMC Hsinchu/Tainan, Samsung Giheung, SK Hynix Icheon, Sony Kumamoto, Murata Izumo, Bosch Stuttgart, ZF Friedrichshafen, Valeo Paris, Magna Celaya, Denso Monterrey, CATL Ningde, BYD Shenzhen and Panasonic Sparks.

Fields: `{id, name, city, country, lat, lng, category ∈ Semiconductor|Electronics|Automotive|Battery}`.

**Risk checks**, using flat-earth distance `sqrt(dx²+dy²)*111.32`:

| Source | Radius | Result |
|---|---|---|
| USGS 4.5_day earthquakes | < 150 km | CRITICAL + 'SEISMIC SHOCK (M<x.x>)' |
| `http://127.0.0.1:3000/api/fires` | < 50 km | HIGH (if NORMAL) + 'WILDFIRE PROXIMITY (<n> hotspots)' |
| `http://127.0.0.1:3000/api/gdelt` | < 100 km | CRITICAL + 'ARMED CONFLICT / RIOT' |

**Response.** `{suppliers[{…, risk_level:'NORMAL'|'HIGH'|'CRITICAL', active_threats[]}], total, critical_count, timestamp}` with `no-store`. The UI's ScmPanel does not fetch this route; it reads `markets.scm_alerts`.

Files: `src/app/api/scm-suppliers/route.ts`, `src/components/ScmPanel.tsx:24`

### 13. /api/cloudflare-radar — outages + L3 attack origins

**Auth.** Needs env `CLOUDFLARE_API_TOKEN` (scope 'Radar: Read'), sent as a Bearer token. Base URL `https://api.cloudflare.com/client/v4/radar`.

**Probe.** `?probe=1` always returns 200 `{configured, source:'Cloudflare Radar'}`. The page calls it at load to hide the layers when unconfigured.

**Unconfigured.** Returns 503 `{configured:false, outages:[], attack_origins:[], error, hint:'Set CLOUDFLARE_API_TOKEN (Cloudflare account → API Tokens → Radar: Read) in .env'}`.

**Calls**, via `Promise.allSettled` with a shared 20 s signal:
- `/annotations/outages?limit=50&format=json`
- `/attacks/layer3/top/locations/origin?limit=25&format=json`

**Outage mapping.** One marker per country code in `annotation.locations`, placed at a centroid from `lib/countryCentroids.ts` (`[lng,lat]`, eyeballed). Fields: `{id:'<annId>-<CC>', lat, lng, country, country_name, scope, event_type (default 'OUTAGE'), cause (outageCause||outageType), description, start, end, ongoing: !endDate, url: linkedUrl}`.

**Attack mapping.** Reads `result.top_0` (or `top0`): `{country, country_name, lat, lng, share (%, 2dp)}`.

**Response.** `{configured:true, outages, attack_origins, total_outages, total_attack_origins, partial?, errors?, source, timestamp}`; 502 when both sections fail. Cache-Control: `public, s-maxage=300, stale-while-revalidate=600`.

**Client.** One `loadLayerOnce` backs both layers:
- 'Internet Outages' (`cf_outages`): halo `#FFB300` at opacity 0.12; dots `#FFB300` when ongoing, `#8B7325` when resolved; country_name label from zoom 3.
- 'Attack Origins' (`cf_attacks`): `#FF3D3D` dots sized by share (0→4, 5→9, 20→16, 50→24); label 'CC n%' in `#FF6B6B`; font 'JetBrains Mono Bold'.

There is no polling.

Files: `src/app/api/cloudflare-radar/route.ts`, `src/lib/countryCentroids.ts`, `src/components/OsirisMap.tsx:585-611`, `src/components/LayerPanel.tsx:138-139`, `src/app/page.tsx:435-440`

### 14. /api/cctv — catalogue architecture, params, response

**Params.**
- `region`: 'all', or a CSV of region keys (filtered to known keys).
- `lat`/`lng`/`radius`: `getRegionsForBounds` point-in-box rules. `radius` is ignored; the fallback is ['uk','us-east'].
- No params: all regions.

**Region keys (about 56).** middle-east, uk, us-west (WSDOT+Caltrans), us-east, us-central, canada, europe, netherlands, asia, bulgaria, greece, serbia, macedonia, turkey, romania, australia, italy, czechia, slovakia, germany, france, spain, poland, japan, switzerland, finland, sweden, hongkong, utah, iceland, taiwan, thailand, asia-live, newzealand, lithuania, edmonton, oregon, michigan, indiana, nevada, louisiana, florida, georgia, northcarolina, arizona, texas, eastasia, seasia, westasia, latam-live, africa-live, europe-live, public-webcams-nl, public-webcams-europe, public-webcams-americas, public-webcams-rest.

**Per-region fetching.**
- Each region is wrapped in `cachedSource('cctv:<region>')` with the default 30-min TTL.
- `refreshRegion`: runs on `createPool(4)` with a 12 s budget (`REGION_BUDGET_MS`). On timeout the region is backed off for 5 min (`BACKOFF_MS`). Refreshes are single-flight per region.
- `collectRegions`: serves stale cached data and refreshes it in the background. Missing regions are awaited for 12 s when nothing is cached, or 2 s (`WARM_GRACE_MS`) when some cameras are already cached.

**Prebuilt payload (`lib/cctv-snapshot.ts`).**
- `buildPayload` serialises the JSON once, gzips it (level 6) and computes ETag `W/"<sha1 base64url>"`.
- `servePayload` returns 304 on `If-None-Match`, and gzip bytes when `Accept-Encoding` includes gzip.
- Headers: `Cache-Control: public, max-age=60, stale-while-revalidate=600`, `Vary: Accept-Encoding`.
- Background rebuild when the payload is incomplete or older than 5 min (`PAYLOAD_REFRESH_MS`), delayed 2 s after the response.

**Disk snapshot.** `OSIRIS_CCTV_SNAPSHOT` or `.cache/cctv-catalog.json`, format `{version:1, builtAt, regions}`, written via tmp file and rename. Saved at most every 60 s and only when the total camera count exceeds the previous high-water mark. Restored on the first request (`ensureRestored`) and via `warmCctvCatalog` from instrumentation.

**Response.** `{cameras[], total, sources{<source>:count}, regions[], pendingRegions[], timestamp}`. For partial or subset responses, Cache-Control is `no-store, max-age=0` when regions are pending or there are fewer than 50 cameras, otherwise `public, s-maxage=300, stale-while-revalidate=600`.

**Camera record (`CctvCamera`).** `{id, lat, lng, name, city, country, feed_url? (still), stream_url?, stream_type?: 'jpg'|'hls'|'iframe'|'mjpeg' (+'mp4' used by Quebec), external_url?, source}`.

**Client (`loadCameraCatalog`).**
1. GET `/api/cctv?region=all` with `cache:'no-store'`.
2. Retry only the `pendingRegions` (validated against `/^[a-z-]+$/`) up to 3 attempts total, with backoff `attempts*15000` ms.
3. Merge by id.

There is no periodic poll.

**Map styling.** `cctv-dots` colour `#00e676` (`--map-cctv`), black stroke 2.5, glow ring, name labels from zoom 10.

**Scale.** Code comments cite about 35,000 cameras and about 7.8 MB of JSON.

Files: `src/app/api/cctv/route.ts:482-558`, `src/app/api/cctv/route.ts:560-805`, `src/app/api/cctv/route.ts:808-933`, `src/app/api/cctv/route.ts:935-1051`, `src/lib/cctv-snapshot.ts`, `src/lib/camera-catalog.ts`, `src/lib/fetch-pool.ts`, `src/lib/sourceCache.ts`, `src/components/OsirisMap.tsx:472-487`

### 15. CCTV providers — upstream URL, parsing and normalisation (part 1: N. America)

**UK — TfL** (region uk). `https://api.tfl.gov.uk/Place/Type/JamCam`. The `additionalProperties` entry with key `imageUrl` gives `feed_url`, falling back to `https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/<id>.jpg`. id `tfl-<id>`.

**WSDOT** (us-west). `https://data.wsdot.wa.gov/log/public/cameras.json` → `CameraLocation.Latitude/Longitude`, `ImageURL`, `Title`.

**Caltrans** (us-west). `https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/CCTV/FeatureServer/0/query?where=1%3D1&outFields=*&f=json` → attributes `latitude`, `longitude`, `currentImageURL`, `locationName`, `nearbyPlace`/`county`.

**Canada** — seven sources fetched in parallel via `subSource`, which retries once on network errors and 5xx but not on 4xx:
- Ottawa `https://traffic.ottawa.ca/beta/camera_list` → `feed_url` `https://traffic.ottawa.ca/map/camera?id=<number>`
- Quebec 511 WFS `https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&outfile=Camera&srsname=EPSG:4326&outputformat=geojson` → `stream_url` = `URL_FLUX_DONNEE` with 'FenetreVideo.html' replaced by 'camera.ashx', plus '&format=mp4'; `stream_type:'mp4'`
- 511 Ontario `https://511on.ca/api/v2/get/cameras` (capitalised fields; the enabled View's `Url`)
- Montreal `https://ville.montreal.qc.ca/circulation/sites/ville.montreal.qc.ca.circulation/files/cameras.json`
- 511 Alberta `https://511.alberta.ca/api/v2/get/cameras`
- Toronto CKAN geojson `https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/a3309088-5fd4-4d34-8297-77c8301840ac/resource/4a568300-c7f8-496d-b150-dff6f5dc6d4f/download/traffic-camera-list-4326.geojson` (`IMAGEURL`, `MAINROAD`/`CROSSROAD`)
- DriveBC `https://drivebc.ca/api/webcams` → `https://drivebc.ca<links.imageDisplay>`

**Edmonton.** POST `https://edmontontrafficcam.com/Default.aspx/GetCameras` with body `{}`; rows are in `d[]`. Only rows with `Status=='1'` and `MMSUrl` on `winkcdn.com` are kept. `stream_url` is `https://<MMSUrl>/<Forge>/public/hls/<StreamCode>.m3u8` (HLS, CORS-echoing).

**us-central.** Only IDOT `https://www.travelmidwest.com/lmiga/cameraReport.json`, which is effectively empty.

**us-east.** Hard-coded Butler County Axis cameras `https://gsccam.butlersheriff.org/axis-cgi/jpg/image.cgi` and `https://towercam.butlersheriff.org/axis-cgi/jpg/image.cgi`, plus external links to Cincinnati YouTube and EarthCam pages.

**IBI 511 platform** (`ibi511.ts`).
- Endpoint `<base>/List/GetData/Cameras?query=<urlencoded DataTables JSON {columns:[{data:null,name:''},{name:'sortOrder',s:true},{name:'roadway',s:true},{data:3,name:''}],order:[{column:1,dir:'asc'}],start,length:100,search:{value:''}}>&lang=en`.
- Headers `X-Requested-With: XMLHttpRequest`. Responses are 100 rows per page with a `recordsTotal`.
- Paging: `MAX_PAGES` 60, `CONCURRENCY` 10, one retry of failed pages. If fewer than 95% of `recordsTotal` arrive, the load throws so the cache keeps the last good copy.
- Coordinates come from WKT `POINT (lng lat)` in `latLng.geography.wellKnownText`. `feed_url` is `base + images[0].imageUrl`.
- `stream_url` is `images[0].videoUrl`, only when it is a .m3u8 and neither `isVideoAuthRequired` nor `videoDisabled` is set. Georgia, Florida and NCDOT are all gated, so they show snapshots only.
- Labels: `cameraLabel` strips a `^[A-Z]{2,8}-?\d*\s*:\s*` prefix and falls back to road+direction when the location has no space.

Deployments:

| Agency | Base URL | Approx. cameras | id prefix |
|---|---|---|---|
| FDOT | `https://fl511.com` | ~4,950 | `fdot-` |
| GDOT | `https://511ga.org` | ~4,040 | `gdot-` |
| NCDOT | `https://drivenc.gov` | ~1,140 | `ncdot-` |
| ADOT | `https://az511.gov` | ~640, stills only | `adot-` |
| LADOTD | `https://511la.org` | 336, HLS on `*.dotd.la.gov` | `ladotd-` |
| NDOT | `https://www.nvroads.com` | ~600, HLS on `*.its.nv.gov`, CORS `*` | `ndot-` |
| UDOT | `https://prod-ut.ibi511.com` | ~2,000 | `udot-` |

UDOT uses `lang=en-US` and `feed_url` `<base>/map/Cctv/<id>`.

**MDOT.** `https://mdotjboss.state.mi.us/MiDrive/camera/list`. Fields contain HTML: coordinates come from the county 'Go to' link (`lat=..&lon=..`), the id from `?id=`, and the image from `<img src>`. id `mdot-`.

**ODOT.** `https://www.tripcheck.com/Scripts/map/data/cctvinventory.js`, requested with `Accept: */*` (a specific JSON Accept gets a 406). Esri features `attributes{cameraId, filename, latitude, longitude, route, title}` → `https://tripcheck.com/RoadCams/cams/<filename>`.

**INDOT.** POST GraphQL `https://511in.org/api/graphql`, query `MapFeatures` with `input{north, south, east, west, zoom:16}` and the inline fragment `... on Camera { active views(limit:1){category ... on CameraView{url}} }`.
- The poster URL `…/cameras/IN/(INDOT_\d+_token).flv.png` gives `stream_url` `https://skysfs4.trafficwise.org/preroll/<token>/playlist.m3u8`. Only the skysfs4 edge works; the first ~20 s of a stream is a PreRoll filler.
- `cleanTitle` strips asset numbers.
- `external_url` `https://511in.org/@lat,lng,14?show=<uri>`.

**TxDOT.** Inventory per district from `https://its.txdot.gov/its/DistrictIts/GetCctvStatusListByDistrict?districtCode=<X>` for 25 districts (ABL AMA ATL AUS BMT BWD BRY CHS CRP DAL ELP FTW HOU LRD LBB LFK ODA PAR PHR SJT SAT TYL WAC WFS YKM), each cached separately.
- Rows from `roadwayCctvStatuses{group:[{icd_Id, latitude, longitude, name, hasSnapshot:true}]}`.
- `feed_url` `/api/cctv/texas/snapshot?district=&id=`; `external_url` `https://its.txdot.gov/its/District/<D>/cameras`.
- The snapshot route calls `GetCctvSnapshotByIcdId?districtCode&icdId` (8 s, revalidate 20), base64-decodes `snippet` (≤8 MB) and checks the JPEG magic bytes FF D8 FF. It returns `image/jpeg` with `public, max-age=20` and `nosniff`; 404 or 502 otherwise, with `no-store`.

Files: `src/app/api/cctv/route.ts:69-385`, `src/app/api/cctv/ibi511.ts`, `src/app/api/cctv/utah.ts`, `src/app/api/cctv/nevada.ts`, `src/app/api/cctv/louisiana.ts`, `src/app/api/cctv/florida.ts`, `src/app/api/cctv/georgia.ts`, `src/app/api/cctv/northcarolina.ts`, `src/app/api/cctv/arizona.ts`, `src/app/api/cctv/michigan.ts`, `src/app/api/cctv/oregon.ts`, `src/app/api/cctv/indiana.ts`, `src/app/api/cctv/texas.ts`, `src/app/api/cctv/texas/snapshot/route.ts`, `src/app/api/cctv/edmonton.ts`

### 16. CCTV providers (part 2: Europe, Asia-Pacific, aggregators)

**Netherlands — Rijkswaterstaat.** `https://api.rwsverkeersinfo.nl/api/cameras`, 26 cameras. Coordinates arrive as strings. `static_url` is served through `/api/cctv/proxy` because `stream.inmoves.nl` returns 401 without a Referer. `stream_url` (a player page) becomes `external_url`. Name is 'road — near'.

**Austria — ASFINAG.** `https://odo.asfinag.at/odo/rest/sec/resource/001/json/webcams?language=atDE`, sent with header `Authorization: Basic [redacted]` ([redacted]), Referer/Origin `https://www.asfinag.at`. Reads `wcs_id`, `wgs84_lat`/`lon`, `url_campic`; Utinform cameras are skipped. Own 1 h cache.

**Sweden.**
- Trafikverket via Kolla Trafiken: POST `https://www.kollatrafiken.se/api/v1/counties`, then POST `/api/v1/cameras` with `county=<id>` (form-encoded, `X-Requested-With`, pool of 4, one retry). Images must be https on `api.trafikinfo.trafikverket.se`; ids must match `/^[\w-]{1,40}$/`.
- CamStreamer: `https://camstreamer.com/live/update-search-map?country%5B0%5D=Sweden` → `videos[{name, iframe_url, lat, lng, detail_link}]`. Each `iframe_url` is fetched with `redirect:'manual'` and the YouTube id is extracted from the `Location` header to build a youtube-nocookie embed, with the CamStreamer player as fallback.
- Streams whose city is 'Sweden' take the county of the nearest road camera within 60 km.
- UA 'OSIRIS/5.0 (+https://osirisai.live)'.

**Finland — Fintraffic.** `https://tie.digitraffic.fi/api/weathercam/v1/stations` with header `Digitraffic-User: OSIRIS/1.0`. Uses `presets[0].imageUrl`, falling back to `https://weathercam.digitraffic.fi/<presetId>.jpg`.

**Iceland — Vegagerðin.** `https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1` → `Breidd`/`Lengd`/`Slod`.

**Lithuania — Via Lietuva.** Joins `https://eismoinfo.lt/eismoinfo-backend/layer-static-features/VKR?lks=false` (WGS84) with `https://eismoinfo.lt/eismoinfo-backend/camera-info-table` on id. Frames older than 6 h are dropped. `feed_url` goes through the proxy: `https://eismoinfo.lt/eismoinfo-backend/image-provider/camera/last?id=<id>`. `external_url` `https://eismoinfo.lt/#!/vkr/<id>`. Source is 'Via Lietuva' per the terms of use.

**Spain — DGT.** `https://www.dgt.es/.content/.assets/json/camaras.json` → `camaras[{latitud, longitud, carretera, pk, sentido, provincia, imagen}]`. Name is '<road> km <pk> (dir)'. The 52-entry `PROVINCE_MAP` gives the city. Images go through the proxy (`etraffic.dgt.es`). Own 5-min cache. Plus 3 YouTube embeds.

**Hong Kong — Transport Department.** XML `https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml`, split on `<image>` and read `key`/`url`/`latitude`/`longitude`/`description`/`district`. Bounds 22.1–22.6 lat, 113.8–114.5 lng. The fallback is 10 curated cameras at `https://tdcctv.data.one.gov.hk/<id>F.JPG`.

**Taiwan — THB.** `https://thbapp.thb.gov.tw/services/cctv/thb` (20 s) → rows `{gisy, gisx, html, stakenumber, id}`. `feed_url` is `/api/cctv/proxy?url=<html>/snapshot`; the proxy sends no Referer to `thb.gov.tw` because DigiEver encoders emit malformed headers when a Referer is sent. City comes from coarse bounding boxes. Plus 4 YouTube embeds.

**New Zealand — NZTA.** XML `https://trafficnz.info/service/traffic/rest/4/cameras/all`. Nested `journey|journeyLeg|region|way` blocks are stripped first; region name comes from `<region>`. Cameras with `offline` or `underMaintenance` are skipped. `feed_url` `https://trafficnz.info<imageUrl>`, `external_url` `/camera/view/<id>`.

**Singapore — LTA** (region asia). `https://api.data.gov.sg/v1/transport/traffic-images` → `items[0].cameras[{camera_id, location, image}]`.

**Australia.** `https://www.livetraffic.com/datajson/all-feeds-web.json`, filtered to `eventType=='liveCams'`, using `properties.href`.

**Japan.** 51 hard-coded entries: YouTube embeds (e.g. Shibuya `coYw-eVU0Ks`) and MLIT river cameras `https://cam.river.go.jp/cam/now/<id>.jpg`.

**Other hard-coded sets.**
- Poland: about 70 nadmorski24 HLS streams `https://ls.tkchopin.pl/live/<name>.stream/playlist.m3u8`, plus Słupsk MJPEG `https://www.slupsk.pl/kamera2`.
- Serbia: Belgrade jpg and AMSS HLS `https://kamere.amss.org.rs/gradina1/gradina1.m3u8`.
- North Macedonia: Neotel HLS `https://streaming1.neotel.net.mk/stream/{deve_bair,tabanovce}.m3u8`.
- Greece: ipcamlive iframe `https://ipcamlive.com/player/player.php?alias=cam128&autoplay=1`.
- Bulgaria: UAB jpg and Smart Burgas HLS.
- Romania: 1 jpg.
- Switzerland: CHUV Axis jpg and SkylineWebcams.
- YouTube embeds: Italy (Skyline), Germany, Czechia, Slovakia, France, Thailand (6), Israel/Lebanon (4).
- Turkey: empty.

**OpenCCTV** (eastasia, seasia, westasia).
- GET `https://opencctv.org/api/cameras/markers` returns parallel arrays `{ids, lats, lngs}` (7.3 MB, cached once and shared).
- Cameras are filtered by region box and sampled at a fixed stride to a cap: eastasia 1200, seasia 800, westasia 600.
- Details come from POST `https://opencctv.org/api/cameras/batch` with `{ids}`, which returns at most 50 rows.
- `feed_type` maps m3u8/hls → hls, mjpeg → mjpeg, image → jpg, iframe → iframe.
- Skipped: `/offcam/` URLs, eismoinfo.lt hosts, and jpgs flagged `cache_buster_breaks_url`.
- Source label `OpenCCTV / <source>`.

**Generated lists.**
- SkylineWebcams: `asia-skyline.generated.ts` (260) and `world-skyline.generated.ts` (341, latam/africa/europe). Only posters observed refreshing get a `feed_url` (proxied `cdn.skylinewebcams.com/live<ID>.jpg`); all have `external_url` to the Skyline page.
- `public-webcams.generated.ts`: 300 rows, NL 216 and the rest worldwide. Four shapes: HLS on Wowza `streamlock.net` (CORS `*`), YouTube channel `/live` links (resolved at runtime), iframe embeds, and external link only. Built by `scratch/scrape_public_webcams.js` with Nominatim-resolved coordinates.

Files: `src/app/api/cctv/netherlands.ts`, `src/app/api/cctv/asfinag.ts`, `src/app/api/cctv/sweden.ts`, `src/app/api/cctv/finland.ts`, `src/app/api/cctv/iceland.ts`, `src/app/api/cctv/lithuania.ts`, `src/app/api/cctv/spain.ts`, `src/app/api/cctv/hongkong.ts`, `src/app/api/cctv/taiwan.ts`, `src/app/api/cctv/newzealand.ts`, `src/app/api/cctv/australia.ts`, `src/app/api/cctv/japan.ts`, `src/app/api/cctv/poland.ts`, `src/app/api/cctv/opencctv.ts`, `src/app/api/cctv/public-webcams.generated.ts`, `src/app/api/cctv/world-skyline.generated.ts`, `src/app/api/cctv/asia-skyline.generated.ts`

### 17. CCTV stream-type detection, playback, resolve and stream-status

**Detection.**
- `inferStreamType(url)`: `.m3u8` → hls. youtube.com/embed, youtube-nocookie embed, rtsp.me/embed, ipcamlive.com/player, click2stream.com, windy.com/webcams/<n>/embed, skylinewebcams.com and voyage.aprr.fr → iframe. Anything else → jpg.
- `normalizeFeedUrl` rewrites `pics/…` to `http://free-webcambg.com/…` and strips the query string.
- `proxiedImageUrl` routes `infobanjirjps.selangor.gov.my` through the proxy because of mixed content.

**Viewer (`CameraViewer.tsx`).**
- HLS: `new Hls({enableWorker:false})`, `loadSource` then `attachMedia`, play on MANIFEST_PARSED, error on a fatal event. Safari falls back to native `application/vnd.apple.mpegurl`.
- mjpeg: `<img src=stream_url>`.
- mp4: `<video autoplay muted playsinline loop>`.
- iframe: `<iframe allow='autoplay; fullscreen'>`.
- jpg: `<img>` cache-busted with `?_t=<Date.now()>` every 5000 ms, plus a manual refresh button.

**Off-platform decision (`lib/camera-feed.ts`).**
- `isHostedOffPlatform`: `external_url` only.
- `localEmbed`: a YouTube video URL becomes an embed without a network call.
- `needsResolution`: Skyline pages and YouTube channel `/live` links.
- `liveFeedAtSource`: a Skyline camera that has a snapshot shows the badge 'SNAPSHOT' and a 'WATCH LIVE' link.
- `offPlatformView` returns one of 'resolving' | 'offline' | 'external' | 'inline'.

**Viewer labels.**
- 'DECRYPTING FEED...'
- 'ACQUIRING UPLINK' / 'Locating a direct feed'
- 'CAMERA WITHDRAWN' / 'CAMERA OFFLINE'
- 'SECURE FEED ENCRYPTED' / 'This feed requires external clearance', with an 'ACCESS TERMINAL' button
- 'FEED UNAVAILABLE', with 'RETRY'
- Live badge: 'LIVE SAT-LINK' for jpg, otherwise 'LIVE FEED'
- Header: `CAM-<lat4>-<lng4>` id, UTC clock, 'SECURE UPLINK'
- Footer: 'FEED TYPE', 'STATUS' (ACTIVE / RECORDING | HOSTED OFF-PLATFORM | LIVE VIDEO AT SOURCE | OFF AIR AT SOURCE | REMOVED BY SOURCE), 'RAW FEED', 'MAP TARGET' (Google Maps @lat,lng,17z)
- Visuals: CRT scanline overlay, crosshair, 20 px grid, gold accents `var(--gold-primary)`

**`/api/cctv/resolve?url=`.** Accepts only Skyline hosts or YouTube channel live links (host comparison, not substring).
- Fetched with `safeFetch` (10 s, UA 'Mozilla/5.0 (compatible; OSIRIS/1.0; +https://github.com/simplifaisoul/osiris)').
- Skyline pages: `extractYouTubeId` using the patterns `videoId:'…'`, `"videoId":"…"`, canonical `?v=` and `/embed/<11>`. An `<strong>OFFLINE</strong>` banner means offline; `.m3u8` means hls (not re-served); otherwise unknown.
- 404/410 → missing.
- Response is `{embeddable:true, kind:'youtube', videoId, embedUrl}` or `{embeddable:false, kind}`.
- Embed URL: `https://www.youtube-nocookie.com/embed/<id>?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3`.
- In-memory cache, max 1000 entries: ok 30 min, no-feed 5 min, unreachable 30 s. Headers `X-Cache` HIT/MISS; `Cache-Control: public, s-maxage=600, stale-while-revalidate=1800`.

**`/api/cctv/stream-status?url=`.** Only accepts rtsp.me hosts on `/embed` paths. Fetches with `safeFetch` (8 s) and matches `/temporarily limited|Top up/i` in the HTML (quota exhausted). Returns `{available, blocked, provider:'rtsp.me'}` with `s-maxage=300`.

**Map preview tiles (`CctvPreviews.tsx`).** MIN_ZOOM 13, MAX_TILES 8, MAX_VIDEO_TILES 4, tile 176×99 px. Refresh cadence: jpg 15 s, mp4 60 s, hls/mjpeg never. hls.js is imported dynamically with `maxBufferLength: 6`. iframes are never tiled.

Files: `src/app/api/cctv/types.ts`, `src/components/CameraViewer.tsx`, `src/lib/camera-feed.ts`, `src/lib/camera-preview.ts`, `src/lib/youtube.ts`, `src/lib/skyline.ts`, `src/app/api/cctv/resolve/route.ts`, `src/app/api/cctv/stream-status/route.ts`, `src/components/CctvPreviews.tsx:19-165`

### 18. /api/cctv/proxy — image proxy and SSRF posture

GET `?url=`, `maxDuration` 15.

**Allowlist** (exact host or subdomain): `cdn.skylinewebcams.com`, `cdn2.skylinewebcams.com`, `s3-eu-west-1.amazonaws.com`, `voyage.aprr.fr`, `stream.inmoves.nl`, `thb.gov.tw`, `etraffic.dgt.es`, `eismoinfo.lt`, `infobanjirjps.selangor.gov.my`. Any other host gets 403 'Forbidden domain: <host>'.

**Request.**
- Headers: `Accept: image/*,*/*` and a Chrome 126 UA.
- Sends `Referer: https://<host>/` except to `thb.gov.tw` (`NO_REFERER_HOSTS`).
- `rejectUnauthorized:false` for https.

**Address handling.** DNS lookup with `all:true` and up to 2 addresses. Each address is tried in turn with a 6 s timeout, pinned through a custom `lookup` so the Host header and SNI are unchanged.

**Redirects.** 301/302 are followed by calling `fetchFrame` on the new URL. The allowlist and private-IP checks are NOT re-applied.

**Content type.** `imageType()` sniffs magic bytes (JPEG FFD8FF, PNG, WEBP, GIF) when the declared type is not `image/*`. This fixes Singapore's octet-stream + nosniff frames.

**Response headers.** `Cache-Control: public, max-age=5, stale-while-revalidate=10` and `Access-Control-Allow-Origin: *`. Upstream status ≥400 is passed through; exceptions return 502.

**Related guards.** `/api/proxy-tiles` only allows `*.cartocdn.com`, uses `next.revalidate` 31536000, and returns `Cache-Control: public, max-age=31536000, immutable`. OsirisMap's `transformRequest` rewrites every cartocdn URL to `/api/proxy-tiles?url=`.

Files: `src/app/api/cctv/proxy/route.ts`, `src/app/api/proxy-tiles/route.ts`, `src/components/OsirisMap.tsx:335-342`

### 19. lib/ssrf-guard.ts, stealthFetch, httpJson

**`validateHost`.**
- Rejects the name patterns localhost, *.localhost, host.docker.internal, *.local, *.internal and metadata.google.internal.
- Rejects non-canonical IPv4 forms (decimal, hex, octal).
- Blocked IPv4 ranges: 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4.
- Blocked IPv6 prefixes: ::, ::1, ::ffff:, 64:ff9b::, 100::, 2001:db8:, fc, fd, fe8–fef, ff.
- Resolves A and AAAA and rejects if any answer is blocked.

**`safeFetch`.** http/https only, `redirect:'manual'`, at most 3 redirects, each hop revalidated.

**`isRateLimited(ip, limit=20, windowMs=60000)`.** In-memory Map.

**`getClientIp`.** Priority: cf-connecting-ip, x-vercel-forwarded-for, true-client-ip, then x-real-ip, then the rightmost X-Forwarded-For entry, else 'unknown'.

**`visitorIp`.** First public IP found, reading X-Forwarded-For left to right; used for geolocation.

**`stealthFetch`.** Adds a random UA from 10 browser strings and spoofed `X-Forwarded-For`/`X-Real-IP` values from 'residential' ISP ranges, with a 30 s hard timeout. Used by most CCTV fetchers.

**`httpJson`/`httpText`/`httpConditional`.** Node https with UA `OSIRIS-OSINT/1.0 (+https://github.com/simplifaisoul/osiris)`, decodes gzip/deflate/br by header, default timeout 20 s, and supports ETag/If-Modified-Since. It exists because undici `fetch` stalled with UND_ERR_CONNECT_TIMEOUT on some hosts.

Files: `src/lib/ssrf-guard.ts`, `src/lib/stealthFetch.ts`, `src/lib/httpJson.ts`

### 20. /api/infrastructure — 64 nuclear facilities

`NUCLEAR_FACILITIES` has 64 entries. Fields: `{id:'nuc-<cc>-<slug>', name, city, country, lat, lng, status, reactors, capacityMW, owner, sourceUrl?}`.

Coverage:
- Ukraine: 5, incl. Zaporizhzhia with status 'Active Conflict Zone'
- France: 4
- UK: 2
- Netherlands: 7 ANVS installations
- Other Europe: 8
- Russia: 11
- North America: 7
- China: 6
- Japan: 4
- South Korea: 3
- India: 2
- Iran and UAE: 1 each
- South Africa, Argentina, Brazil

Status values seen: Operational, Under Construction, Suspended, 'Destroyed / Decommissioning', 'Decommissioned / Exclusion Zone', 'Partial Shutdown', 'Operational (Extended)', 'Partially Operational', 'Decommissioned / Safe Enclosure'.

**Enrichment.** On every request the route fetches USGS `4.5_day.geojson` (5 s). Any facility within 150 km of a quake gets its status overwritten to 'SEISMIC RISK (M<x.x>)'.

**Response.** `{infrastructure, total, timestamp}` with `Cache-Control: no-store, no-cache, must-revalidate` and `Pragma: no-cache`.

**Client.** Fetched once when the 'Nuclear Facilities' layer is enabled. Dot colours:
- SEISMIC RISK: `#E65100`
- Active Conflict Zone: `#D32F2F`
- Decommission*: `#546E7A`
- Under Construction: `#FFA726`
- otherwise: `#26A69A`

Labels from zoom 5.

Files: `src/app/api/infrastructure/route.ts`, `src/components/OsirisMap.tsx:630-650`

### 21. /api/maritime — ports, chokepoints, aisstream.io

**Ports (52).** `{name, country, lat, lng, type:'container'|'energy'|'naval', volume?, rank?, fleet?}`: 33 container (including 2 Japanese 'energy'-type industrial ports), 6 energy (Ras Tanura, Fujairah, Novorossiysk, Houston, Kharg, Primorsk) and 13 naval bases.

**Chokepoints (10).**

| Name | Base risk | Traffic |
|---|---|---|
| Strait of Hormuz | HIGH | 21M bpd |
| Strait of Malacca | MODERATE | |
| Suez Canal | ELEVATED | |
| Bab el-Mandeb | CRITICAL | |
| Panama Canal | LOW | |
| Turkish Straits | MODERATE | |
| Danish Straits | LOW | |
| Cape of Good Hope | LOW | |
| Taiwan Strait | ELEVATED | |
| Lombok Strait | LOW | |

**AIS stream.**
- Needs env `AIS_API_KEY`. Connects on module load to `wss://stream.aisstream.io/v0/stream`.
- Subscription: `{APIKey, BoundingBoxes:[Tokyo Bay, Hormuz, Suez, Bab el-Mandeb, Panama, Malacca/Singapore, Taiwan Strait, Rotterdam/Channel, LA/LB, global [[-90,-180],[90,180]]], FilterMessageTypes:['PositionReport','ShipStaticData']}`.
- `shipsCache` Map on `globalThis`, keyed by MMSI, max 20,000 entries. Reconnects 5 s after close.
- Ship types: 80–89 tanker, 70–79 cargo, 35 military, otherwise cargo.
- Ship record: `{id, mmsi, name, lat, lng, speed(Sog), heading(TrueHeading||Cog), destination, type, timestamp}`. Ships older than 10 min are pruned.

**Snapshot (5 s TTL).** Built once and served to every caller as the same pre-serialised string.
- Ports count ships within 50 km. A ship counts as waiting when speed < 0.5 and it is not military. SEVERE when the waiting ratio > 0.6 or more than 30 waiting (dwell '7+ Days'); CONGESTED when > 0.4 or more than 15 ('3-5 Days'); otherwise NORMAL ('1-2 Days'). Port `volume` becomes '<vol> | LIVE: n (WAITING: w)'.
- Chokepoints count ships within 100 km: > 50 → CRITICAL; > 20 → HIGH; > 5 raises LOW to ELEVATED. `traffic` gets ' | LIVE SHIPS: n' appended.

**Response.** `{ports, chokepoints, ships, total_ports, total_chokepoints, total_ships, timestamp}` with `Cache-Control: public, max-age=5, s-maxage=5, stale-while-revalidate=15`.

**Client.** Adaptive polling: every 10 s while ships exist, otherwise every 300 s.
- Port dots: naval `#D32F2F`, energy `#E65100`, otherwise `#26C6DA`.
- Chokepoint dots: CRITICAL `#D32F2F`, HIGH `#E65100`, ELEVATED `#F9A825`, otherwise `#26A69A`.
- Ship dots: military `#D32F2F`, tanker `#E65100`, cargo `#26C6DA`, otherwise `#B0BEC5`.

Files: `src/app/api/maritime/route.ts`, `src/app/page.tsx:769-773`, `src/app/page.tsx:871-890`, `src/components/OsirisMap.tsx:674-700`, `src/components/OsirisMap.tsx:885-896`

### 22. /api/arcgis — catalog search and Feature Service query

**Mode 1: search.** `?q=&bbox=w,s,e,n` calls `https://www.arcgis.com/sharing/rest/search?q&type=Feature Service&filter=access:public&num=20&f=json[&bbox]` (20 s, 2 attempts).
- Returns `{results:[{id, title, url, snippet, owner, numViews, extent, tags}]}`.
- Cache-Control: `public, s-maxage=120, stale-while-revalidate=300`.
- Timeout returns 504.

**Mode 2: query.** `?service=<url>&bbox=`.
- `featureServiceTarget` requires https, rejects IP literals, strips hash and search, removes '/query', and splits off a trailing layer number. The path must match `/rest/services/.+/(Feature|Map)Server$`.
- Other `*Server` kinds get a 422 naming the kind; anything else gets 403.
- Rate limit: 30/min per IP.
- If no layer was given, `discoverLayer` calls `<root>?f=json` (cached 30 min). It surfaces a service error message (422), requires the `Query` capability (otherwise 'This service publishes map tiles only…', 422), and picks the first layer that is not a group (has no `subLayerIds`), defaulting to layer 0.
- Query: `<root>/<layer>/query?where=1=1&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&outFields=*&returnGeometry=true&resultRecordCount=2000&f=geojson[&geometry=bbox]`, sent through `safeFetch` (20 s).
- Returns raw GeoJSON with `Cache-Control: public, s-maxage=60, stale-while-revalidate=120`.
- A `safeFetch` block returns 403 'Forbidden target'.

Files: `src/app/api/arcgis/route.ts`, `src/components/ArcGISPanel.tsx:127-155`

### 23. /api/geo, /api/geo/reverse, /api/geosearch

**`/api/geo`** (IP geolocation). Uses `visitorIp()`. In production with no public IP it returns `{status:'fail', message:'Visitor address unknown'}`. Providers are tried in order with 5 s timeouts:
1. `https://ipapi.co/<ip>/json/` (UA 'OSIRIS/4.2')
2. `https://freeipapi.com/api/json/<ip>`
3. `http://ip-api.com/json/<ip>?fields=status,lat,lon,city,regionName,country,query,isp,org,as`

Output has the ip-api shape: `{status:'success', query, lat, lon, city, regionName, country, isp, org, as}`, with `Cache-Control: private, no-store`. The client flies to the visitor; after 6 s without an answer it lands on a random well-covered city (`pickLandingCity`).

**`/api/geo/reverse?lat&lng`.** Rounds to 0.1° (`GRID`=10) and calls Nominatim reverse with `zoom=10&addressdetails=1` through the queue.
- Returns `{label:'city|town|village|county, state|region, country' | null, attribution}`.
- Cache-Control: `public, s-maxage=2592000, max-age=86400, stale-while-revalidate=86400`.
- The client debounces 3000 ms, skips moves under 0.5°, and keeps its own 0.1° cache of up to 500 entries.

**`/api/geosearch?q&lat&lng`.**
- Queries shorter than 2 chars return `[]`.
- Photon first: `https://photon.komoot.io/api/?q=<q>&limit=8&lang=en[&lat&lon bias]` (8 s).
- If Photon returns fewer than 3 results, Nominatim search is added (`limit=6`, `addressdetails=0`, via the queue).
- `mergeResults`: Nominatim hits with importance ≥0.5 go first (so 'heathrow' finds the airport), then Photon, then the rest. Duplicates are dropped when within 0.001° and the name matches. Limit 8.
- `classifyKind` maps OSM class/value to country | region | city | street | address | poi | place.
- Result: `{name, context (≤3 parts), lat, lng, kind, source:'photon'|'nominatim', score?}`.
- Cached 10 min per `q|bias(1dp)`; Cache-Control `public, s-maxage=600, stale-while-revalidate=1800`.
- Client debounce: SearchBar 500 ms, DirectionsBar 280 ms. Both abort stale requests and send the map centre as bias. `ZOOM_BY_KIND` sets address 18, street 16, poi 16, default 13.

Files: `src/app/api/geo/route.ts`, `src/app/api/geo/reverse/route.ts`, `src/app/api/geosearch/route.ts`, `src/components/SearchBar.tsx:31-181`, `src/components/DirectionsBar.tsx:295-320`, `src/app/page.tsx:442-473`, `src/app/page.tsx:534-563`

### 24. /api/directions — Valhalla primary, OSRM fallback

**Params.**
- `from=lat,lng`, `to=lat,lng` (required; 400 without them)
- `via=lat,lng|lat,lng`
- `mode` = auto | bicycle | pedestrian
- `avoid` = tolls,highways,ferries

**Valhalla.** GET `https://valhalla1.openstreetmap.de/route?json=<{locations:[{lat,lon}], costing:mode, costing_options:{<mode>:{use_tolls:0, use_highways:0, use_ferry:0}}, alternates:2, directions_options:{units:'kilometers'}}>`.
- Retried once after 400 ms.
- Shape decoding: polyline precision 6.
- Maneuver type → kind: 1–3 depart, 4–6 arrive, 9–11 right, 13–14 left, 15–20 roundabout, 7–8 straight, 25–27 merge.
- Distances are km × 1000.

**OSRM fallback** (auto mode only). `https://router.project-osrm.org/route/v1/driving/<lng,lat;…>?steps=true&overview=full&geometries=geojson`. Instruction text is synthesised, e.g. 'Head out on X', 'At the roundabout, take exit N onto X', 'Keep left onto X'.

**Elevation** (bicycle and pedestrian only). `https://valhalla1.openstreetmap.de/height?json={range:true, shape:[≤120 samples]}` gives `elevation[{distance, height}]`. Ascent and descent ignore changes of 1 m or less.

**Response.** Top-level fields mirror `routes[0]`, plus `routes[]`. Each route: `{provider, mode, distance (m), duration (s), geometry:{type:'LineString', coordinates:[lng,lat][]}, steps[{instruction, distance, duration, location:[lng,lat], type}], hasHighway, hasToll, hasFerry, elevation?, ascent?, descent?}`.

No route returns 502 'No route found between those points'. Cache-Control: `public, s-maxage=300, stale-while-revalidate=600`. Both engines are reached through `httpJson` with the OSIRIS UA.

**Scope.** This is road/foot routing only. There is no aviation routing anywhere in this slice, and `lib/airports.ts` (554 lines) exists but belongs to a different slice. The new airport-to-airport flight path feature therefore needs new code: a great-circle or airway route, plus an airport lookup by IATA/ICAO code.

Files: `src/app/api/directions/route.ts`, `src/components/DirectionsBar.tsx:457`

### 25. Shared visual tokens seen in this slice

**Theme colours.** Gold accent `var(--gold-primary)`, plus `--cyan-primary`, `--border-primary`, `--text-muted` and `--alert-green`. Panels use the classes `glass-panel` and `osiris-glow`, with `hud-label` for small caps labels. Typography is mono with tracking 0.2em and sizes 9–12 px.

**Threat palette.** `#D32F2F` red, `#E65100` burnt orange, `#F9A825` amber, `#26A69A` teal, `#26C6DA` ocean cyan, `#EC407A` news rose, `#7E57C2` violet.

**Map fonts.** 'Open Sans Regular/Bold' and 'JetBrains Mono Bold'. Labels have a black halo 1–1.5.

**Basemap.** CARTO dark-matter (`public/dark-matter-style.json`) with tiles through the proxy. MapLibre 6.7.0 is vendored in `public/vendor/maplibre/6.7.0`. Map attribution: 'Geocoding © OpenStreetMap contributors'.

**Keyboard shortcuts.**
- f: fullscreen
- l: layers
- m: markets
- c: SCM panel
- i: intel
- s or Ctrl+F: search
- r: reset view to 20,0 zoom 2.5
- g: toggle globe/mercator

The URL persists active layers as `?layers=a,b,c`, debounced 1500 ms.

Files: `src/components/OsirisMap.tsx:391-487`, `src/lib/map-palette.ts:53-66`, `src/app/page.tsx:505-532`, `src/app/page.tsx:483-493`

## Worth copying

- Use a `cachedSource(key, fetcher, ttl)` wrapper for every upstream. It combines a TTL, in-flight dedupe, stale-on-error (a 60 s retry while still serving the last good data), 'empty result counts as failure', an LRU cap of 500, and `peekSource`/`seedSource`/`isStale` for serving stale data and restoring from disk.
- Serve the CCTV catalogue from a prebuilt payload: JSON serialised and gzipped once, a weak SHA1 ETag with 304s, and a disk snapshot that only saves forward (high-water mark). Restore it on the first request, rebuild in the background 2 s after responding, and refresh regions in a pool of 4 with a 12 s budget, a 5-minute backoff and a 2 s warm grace. Report `pendingRegions` so the client retries only those, up to 3 times with 15 s×n backoff.
- Scrape the IBI 511 platform once and reuse it for every state that runs it: a DataTables `query` JSON parameter on `/List/GetData/Cameras`, 100 rows per page at concurrency 10, a retry for failed pages, and a throw when fewer than 95% of `recordsTotal` arrive so the cache keeps the last good copy. Skip HLS URLs flagged `isVideoAuthRequired`, since they return 401 to anyone but the platform's own player.
- Parse Telegram with no API by reading `t.me/s/<channel>` HTML: split on the wrapper, use a balanced-div scan for `js-message_text`, strip sign-offs, split out a headline and BREAKING flag, and extract media, video (Telegram CDN only), forwards, replies and views. Merge cross-posts by a 24-word fingerprint and tag every source with its bloc and lean.
- Keep risk scoring transparent: a whole-word keyword count that ships the matched terms and a `risk_method` label with each score. Report `location_precision` (country-anchor, settlement or region) so markers are honest about their accuracy.
- Geoparse alerts with heuristic place candidates (a stoplist, prepositions for locative detection, skipping names after titles). Look them up in the theatre's countries first, then worldwide, with importance thresholds of 0.5 and 0.6. Budget new lookups at 15 per refresh plus cache-only answers, and cap the wait at 2.5 s.
- Put a single server-side door in front of Nominatim: a 2 s gap, a queue of 40 that refuses beyond that, a 30-day cache persisted to disk, a 10-minute failure cache and an identifying UA. Expose its stats in `/api/health`. Never call Nominatim from the browser; round reverse lookups to 0.1°.
- For search, use Photon for type-ahead and add Nominatim only when Photon returns fewer than 3 hits, promoting prominent results (importance ≥0.5). Dedupe within 0.001°, bias by map centre, and abort stale keystroke requests.
- For routing, use Valhalla with `alternates:2`, avoid options (`use_tolls` etc. set to 0), and a `/height` elevation profile for walking and cycling, with OSRM as the driving fallback. Normalise both to one shape with top-level fields mirroring `routes[0]`. The same pattern fits the new flight-path feature: primary provider, fallback, and a `routes[]` array.
- Read the GDELT 2.0 15-minute export directly: `lastupdate.txt`, then the ZIP, unzipped with the raw `inflateRawSync` local-header trick (no dependency). Pin requests to IPv4, walk back to earlier windows on 404, and filter by quad, articles and limit. Colour dots by QuadClass and size them by article count.
- Get Yahoo v8 chart data with `range=1mo` so one call gives price, sparkline and trading session. Compute the previous close from the second-to-last close, use a worker pool of 5 with a retry pass, and keep a `lastGood` map per symbol. Use case-sensitive history ranges (`1m` minutes vs `1M` month) with a sensible interval per range.
- For region dossiers, use Photon reverse with `radius=50` for the place name and Wikidata REST statements instead of SPARQL. Filter statements by rank and the P582 end qualifier, read the office from the country's P1906, batch labels through `wbgetentities`, cache 24 h per country, and don't cache an empty dossier.
- In the camera viewer, model the off-platform decision as an explicit state machine (resolving, offline, external, inline). Resolve SkylineWebcams pages and YouTube channel `/live` links to youtube-nocookie embeds at runtime, never baking in video ids. Use separate cache TTLs: ok 30 min, no-feed 5 min, unreachable 30 s.
- Proxy tricks worth keeping: sniff content type from magic bytes, try each DNS address with a short timeout, drop the Referer for hosts that choke on it, and add a Referer for hotlink-protected hosts. Decode TxDOT's base64 JSON snapshot into a real JPEG endpoint.
- Map preview tiles: only from zoom 13, at most 8 tiles with 4 video decoders, jpg refreshed every 15 s, mp4 every 60 s, HLS never re-pointed, and hls.js loaded only when needed. For YouTube tiles, send the postMessage 'listening' handshake and drop tiles that report `onError`.
- For maritime, keep the AIS websocket in memory and build a 5 s pre-serialised snapshot so cost does not grow with viewers. Poll adaptively on the client: 10 s while ships exist, 5 minutes otherwise. Derive congestion from vessels waiting at speed below 0.5 kn.
- Cloudflare Radar: offer a `?probe=1` capability check so the UI hides layers the deployment has no token for. Let each section degrade on its own, reporting `partial` and `errors`.
- SSRF hardening: `safeFetch` revalidates on every redirect, requests are refused by name pattern, IP literal and resolved range, and the ArcGIS URL is rebuilt through a URL object rather than string concatenation. `getClientIp` reads the rightmost X-Forwarded-For entry for rate limiting and the leftmost public entry for geolocation.

## Weaknesses to fix in GODSEYE

- `/api/cctv/proxy` does not re-check the allowlist or private ranges when it follows a 301/302, and it allow-lists all of `s3-eu-west-1.amazonaws.com` (every S3 bucket in that region). It also sets `rejectUnauthorized:false`. Any bucket there can bounce the proxy to internal addresses. The replica should use `safeFetch`-style per-hop validation plus exact path prefixes such as `/jamcams.tfl.gov.uk/`.
- `stealthFetch` spoofs `X-Forwarded-For`/`X-Real-IP` with fake 'residential' IPs and rotates browser UAs. That is deceptive and fragile; the replica should send an honest identifying UA the way `httpJson` does.
- `/api/conflicts` claims to use GDELT, but it keyword-matches three RSS feeds and pins each event at the zone anchor with a fake ±0.2° offset. Its `region`-slug substring match is over-broad, it imports `stealthFetch` without using it and carries a dead `fetchRSS` helper. It returns `refreshInterval: 300` in seconds while the docs say milliseconds, and the client fetches it only once with no polling. The replica should drive conflict zones from real GDELT, ACLED-like data or geoparsed alerts.
- `/api/gdelt` is misnamed: it is GDACS disaster RSS, and it returns an unsanitised `html` string. `/api/scm-suppliers` then treats those GDACS disasters as 'ARMED CONFLICT / RIOT'.
- `/api/scm-suppliers` fetches `http://127.0.0.1:3000/api/fires` and `/api/gdelt` with a hard-coded host and port, which breaks on any other port or in serverless. The UI never calls it. `/api/markets` also calls itself over HTTP to reach `/api/maritime`; shared in-process functions would be better.
- Several routes have no UI consumer: `/api/frontlines` (DeepState geometry is never drawn, and its fetch comment claims a 30-min cache that is not set), `/api/country-risk` (20 countries, editorial only) and `/api/crypto` (duplicates the markets crypto group and returns a bare array). The replica should either render frontlines and country risk (choropleth) or drop them.
- Region dossier mismatch: the UI renders `country.flag` but the API returns `flag_url`. `timezones` is always `[]`, `subregion` is just the continent and `official_name` equals `name`. Several dossier fields listed in the docs ('…dossier sections') do not exist; there is no news, risk or conflict context for the clicked place.
- Maritime: the websocket connects at module import. Adding a global `[-90,-180],[90,180]` bounding box makes the targeted boxes redundant. Ship typing is crude (only type 35 counts as military). Chokepoint risk comes from a static table plus raw ship counts, and without `AIS_API_KEY` there are no vessels. `/api/infrastructure` calls USGS on every request under `no-store` and overwrites `status` with seismic text instead of adding a field.
- CCTV data quality: many hard-coded YouTube video ids go stale when a stream restarts, which contradicts the project's own resolve approach. The curated Toronto cameras point `feed_url` at a JSON API rather than an image. Turkey and `bulgaria-fwcbg` are empty, and the France Skyline/APRR arrays hold only comments. Greece puts an iframe player URL into `feed_url`. `CctvStreamType` lacks `'mp4'` even though Quebec uses it. The viewer's iframe has no `sandbox` attribute.
- CCTV region routing: `getRegionsForBounds` never emits `'australia'`; the Australian box pushes `'asia'`, so livetraffic.com cameras only arrive with `region=all`. The `'europe'` region calls `fetchNetherlandsCameras` and `'netherlands'` is also a region, so `region=all` returns duplicate `nl-rws-*` cameras (the client dedupes by id). The `radius` param is parsed but ignored. Comments say '48 regions' while there are about 56.
- Live news has only 15 hard-coded channels, 7 embeddable and none HLS. There is no server-side resolution of `/channel/<id>/live` links, so 8 channels only open externally, and the list never refreshes.
- News location fallback is 15 keyword anchors ('united states' pins to DC). The Nominatim budget of 15 per refresh means a cold start mostly shows country anchors.
- `/api/gdelt-events` only reads the latest 15-minute window, with no rolling aggregation. `limit` takes rows in file order, so a burst from one region can crowd out the others.
- Cloudflare centroids are eyeballed, include bogus codes 'ET2' and 'AZO', and are duplicated in `/api/radar`. Outages are country-level only; there are no ASN or region detail pins.
- All caches and rate limiters live in one process's memory, with no shared store (Redis), so multi-instance deployments multiply upstream load. `/api/geo` depends on ipapi.co's free tier of 1000/day.
- The API docs in `apiCatalog` are out of sync with the code. `/api/markets` is documented as returning 'stocks', `/api/arcgis` 'service' as an 'identifier', and `/api/cctv` region example 'london' (the real key is 'uk'). `/api/cctv/proxy` is described as a stream proxy but only handles images.

## Gaps (not verified)

- Nothing was run, so live camera counts per region, actual upstream response shapes (for example DeepState's geometry format) and current reachability are unverified. Counts quoted come from source comments: about 35,000 cameras and a payload of about 7.8 MB.
- There are no conflict-zone, frontline, port, chokepoint, nuclear, CCTV, live-news, Telegram, supplier or country-risk files in `public/data`; all of these are inline TS constants or `*.generated.ts`. The only static data files are the two identical submarine-cable GeoJSONs (717 features, 665,094 bytes each).
- I did not read every data row of `japan.ts` (51 entries), `spain.ts` (53 ids), `france.ts` (40 ids), `poland.ts` (about 70) or the three generated webcam files beyond their headers and counts.
- Outside this slice and not read: the rest of `alert-digest.ts` (brief/thread building), the `LiveAlerts.tsx` UI details, the `MarketsPanel` tab layout, `NavigationView`/`DirectionsBar` UI and `lib/airports.ts` (554 lines). `airports.ts` is likely relevant to the new airport-to-airport flight-path feature and should be checked by the flights slice.
- Unclear whether Singapore LTA images actually pass through `/api/cctv/proxy`. The proxy comment mentions LTA, but `fetchAsiaCameras` sets `feed_url` directly to `cam.image` and the LTA image host is not in the allowlist.
- The production site osirisai.live may differ from this repo snapshot; for example, Cloudflare Radar and AIS layers only work where `CLOUDFLARE_API_TOKEN` and `AIS_API_KEY` are configured.
