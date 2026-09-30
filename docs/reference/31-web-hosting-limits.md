# Hosting targets and limits (Vercel vs Docker/Node), shared cache options
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
**Question answered:** What is the hosting target, and what are its limits? Vercel caps function bodies at 4.5 MB (verified). Do streamed or SSE responses get around that cap? What are the maximum function duration and memory on each plan? What shared cache should replace per-instance in-memory LRUs (Vercel Runtime Cache, Next 16 'use cache' remote cacheHandlers, Upstash)? Or should the prompt make Docker/Node the primary target?

## Summary

Recommendation: make a single long-running Node/Docker process the primary target. Vercel can be a secondary target with explicit constraints. Evidence: (1) The real osirisai.live does not look like it runs on Vercel. Responses carry `server: cloudflare`, `cf-ray` and `x-nextjs-cache`, and have no `x-vercel-*` headers, so it is most likely self-hosted Next.js behind Cloudflare (inference). The repo ships a node:22-alpine standalone Dockerfile and a docker-compose file with an nginx sidecar. That sidecar gzips JSON and caches CARTO tiles with `proxy_cache_lock`, and there is also an osiris-intel service on :4000. `next.config.ts` sets `output: process.env.VERCEL ? undefined : 'standalone'`, so the codebase is dual-target with Docker as the main one. (2) Measured live payloads today: /api/cctv is 8.49 MB raw; /api/flights is 3.59 MB raw (483 KB brotli); /api/satellites is 2.74 MB raw (379 KB brotli). CCTV alone breaks Vercel's 4.5 MB limit unless it is streamed.

Vercel facts, verified in the docs:
- Request and response bodies are capped at 4.5 MB (413 FUNCTION_PAYLOAD_TOO_LARGE; 500 FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE).
- Vercel's KB says streaming functions "don't have this limit". No upper bound for streamed responses is documented.
- With Fluid compute, duration is 300 s default and 300 s max on Hobby. Pro and Enterprise are 300 s default, 800 s max, and 1800 s in beta (set per function only, Node 20/22/24, Bun, Python 3.12–3.14).
- Memory is 2 GB / 1 vCPU on Hobby and up to 4 GB / 2 vCPU on Pro and Enterprise.
- Other limits: 1,024 file descriptors shared across concurrent executions, 250 MB bundle, and a single region (iad1) on Hobby.
- The CDN caches function responses up to 10 MB, or 20 MB when streamed. The cache is regional and max TTL is 1 year. Request collapsing is only documented for ISR and Image Optimization, one invocation per region.
- Hobby cron can only run once a day (±59 min); Pro can run once a minute.
- Hobby is non-commercial only. Its monthly allotments: 1M invocations, 4 h Active CPU, 360 GB-hrs, 100 GB Fast Data Transfer, 10 GB Fast Origin Transfer.
- Egress IPs are dynamic. Static IPs cost $100 per project per month (Pro+).
- Container-image functions are stateless, have the same limits and scale to zero, so they do not escape the caps.
- WebSockets are in public beta and close at max duration; the default message cap is 256 KiB.

Shared-cache options:
- Vercel Runtime Cache (`getCache` or `'use cache: remote'` on Next 16 on Vercel) is regional and split per environment. It has a 2 MB item limit, and items larger than that are silently not cached. Eviction is LRU, writes cost $4–6.40 per 1M and reads $0.40–0.64 per 1M. `expireTag` propagates globally in 300 ms, and on Hobby all projects share one cache. So it cannot hold the 7 MB CelesTrak file or raw flights without compression or sharding. It also has no lock, so concurrent instances can each call upstream.
- Next 16 `'use cache: remote'` entries are keyed by buildId/deploymentId and are lost on every deploy. The default `'use cache'` handler is an in-memory LRU per instance. `cacheHandlers` (v16.0.0+) need get/set/refreshTags/getExpiration/updateTags, and the docs include a Redis example.
- Upstash Redis: 10 MB max request and 100 MB max record on Free and pay-as-you-go. Free gives 256 MB, 500K commands a month and 10 GB bandwidth. Pay-as-you-go is $0.2 per 100K commands at 10k commands/s.
- Vercel Blob (public, CDN-served, up to 5 TB per file, cached up to 512 MB per blob) gets around the 4.5 MB cap for static snapshots. The Hobby quota is only 2,000 advanced operations (put) a month, so frequent snapshot writes are only viable on Pro.

