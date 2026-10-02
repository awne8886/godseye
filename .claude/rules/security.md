---
paths:
  - "src/app/api/**"
  - "src/lib/**"
  - "src/features/**/feeds.ts"
  - "src/features/**/server/**"
  - "src/components/panels/**/feeds.ts"
  - "src/components/panels/**/server/**"
---
# Security rules (§0.6)
- Any host or URL that comes from a user (query param, body, imported ArcGIS URL, OSINT target) goes
  through `safeFetch()` or `assertPublicUrl()` from `src/lib/ssrf.ts`. Never call `fetch()` directly.
- Proxy routes (camera stills, ArcGIS, tiles if ever needed) fetch ONLY through
  `allowListedFetch(url, RULES)`: exact hosts + directory path prefixes, re-checked with the SSRF guard
  on every redirect hop. Never `httpRequest()` after a one-off `matchesAllowList()`; never `**`.
- Client IP: `getClientIp()` only. `x-real-ip` is trusted only when `TRUST_PROXY_HEADER=x-real-ip`.
- Rate limits are per route and per verified client IP (`getClientIp`), never one shared bucket.
- Secrets only from `process.env` on the server; never in `NEXT_PUBLIC_*`, URLs, logs or responses.
  User-supplied AI keys arrive in a header, are used once and never stored or logged.
- Never render upstream strings as HTML. RSS/Telegram text passes through `toPlainText()` and is rendered
  as text; links are `http(s)` only and open with `rel="noopener noreferrer"`.
- `http.ts` refuses spoofed forwarding headers and non-GODSEYE User-Agents — do not work around it.
