# OSIRIS deployment topology, env vars and middleware
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
**Question answered:** The deployment topology, env vars and middleware behaviour are not covered. This includes the second tile proxy.

## Summary

Deployment topology: docker-compose.yml runs three services. (1) `osiris` is the Next.js standalone app on :3000. It is published as ${OSIRIS_PORT:-3000}, joins the `default` and external `umami_default` networks, and reads `.env` optionally. (2) `osiris-cache` is nginx:alpine on :8080 in front of osiris:3000. It adds gzip and large buffers, and has a 10 GB/365-day `tile_cache` zone that only serves /proxy/tiles/<[a-d].>basemaps.cartocdn.com/... (3) `osiris-intel` is an Express 5 entity-resolution graph service on :4000 (OpenSanctions OFAC SDN + Wikidata SPARQL + ip-api/RIPEstat). The only thing that calls it is /api/entity/expand, and no UI code calls that route.

Canonical tile proxy: /api/proxy-tiles is the one in use. The map's transformRequest (src/components/OsirisMap.tsx:335-341) rewrites every cartocdn.com URL (style, TileJSON, .mvt, sprite, glyphs) to `${origin}/api/proxy-tiles?url=<encoded>`. Nothing in src ever requests /proxy/tiles/. The nginx regex would not match the hosts CARTO's vector style actually uses anyway (tiles.basemaps.cartocdn.com, tiles-a..d.basemaps.cartocdn.com), so those would fall through to the 403 catch-all. The nginx tile route is legacy/dead. Tiles that pass through nginx go via `location /`, which has no proxy_cache. Real tile caching comes from Next fetch `next.revalidate: 31536000` plus the browser header `Cache-Control: public, max-age=31536000, immutable`.

Middleware: on every non-asset page request it sends two fire-and-forget Umami events (a page view and a "Network Log" event carrying the visitor IP) to http://umami-umami-1:3000/api/send. Each has a 2 s AbortSignal and waitUntil. The website id falls back to a hard-coded UUID.

Env vars the code actually reads: SCANNER_URL/KEY, CLOUDFLARE_API_TOKEN, ETHERSCAN/HELIUS, OPENSKY_CLIENT_ID/SECRET, AIS_API_KEY, GEMINI_API_KEY_1..8, SDK_INGEST_KEY, GITHUB_WEBHOOK_SECRET/FORWARD_URL, INTEL_URL, UMAMI_WEBSITE_ID, OSIRIS_CCTV_SNAPSHOT, OSIRIS_NOMINATIM_CACHE/GAP_MS, VERCEL, NODE_ENV, INTEL_PORT. FIRMS_API_KEY, N2YO_API_KEY and OSIRIS_TELEGRAM_CHANNELS are documented but not read anywhere. The docs are wrong in several places: .env.example says OpenSky/AIS keys are not read (they are), .env.example says analytics are absent without UMAMI_WEBSITE_ID (a fallback UUID is used), the docs say OSIRIS_TELEGRAM_CHANNELS is read (it is not), and compose/DOCKER.md name `.env.template` (the file is `.env.example`).

## Findings

### 0. Compose service: osiris (Next.js app)

Build context `.` (Dockerfile). container_name `osiris`.
- ports: "${OSIRIS_PORT:-3000}:3000" (line 13).
- env_file: `- path: .env, required: false` (lines 16-18).
- environment (lines 19-23): `NODE_OPTIONS=--dns-result-order=ipv4first`, `NODE_ENV=production`, `PORT=3000`, `HOSTNAME=0.0.0.0`.
- extra_hosts: "host.docker.internal:host-gateway" (lines 24-25).
- restart: unless-stopped.
- networks: `default` and `umami_default`. `umami_default` is declared `external: true` (lines 59-61), so `docker compose up` on a host with no Umami stack fails because the external network does not exist (standard Docker behaviour).
- No volume is mounted for /app/.cache, so the CCTV catalogue and Nominatim disk caches do not survive container recreation.
- The comment says the prebuilt image is `ghcr.io/simplifaisoul/osiris:latest`.

Files: `docker-compose.yml:3-29`, `docker-compose.yml:56-61`

### 1. Compose service: osiris-cache (nginx)

Service definition:
- image: nginx:alpine. container_name osiris-cache. ports "8080:8080".
- volumes: `./nginx/nginx.conf:/etc/nginx/nginx.conf:ro` and named volume `nginx-cache:/var/cache/nginx`.
- depends_on: osiris. Network: default only.