Upstream rules that force a single writer:
- CelesTrak: download once per update, and GP data updates every 2 h. Machine clients must stop on any non-200 response, and enforcement has started on the Active and Starlink groups. CelesTrak ran out of 5-digit catalogue numbers on 2026-07-11, so use OMM JSON/CSV rather than TLE.
- Nominatim: at most 1 req/s, identifying User-Agent, results must be cached, no autocomplete, no distributed scripts.
- adsb.fi: 1 req/s, non-commercial use only.

If the site is fronted by Cloudflare, its default Proxy Read Timeout of 125 s means SSE streams need heartbeats.

## Findings

### 0. Live osirisai.live hosting (observed) (verified)

curl -I https://osirisai.live/ returns server: cloudflare, cf-ray, cf-cache-status: DYNAMIC, x-powered-by: Next.js, x-nextjs-cache: HIT, x-nextjs-prerender: 1, and no x-vercel-* headers. Conclusion: self-hosted Next.js behind Cloudflare (INFERENCE based on headers, not a documented statement). /api/flights: cache-control 'public, max-age=14400, s-maxage=30, stale-while-revalidate=60'. /api/satellites: 'public, max-age=14400, s-maxage=120, stale-while-revalidate=300'.

Source: https://osirisai.live/

### 1. Live payload sizes (measured 2026-09-30) (verified)

/api/cctv 8,491,508 bytes raw. /api/flights 3,585,169 bytes raw, 482,852 bytes brotli. /api/satellites 2,736,124 bytes raw, 379,224 bytes brotli. CCTV is over the Vercel 4.5 MB non-streamed cap, and all three are over the Runtime Cache 2 MB item cap when uncompressed.

Source: https://osirisai.live/api/cctv

### 2. OSIRIS repo deployment config (verified)

Dockerfile: node:22-alpine multi-stage, copies .next/standalone, runs `node server.js` on PORT 3000. docker-compose: osiris (Next) + osiris-cache (nginx:alpine on :8080, gzip for application/json, proxy_cache tile_cache 10g with proxy_cache_lock on for CARTO tiles, proxy_read_timeout 120s, proxy_buffers 32 64k 'flights response is ~5MB') + osiris-intel (:4000). next.config.ts: `output: process.env.VERCEL ? undefined : 'standalone'` (a comment says Vercel packaging fails with standalone on Next 16.3.4), serverExternalPackages ['ws'], immutable caching for /vendor/maplibre/:version. package.json: next 16.3.4, react 19.2.4, maplibre-gl 6.7.0, satellite.js ^7, ws, @vercel/analytics. There is no vercel.json.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/HEAD/docker-compose.yml

### 3. Vercel 4.5 MB body cap (verified)

'The maximum payload size for the request body or the response body of a Vercel Function is 4.5 MB.' Error 413 FUNCTION_PAYLOAD_TOO_LARGE (request) / 500 FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE (response).

Source: https://vercel.com/docs/functions/limitations

### 4. Streaming bypasses the 4.5 MB response cap (verified)

Vercel KB: 'Often, it can be hard or impossible for you to reduce the size of it depending on your needs. In this case, we recommend using streaming functions, which don't have this limit.' It also recommends a dedicated media host or Vercel Blob with pre-signed URLs for large files. No maximum streamed size is documented. Streaming has been on by default for Node.js functions on Pro/Enterprise since 2024-10-01. The time spent streaming counts toward maxDuration.

Source: https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions

### 5. Vercel max duration (Fluid compute, Node/Bun/Python) (verified)

