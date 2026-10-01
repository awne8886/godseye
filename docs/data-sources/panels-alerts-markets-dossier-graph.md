# panels-alerts-markets-dossier-graph — probe log

All probes 2026-09-30 20:02–20:09 UTC from the build sandbox with the honest UA
`GODSEYE/0.1.0 (+https://github.com/awne8886/godseye; contact https://github.com/awne8886/godseye/issues)`,
`curl -sS -m 25`, one request each (no retry loops). CORS = `Access-Control-Allow-Origin` returned to
`Origin: http://localhost:3000`. Every upstream is called server-side only (browsers talk to `/api/*`).
Recorded (trimmed) fixtures live in `src/components/panels/intel/__fixtures__/` with the capture date in
each file name.

## Live Alerts — Telegram public previews (`/api/news`)

Public channel previews (`https://t.me/s/<handle>`), server-rendered HTML with no API. Low volume
(8 newest posts per channel — OSIRIS and contract §6; was 10 before 2026-09-30 round-1 fix — 2-minute feed TTL, `providerBucket('t.me', 2/s)`), shown to people with a
link to the post; never used for training. Posts without their own `<time datetime>` are dropped.

| Handle | Name / declared stance | Bloc | Status | Latency | Size | CORS |
|---|---|---|---|---|---|---|
| Osintdefender | OSINTdefender — Global incident OSINT | independent | 200 | 0.78 s | 112 kB | none |
| WarMonitors | War Monitor — Global conflict monitor | independent | 200 | 0.81 s | 120 kB | none |
| rybar_in_english | Rybar — Russian military OSINT | russian | 200 | 1.11 s | 182 kB | none |
| DDGeopolitics | DD Geopolitics — Multipolar / Russian | russian | 200 | 0.96 s | 134 kB | none |
| intelslava | Intel Slava Z — Russian military OSINT | russian | 200 | 1.17 s | 121 kB | none |
| KyivIndependent_official | Kyiv Independent — Ukrainian newsroom | western | 200 | 1.09 s | 121 kB | none |
| QudsNen | Quds News Network — Palestinian / Gaza & West Bank | regional | 200 | 1.03 s | 118 kB | none |
| AlMayadeenEnglish | Al Mayadeen English — Lebanese / Resistance Axis | regional | 200 | 1.01 s | 93 kB | none |
| PressTV | Press TV — Iranian state broadcaster | regional | 200 | 1.07 s | 119 kB | none |

Sample fields per post: `data-post="OSINTdefender/20365"`, `tgme_widget_message_date > time[datetime]`
(`2026-09-29T17:48:15+00:00`), `js-message_text`, `tgme_widget_message_views` ("396", "4.02K"),
`tgme_widget_message_forwarded_from`, `tgme_widget_message_reply[href]`, photo/video thumbs as
`background-image:url('https://cdn*.telesco.pe/file/…')` (CSP already allows `*.telesco.pe/file/`).
Note `data-post` keeps the channel's own capitalisation (`OSINTdefender`), which differs from the URL handle.

## Live Alerts — wire RSS (`/api/news`)

| Source | URL | Status | Latency | CORS | Notes |
|---|---|---|---|---|---|
| BBC World | `https://feeds.bbci.co.uk/news/world/rss.xml` | 200 | 0.54 s | none | RSS 2.0, `pubDate` RFC 822 |
| The Guardian | `https://www.theguardian.com/world/rss` | 200 | 0.55 s | none | |
| Al Jazeera | `https://www.aljazeera.com/xml/rss/all.xml` | 200 | 0.51 s | none | |
| France 24 | `https://www.france24.com/en/rss` | 200 | 0.74 s | none | |
| DW | `https://rss.dw.com/rdf/rss-en-world` | 200 | 0.97 s | `*` | RDF/RSS 1.0 (`dc:date`) |
| NYT | `https://rss.nytimes.com/services/xml/rss/nyt/World.xml` | 200 | 0.62 s | `*` | |
| Times of Israel | `https://www.timesofisrael.com/feed/` | **403** | 0.48 s | none | Bot wall; shown as SOURCE OFFLINE in the sources list, never hidden |
| TASS | `https://tass.com/rss/v2.xml` | **403** | 1.02 s | none | As above |
| Anadolu | `https://www.aa.com.tr/en/rss/default?cat=world` | **connection reset** | 7.9 s | — | Reported per source as failed |
| SCMP | `https://www.scmp.com/rss/91/feed/` | 200 | 0.48 s | none | Re-probed 2026-10-01 05:38 UTC: 83 kB, 50 items, newest `pubDate` Thu, 01 Oct 2026 05:18:44 +0000. Without the trailing slash SCMP answers 301 → `http://…/feed/`, which `http.ts` refuses (downgrade), so the URL carries the slash |
| CNA | `https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311` | 200 | 0.64 s | `*` | |
| Africanews | `https://www.africanews.com/feed/rss` | 200 | 0.66 s | none | |

