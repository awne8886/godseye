# OSIRIS cyber layers: URLhaus malware over SSE and Feodo C2
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
**Question answered:** The cyber layer upstreams and data shapes are missing: the Live Malware pipeline over URLhaus + ip-api over SSE, and Botnet C2 from Feodo.

## Summary

The cyber layer is built from two separate pipelines, and the verified facts in the task all check out against the code.

(1) Live Malware (layer key `malware`, data key `malware_threats`) is a push pipeline.
- A single store is pinned on `globalThis.osirisMalwareStore`. The first request starts it lazily.
- Every 60 s it makes a conditional GET for the URLhaus `csv_recent` dump, replaying the ETag / Last-Modified validators and asking for gzip. An unchanged dump comes back as a 304 with no body.
- Only rows with status `online` are kept. Only URLs whose host is an IPv4 literal are used; domain hosts are dropped.
- Rows are grouped into one node per IP. `url_count` is the number of URLs on that host.
- Each IP is geolocated over plain HTTP with a batch POST to ip-api (100 addresses per batch, 4 s between batches, at most 8 batches per poll). Results are cached for 24 h, and failed lookups for 10 min. On a cold start the busiest hosts are looked up first.
- Updates go out over SSE on `/api/malware/stream` as `data: <json>\n\n` frames. There are four event types: `snapshot` (sent on connect, and again as a catch-up if needed), `detections` (with a `fresh` flag), `status` (after every poll, carrying the hosts that dropped out in `retired[]`) and `heartbeat` (every 15 s).
- The client keys nodes by IP. A node that arrives after the first `status` event, with `fresh:true`, gets a `detected_at` stamp. That drives a pulsing ring for 60 s, redrawn every 200 ms.
- Dots are crimson `#D32F2F` and sized by the square root of `url_count`. Labels show the `malware` field from zoom 5 up. Clicking a dot opens a popup with a link to the URLhaus report.

(2) Botnet C2 (layer key `cyber_attacks`) is a plain request/response route.
- `/api/cyber-attacks` fetches the Feodo `ipblocklist.json` and keeps the result in memory for 300 s. It also sends `s-maxage=300, stale-while-revalidate=600`.
- It returns one indicator per C2, de-duplicated on `ip:port`. No attack arcs are invented.
- Each C2 is placed at the centroid of its hosting country from a hand-made table, so `location_precision` is always `'country'`. If the country is unknown, lat and lng are null and the client leaves the dot off the map.
- The client fetches when the layer is switched on, then again every 5 min.
- Dots are orange `#FF6D00` when online and grey `#555555` otherwise. Labels show the family from zoom 3 up.
- The popup reads "BOTNET C2 SERVER" and states that the entry is a blocklist listing, not an observed attack.

**What the task summary left out:**
- `detections` events also carry `cursor` and `total`.
- The heartbeat's `at` is an ISO string, while `status.lastPollAt` is epoch milliseconds.
- There is also a snapshot REST route, `/api/malware`, returning `{threats,total,cursor,last_poll,stream,timestamp,source,warning?}`.
- The CSV's column 4, `last_online`, is ignored by the parser.
- The Feodo route sends User-Agent `OSIRIS/4.3`, while the malware feed sends `OSIRIS-OSINT/1.0 (+https://github.com/simplifaisoul/osiris)`.
- The code's own comment says the Feodo feed returned only 5 rows, 4 of them offline, when it was checked, so expect the C2 layer to be nearly empty.

**Bugs worth avoiding in the replica:**
- About once a day, every host already on the map gets a false "new arrival" ring when its 24 h geo cache expires.
- A decorative "mesh" joins malware nodes in array order. Its lines have no colour set, so they draw black.
- C2 labels are `#333` on a dark map, which is nearly invisible.
- C2 dots in the same country all sit on the same point, stacked on top of each other.

## Findings

### 0. Malware upstream + poll cadence + conditional GET