Hobby: 300s default and max. Pro and Enterprise: 300s default, 800s max (GA), 1800s extended max (Beta). Values above 800s must be set per function (export const maxDuration = 1800) on nodejs20.x/22.x/24.x, Bun 1.x/1.4.x, python3.12–3.14, and are not supported with Secure Compute or Static IPs. Edge runtime must start responding within 25s and can stream for up to 300s. Timeout gives 504 FUNCTION_INVOCATION_TIMEOUT. HTTP/1.1 clients may drop idle connections, so stream heartbeats.

Source: https://vercel.com/docs/functions/configuring-functions/duration

### 6. Vercel memory/CPU and other function limits (verified)

Memory: Hobby 2 GB / 1 vCPU (default = max). Pro/Enterprise 2 GB / 1 vCPU default, 4 GB / 2 vCPU max. Bundle 250 MB uncompressed (large functions up to 5 GB in beta). Concurrency auto-scales to 30,000 (Hobby/Pro) or 100,000+ (Enterprise). 1,024 file descriptors shared across concurrent executions, including the runtime. Default region iad1.

Source: https://vercel.com/docs/functions/limitations

### 7. Fluid compute instance model (verified)

Multiple invocations share one instance/process concurrently (optimized concurrency, Node.js/Python), so module-level in-memory state is shared by concurrent requests on the same instance but not across instances. Enabled by default for new projects since 2025-04-23. Multi-region functions: Pro 'Up to 3', Enterprise 'All' (the regions page says Pro 5 regions, which conflicts; Hobby is single region either way).

Source: https://vercel.com/docs/fluid-compute

### 8. Vercel function regions (verified)

Hobby: single region. Pro: 5 regions. Enterprise: all (region page). Deploying to more regions than the plan allows fails the deployment. Default iad1. Per-function regions can be set in vercel.json `functions`.

Source: https://vercel.com/docs/functions/configuring-functions/region

### 9. Vercel CDN cache for function responses (verified)

Needs Cache-Control with s-maxage (optionally stale-while-revalidate / stale-if-error), or CDN-Cache-Control / Vercel-CDN-Cache-Control. Cacheable only for GET/HEAD with no Authorization or Range header, status 200/404/410/301/302/307/308, no set-cookie, and no Vary: Cookie. Max cacheable size: 10 MB non-streaming, 20 MB for streaming function responses. The cache is segmented by region and max cache time is 1 year (best effort). Available on all plans.

Source: https://vercel.com/docs/caching/cdn-cache

### 10. Request collapsing scope (verified)

'combining concurrent requests into a single function invocation within the same region'. It also collapses stale-while-revalidate background revalidation. The docs list support only for ISR and Image Optimization. The blog says 'only one request per region invokes a function'. Collapsing for plain Cache-Control s-maxage function responses is not documented.

Source: https://vercel.com/docs/incremental-static-regeneration/request-collapsing

### 11. Vercel Runtime Cache (verified)

'regional, ephemeral cache' shared across Functions, Routing Middleware and builds within one region. Isolated by environment (preview/production). Pro/Enterprise: a cache per project; Hobby: all projects in the team share one cache. Persists across deployments, LRU eviction at a fixed storage limit (size not published). Limits: item size 2 MB ('Items larger than this will not be cached'), 128 tags per item, 256-byte tags. API: getCache({namespace, namespaceSeparator, keyHashFunction}) with get, set(key, value, {ttl, tags, name}), delete, expireTag. expireTag propagates to all regions within 300ms. Next's revalidateTag/revalidatePath do NOT invalidate Runtime Cache. On Next 16+, 'use cache: remote' or getCache map to Runtime Cache. Pricing: writes $4.00–6.40 per 1M write units, reads $0.40–0.64 per 1M read units.

Source: https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package

### 12. Next.js 16 cacheHandlers / 'use cache: remote' (verified)