Licence: headlines are shown with attribution and link to the publisher; no article bodies are stored.

## Markets / crypto / ticker

| URL | Status | Latency | CORS | Auth | Licence / notes |
|---|---|---|---|---|---|
| `https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=1d&interval=5m` | 200 | 0.36 s | none | none | **Unofficial** endpoint (flagged per quote). `meta.regularMarketTime` (unix s) = observedAt; `regularMarketChangePercent`, `currentTradingPeriod.regular` |
| `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=1mo&interval=1d` | 200 | 0.39 s | none | none | OHLC arrays under `indicators.quote[0]` |
| `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=[…]` | 200 | 1.19 s | `*` | none | `lastPrice`, `priceChangePercent`, `closeTime` (ms) = observedAt |
| `https://api.exchange.coinbase.com/products/BTC-USD/ticker` | 200 | 0.61 s | `*` | none | `price`, `time` (ISO, ns) |
| `https://api.exchange.coinbase.com/products/BTC-USD/stats` | 200 | 0.42 s | `*` | none | `open` for the 24 h change |
| `https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD` | 200 | 0.52 s | origin echoed | none | Pairs `XXBTZUSD`, `XETHZUSD`, `SOLUSD`; `c[0]` last, `o` open; **no timestamp** → observedAt null |
| CoinGecko `simple/price` | not probed keyless | — | — | demo key | Keyless 429s on shared egress (lead probe); used only with `COINGECKO_DEMO_KEY` |
| `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson` | 200 | 0.33 s | `*` | none | Public domain; read in-process through the hazards `earthquakes` feed for `/api/ticker` and SCM |

Exchange sessions are computed (no upstream): 12 exchanges' regular hours in their IANA zones; holidays not modelled.

## Chain brief (`/api/chain/daily`)

| URL | Status | Latency | CORS | Auth | Licence / notes |
|---|---|---|---|---|---|
| `https://api.llama.fi/hacks` | 200 | 0.81 s | `*` | none | 1 290 records; `date` unix s, `amount` USD, `chain[]`, `technique`, `classification`, `bridgeHack` |
| `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=cryptocurrency&resultsPerPage=20` | 200 | 0.79 s | `*` | optional `apiKey` header | Public domain. `published` is **zone-less UTC** ("2018-03-13T15:29:01.597") → normalised with Z. Keyless 5 req / 30 s; pub-date windows ≤ 120 days |
| `https://api.opensanctions.org/search/default?q=Rosneft` | **401** | 0.59 s | none | `OPENSANCTIONS_KEY` | Keyed only; skipped as `not-configured` otherwise. Data CC BY-NC 4.0 (non-commercial) or commercial licence |

## Region Dossier (`/api/region-dossier`)

| URL | Status | Latency | CORS | Auth | Licence / notes |
|---|---|---|---|---|---|
| `https://photon.komoot.io/reverse?lat=50.45&lon=30.52` | 200 | 3.27 s | `*` | none | © OpenStreetMap contributors (ODbL); via `src/lib/geocode.ts` only (Nominatim queue as fallback) |
| `https://query.wikidata.org/sparql` (country by `P297`) | 200 | 0.84 s | — | none | CC0. Current head of state = P35 statement without end time (P582) |
| `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=Kyiv` | 200 | 0.45 s | none | none | CC0 (not used for people search) |
| `https://en.wikipedia.org/api/rest_v1/page/summary/Kyiv` | 200 | 0.55 s | `*` | none | CC BY-SA 4.0; `extract`, `content_urls.desktop.page`, `thumbnail.source`, `wikibase_item` |
| `https://api.open-meteo.com/v1/forecast?latitude=50.45&longitude=30.52&current=…` | **timeout (25 s, twice)** | — | — | none | CC BY 4.0, free tier non-commercial → capability `openmeteo`. `current.time` is zone-less GMT → `normalizeUtc()`. Timeouts from the shared egress are reported as a failed provider (weather null) |

Live layers within 150 km are read in-process from the registered feeds (`flights`, `earthquakes`, `fires`,
`weather`, `news`, `maritime`, `cctv`, `gdacs`); an unregistered or empty feed is `{count: null, state: 'offline'}`.