RECENT_CSV = 'https://urlhaus.abuse.ch/downloads/csv_recent/' (malware-live.ts:84). POLL_MS = 60_000 (:57); the header comment says the dump is regenerated upstream about every 5 min. The loop starts lazily: startMalwareFeed() (:456-468) sets s.primed = poll(), then setInterval(poll, POLL_MS) with .unref(). Nothing runs on import. poll() (:366-453) is guarded by s.polling so polls never overlap. Request (:372-376): httpConditional(RECENT_CSV, {...s.validators, timeoutMs: 30_000, headers: {Accept:'text/csv','Accept-Encoding':'gzip'}}). httpConditional (httpJson.ts:119-136) sends If-None-Match / If-Modified-Since. A 304 gives {changed:false, body:null}. It uses Node https.get, not fetch, because the bundled undici fetch times out on some upstreams (httpJson.ts:6-12). The response is decoded by its Content-Encoding header: gzip, deflate or br (httpJson.ts:67-71). Default User-Agent: OSIRIS_UA = 'OSIRIS-OSINT/1.0 (+https://github.com/simplifaisoul/osiris)' (httpJson.ts:19). Status >= 400 rejects with an 'HTTP <code>' error. Only rows with r.status === 'online' are kept (:387). The comments give sizes: about 1,550 URLs across about 470 IPv4 hosts; 2.9 MB uncompressed, about 400 KB gzipped; json_online is 8.6 MB and deliberately not used (:27-33). MALWARE_SOURCE = 'abuse.ch URLhaus (live) + ip-api geolocation' (:88).

Files: `src/lib/malware-live.ts:56-88`, `src/lib/malware-live.ts:366-453`, `src/lib/malware-live.ts:456-468`, `src/lib/httpJson.ts:19`, `src/lib/httpJson.ts:40-83`, `src/lib/httpJson.ts:119-136`

### 1. URLhaus CSV format + parser

The dump starts with a '#' comment banner. Column header: '# id,dateadded,url,url_status,last_online,threat,tags,urlhaus_link,reporter' (malware-intel.test.ts:22). Every field is double-quoted. Tags are comma-separated inside one quoted field, e.g. "32-bit,elf,mips,Mozi". Example row: "3910216","2026-08-31 02:15:25","http://103.179.240.227:39430/i","online","2026-08-31 02:15:25","malware_download","32-bit,elf,mips,Mozi","https://urlhaus.abuse.ch/url/3910216/","geenensp". parseUrlhausCsv (malware-intel.ts:144-170): skips blank lines and '#' lines, skips rows with fewer than 9 columns, and skips rows whose id is not numeric (this drops the header). It maps cols[0]→id (Number), [1]→dateadded, [2]→url, [3]→status, [5]→threat, [6]→tags (split on ',', trimmed, empties dropped), [7]→link, [8]→reporter. cols[4] (last_online) is ignored. splitCsvLine (:172-194) is a real quote-aware state machine that treats "" as an escaped quote. UrlhausRecord = {id:number, dateadded, url, status, threat, tags:string[], link, reporter} (:35-44).

Files: `src/lib/malware-intel.ts:35-44`, `src/lib/malware-intel.ts:144-194`, `src/lib/malware-intel.test.ts:17-25`

### 2. Host extraction, grouping, family label