nginx.conf:
- `worker_processes auto; worker_connections 1024`.
- gzip (lines 12-26): `gzip on; gzip_vary on; gzip_comp_level 5; gzip_min_length 1024; gzip_proxied any`. gzip_types: application/json, application/javascript, application/xml, application/geo+json, text/plain, text/css, text/javascript, image/svg+xml. The comment says /api/cctv?region=all is "~4.3 MB of JSON that gzips to ~0.5 MB".
- Line 28: `proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=tile_cache:100m max_size=10g inactive=365d use_temp_path=off;`
- Line 31: `resolver 1.1.1.1 8.8.8.8 valid=300s;`. Line 34: `listen 8080`.
- Tile location (line 38): `location ~ ^/proxy/tiles/(?<target_domain>(?:[a-d]\.)?basemaps\.cartocdn\.com)/(?<target_path>.*)$`.
  - `proxy_pass https://$target_domain/$target_path$is_args$args`, `proxy_set_header Host $target_domain`, `proxy_ssl_server_name on`, TLSv1.2/1.3.
  - Hides and ignores Set-Cookie.
  - `proxy_cache tile_cache; proxy_cache_valid 200 304 365d; proxy_cache_valid any 1m; proxy_cache_lock on`.
  - `add_header Cache-Control "public, max-age=31536000, immutable"` and `add_header X-Cache-Status $upstream_cache_status`.
- Line 66: `location ~ ^/proxy/tiles/ { return 403; }` is the catch-all; regex locations are checked in source order.
- `location /` (line 71): `proxy_pass http://osiris:3000`.
  - Headers: Host $host, X-Real-IP $remote_addr, X-Forwarded-For $proxy_add_x_forwarded_for, X-Forwarded-Proto $scheme.
  - Timeouts: connect 30s, read 120s, send 120s. The comment: "flights/cctv/satellites fan out to slow external APIs".
  - Buffering: `proxy_buffering on; proxy_buffer_size 16k; proxy_buffers 32 64k; proxy_busy_buffers_size 128k`. The comment: "flights response is ~5MB".
  - `proxy_http_version 1.1`, `Upgrade $http_upgrade`, and `Connection "upgrade"`, which is set unconditionally on every request.
- `location /` has no proxy_cache, so /api/proxy-tiles responses are not cached by nginx.
- Ports 3000 and 8080 are both published, so clients can bypass nginx.

Files: `docker-compose.yml:31-43`, `nginx/nginx.conf:1-97`

### 2. Which tile proxy is canonical: /api/proxy-tiles (the nginx /proxy/tiles route is dead)

Client side:
- Style URL: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' (OsirisMap.tsx:310).
- transformRequest at OsirisMap.tsx:335-341: `if (url.includes('cartocdn.com')) { const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''; return { url: `${baseUrl}/api/proxy-tiles?url=${encodeURIComponent(url)}` }; }`. This covers style.json, TileJSON, .mvt tiles, sprite and glyph PBFs.
- Nothing in src references /proxy/tiles/.
- The CARTO GL style uses these hosts (mirrored in public/dark-matter-style.json:9-20):
  - `https://tiles-{a..d}.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt`
  - sprite `https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite`
  - glyphs `https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf`
- The nginx regex `(?:[a-d]\.)?basemaps\.cartocdn\.com` does not match `tiles-a.`/`tiles.` hosts, so they would get the 403 catch-all.
- scratch/architecture.html describes nginx as the intended entry point that intercepts /proxy/tiles/, but the client code no longer uses that path.

src/app/api/proxy-tiles/route.ts:
- GET `?url=`. Missing: 400 `{error:'Missing url parameter'}`.
- Host allowlist: `host !== 'cartocdn.com' && !host.endsWith('.cartocdn.com')` returns 403 `{error:'Forbidden domain'}`.
- Upstream fetch: `AbortSignal.timeout(15000)`, headers `Accept: */*`, `User-Agent: 'Osiris-Tile-Proxy/1.0'`, `next: { revalidate: 31536000 }` (Next data cache, 1 year).
- Upstream !ok: JSON `{error:'Failed to fetch tile'}` with the upstream status.
- Success: returns the upstream Content-Type (default application/octet-stream), `Cache-Control: public, max-age=31536000, immutable`, `Access-Control-Allow-Origin: *`.
- Exception: 500 `{error:'Internal server error'}`.
- The docs catalog calls it a "Same-origin raster tile proxy for basemaps that block cross-origin reads" (apiCatalog.ts:322-327). It actually proxies vector tiles and style assets.

