# panels-alerts-markets-dossier-graph — probe log

All probes 2026-09-30 20:02–20:09 UTC from the build sandbox with the honest UA
`GODSEYE/0.1.0 (+https://github.com/awne8886/godseye; contact https://github.com/awne8886/godseye/issues)`,
`curl -sS -m 25`, one request each (no retry loops). CORS = `Access-Control-Allow-Origin` returned to
`Origin: http://localhost:3000`. Every upstream is called server-side only (browsers talk to `/api/*`).
Recorded (trimmed) fixtures live in `src/components/panels/intel/__fixtures__/` with the capture date in
each file name.

## Live Alerts — Telegram public previews (`/api/news`)

Public channel previews (`https://t.me/s/<handle>`), server-rendered HTML with no API. Low volume
(10 newest posts per channel, 2-minute feed TTL, `providerBucket('t.me', 2/s)`), shown to people with a
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
| SCMP | `https://www.scmp.com/rss/91/feed` | **301 → http://** | 0.82 s | none | `http.ts` refuses the https→http downgrade; not worked around (SOURCE OFFLINE) |
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
