# GODSEYE — working checklist

Kept current by the lead after every phase. The build is done when this file is empty (§11).

## Setup (lead) — done
- [x] Next 16.3.7 + React 19.3 + TS 6 strict + Tailwind 4 + ESLint 10 flat config; pinned deps
- [x] MapLibre 6 worker recipe (vendored worker + shared module, `setWorkerUrl`, Turbopack loader, immutable cache)
- [x] Contracts: zod schemas (`src/lib/schemas/*`) + inferred types, layer/tool registries, keyboard map,
      API catalogue, capabilities, design tokens (CSS + TS mirror), feature-module + layer-host stores, URL state
- [x] Utilities with tests: http, SSRF guard, cache/SnapshotStore (memory/fs/Redis), feeds/poller,
      rate limits + provider buckets, SSE hub, responses (ETag/304, precompressed, 4 MB cap), geo, solar,
      freshness, columnar, CSV, RSS, geocoder queue
- [x] Globe shell: restyled OpenFreeMap globe, atmosphere, twilight terminator, deck overlay host,
      minimal HUD (header, telemetry, rail, 3D/2D, splash, overlays, status bar), /api/health, /api/stats, e2e smoke
- [x] CLAUDE.md, `.claude/rules/*`, `.claude/settings.json` (worktree baseRef head), 16 agents, `.env.example`, LICENSE + NOTICE

## Known gaps carried into Phase 0–2
- [ ] map-engine: resolve missing sprite images (`circle-11`) with `setMissingStyleImageResolver` (console warning today)
- [ ] map-engine: tune label density at z 3–5 (state/oblast labels crowd the view)
- [ ] pages-docs-privacy-ops: `/docs` and `/privacy` (Link prefetch 404 until built)
- [ ] lead: flip `CHECK_CATALOG_COMPLETENESS=1` in CI once every catalogue route exists
- [ ] lead: add each builder's operator media hosts to `src/config/hosts.ts` (CSP) when reported