hostOf(url) (malware-intel.ts:209-234): matches /^(https?):\/\/([^/?#]+)/i, strips userinfo after the last '@', splits the port at the last ':', and requires an IPv4 literal (IPV4 regex at :196, each octet <= 255). Domains return null and are dropped. The port comes from the authority; the default is 443 for https and 80 otherwise, and any port outside 1..65535 falls back to that default. groupByHost (:266-285) builds Map<ip, HostGroup{ip, port, newest, oldest, count}>; the newest id supplies the port, label and link. familyOf(tags, threat) (:244-253) returns the first tag that is not in NON_FAMILY_TAGS (:109-115, a lowercase set: '32-bit','64-bit','arm','mips','mipsel','x86','x86-64','sparc','ppc','m68k','sh4','arc','elf','exe','dll','zip','rar','7z','doc','docx','xls','xlsx','pdf','rtf','lnk','js','vbs','ps1','sh','bat','jar','apk','msi','iso','img','html','htm','php','py','opendir','censys','ua-wget','ua-curl','shodan','unknown','encrypted','obfuscated','malware','payload','binary','none','ascii','iot','honeypot') and does not match TAG_ARTEFACT (:126-130: /^\d+$/, /^\d{1,3}(-\d{1,5}){3,4}$/ for dash-written IPs, /^[0-9a-f]{6,}$/i for hashes). Upstream capitalisation is kept (e.g. 'Mozi', 'mirai'). If no tag qualifies it returns threat.replace(/_/g,' ') (e.g. 'malware download'), else 'malware'. A test notes that 119 of 473 live hosts carry the literal tag 'None' (malware-intel.test.ts:151-154).

Files: `src/lib/malware-intel.ts:101-130`, `src/lib/malware-intel.ts:196-285`, `src/lib/malware-intel.test.ts:130-160`

### 3. Detection record (the malware dot's data shape)

interface Detection (malware-intel.ts:47-69) has: id, lat, lng, ip, port, malware, status, first_seen, last_seen, country, city, asn (number|null), as_name, threat_type, url_count, urlhaus_id, reference, reporter, tags (string[]). toDetection(host, geo) (:288-313) fills it as follows: id `urlhaus-${ip}`; lat/lng from geo; malware = familyOf(newest.tags, newest.threat); status = newest.status || 'online'; first_seen = oldest.dateadded; last_seen = newest.dateadded (format 'YYYY-MM-DD HH:MM:SS'); country = geo.country || 'XX'; city = geo.city || ''; threat_type = newest.threat || 'malware_download'; url_count = host.count; urlhaus_id = newest.id; reference = newest.link (e.g. https://urlhaus.abuse.ch/url/<id>/); reporter = newest.reporter; tags = newest.tags. It returns null (the host is dropped) if there is no geo or lat/lng are not finite. LiveDetection = Detection & {detected_at?: number}, stamped in the browser (:79). GeoResult = {ip, lat, lng, country, city, asn:number|null, as_name} (:82-90). HostGroup = {ip, port, newest, oldest, count} (:93-99). detectionChanged compares only urlhaus_id, url_count and first_seen (:324-328). newSince(records, cursor) returns rows with id > cursor, sorted ascending (:371-373). maxId(records, fallback) (:376-380). The cursor is the highest URLhaus id seen, because ids only ever increase.

Files: `src/lib/malware-intel.ts:47-99`, `src/lib/malware-intel.ts:288-328`, `src/lib/malware-intel.ts:365-380`

### 4. ip-api batch geolocation

GEO_ENDPOINT = 'http://ip-api.com/batch?fields=status,countryCode,city,lat,lon,as,query' (malware-live.ts:86). The free tier is plain HTTP only. Requests are POSTed with Node's http.request, not fetch; the comment says fetch dropped about 1 in 5 batches (:164-211). Body: a JSON array of IP strings. Headers: Content-Type application/json, User-Agent OSIRIS_UA. Timeout 15_000 ms. Parsing (:223-249): a row is used only if status === 'success' and lat/lon are finite. `as` looks like 'AS15169 Google LLC' and is split by /^AS(\d+)\s*(.*)$/ into asn (a Number) and as_name. countryCode becomes country and city becomes city. Constants: GEO_BATCH_SIZE 100 (:70), GEO_BATCH_GAP_MS 4_000 (:71), GEO_BATCHES_PER_POLL 8 (:72), so at most 800 IPs per poll. The comment gives the limit as 15 batch requests per minute (:66). GEO_TTL_MS 24h (:60), GEO_RETRY_MS 10 min for misses (:63), MAX_GEO_ENTRIES 5_000 (:82). The cache entry is {geo: GeoResult|null, at}. Misses are stored as null so they are not asked about every poll (:311). evictGeo (:252-261) never evicts an IP that currently has a detection and otherwise deletes in Map order. needsGeo (:264-277) returns IPs with no cache entry or an expired one. fillGeo (:286-330): batches = min(ceil(pending/100), 8), with a 4 s sleep between batches. A failed batch sets lastError = 'geolocation failed: <msg>' and leaves those IPs uncached so they are retried. After each batch it emits {type:'detections', fresh:true, ...}, so the map fills progressively. On a cold start pending hosts are sorted by count descending, busiest first (:420). A poll that brought new rows looks up only the new hosts; a cold or quiet poll works through the whole backlog (:428).

Files: `src/lib/malware-live.ts:59-86`, `src/lib/malware-live.ts:173-249`, `src/lib/malware-live.ts:252-330`, `src/lib/malware-live.ts:418-430`

### 5. Poll diff / retire / update semantics

When the dump has changed (malware-live.ts:386-416): rows = only online rows; fresh = newSince(rows, cursor); s.hosts = groupByHost(rows); cursor = maxId. Any IP in s.detections that is no longer in s.hosts is deleted and pushed to retired[]. refreshKnown rebuilds the detections of hosts that already have geo; those that changed are emitted as {type:'detections', fresh:false}. It logs '[OSIRIS] malware: dump changed — N new URL(s), U host(s) updated, R retired, H online'. Every poll ends with emit {type:'status', total, cursor, lastPollAt, error, retired}. On failure (:440-449) the last good data is kept, lastError is set, and it logs '[OSIRIS] malware poll failed:'. If the store is still empty, primed is reset to null so the next request retries immediately. malwareSnapshot() (:471-487) returns detections sorted by urlhaus_id descending, plus total, cursor, lastPollAt and error.

Files: `src/lib/malware-live.ts:366-453`, `src/lib/malware-live.ts:471-494`

### 6. SSE event types (exact)

LiveEvent (malware-live.ts:90-105) has three variants: {type:'snapshot', detections, cursor, total}; {type:'detections', detections, fresh:boolean, cursor, total}; {type:'status', total, cursor, lastPollAt:number (epoch ms), error:string|null, retired:string[] (IPs)}. The stream route adds {type:'heartbeat', at: new Date().toISOString()} (an ISO string, not a number) every 15_000 ms (stream/route.ts:30,45). Framing: `data: ${JSON.stringify(event)}\n\n`. It uses no `event:` or `id:` lines, so the client uses onmessage (stream/route.ts:33). On connect the route sends a snapshot from the current store straight away, even if empty, then awaits startMalwareFeed(). If fewer detections were delivered than filled.total, it sends a second, catch-up snapshot (:57-76). Response headers: Content-Type text/event-stream; Cache-Control 'no-cache, no-store, must-revalidate'; Connection keep-alive; X-Accel-Buffering 'no' for nginx (:80-89). The route is `dynamic = 'force-dynamic'`. It cleans up on request.signal abort: clears the heartbeat, unsubscribes and closes the controller (:47-55).

Files: `src/lib/malware-live.ts:90-105`, `src/app/api/malware/stream/route.ts:21-90`

### 7. /api/malware snapshot REST route

GET awaits startMalwareFeed() and returns {threats: detections, total, cursor, last_poll: ISO string or null, stream: '/api/malware/stream', timestamp, source: MALWARE_SOURCE, warning?: lastError}, with Cache-Control 'no-store'. On error it returns 500 {threats:[], total:0, error:'Malware feed unavailable'}. The comment says ThreatFox was dropped because its API now needs an auth key (malware/route.ts:14-17).

Files: `src/app/api/malware/route.ts:19-43`

### 8. Client SSE consumer (page.tsx)

The EventSource('/api/malware/stream') is opened only while activeLayers.malware is on and closed when it is switched off (page.tsx:907-965). byIp = Map<ip, LiveDetection>; `filled` starts false. A snapshot clears byIp and refills it. For detections, beacon = filled && event.fresh. When beacon is true it sets detected_at = Date.now(); otherwise it keeps the previous detected_at (:935-938). A status event sets filled = true and deletes the retired IPs. commit() writes dataRef.current.malware_threats = [...byIp.values()] and bumps setDataVersion. onopen and each message call setBackendStatus('connected'); onerror reports 'error' only when readyState === CLOSED. Malformed frames are caught and ignored. The layer is off by default (page.tsx:365).

Files: `src/app/page.tsx:822`, `src/app/page.tsx:901-965`, `src/app/page.tsx:365-366`

### 9. Malware map visuals (MapLibre)

Sources 'malware-nodes', 'malware-new' and 'network-mesh' are plain empty geojson sources with no clustering (OsirisMap.tsx:410-411). Layers:
- 'malware-glow' (:494-497): circle, radius by zoom 1→6, 5→12, 10→20; colour #D32F2F; opacity 0.06; blur 0.5.
- 'malware-dots' (:501-515): radius is a zoom interpolate with nested sqrt(max(url_count,1)) stops. Zoom 1: 1→1.6, 3→2.4, 9→4. Zoom 5: 1→3.2, 3→4.8, 9→8. Zoom 10: 1→4.8, 3→7.2, 9→12. Colour #D32F2F, opacity 0.9, stroke 1 #000000 at 0.8.
- 'malware-new-ring' (:518-524): transparent fill, stroke #FF1744 width 2, stroke-opacity interpolated on age 0→0.9, 1→0.
- 'malware-label' (:525-528): symbol, minzoom 5, text-field ['get','malware'], size 8, font ['JetBrains Mono Bold','Open Sans Bold'], offset [0,1.5], max-width 10, colour #D32F2F, halo #111 width 1.5, opacity 0.85.
Feature properties (:2040-2054): ip, malware, status, threat_type, country, city, port, asn, as_name, url_count (default 1), first_seen, last_seen, reference, reporter, detected_at (default 0). Beacon loop (:2060-2097): every 200 ms arrivalBeacons(data, now) with BEACON_WINDOW_MS 60_000 (malware-intel.ts:331-362); age = elapsed/window, and future or missing timestamps are skipped. It only pushes an empty collection on the tick after it was last drawing. It sets 'malware-new-ring' circle-radius to ['interpolate',['linear'],['get','age'], 0, 6+Math.sin(now/200)*2, 1, 26], a single pulse shared by all rings. Visibility is set with setVis(['malware-glow','malware-dots','malware-label','malware-new-ring'], activeLayers.malware) (:2384).

Files: `src/components/OsirisMap.tsx:410-411`, `src/components/OsirisMap.tsx:493-528`, `src/components/OsirisMap.tsx:2037-2097`, `src/components/OsirisMap.tsx:2384`, `src/lib/malware-intel.ts:330-362`

### 10. Malware popup (click 'malware-dots')

OsirisMap.tsx:1227-1258. Popup: new maplibregl.Popup({closeButton:true, maxWidth:'420px', offset:14}) (:956-959). pStyle = background rgba(12,14,26,0.95); backdrop-filter blur(16px); border-radius 10px; padding 16px; font 'JetBrains Mono' (:960). Border 1px rgba(255,23,68,0.4), inset glow, min-width 250px.
- Header: `[ ${threat_type.replace(/_/g,' ').toUpperCase()} ]` in #FF1744, 12px, weight 700, letter-spacing 0.1em, with a text-shadow. On the right, the place as 'city, country' or 'UNKNOWN' in #5C5A54, 9px.
- Title: p.malware || 'Unclassified payload' in #E8E6E0, 11px bold. Subline: `AS${asn} ${as_name}` in #5C5A54.
- A 2x2 grid on rgba(0,0,0,0.3) with labels HOST (ip:port, #00E5FF monospace), STATUS (#39FF14 if online, else #FF1744), LIVE URLS (url_count), LAST REPORT (date part of last_seen).
- Footer: 'First seen <date> · reported by <reporter>'.
- Button 'URLHAUS REPORT ↗' links to the reference URL.
All values are HTML-escaped with htmlEsc (:964). Links pass through urlSafe, which returns '#' unless the URL starts with http(s) (:966). The cursor becomes a pointer on hover (:1457-1460).

Files: `src/components/OsirisMap.tsx:955-966`, `src/components/OsirisMap.tsx:1226-1258`, `src/components/OsirisMap.tsx:1457-1460`

### 11. Botnet C2 upstream + route

GET /api/cyber-attacks (cyber-attacks/route.ts). Upstream: fetch('https://feodotracker.abuse.ch/downloads/ipblocklist.json', {signal: AbortSignal.timeout(10000), cache:'no-store', headers:{'User-Agent':'OSIRIS/4.3', Accept:'application/json'}}) (:45-49). It uses native fetch, not httpJson. Cache: a module-level `cached` with CACHE_TTL = 300_000 (:32-34). CACHE_HEADERS = {'Cache-Control':'public, s-maxage=300, stale-while-revalidate=600'} (:36). Payload C2Payload = {indicators, total, online (count where status==='online'), fetched_at (ISO time of the poll, not an observation time), source: FEODO_SOURCE 'abuse.ch Feodo Tracker', source_url: FEODO_SOURCE_URL 'https://feodotracker.abuse.ch/browse/'} (:23-30, :57-64; c2-indicators.ts:66-67). A non-OK upstream returns 200 {indicators:[], total:0, online:0, error:'Feodo unavailable'} (:51-53). An exception returns 500 {..., error:'Feed unavailable'} (:70-73). Failures are not cached, and a stale cache is not served on error. The route is `dynamic = 'force-dynamic'`.

Files: `src/app/api/cyber-attacks/route.ts:23-74`, `src/lib/c2-indicators.ts:66-67`

### 12. Feodo record → C2Indicator mapping

FeodoRecord (c2-indicators.ts:25-40) is the input row: ip_address, port or dst_port (number or string), status, hostname, as_number, as_name, as_country or country, first_seen, last_online, malware. Example live row: {ip_address:'198.51.100.7', port:8080, status:'online', hostname:'c2.example.invalid', as_number:64500, as_name:'EXAMPLE-AS', as_country:'de', first_seen:'2026-01-04 11:02:17', last_online:'2026-09-14', malware:'QakBot'} (c2-indicators.test.ts:10-21). C2Indicator (:43-64) = {id, ip, port:number|null, malware:string|null, status, hostname, country (upper-cased), as_number, as_name, first_seen, last_online, lng, lat, location_precision:'country'|null}. toIndicator (:82-106): text() trims strings and turns empty into null. The row is dropped if there is no ip. port = parseInt(port ?? dst_port). id = `${ip}:${port}`, or just ip if there is no port. country = as_country ?? country. status defaults to 'unknown'. as_number is kept only if it is a number. Coordinates come from centroidFor(country), which returns [lng, lat] from COUNTRY_CENTROIDS (countryCentroids.ts:12-42; e.g. US [-97,38], DE [10,51], RU [100,60], CN [105,35], NL [5.5,52.5], GB [-2,54]). There is no jitter. An unknown country gives lat, lng and location_precision all null. parseFeodoBlocklist (:114-124) returns [] for a non-array, skips non-objects, and de-duplicates by id keeping the first occurrence in source order.

Files: `src/lib/c2-indicators.ts:25-124`, `src/lib/countryCentroids.ts:12-42`, `src/lib/c2-indicators.test.ts:4-21`

### 13. C2 client fetch + map visuals + popup

Client (page.tsx): on toggle it calls fetchEndpoint('/api/cyber-attacks', d => ({cyber_attacks: d.indicators})), guarded by layerFetchedRef (:825-828), and re-fetches every 300000 ms while the layer is on (:891-897). Features are only built for indicators with numeric lng and lat. Properties: id, ip, port, malware, status, hostname, country, as_number, as_name, first_seen, last_online (OsirisMap.tsx:2127-2151). Layer 'cyber-heads' (:554-559): circle, radius by zoom 1→2.5, 5→4, 10→6; colour ['case', status=='online', '#FF6D00', '#555555']; opacity 0.95; stroke 1.5 #333 at 0.9. Layer 'cyber-labels' (:560-563): minzoom 3, text ['get','malware'], size 9, font JetBrains Mono Bold / Open Sans Bold, offset [0,1.5], colour #333333, halo #000 width 1.5, opacity 0.85. Popup (:1428-1454): accent c = online ? '#FF6D00' : '#8A8880'; title 'BOTNET C2 SERVER'; a status pill; family or 'Family not reported'; grid rows C2 ADDRESS (#00E5FF mono), PORT (#FFD600 mono), HOSTED IN, AS ('AS<n>'), FIRST SEEN, LAST ONLINE, with 'Not reported' or '—' fallbacks. Then the hostname in mono, then the disclaimer 'Blocklist entry, not an observed attack. Marker sits at the hosting country's centroid, not the host's location.', then 'SOURCE: ABUSE.CH FEODO TRACKER ↗' linking to source_url or https://feodotracker.abuse.ch/browse/. Visibility: setVis(['cyber-heads','cyber-labels'], cyber_attacks) (:2386).

Files: `src/app/page.tsx:824-828`, `src/app/page.tsx:891-897`, `src/components/OsirisMap.tsx:549-563`, `src/components/OsirisMap.tsx:1423-1454`, `src/components/OsirisMap.tsx:2122-2151`

### 14. Layer panel labels

The group is label 'NETWORK', fullLabel 'NETWORK INTEL', icon Network (lucide). Layers: {key:'malware', label:'Live Malware', dataKey:'malware_threats'} and {key:'cyber_attacks', label:'Botnet C2 Servers', dataKey:'cyber_attacks'}. Both are off by default (page.tsx:365-366). API docs catalog summaries: /api/cyber-attacks 'Listed botnet C2 servers from abuse.ch Feodo Tracker — blocklist entries, not observed attacks.'; /api/malware 'Live malware hosts from abuse.ch URLhaus, geolocated per address.'; /api/malware/stream 'Server-sent events for the malware layer: a snapshot on connect, then new detections as URLhaus reports them.'

Files: `src/components/LayerPanel.tsx:124-132`, `src/app/docs/apiCatalog.ts:347-365`

### 15. Network mesh decoration (malware)

'network-mesh' line layers: 'network-mesh-atmo' (width by zoom 1→2, 5→4, 10→8; opacity 0.08; blur 4), 'network-mesh-glow' (1→1, 5→2, 10→4; opacity 0.2; blur 1.5) and 'network-mesh-core' (1→0.2, 5→0.5, 10→1.5; opacity 0.4). None of them sets line-color; the blank lines at OsirisMap.tsx:532,538,544 suggest it was removed, so MapLibre's default black applies. The mesh is generated by linking each malware node i to nodes (i+1) and (i+2) modulo n, in array order, with properties {threat_type:'malware'} (:2100-2120). It is visible when activeLayers.internet_outages || activeLayers.malware (:2385).

Files: `src/components/OsirisMap.tsx:530-547`, `src/components/OsirisMap.tsx:2099-2120`, `src/components/OsirisMap.tsx:2385`

## Worth copying

- One shared server-side poll loop pinned on globalThis, started lazily by the first request and unref()'d, then fanned out to all SSE subscribers. With 100 clients there is still only 1 upstream request per minute.
- Conditional GET that replays ETag / If-Modified-Since and asks for gzip. An unchanged poll costs a header-only 304, which makes a 60 s cadence against a 5-minute dump nearly free.
- Use the upstream's increasing id as the only sync cursor (newSince / maxId): no timestamp comparison and no clock skew.
- Geolocate in batches with a per-IP cache: 24 h for hits, 10 min for misses, and misses are cached as null. Cap the cache at 5000 entries and never evict IPs that are currently shown. Look up the busiest hosts first on a cold start.
- Emit after each geo batch so the map fills in progressively instead of snapping in all at once.
- Separate `fresh` arrivals from `fresh:false` updates of hosts already shown, send `retired[]` on every status event so clients prune, and send a status event after quiet polls too so a client can tell a quiet feed from a stalled one.
- The SSE route sends a snapshot immediately on connect, then a catch-up snapshot after priming if needed. It uses a 15 s heartbeat, the X-Accel-Buffering: no header for nginx, and cleans up on request.signal abort.
- Client keys nodes by IP. It beacons arrivals only after the first status event, so the initial fill never pulses. One 60 s expanding and fading ring (#FF1744) is driven by a 200 ms tick that shares one sin pulse, and the tick avoids redundant empty setData calls.
- Size dots by sqrt(url_count) inside zoom stops, because a zoom expression must be the top-level interpolate input.
- A quote-aware CSV parser. A family-name picker that skips format tags, dash-written IPs and hashes. Only IPv4-literal hosts are placed on the map, never guessed.
- Honesty in the C2 layer: no fabricated arcs or verbs, de-duplicate by ip:port, flag location_precision:'country', and show a popup disclaimer. Keep fetched_at separate from the observation timestamps.
- Keep failing polls from emptying the layer: keep the last good data and surface lastError.

## Weaknesses to fix in GODSEYE

- False arrival beacons once a day. When a host's 24 h GEO_TTL expires, needsGeo returns it again. On a quiet poll the target is the whole backlog, so fillGeo re-looks it up and emits {type:'detections', fresh:true} for hosts already on the map (malware-live.ts:264-277, 313-326, 428). The client then stamps detected_at = now because filled && fresh (page.tsx:935-937). Every host that was geolocated in the same cold-start fill therefore beacons as 'new' at about the same time, 24 h later. Fix: emit fresh:true only for IPs not already in s.detections.
- The malware 'network mesh' links nodes i→i+1 and i→i+2 in arbitrary array order. That invents relationships and contradicts the layer's own 'honest' approach. Its line layers have no line-color, so they render in the default black and are invisible on a dark map (OsirisMap.tsx:530-547, 2100-2120). It is also tied to a stale `internet_outages` key (:2385).
- The C2 label colour #333333 with halo #000 is nearly unreadable on a dark basemap (OsirisMap.tsx:563).
- All C2s in the same country sit on the exact same centroid with no jitter or clustering, so clicking only shows the first feature. Many malware hosts also share city-level ip-api coordinates and overlap. The replica should cluster or spider-spread overlapping points and show a count.
- The Feodo route uses native fetch, even though the codebase documents undici failures elsewhere, and sends a different User-Agent, 'OSIRIS/4.3'. It does not serve the stale cache on upstream failure. A non-OK response returns HTTP 200 with an error field and no source or fetched_at fields (cyber-attacks/route.ts:45-53, 70-73).
- The Feodo feed is nearly empty: the comment reports 5 rows, 4 offline (malware-intel.ts:11-15), so the Botnet C2 layer mostly shows nothing. ThreatFox now needs an auth key (malware/route.ts:14-17). The replica should state this or add another source (e.g. ThreatFox with a key, if one is configured).
- The stream catch-up heuristic counts delivered detections, including repeated updates of the same host, and compares that with the store size. A connection that got many fresh:false updates might skip a needed catch-up snapshot (stream/route.ts:34-35, 73-76).
- evictGeo's 'oldest-first' is really first-inserted order, because Map.set on an existing key keeps its position (malware-live.ts:252-261).
- In the malware popup, the `ref ? ... : ''` test is always true because urlSafe returns '#' rather than an empty string. The subline builds `AS${p.asn}` even when asn is null, which could produce 'ASnull ...' (OsirisMap.tsx:1234, 1238, 1255). Whether MapLibre drops null properties here is unverified.
- Only rows with status 'online' are kept, so the STATUS field in the popup is always ONLINE, and the offline colour (#FF1744) is dead code.
- Only about half of URLhaus hosts (IPv4 literals) are shown. Domain-hosted URLs are dropped entirely.

## Gaps (not verified)

- I did not run the app or fetch the live upstreams, so the current Feodo row count and the exact URLhaus column set are taken from code comments and test fixtures only.
- Not verified: whether MapLibre keeps null property values such as asn:null on queried features, which decides whether the 'ASnull' popup text can actually appear.
- I did not read fetchEndpoint or setBackendStatus in page.tsx, which handle generic error and status behaviour for the C2 fetch.
- I did not check the map style's glyph endpoint that serves the 'JetBrains Mono Bold' / 'Open Sans Bold' fonts used by the labels.