cacheHandlers was added in v16.0.0: { default: require.resolve(...), remote: require.resolve(...) }. 'default' serves 'use cache' and 'remote' serves 'use cache: remote'; other named handlers can be added. Without config, both default and remote use an in-memory LRU per process. Handler interface: get(cacheKey, softTags), set(cacheKey, pendingEntry: Promise<CacheEntry>), refreshTags(), getExpiration(tags), updateTags(tags, durations). CacheEntry {value: ReadableStream<Uint8Array>, tags, stale, timestamp, expire, revalidate}. The docs include a Redis example and distributed tag coordination. Requires cacheComponents: true. Remote entries do NOT persist across deploys (the key includes deploymentId/buildId). The docs list rate-limited upstream APIs as a key use case. Supported on Node server, Docker and adapters; not static export.

Source: https://nextjs.org/docs/app/api-reference/directives/use-cache-remote

### 13. Next.js self-hosting (Docker/Node) caching and streaming (verified)

The default cache is in-memory (50 MB) plus on disk, per instance. For multiple instances, set cacheHandler plus cacheMaxMemorySize: 0 and use 'use cache: remote' with a custom cacheHandlers entry. Set NEXT_SERVER_ACTIONS_ENCRYPTION_KEY and deploymentId for multi-instance setups. Implement refreshTags for cross-instance revalidateTag. For streaming behind nginx, set header X-Accel-Buffering: no, and load balancers must pass chunked responses through. after() is supported, with a graceful SIGTERM drain of 10–30s recommended.

Source: https://nextjs.org/docs/app/guides/self-hosting

### 14. Upstash Redis limits (verified)

Free: 256 MB data, 500K commands a month, 10 GB bandwidth, max request size 10 MB, max record size 100 MB. Pay-as-you-go: 100 GB data, unlimited commands, 10,000 cmd/s, 10 MB max request, 100 MB max record, $0.2 per 100K commands, 200 GB bandwidth free then $0.03/GB. Fixed plans: 10–100 MB max request, 100 MB–5 GB max record.

Source: https://upstash.com/docs/redis/overall/pricing

### 15. Vercel Blob limits (verified)

Max file size 5 TB (use multipart above 100 MB). CDN caches blobs up to 512 MB. Hobby includes 1 GB storage, 10,000 simple ops, 2,000 advanced ops (put/copy/list) and 10 GB data transfer. Over the limit, Hobby loses Blob access for 30 days. Rate limits: Hobby 1,200 simple/min and 900 advanced/min; Pro 7,200 and 4,500. Pro pricing: storage $0.023/GB, advanced ops $4.50–7.00 per 1M, data transfer $0.05–0.117/GB.

Source: https://vercel.com/docs/vercel-blob/usage-and-pricing

### 16. Vercel cron limits (verified)

100 cron jobs per project on all plans. Hobby: minimum interval once per day, precision ±59 min, and expressions that run more often fail deployment. Pro/Enterprise: once per minute, per-minute precision.

Source: https://vercel.com/docs/cron-jobs/usage-and-pricing

### 17. Vercel Hobby allotments and commercial restriction (verified)

Hobby includes 100 GB Fast Data Transfer, 1,000,000 function invocations, 10 GB Fast Origin Transfer, 4 hours Active CPU and 360 GB-hrs provisioned memory. 'Hobby teams are restricted to non-commercial personal use only'; ads count as commercial use, donations do not. Pro on-demand: $0.60 per 1M invocations, Active CPU from $0.128/h, memory from $0.0106/GB-hr.

Source: https://vercel.com/docs/limits/fair-use-guidelines

### 18. Vercel egress IPs (verified)

'Builds and Vercel Functions send outbound requests from a dynamic range of addresses.' Static IPs cost $100/month per project on Pro/Enterprise plus Private Data Transfer, and are not supported with the extended duration, large function or container image betas.

Source: https://vercel.com/kb/guide/can-i-get-a-fixed-ip-address

### 19. Vercel container-image (Docker/OCI) functions (verified)

'Container-based functions are stateless. Each instance takes a request, returns a response, and keeps nothing between calls.' They serve HTTP on port 80 (override with PORT), scale down after 5 min with no traffic (30s in preview), and have the same pricing and size/memory/duration limits as other functions. Not supported with Secure Compute or Static IPs.

