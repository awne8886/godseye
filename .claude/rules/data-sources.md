---
paths:
  - "src/features/**/feeds.ts"
  - "src/features/**/server/**"
  - "docs/DATA_SOURCES.md"
  - "tools/**"
---
# Data-source rules (§0.4, §6)
- Probe every upstream with `curl` before wiring it; append status, latency, CORS, auth, licence and
  sample fields to `docs/DATA_SOURCES.md` under your agent heading, with the probe date.
- Encode the §6.2 breaking changes in comments and tests (CelesTrak OMM JSON, NOAA `/json/rtsw/`,
  K-index objects, GDELT GEO gone, NWS rejects `limit`, adsb.fi v3, hexdb `/route/icao/`, etc.).
- Each feed declares `attribution` (text + licence + url) and `kind` (`live` | `reference` | `mixed`).
- Honour limits with `providerBucket(name, ratePerSec)`; Nominatim only through `src/lib/geocode.ts`.
- Keyed/licensed providers return `skippedProvider('not-configured' | 'licence')` when their capability
  is off — never silently.
