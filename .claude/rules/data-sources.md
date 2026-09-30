---
paths:
  - "src/features/**/feeds.ts"
  - "src/features/**/server/**"
  - "src/components/panels/**/feeds.ts"
  - "src/components/panels/**/server/**"
  - "docs/data-sources/**"
  - "tools/**"
---
# Data-source rules (§0.4, §6)
- Probe every upstream with `curl` before wiring it; append status, latency, CORS, auth, licence and
  sample fields to `docs/data-sources/<agent>.md`, with the probe date (pages-docs-privacy-ops compiles
  `docs/DATA_SOURCES.md` from those files).
- Zone-less UTC timestamps (NOAA, GDACS, CelesTrak, SWPC) go through `normalizeUtc()`; never parse
  them with `new Date()` directly (that assumes the server's zone).
- Encode the §6.2 breaking changes in comments and tests (CelesTrak OMM JSON, NOAA `/json/rtsw/`,
  K-index objects, GDELT GEO gone, NWS rejects `limit`, adsb.fi v3, hexdb `/route/icao/`, etc.).
- Each feed declares `attribution` (text + licence + url) and `kind` (`live` | `reference` | `mixed`).
- Honour limits with `providerBucket(name, ratePerSec)`; Nominatim only through `src/lib/geocode.ts`.
- Keyed/licensed providers return `skippedProvider('not-configured' | 'licence')` when their capability
  is off — never silently.