Source: https://vercel.com/kb/guide/does-vercel-support-docker-deployments

### 20. Realtime on Vercel (SSE / WebSockets) (verified)

SSE runs on standard HTTP, browsers reconnect on their own, and it is subject to function max duration. WebSockets are in public beta on Fluid compute; 'A connection closes when its function hits the maximum duration'. experimental_upgradeWebSocket has a default maxPayload of 262144 (256 KiB) and needs `vc dev` locally.

Source: https://vercel.com/kb/guide/publish-and-subscribe-to-realtime-data-on-vercel

### 21. Cloudflare proxy timeouts (live site is fronted by Cloudflare) (verified)

Proxy Read Timeout defaults to 125 s (configurable on Enterprise only). Proxy Idle Timeout is 900 s. SSE through Cloudflare therefore needs heartbeats well under 125 s.

Source: https://developers.cloudflare.com/fundamentals/reference/connection-limits/

### 22. CelesTrak usage policy (verified)

'Only download the data you need, when you are going to use it, and only download data once per update.' 'For GP data, updates are once every 2 hours.' 'we are starting to enforce some of those limits for larger data sets, like the Active list for GP data and the Starlink list for GP & SupGP data.' M2M software 'should immediately stop querying when it receives any non-HTTP 200 responses'. Repeatedly ignoring errors gets the IP firewalled.

Source: https://celestrak.org/usage-policy.php

### 23. CelesTrak catalogue-number exhaustion (verified)

The elements page banner says: 'URGENT: We ran out of 5-digit catalog numbers on 2026-07-11.' Classic TLE cannot carry 6-digit catalogue numbers, so the build should use OMM JSON/CSV (satellite.js json2satrec / OMM support).

Source: https://celestrak.org/NORAD/elements/

### 24. Nominatim usage policy (verified)

'an absolute maximum of 1 request per second'. A valid HTTP Referer or User-Agent is required (stock library User-Agents are refused). 'Results must be cached on your side.' No client-side autocomplete. Scheduled or long-running scripts are limited to 4 requests/min, on '1 machine only, no distributed scripts'. Violations lead to a ban.

Source: https://operations.osmfoundation.org/policies/nominatim/

### 25. adsb.fi open data API (verified)

Base https://opendata.adsb.fi/api/. 'The public endpoints are rate limited to 1 request per second.' 'adsb.fi open data is for personal, non-commercial use only.'

Source: https://github.com/adsbfi/opendata

## Recommendations