## Entity Graph (`/api/entity/expand`)

| URL | Status | Latency | CORS | Auth | Notes |
|---|---|---|---|---|---|
| `https://www.wikidata.org/wiki/Special:EntityData/Q95.json` | 200 | 0.64 s | `*` | none | 435 kB; the route uses `wbgetentities` with `props=labels|claims` and follows P749/P355/P127/P112/P169/P17 (company), P27/P108/P102/P39 (person), P35/P6/P36/P463 (country); max 8 per property |
| `https://stat.ripe.net/data/whois/data.json?resource=8.8.8.8` | 200 | 0.77 s | `*` | none | RIPEstat: 8 concurrent, ~1 000/day fair use |
| `https://stat.ripe.net/data/network-info/data.json?resource=8.8.8.8` | 200 | 0.76 s | `*` | none | `{asns: ["15169"], prefix: "8.8.8.0/24"}` |
| `https://stat.ripe.net/data/as-overview/data.json?resource=AS15169` | 200 | 0.75 s | `*` | none | `holder: "GOOGLE - Google LLC"` |
| `https://stat.ripe.net/data/asn-neighbours/data.json?resource=AS15169` | 200 | 0.61 s | `*` | none | 330 neighbours `{asn, type: left/right/uncertain, power}`; top 10 by power are linked |
| OpenSanctions search | 401 keyless | — | — | `OPENSANCTIONS_KEY` | Sanction nodes only with a key |

## AI

| URL | Status | Latency | Notes |
|---|---|---|---|
| `https://api.anthropic.com/v1/messages` (GET, no key) | 405 | 0.05 s | Recorded only. The route POSTs with `x-api-key` + `anthropic-version: 2023-06-01`; the model id comes from `GET /v1/models` (or `ANTHROPIC_MODEL`) |
| `https://generativelanguage.googleapis.com/v1beta/models` | not probed (no key) | — | `x-goog-api-key` header; first model supporting `generateContent` (or `GEMINI_MODEL`) |
| `OLLAMA_URL/api/tags`, `/api/chat` | operator-hosted | — | Never visitor-supplied |

Keyless default: the deterministic ANALYST (keyword digest), labelled as such with `fallbackReason`.

## Re-probe 2026-09-30 22:47 UTC (Phase 3 round-1 fixes)

Same honest UA, `curl -sS -m 25`, one request each (one retry where noted), `Origin: http://localhost:3000`.

| URL | Status | Latency | CORS | Auth | Notes |
|---|---|---|---|---|---|
| `https://query1.finance.yahoo.com/v8/finance/chart/%5EIXIC?interval=1d&range=5d` | **429** | 0.38 s | none | none (unofficial) | body `Too Many Requests` from the shared sandbox egress; the app keeps SOURCE OFFLINE / last-good for that symbol |
| `https://query2.finance.yahoo.com/v8/finance/chart/%5EIXIC?interval=1d&range=5d` | 200 | 0.16 s | none | none (unofficial) | 1.7 kB; `meta.regularMarketTime` 1790802959, `exchangeName: "NIM"`, `timezone: "EDT"`. Not wired (query1 only; no host rotation) |
| `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT` | 200 | 0.79 s | `*` | none | 556 B; `lastPrice`, `priceChangePercent`, `closeTime` (ms) |
| `https://t.me/s/Osintdefender` | reset, then 200 | 11.2 s (reset) / 0.79 s | none | none | 112 kB, **20 posts** on the page; the feed keeps the newest **8** (`POSTS_PER_CHANNEL`). Saved as fixture `tg-Osintdefender-full.2026-09-30.html` |
| `https://en.wikipedia.org/api/rest_v1/page/summary/Singapore` | 200 | 0.30 s | `*` | none | 2.7 kB; `title`, `extract`, `content_urls.desktop.page`, `thumbnail.source` (CC BY-SA 4.0) |
| `https://query.wikidata.org/sparql?query=SELECT ?c WHERE {?c wdt:P297 "SG"}&format=json` | 200 | 0.20 s | `*` | none | `results.bindings[0].c.value` = `http://www.wikidata.org/entity/Q334` (CC0) |
| `https://www.gov.uk/bank-holidays.json` | 200 | 0.33 s | `*` | none | OGL v3; `england-and-wales.events[].date` 2026 → 01-01, 04-03, 04-06, 05-04, 05-25, 08-31, 12-25, 12-28 (LSE closures, bundled in `sessions.ts`, not fetched at runtime) |