public/dark-matter-style.json is a local copy (background-color #0e0e0e, attribution "© CARTO, © OpenStreetMap contributors"). src code does not load it. It is referenced only in a middleware comment, middleware.test.ts:34, and tools/preview-smoke.mjs 'recovery' scenario (line 116). Whether it is a fallback or a stale artifact is ambiguous.

Files: `src/components/OsirisMap.tsx:310-342`, `src/app/api/proxy-tiles/route.ts:1-51`, `public/dark-matter-style.json:1-25`, `nginx/nginx.conf:36-68`, `src/app/docs/apiCatalog.ts:321-327`, `scratch/architecture.html:180-240`

### 3. Middleware (Umami analytics)

src/middleware.ts:
- IP (line 7) = `cf-connecting-ip || x-forwarded-for || '127.0.0.1'`. The raw XFF string is not split. userAgent falls back to 'Unknown OSIRIS Client'.
- basePayload (lines 10-18): `{hostname: request.nextUrl.hostname, language: "en-US", referrer: referer||"", screen: "1920x1080", title: "OSIRIS", url: pathname, website: process.env.UMAMI_WEBSITE_ID || "cd8f216c-fc3f-45f5-ba1a-e10309a61d18"}`. The screen and language values are hard-coded.
- Two POSTs to 'http://umami-umami-1:3000/api/send', headers Content-Type json, User-Agent and x-forwarded-for=ip:
  1. `{payload: basePayload, type: "event"}` (page view).
  2. `{payload: {...basePayload, name: "Network Log", data: {IP: ip}}, type: "event"}`.
- Both use `signal: AbortSignal.timeout(2000)` and `.catch(()=>{})`, then `event.waitUntil(Promise.all([pageView, ipEvent]))` and `NextResponse.next()`.
- The comment (lines 20-26) explains that unbounded analytics fetches on an ENOTFOUND host starved the connection pool so /api/cctv timed out.
- matcher (line 57): `'/((?!api|_next/static|_next/image|vendor|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mjs|js|css|json|pbf|mvt|woff|woff2|ico|txt)$).*)'`. It excludes API routes, the MapLibre worker under /vendor, and /dark-matter-style.json (comment lines 49-54).
- middleware.test.ts asserts:
  - `/vendor/maplibre/<ver>/maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` exist and are not matched.
  - Exactly one vendored version exists (currently public/vendor/maplibre/6.7.0).
  - `/` and `/merch` are matched; `/api/cctv` is not.
- Because of the hard-coded fallback UUID, analytics are never absent. This contradicts .env.example ("analytics are simply absent when unset").

Files: `src/middleware.ts:1-60`, `src/middleware.test.ts:1-43`

### 4. Compose service: osiris-intel (entity-resolution graph)

Build and image:
- compose: build ./intel, ports "4000:4000" (published on the host), network default, no auth.
- intel/Dockerfile: node:22-alpine, `npm ci --omit=dev`, USER node, EXPOSE 4000, `HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:4000/health || exit 1`.
- package.json dependency: express ^5.1.0.

server.js constants:
- PORT = `process.env.INTEL_PORT || 4000`.
- SDN_CSV_URL 'https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv'.
- WIKIDATA_ENDPOINT 'https://query.wikidata.org/sparql'.
- WIKIDATA_UA 'OSIRIS-Intel/1.0 (https://osirisai.live; ontology engine)'.
- SDN_REFRESH_MS and WIKIDATA_CACHE_TTL both 24h. WIKIDATA_CACHE_MAX 10_000 (LRU via Map re-insert).
- ALLOWED_DOMAINS: query.wikidata.org, data.opensanctions.org, www.wikidata.org, ip-api.com, stat.ripe.net.

Sanctions index:
- CSV columns id, schema, name, aliases, countries, program_ids, sanctions, first_seen. Lists are split on ';'.
- byNorm key: lower-case, non letter/number replaced by space, whitespace collapsed.
- Search needs a query of at least 3 chars: exact normalised match first, else substring scan, limit 5.

Resolvers (types aircraft | vessel | company | person | ip | country):
- aircraft: callsign prefix (trailing digits stripped) to Wikidata P230 airline ICAO, plus P17/P169/P749. A registration-prefix table (N, G, F, D, TC, RA, …) maps to country. Optional model node.
- vessel: P458 IMO or label + Q11446; owner P127, operator P137, flag P8047.
- company: wbsearchentities, then P17/P749/P169/P452.
- person: P27/P108/P39.
- ip: `http://ip-api.com/json/<ip>?fields=...` (plain HTTP), RIPEstat whois / abuse-contact-finder / network-info.
- country: P35/P36/P1082/P2131/P78/P474/P463/P47.

Graph shape:
- Nodes `{id:'<type>:<label>', label, type, properties}`. Sanction nodes are `sanction:<id>` with label `⚠ <name>`.
- Links `{source, target, label}`. Labels: 'OPERATED BY', 'HEADQUARTERED', 'CEO', 'PARENT ORG', 'REGISTERED IN', 'AIRCRAFT TYPE', 'SANCTIONS MATCH', 'OWNED BY', 'FLAG STATE', 'NATIONALITY', 'EMPLOYER', 'POSITION HELD', 'HOSTED_BY', 'ASN', 'LOCATED_IN', 'GEOLOCATED', 'ABUSE CONTACT', 'PREFIX', 'HEAD OF STATE', 'CAPITAL', 'MEMBER OF', 'NEIGHBOR'.

Routes:
- Rate limit: 30 requests / 60 s per first XFF IP; 429 `{error:'Rate limit exceeded'}`.
- GET /health returns `{status:'ok', sanctions_entries, sanctions_loaded_at, wikidata_cache_size, uptime_seconds}`.
- GET /resolve?type=&id=[&registration&model&icao24]. id must be 2-200 chars; sanitizeId `/[^a-zA-Z0-9 \-._]/g`.
  - Response: `{nodes, links, entity:{type,id}, source:'OSIRIS Intelligence Layer', sanctions_index_size, wikidata_cache_hits, timestamp}`.
  - Cache-Control 'public, s-maxage=3600, stale-while-revalidate=7200'.
  - Error: 500 `{error:'Resolution failed', nodes:[], links:[]}`.
- Boot awaits the SDN load before listen and refreshes every 24h. A failed refresh keeps the stale index.

Files: `docker-compose.yml:45-54`, `intel/Dockerfile`, `intel/package.json`, `intel/server.js:18-33`, `intel/server.js:66-141`, `intel/server.js:240-686`, `intel/server.js:693-776`

### 5. Next <-> intel bridge (/api/entity/expand) and its (non-)use

src/app/api/entity/expand/route.ts:
- `INTEL_URL = process.env.INTEL_URL || (process.env.NODE_ENV === 'production' ? 'http://osiris-intel:4000' : 'http://localhost:4000')`.
- Rate limit `isRateLimited(clientIp, 30, 60_000)`.
- Same type allowlist and 2-200 char id rule as the intel service.
- Forwards registration, model and icao24. Timeout 15000. Sends `X-Forwarded-For: clientIp`.
- Passes upstream errors through as `{error, nodes:[], links:[]}`. Success Cache-Control 'public, s-maxage=3600, stale-while-revalidate=7200'.
- A grep of src/components, src/lib and src/app/page.tsx finds no fetch to /api/entity/expand. It appears only in the docs catalog (apiCatalog.ts:533: "Expands one graph node into its neighbours."). The osiris service does not depends_on osiris-intel.

Files: `src/app/api/entity/expand/route.ts:1-70`, `src/app/docs/apiCatalog.ts:531-542`

### 6. Env var -> gated feature matrix (verified against process.env reads)

RECON scanner:
- `SCANNER_URL`, `SCANNER_KEY` (scanner/route.ts:9-10).
- Only SCANNER_KEY is checked. Without it: 503 `{error:'Scanner not configured', hint:'Set SCANNER_URL and SCANNER_KEY in .env'}`.
- Rate limit 5 scans/min per IP. SSRF guard validateHost.
- ALLOWED_SCANS (timeouts): quick 15000, ssl 10000, headers 10000, rdns 8000, subdomains 15000, tech 15000, whois 10000, geoloc 8000, vuln 90000.

Cloudflare Radar:
- `CLOUDFLARE_API_TOKEN` (cloudflare-radar/route.ts:74-84).
- `?probe=1` always returns 200 `{configured, source:'Cloudflare Radar'}`. page.tsx:437 probes it to set `capabilities.cloudflare` and hide the layer toggles.
- Unset: 503 with hint 'Set CLOUDFLARE_API_TOKEN (Cloudflare account → API Tokens → Radar: Read) in .env'.
- Upstream RADAR_BASE 'https://api.cloudflare.com/client/v4/radar'. Paths '/annotations/outages?limit=50&format=json' and '/attacks/layer3/top/locations/origin?limit=25&format=json'. 20 s timeout.
- Promise.allSettled gives partial results (`partial:true, errors`). 502 only if both fail.
- Cache-Control 'public, s-maxage=300, stale-while-revalidate=600'.

Chain intel:
- `ETHERSCAN_API_KEY`, `HELIUS_API_KEY` feed chainIntel.ts:541-546 `capabilities()`, exposed by /api/osint/crypto?probe=1.

OpenSky (flights/route.ts:236-285):
- `OPENSKY_CLIENT_ID` + `OPENSKY_CLIENT_SECRET` are read, contrary to .env.example.
- OAuth2 client_credentials at 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'. Token cached until `expires_in(default 1800)-60`s.
- OpenSky poll interval: 90000 ms with credentials, 900000 ms anonymous. Response CACHE_TTL 90000. 429 cooldown 15 min.
- Sources: 'https://opensky-network.org/api/states/all?extended=1' plus adsb.fi 'https://opendata.adsb.fi/api/v2'. Comments say api.adsb.lol/v2 returns empty and adsb.one returns 403.

AIS:
- `AIS_API_KEY` (maritime/route.ts:100) is read, contrary to .env.example.
- Without it, no websocket and `ships` is empty; the static PORTS/CHOKEPOINTS are still served.
- With it: wss://stream.aisstream.io/v0/stream with BoundingBoxes, reconnect after 5000 ms, stale ships dropped at 10 min, SNAPSHOT_TTL_MS 5_000 (client polls every 10 s).

AI:
- `GEMINI_API_KEY_1..8` (loop i=1..8) in ai/analyze:67, ai/briefing:66, ai/overview:29.
- Unset: 503 'No Gemini API key configured. Set GEMINI_API_KEY_1 in environment or provide a key via the settings panel.' Overview falls back to a heuristic.

Fail-closed secrets:
- `SDK_INGEST_KEY` (sdk/ingest/route.ts:32): ingest is disabled when unset.
- `GITHUB_WEBHOOK_SECRET` + `GITHUB_WEBHOOK_FORWARD_URL`: 503 unless both are set. HMAC sha256 over `x-hub-signature-256` with timingSafeEqual; forwards with a 15 s timeout.

Other runtime vars:
- `INTEL_URL`: the intel bridge.
- `UMAMI_WEBSITE_ID`: middleware, with fallback UUID.
- `OSIRIS_CCTV_SNAPSHOT`: default `<cwd>/.cache/cctv-catalog.json`; 'off' disables.
- `OSIRIS_NOMINATIM_CACHE`: default `<cwd>/.cache/nominatim.json`; 'off' disables.
- `OSIRIS_NOMINATIM_GAP_MS`: default 2000; floor 1000 unless NODE_ENV=test.
- `VERCEL` (next.config.ts:20): output standalone unless VERCEL.
- `NODE_ENV`: in /api/geo, production with no public visitor IP returns `{status:'fail', message:'Visitor address unknown'}`; also sets the intel default URL.
- `INTEL_PORT`: intel service.
- `OSIRIS_PORT`: compose only.

Documented but not read anywhere in src: `FIRMS_API_KEY` (fires use the keyless CSV), `N2YO_API_KEY`, and `OSIRIS_TELEGRAM_CHANNELS`. Telegram channels are hard-coded in news/route.ts:36-50 as handles Osintdefender, WarMonitors, rybar_in_english, DDGeopolitics, KyivIndependent_official, QudsNen, AlMayadeenEnglish, intelslava, PressTV, each with lean/bloc labels. The documented default 'osintdefender,insiderpaper,aljazeeraenglish,nexta_live,war_monitor' is stale.

Files: `src/app/api/scanner/route.ts:9-45`, `src/app/api/cloudflare-radar/route.ts:17`, `src/app/api/cloudflare-radar/route.ts:74-84`, `src/app/api/cloudflare-radar/route.ts:154-210`, `src/app/page.tsx:435-440`, `src/app/page.tsx:848`, `src/lib/chainIntel.ts:541-546`, `src/app/api/flights/route.ts:112-123`, `src/app/api/flights/route.ts:220-285`, `src/app/api/flights/route.ts:345`, `src/app/api/maritime/route.ts:96-130`, `src/app/api/maritime/route.ts:198-240`, `src/app/api/ai/briefing/route.ts:63-72`, `src/app/api/ai/overview/route.ts:26-33`, `src/app/api/ai/analyze/route.ts:67`, `src/app/api/sdk/ingest/route.ts:31-33`, `src/app/api/github-webhook/route.ts:4-45`, `src/lib/cctv-snapshot.ts:30-47`, `src/lib/nominatim.ts:45-98`, `src/app/api/geo/route.ts:1-40`, `src/app/api/news/route.ts:23-50`, `next.config.ts:20`, `.env.example`

### 7. .env.example / DOCKER.md content and documented drift

.env.example sections:
- RECON: SCANNER_URL=, SCANNER_KEY=. Generate with `openssl rand -hex 32`; the key must equal the backend OSIRIS_KEY.
- CLOUDFLARE RADAR: CLOUDFLARE_API_TOKEN= for the "Internet Outages" and "Attack Origins" layers under "NET & EVENT INTEL". Token permission "Account · Radar · Read".
- CHAIN INTEL: ETHERSCAN_API_KEY=, HELIUS_API_KEY=.
- "OPTIONAL DATA-SOURCE KEYS (not read by current code)": FIRMS_API_KEY (5000 req/10 min), OPENSKY_CLIENT_ID/SECRET (OAuth2 since March 2025), N2YO_API_KEY (1000 req/hour), AIS_API_KEY.
- Commented: GEMINI_API_KEY_1, SDK_INGEST_KEY, GITHUB_WEBHOOK_SECRET, GITHUB_WEBHOOK_FORWARD_URL, INTEL_URL, UMAMI_WEBSITE_ID.
- RUNTIME: OSIRIS_PORT=3000; OSIRIS_TELEGRAM_CHANNELS commented.

Drift between docs and code:
1. compose line 14 and DOCKER.md say `.env.template`; the repo only has `.env.example`.
2. OPENSKY and AIS are labelled "not read" but are read.
3. OSIRIS_TELEGRAM_CHANNELS is documented as read (DOCKER.md, DocsClient.tsx:414) but is not.
4. UMAMI_WEBSITE_ID is said to be absent when unset, but a fallback UUID is used.
5. DOCKER.md says aviation comes from `adsb.lol`; the code uses adsb.fi plus OpenSky.

CasaOS x-casaos block: port_map "3000", webui_port 3000, scheme http. Icon https://raw.githubusercontent.com/simplifaisoul/osiris/master/public/casaos-icon.png; thumbnail og-image.png. Env descriptions for SCANNER_URL, SCANNER_KEY, FIRMS_API_KEY, AIS_API_KEY, OPENSKY_CLIENT_ID/SECRET, N2YO_API_KEY. Tagline "Real-time global OSINT intelligence dashboard".

Files: `.env.example`, `DOCKER.md`, `docker-compose.yml:14-15`, `docker-compose.yml:63-120`, `src/app/docs/DocsClient.tsx:395-440`

### 8. Dockerfile, next.config headers, CI and deploy

Dockerfile:
- Three stages on node:22-alpine: deps (`npm ci`), builder (`npm run build`), runner.
- Runner: NODE_ENV=production; user `nextjs` uid 1001 in group `nodejs` gid 1001.
- Copies public, `.next/standalone` (chown) and `.next/static`. EXPOSE 3000, PORT=3000, HOSTNAME="0.0.0.0", `CMD ["node","server.js"]`. Image is about 220 MB.
- .dockerignore excludes node_modules, .next, .env*, .git, .github, *.diff, README, AGENTS.md, CLAUDE.md, LICENSE.

next.config.ts:
- `output: process.env.VERCEL ? undefined : 'standalone'`. `serverExternalPackages: ['ws']`. `transpilePackages: ['react-map-gl','mapbox-gl','maplibre-gl']`.
- turbopack rule loads `maplibre-gl.mjs` through tools/maplibre-url-loader.cjs. `typescript.ignoreBuildErrors: false`. images.remotePatterns `https` `**`.
- Header on `/vendor/maplibre/:version/:file*`: 'public, max-age=31536000, immutable'.
- Headers on all routes: CSP "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: wss: data: blob:;", HSTS 'max-age=31536000; includeSubDomains', nosniff, X-Frame-Options SAMEORIGIN, X-XSS-Protection '1; mode=block'.
- MapLibre worker: `maplibregl.setWorkerUrl(`/vendor/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`)`. Vendored version is 6.7.0.

CI (.github/workflows/docker-publish.yml):
- Publishes only the osiris image to ghcr.io/${{ github.repository }}, for linux/amd64 and linux/arm64 via QEMU.
- Tags: latest (default branch), semver {{version}} and {{major}}.{{minor}}, sha short. GHA cache. Concurrency group docker-publish-${ref} with cancel-in-progress.

deploy.sh:
- SERVER="root@[redacted-ip]", REMOTE_DIR="/root/osiris", BRANCH="master".
- Runs `git add -A`, commit, push, then `ssh ... "cd /root/osiris && git pull && docker-compose down && docker-compose up -d --build"`. Prints https://osirisai.live.
- Production is therefore a single VPS running this compose file. The middleware reading `cf-connecting-ip` suggests Cloudflare in front; this is an inference.

Files: `Dockerfile`, `.dockerignore`, `next.config.ts:1-66`, `src/components/OsirisMap.tsx:314`, `.github/workflows/docker-publish.yml`, `deploy.sh`

### 9. Client-IP resolution and health (proxy-aware behaviour)

ssrf-guard.ts getClientIp (lines 251-266):
1. `cf-connecting-ip || x-vercel-forwarded-for || true-client-ip`, if it looks like an IP.
2. Else `x-real-ip` (set by nginx).
3. Else the rightmost x-forwarded-for entry.

visitorIp (lines 298-305) returns the first *public* IP among cf-connecting-ip, true-client-ip, x-vercel-forwarded-for, x-real-ip and x-forwarded-for. /api/geo uses it; responses are 'private, no-store'. Provider cascade starts with ipapi.co, UA 'OSIRIS/4.2'.

isRateLimited(ip, limit=20, windowMs=60000) is an in-memory Map.

/api/health returns `{status:'serving', scope:'process', checks_performed:'none', detail:'The application process is up and answering requests. Upstream feed availability is not checked by this endpoint — query the individual routes for that.', platform:'OSIRIS', version:'1.0.0', uptime_seconds, nominatim: nominatimStats(), timestamp}`.

CCTV route (cctv/route.ts:956-970):
- Self-gzips a prebuilt payload: `buildPayload` gzip level 6, weak ETag `W/"<sha1 base64url>"`.
- Headers: 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600', 'Vary': 'Accept-Encoding'. 304 on If-None-Match. Content-Encoding gzip when Accept-Encoding includes gzip. So nginx gzip is now redundant for /api/cctv.
- The snapshot is written atomically (tmp + rename). Write failures are caught with the warning '[OSIRIS] Could not save the camera catalogue:' (cctv/route.ts:717-720).

Files: `src/lib/ssrf-guard.ts:221-305`, `src/app/api/geo/route.ts:1-40`, `src/app/api/health/route.ts:1-45`, `src/app/api/cctv/route.ts:700-720`, `src/app/api/cctv/route.ts:950-972`, `src/lib/cctv-snapshot.ts:55-90`

## Worth copying

- Bound every fire-and-forget analytics or side-channel fetch with AbortSignal.timeout(2000) and event.waitUntil. Exclude API routes, the MapLibre worker and static assets from the middleware matcher, so analytics can never starve the app's own sockets or delay the map (src/middleware.ts:20-57).
- Use one same-origin tile proxy with a strict host allowlist (host === 'cartocdn.com' || endsWith('.cartocdn.com')). Route it through MapLibre transformRequest so style, TileJSON, MVT, sprite and glyphs all go the same path. Return 'public, max-age=31536000, immutable'.
- If an nginx edge is kept, point its proxy_cache at the path the client actually uses (e.g. `location = /api/proxy-tiles` keyed on $arg_url), with `proxy_cache_lock on`, a 1-minute negative cache, and an X-Cache-Status header.
- Capability probes (`?probe=1`, always 200, no upstream call) for credential-gated layers, so the UI hides toggles that can never return data (cloudflare-radar, osint/crypto). Fail closed with 503 plus a `hint` telling the operator exactly which env var to set.
- Degrade per section with Promise.allSettled and flag partial results (`partial:true, errors[]`). Return 502 only when every section fails.
- Prebuild and pre-gzip big payloads once per rebuild with a weak ETag, and answer 304 on If-None-Match. Persist expensive catalogues (CCTV, Nominatim) to disk with atomic tmp+rename writes, and restore them at boot.
- Budget-aware polling for rate-limited upstreams: OpenSky polls every 90 s with OAuth2 credentials and every 900 s anonymously, backs off for 15 min after a 429, caches the OAuth token until expires_in-60 s, and reuses the last good snapshot between polls so aircraft counts do not swing.
- Proxy-aware client IP resolution: trust edge headers (cf-connecting-ip, then x-real-ip), then the rightmost XFF entry. For geolocation, only use a public IP and refuse to locate the server itself in production.
- A health endpoint that states its own scope ('process', checks_performed:'none') instead of claiming feeds are healthy.
- MapLibre worker self-hosted at a versioned path (/vendor/maplibre/<ver>/) with immutable caching. A unit test asserts that the worker file ships and that the analytics matcher does not intercept it.
- Rotating multi-key env pattern (GEMINI_API_KEY_1..8), plus a user-supplied key from the settings panel as a fallback.
- Keyless-first design: every core layer works with zero keys. Keys only raise rate limits or unlock extra layers.
- Security headers set centrally in next.config headers() (CSP, HSTS, nosniff, SAMEORIGIN).

## Weaknesses to fix in GODSEYE

- Two tile proxies, and the nginx one (/proxy/tiles/) is dead. The client never calls it, and its regex `(?:[a-d]\.)?basemaps\.cartocdn\.com` does not match the tiles-a..d./tiles. hosts CARTO's vector style uses, so they would get 403. Meanwhile /api/proxy-tiles traffic through nginx `location /` gets no proxy_cache. The replica should have exactly one tile path, with an edge cache on it (or fetch CARTO directly, since it serves CORS).
- Every tile, glyph and sprite request goes through a Node route handler that buffers the whole response (arrayBuffer). This costs CPU and memory per tile. Next's fetch data cache for tiles lives inside the container with no volume. (Whether .next/cache persists here is not verified.)
- `networks: umami_default: external: true` makes `docker compose up` fail on any host without the author's Umami stack. The middleware also hard-codes the host `umami-umami-1` and a fallback website UUID, so self-hosters send events to a non-existent host, and analytics can never be disabled by config.
- The middleware sends the raw, spoofable `x-forwarded-for` string as the visitor IP in a 'Network Log' Umami event, which is a privacy concern. It does not reuse the safer getClientIp logic. Screen '1920x1080' and language 'en-US' are faked.
- osiris-intel is published on host port 4000 with no auth, and osiris-cache (8080) and osiris (3000) are both published, so nginx is bypassable. Nothing in the UI calls /api/entity/expand, so the intel container is effectively unused. osiris has no depends_on or healthcheck wait on intel.
- ip-api.com is queried over plain HTTP from the intel service. SPARQL queries are built by string interpolation (mitigated only by sanitizeId stripping quotes).
- Env documentation drift: `.env.template` is referenced but does not exist. OPENSKY and AIS keys are called 'not read' but are read. FIRMS_API_KEY, N2YO_API_KEY and OSIRIS_TELEGRAM_CHANNELS are documented but not read. DOCKER.md names adsb.lol as the aviation source even though the code says it returns empty.
- The scanner route checks only SCANNER_KEY, not SCANNER_URL. The AIS websocket starts at module import and holds global state; this does not work on serverless.
- nginx sets `Connection "upgrade"` unconditionally on every proxied request. The gzip for /api/cctv is now redundant because the route self-gzips.
- No persistent volume for /app/.cache (CCTV catalogue, Nominatim cache), so every redeploy (`docker-compose down && up --build`) cold-starts those caches. deploy.sh does `git add -A` and pushes straight to master.

## Gaps (not verified)

- Could not confirm what fronts osirisai.live in production (Cloudflare proxy or tunnel is inferred from the cf-connecting-ip handling), or whether public traffic enters on :8080 (nginx) or :3000 directly.
- Not verified whether Next's fetch data cache (`next.revalidate: 31536000` in /api/proxy-tiles) persists across container restarts in the standalone runner. No volume maps .next/cache, so likely not.
- Ambiguous whether the non-root `nextjs` user can create /app/.cache in the runner image (WORKDIR /app is created by root; only the copied contents are chowned). Write failures are caught and logged, so the only impact would be losing persistence.
- public/dark-matter-style.json is not loaded by src code. Whether it is an intended fallback (tools/preview-smoke.mjs has a 'recovery' scenario that blocks it) or a stale artifact cannot be determined from the code.
- The live CARTO style.json at https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json was not fetched (read-only task). The claim that its hosts are tiles.* and tiles-{a-d}.* is based on the local mirror and tools/preview-smoke.mjs probe URLs.
- Did not inspect the SSRF-guard internals beyond getClientIp, isRateLimited and visitorIp, nor the full flights, cctv and satellite fan-out, which other slices cover.
