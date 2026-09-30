---
paths:
  - "src/app/api/**"
---
# API route conventions
- One folder per endpoint: `route.ts` + `route.test.ts`. The path must exist in `src/lib/api-catalog.ts`
  (a test fails otherwise); request catalogue edits from the lead.
- Export `GET`/`POST` wrapped in `withRoute('/api/<path>', handler, limit?)` (per-route rate limit,
  uniform 500 without stack traces). AI routes: `{limit: 5, windowS: 60}`.
- Validate query params with zod via `parseQuery()`; 400 `{error:'invalid_request', detail}` on bad input.
- Never fetch an upstream in the handler: call a feed (`defineFeed` in your area's `feeds.ts`, listed in
  its `feeds` export) or a lookup module that uses `httpJson()` + `sourceCache()`. Never fetch another
  route over HTTP; import the shared module instead.
- Respond with `feedJson(req, await feed.get(), (d) => ({...}))` for feeds (adds `meta` + `providers`,
  ETag/304, short edge TTL when stale, 503 SOURCE OFFLINE when there is no data). Lookups return
  `providers` + `timestamp`. Errors: `apiError(status, code, detail)`.
- Bulk payloads (flights, satellites, cameras) use columnar rows and `compressedJson()`; every response
  must stay < 4 MB uncompressed with default params (add a test).
- Cache headers: `public, s-maxage=<ttl>, stale-while-revalidate=<2×ttl>` (helpers do this).
- Timestamps ISO-8601 UTC. `observedAt` comes from the upstream record; if unknown it is `null`.
- `export const dynamic = 'force-dynamic'` for routes that read live feeds.