Holiday calendars bundled in `src/components/panels/intel/server/sessions.ts` (read once, 2026 only):
NYSE/Nasdaq from `https://www.nyse.com/markets/hours-calendars` (200, 0.35 s; 2026 column: Jan 1, Jan 19,
Feb 16, Apr 3, May 25, Jun 19, Jul 3, Sep 7, Nov 26, Dec 25); SSE from the Shanghai Futures Exchange
circular of 2025-12-17 "Trading Schedule during National Holidays for Year 2026" (mainland calendar:
Jan 1–3, Feb 15–23, Apr 4–6, May 1–5, Jun 19–21, Sep 25–27, Oct 1–7); HKEX 2026 securities-market
full-day closures (14 dates, as published by HKEX and reported by globalexchanges.com). Every other
exchange reports `holidaysModelled: false` and the panel marks it with `*`.

Region Dossier live layers read other owners' feeds in-process (no HTTP): `cctv:<region>` (the regions
whose box, grown by 150 km, holds the point), `maritime` (ports + chokepoints REFERENCE; vessels only
with `AIS_API_KEY`), `cables` (TeleGeography REFERENCE, CC BY-NC-SA, only with `nc_sources`).

## Probes 2026-10-01 (Phase 3 round-2b: KEV date-only rows, background NVD scoring)

Honest UA `GODSEYE/0.1.0 (+repo; contact …/issues)`, no key.

| URL | Status | Latency | CORS | Auth | Notes |
|---|---|---|---|---|---|
| `https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json` | 200 | 0.56 s | none | none (public domain, US Gov) | 1.76 MB; `catalogVersion` 2026.09.30, `dateReleased` 2026-09-30T16:59:23.0688Z, `count` 1730; `vulnerabilities[].dateAdded` is a **date only** (`2026-09-30`), so Intel Feed rows render the date, never an age or 00:00Z. ETag + Last-Modified |
| `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2021-44228` | 200 | 0.46 s | `*` | none (keyless 5 req / 30 s; `NVD_API_KEY` in the `apiKey` header → 50 / 30 s) | 87 kB; `metrics` keys `cvssMetricV31` (baseScore 10), `cvssMetricV2`, `ssvcV203`. Lookups now run in a background batch through the shared `nvdBucket()`; `/api/cyber-threats` answers with KEV at once and `providers.nvd.error: "pending"` while the batch runs |

## Probes 2026-10-01 05:38–05:40 UTC (Phase 3 round 4: degraded inputs, dated population, SCMP)

Honest UA `GODSEYE/0.1.0 (+https://github.com/awne8886/godseye; contact …/issues)`, no key, one request each,
`Origin: https://example.org` for the CORS column.

| URL | Status | Latency | CORS | Auth | Licence / notes |
|---|---|---|---|---|---|
| `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson` | 200 | 0.30 s | `*` | none | Public domain. `/api/scm-suppliers` now checks sites only on fresh USGS data; while the quake feed is stale/offline the last-good checks are served STALE → OFFLINE with `hazardsAsOf` and `providers.usgs.ok:false` |
| `https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=1d&interval=15m` | 200 | 0.28 s | none | none (unofficial endpoint) | 3.5 kB. When it fails, the last-good quotes stay on the board with `lastGoodAt`, `providers.yahoo.age_s` keeps growing and the chip reads SOURCE OFFLINE + time |
| `https://api.worldbank.org/v2/country/UA/indicator/SP.POP.TOTL?format=json&mrnev=1` | 200 | 0.34 s | `*` | none | CC BY 4.0 (World Bank WDI). `[meta, [{date:"2025", value:38980376, countryiso3code:"UKR"}]]`, `lastupdated` 2026-07-13, `cache-control: max-age=82398`. Dossier population source (shown with its year); bucket `worldbank` 2/s |
| `https://api.worldbank.org/v2/country/TW/indicator/SP.POP.TOTL?format=json&mrnev=1` | 200 | 0.23 s | `*` | none | `[{"page":0,…,"total":0}, null]`: economy not covered → no figure (provider ok, count 0); the dossier keeps Wikidata's figure with its own year |
| `https://query.wikidata.org/sparql` (country query, best-rank `p:P1082/ps:P1082` + `pq:P585 ?popDate`) | 200 | 0.33 s | `*` | none | CC0. UA → `pop 41167335`, `popDate 2022-01-01T00:00:00Z`: the old figure is a 2022 value, now shown with that year when the World Bank has no figure |
| `https://www.scmp.com/rss/91/feed/` | 200 | 0.48 s | none | none | 50 items; the slash-less URL → 301 to `http://` (0.55 s) |
