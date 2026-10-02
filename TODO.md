# GODSEYE — working checklist

Kept current by the lead after every phase. The build is done when this file is empty (§11). Finished
items are removed; `git log -- TODO.md` has the history of Setup, Phases 0–2 and Phase 3 rounds 1–5.
Limitations that follow from upstream terms, quotas or hardware are documented in README
"Known limitations", not here.

## Phase 3 — verify → fix (need two consecutive clean rounds)
- [ ] Round 5 integration merged; still to check by e2e: the DeckOverlay stale-list guard (route endpoint
      labels on SVO-LAX, FLIGHT tab) and armed-tool gesture gating (long-press, double right-click, hover)
- [ ] Open follow-ups after round 6
  - [ ] map-engine + aviation + surveillance: initial JS on / is 688.9 KB gz until idle (budget 350 KB,
        measured by tools/perf/bundle-size.mjs); remaining client zod imports are aviation/codec.ts and
        surveillance/client/rows.ts. Add the CI step once the budget holds.
  - [ ] map-engine: Trips baselines in e2e/visual/deck-baselines.spec.ts now that watched-flight trails
        are a TripsLayer (globe + mercator)
  - [ ] layers-space: reuse transferred frame buffers (ping-pong) instead of allocating per re-filter;
        re-run e2e/layers-space/far-side.spec.ts against the mission glyphs
  - [ ] panels-alerts: AlertPinsLayer onto the shared `useGeoJsonLayers`; a chat UI that shows
        `done.truncated`, or remove the reason until one exists
  - [ ] panels-recon: e2e that draws a polygon and opens its card; alternate-route numbering
  - [ ] design-system-hud: landscape phone sheet leaves ~120 px for the planned route (collapse after
        PLOT); sensor chip on coarse-pointer tablets overlaps the header
  - [ ] feature-flight-paths: providers.flights.age_s in /api/route/plan; cap the plan's cache TTL while
        a known service is live
  - [ ] pages-docs-privacy-ops: re-capture the mislabelled Style Studio shots and the README hero shots;
        replace the stale "re-capture on a GPU machine" note with the capture environment
- [ ] Verification rounds: round 6 had 2 BLOCKING / 8 MAJOR (fixed); need rounds 7 and 8 clean

## Repository owner actions (cannot be done from the codebase)
- [ ] Provision a hardware-GPU Actions runner and set the repository variable `LIGHTHOUSE_GPU_RUNNER`
      (README "Optional: GPU runner for Lighthouse on `/`"). Until then the `/` gate is job
      `lighthouse-home` on the documented software-GL budget (`lighthouserc.home.json`):
      performance >= 0.45 and TBT <= 13500 ms (from the CI history under SwiftShader: perf 0.53-0.56,
      TBT 3.4-11.2 s, 60 runs), accessibility = 1, LCP <= 2.5 s, CLS <= 0.1 and the in-run audit
      `godseye-map-globe-drawn`; the GPU job is skipped. Tick after a green
      "Build + Lighthouse CI (/, GPU runner)" run whose summary lists a hardware renderer for all 3 runs.
- [ ] Optional keys to verify upgrades live (each adapter is tested with fixtures; a live smoke test
      needs the key in CI secrets or a staging deploy):
  - [ ] `AEROAPI_KEY` (FlightAware personal tier; needs a FlightAware account with a payment method)
  - [ ] `AIS_API_KEY` (AISStream.io) and `CLOUDFLARE_API_TOKEN` (Account › Radar: Read)
        — with the Cloudflare token, record `/api/cloudflare-radar` into e2e/visual/fixtures so the
        §11 ArcLayer (greatCircle) baseline can run: the attack-origin arcs are the only ArcLayer, drawn
        only from attributed telemetry, and the keyless API answers 400
  - [ ] `TRAFIKVERKET_KEY` (Trafikverket open traffic-information API)
- [ ] Decide whether to offer these keyed upgrades; if yes provide the key so the adapter can be built
      and recorded, if no the lead adds a README limitation:
  - [ ] OpenAQ v3 (`OPENAQ_API_KEY`) and WAQI (`WAQI_TOKEN`) station air quality
  - [ ] IBI 511 traffic cameras (per-site 511 developer keys)
  - [ ] Windy Webcams API v3 (`WINDY_WEBCAMS_KEY`)
- [ ] For fresher keyless aircraft: run the server on a host that feeds adsb.lol and set
      `ADSBLOL_REAPI=true` (the code path exists; README upgrades table).