- Make a single long-running Node process the PRIMARY target: `output: 'standalone'`, node:22-alpine Dockerfile, docker-compose with an nginx (or Caddy) front that has gzip/brotli, `proxy_cache_lock on` and X-Accel-Buffering: no for SSE routes, plus Cloudflare optional. Copy OSIRIS's own `output: process.env.VERCEL ? undefined : 'standalone'` so the same code also deploys to Vercel.
- Use ONE upstream poller (a single writer). Start it from instrumentation.ts register() on the Docker target, or run a separate worker container. It fetches each upstream on its own schedule and respects per-IP rules: CelesTrak GP once per 2 h per group, using the OMM JSON/CSV formats, not TLE; stop on any non-200 and back off. adsb.fi/Nominatim get a global token bucket of ≤1 req/s with a proper User-Agent, and Nominatim results must be cached permanently. Request handlers must never fetch these upstreams directly.
- Store each snapshot once as precompressed bytes (brotli, plus gzip fallback) with an ETag. Serve with `Cache-Control: public, s-maxage=<poll interval>, stale-while-revalidate=<2x>` and `Vary: Accept-Encoding` only. Never Vary on Cookie.
- Mandate chunked, binary or tiled delivery: satellites as compact OMM element sets, split by group (active, starlink, stations...) and propagated client-side with satellite.js in a Web Worker. Flights as a columnar binary (Float32Array/Int32Array or FlatBuffers) snapshot plus SSE deltas. CCTV and other large point catalogues tiled by bbox or z/x/y (or PMTiles/vector tiles), or paginated. Keep every single HTTP response under 4 MB uncompressed so the same routes work on Vercel without streaming.
- SSE: send a heartbeat comment every 15–25 s (Cloudflare Proxy Read Timeout is 125 s; Vercel closes streams at maxDuration, which is 300 s on Hobby). Send `retry:` and event ids so EventSource resumes. On Vercel, set `export const maxDuration` explicitly and expect a reconnect at the limit.
- If Vercel is supported as a secondary target, say so explicitly in the prompt: keep one function region (iad1) so the regional caches are not multiplied. Use Upstash Redis (via the Vercel Marketplace) as the shared cache and lock: `SET key NX PX` to elect one fetcher per upstream, and store brotli'd values under 10 MB (Upstash's max request size), sharding anything larger. Do NOT rely on Vercel Runtime Cache or 'use cache: remote' for payloads over 2 MB: Runtime Cache silently skips items above 2 MB, and remote entries are dropped on every deploy.
- On Vercel, prefetch with cron only on Pro (per minute). Hobby cron runs only once a day, so Hobby must use lazy fetch-on-request guarded by the Redis lock. Alternatively, write snapshots to public Vercel Blob so clients download them directly from the CDN, which avoids the 4.5 MB cap. Blob puts count as advanced operations, and Hobby includes only 2,000 a month, so frequent Blob writes are only viable on Pro.
- Anything that must exceed 4.5 MB on Vercel must return a ReadableStream (streamed responses are exempt, and the CDN caches them up to 20 MB). Better: make sure no single response exceeds that size. Add a CI test that asserts every /api route's uncompressed body is under 4 MB for default parameters.
- State in the prompt that Vercel Hobby is non-commercial only (adsb.fi is also non-commercial) and that Vercel egress IPs are dynamic and shared. Per-IP upstream quotas (CelesTrak, adsb.fi, Nominatim) are therefore more reliable from a single self-hosted IP, which is one more reason to make Docker primary.
- Implement the shared-cache layer behind one interface (`SnapshotStore` with memory, Redis and filesystem backends). The Docker build defaults to in-process memory plus an optional disk or Redis store; the Vercel build uses Upstash. If Next 'use cache: remote' is used for small derived data, register a Redis-backed `cacheHandlers.remote` for Docker (Next 16 interface: get/set/refreshTags/getExpiration/updateTags).

## Gaps (not verified)

- No maximum size for streamed Vercel function responses is documented. The KB only says streaming functions 'don't have this limit' (UNVERIFIED upper bound; time-bound by maxDuration).
- Whether the 4.5 MB cap is measured on uncompressed or compressed bytes, and whether a function can return pre-compressed Content-Encoding: br to stay under it (UNVERIFIED).
- Whether Vercel request collapsing applies to function responses cached via Cache-Control s-maxage. The docs list only ISR and Image Optimization (UNVERIFIED for plain route handlers).
- Total Runtime Cache storage size per project/region is not published; only the 2 MB item limit and LRU eviction are.
- The Vercel docs conflict on Pro multi-region functions: the Fluid compute page says 'Up to 3', the region config page says '5 regions'.
- The CelesTrak enforcement start date (a search snippet says 2026-03-26, with 403 on the second download until the next update) and the '>100 MB/day firewall' threshold were not found on the primary policy page (UNVERIFIED). The gp-data-formats page returned 503 / connection reset.
- That osirisai.live is self-hosted rather than Vercel behind Cloudflare is inferred from headers (x-nextjs-cache, no x-vercel-*), not stated by the project.
- Whether Fast Origin Transfer is billed on compressed or raw bytes (affects Hobby's 10 GB/month with 8.5 MB CCTV payloads): UNVERIFIED.
- Cloudflare behaviour for long-lived SSE beyond the documented 125 s read / 900 s idle timeouts was not explicitly documented.
