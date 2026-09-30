# Web-recon critic: coverage assessment and gaps
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
The critic reviewed files 20–23 and named the gaps filled in files 25+.

## Assessment

Overall the four results are strong on three areas: flight-path data sourcing (OurAirports, VRS standing-data, adsbdb/hexdb, AeroAPI, FPD, Turf/MapLibre geometry), current stack versions and their conflicts (MapLibre v6 worker recipe, TS7 vs typescript-eslint, ESLint 10, CelesTrak OMM), and the licensing of basemaps and many feeds. They are weakest on four things that decide whether the prompt can deliver a 1:1 replica:
(a) The internals of OSIRIS's own UI. GitHub API and HTML access to simplifaisoul/osiris is blocked in this session (I re-checked: HTTP 403 "GitHub access to this repository is not enabled"). raw.githubusercontent.com and the osirisai.live production JS chunks do work, so the lookups have to go through those two.
(b) How Opus 5.5 should actually orchestrate sub-agents. The user explicitly asked for this and none of the four agents researched it.
(c) Hosting limits. I verified that Vercel Functions cap request and response bodies at 4.5 MB (https://vercel.com/docs/functions/limitations). Several of the recommended payloads are larger than that: CelesTrak active JSON is about 7 MB, and the flights GeoJSON and CCTV catalogue are about 10 MB.
(d) A legal default for global live ADS-B at OSIRIS scale (about 12.9k aircraft).

The agents also contradict each other on a few points:
- adsb.lol /v2/callsign returned empty in one test and live data in another.
- The VRS standing-data licence is "CC0" on the adsb.lol mirror but "not checked" on the vradarserver repo.
- adsb.lol POST /api/0/routeset returns 201 with an empty body, so it is non-functional. Yet one agent lists it as a keyless route source.
- The Node floor differs: OSIRIS says Node 20+, while Vitest 5 needs 22.12+ and satellite.js 7.1 needs 20.19+.

The 'feeds' result reached me truncated after the IODA/Cloudflare entry. So I could not check whether the cyber/OSINT sources were covered: NVD key and rate limits, abuse.ch bulk terms, OpenSanctions CC BY-NC, XposedOrNot, HudsonRock, Shodan InternetDB terms, crt.sh reliability, and nmap scanner legality. Treat those as unverified unless the full feeds result covers them.

Lower-priority open items not in the top 10:
- Which CelesTrak query produces OSIRIS's roughly 19k satellite count.
- Style Studio preset hex values.
- Exactly what 'Night Mode' renders.
- Mobile layout behaviour.
- The Polybolos SDK ingest schema.
- The original Reddit launch post.

## Gaps identified

### 1. What legal data source can a public deployment use for global, keyless live ADS-B at OSIRIS scale (about 12.9k aircraft)? How exactly does osirisai.live reach that count: OpenSky OAuth global /states/all plus tiled adsb.fi calls at 1.1 s pacing? Does adsb.lol offer any all-world or re-api endpoint to non-feeders, and on what terms?

- Why it matters: Flights are the hero layer and the base of the requested airport-to-airport feature. Each candidate source has a problem. OpenSky's terms require a written agreement for any live product. Anonymous OpenSky gives 400 credits/day at 4 credits per global call, which is about 100 polls a day. adsb.fi is personal and non-commercial only. adsb.lol has no global endpoint, and airplanes.live returns 403. Without an answer the prompt cannot name a default flights pipeline, a tiling strategy, or a poll interval, and the builder will guess or ship something that breaks the terms.
- Where to look: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/flights/route.ts (read the tiling and merge logic); https://opensky-network.org/about/terms-of-use; https://openskynetwork.github.io/opensky-api/rest.html; https://api.adsb.lol/docs and https://github.com/adsblol/api (README, terms, re-api or feeder-only notes); https://github.com/adsbfi/opendata; https://www.adsbexchange.com/community/developer-hub/ (paid fallback pricing)

### 2. How do sub-agents work in current Claude Code for Opus 5.5? This covers the Agent/Task tool semantics, custom agent files in .claude/agents/*.md with their frontmatter fields (name, description, tools, model), running agents in parallel from one message, background agents, git-worktree isolation to avoid file clashes, how results come back to the lead agent, and any concurrency or context limits.

- Why it matters: The user explicitly asked that the prompt tell Opus 5.5 to use sub-agents, and no research agent covered the mechanism. The prompt needs the right primitives: define the agent files, split work so parallel agents don't edit the same files, and set how the lead integrates the results. Otherwise the orchestration instructions will be vague or wrong.
- Where to look: https://code.claude.com/docs/en/sub-agents (reachable, HTTP 200); https://code.claude.com/docs/en/common-workflows (parallel sessions and worktrees); https://code.claude.com/docs/en/settings; https://code.claude.com/docs/en/memory (CLAUDE.md conventions for multi-agent builds)

### 3. What is the exact OSIRIS layer catalogue in each left-rail category? This means individual layer names and descriptions, which layers are on by default (the '12 LAYERS' default), icon, colour and cluster styling, popup and hover fields, click actions, and which API route feeds each layer.

- Why it matters: A 1:1 replica depends on this, and the footprint agent listed it as unextracted. Right now the builder only has the category names (AVIATION, MARITIME, NATURAL HAZARDS, and so on) and would have to invent the layers inside them.
- Where to look: https://osirisai.live/_next/static/chunks/ (grep the loaded chunks for 'NATURAL HAZARDS', 'SPACE TRACKING', 'NETWORK INTEL', 'defaultEnabled'); https://osirisai.live/docs (Layer Panel section); raw.githubusercontent.com/simplifaisoul/osiris/master/src/components/ (OsirisMap.tsx is named in issue #146; try likely LayerPanel/layers config paths)

### 4. Which basemap and imagery sources does OSIRIS use for 2D Map, Night Mode, Satellite View, labels and 3D buildings? Is it the CARTO dark-matter GL style or CARTO rasters, Esri World Imagery, or something else? What exactly does /api/proxy-tiles proxy?

- Why it matters: A 1:1 look needs the same base style. But CARTO's terms, updated 2026-09-29, require an API key and forbid server-side proxying or caching, and OSIRIS proxies tiles. The prompt has to either replicate the look with a compliant source such as a recoloured OpenFreeMap dark or fiord style, or specify CARTO with a key. Issues #316 (CARTO/OSM boundaries) and #406 (missing OSM attribution) suggest CARTO is used, but nobody has confirmed it.
- Where to look: osirisai.live production chunks (grep 'cartocdn', 'basemaps', 'arcgisonline', 'openfreemap', 'style.json', 'dark-matter'); https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/proxy-tiles/route.ts; https://carto.com/legal/basemap-terms/; GitHub issues #316 and #406 on simplifaisoul/osiris

### 5. Where do OSIRIS's roughly 39.5k CCTV cameras come from? This covers the bekijkhet.nu catalogue versus per-agency APIs (TfL, WSDOT, Caltrans, TxDOT, Trafikverket, Lithuania, Edmonton, Taipei, Seoul), the stream format of each (JPEG refresh, MJPEG, HLS, iframe), whether /api/cctv/proxy re-streams them, and each source's terms and attribution rules.

- Why it matters: The camera count is a headline counter and a flagship visual (the README screenshots show Taipei and Seoul feeds). It is also the biggest legal exposure: issue #298 raises GDPR, and Insecam-style sources would be a problem. The builder needs a concrete, lawful source list and a player spec. Otherwise it will either under-deliver or proxy streams in ways that break the sources' terms.
- Where to look: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/cctv/route.ts (and cctv/proxy, cctv/stream-status); https://bekijkhet.nu (terms/API); https://osirisai.live/docs (CCTV endpoints); PRs #378, #402, #403, #404 and issue #298 on simplifaisoul/osiris; https://tfl.gov.uk/info-for/open-data-users/our-open-data; https://wsdot.wa.gov/traffic/api/

### 6. What exactly do the under-specified OSIRIS tools do? ROUTE/Directions: which routing engine (the OSRM public demo, Valhalla or GraphHopper) and what is its usage policy? SEARCH: which geocoder? REMOTE/'World Remote': which Web Bluetooth devices and what data? SPACE: the ISS stream plus what else? MARKETS: which defence equities and commodities, from which source? ALERTS: which sources? DRAW/Save Area: what GeoJSON export schema? ARCGIS: which search endpoint?

- Why it matters: Without this the builder has to guess the behaviour of 9 toolbar buttons. There is also a naming collision: OSIRIS's 'ROUTE' button is road turn-by-turn, so the requested airport-to-airport flight-path tool needs its own entry point. If ROUTE uses the OSRM demo server, that server's usage policy forbids heavy or production use, and the prompt should say so.
- Where to look: https://osirisai.live/docs (tool sections); osirisai.live production chunks (grep 'router.project-osrm', 'valhalla', 'graphhopper', 'navigator.bluetooth', 'photon', 'nominatim'); https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/markets/route.ts and src/app/api/arcgis/route.ts; https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server

### 7. What is the hosting target, and what are its limits? Vercel caps function bodies at 4.5 MB (verified). Do streamed or SSE responses get around that cap? What are the maximum function duration and memory on each plan? What shared cache should replace per-instance in-memory LRUs (Vercel Runtime Cache, Next 16 'use cache' remote cacheHandlers, Upstash)? Or should the prompt make Docker/Node the primary target?

- Why it matters: Several recommended payloads are over the 4.5 MB cap: CelesTrak active JSON (about 7 MB), full flights GeoJSON (about 10 MB) and the CCTV catalogue. Per-IP upstream rules also break when many serverless instances each fetch on their own: CelesTrak allows one download per update, and Nominatim and adsb.fi allow 1 request per second. The prompt must specify chunked, binary or tiled delivery and a shared cache, or the build will fail in production.
- Where to look: https://vercel.com/docs/functions/limitations; https://vercel.com/docs/functions/streaming-functions; https://vercel.com/docs/functions/configuring-functions/duration; https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers; https://vercel.com/docs/runtime-cache

### 8. Does deck.gl 9.4's @deck.gl/maplibre MapLibreOverlay in interleaved mode fully work on the MapLibre v6 globe projection? Check ArcLayer greatCircle, TripsLayer, IconLayer, H3HexagonLayer and HexagonLayer, and picking, and look for open issues with React 19.3 or Next 16 Turbopack. Separately, what are the terms, pricing, attribution and caching rules for Google Photorealistic 3D Tiles and Cesium ion, including whether they may be mixed with a non-Google basemap?

- Why it matters: The 'upgrades' agent's core rendering plan (MapLibre v6 globe with deck.gl interleaved) was not tested on the globe with v6. The 'footprint' agent recommends a Cesium plus Google 3D Tiles path, but no one checked its licence or cost. A wrong assumption here means rewriting the map engine.
- Where to look: https://deck.gl/docs/api-reference/maplibre/maplibre-overlay; https://github.com/visgl/deck.gl/issues?q=globe+interleaved+maplibre; https://github.com/visgl/deck.gl/releases/tag/v9.4.0; https://developers.google.com/maps/documentation/tile/3d-tiles-overview; https://developers.google.com/maps/documentation/tile/policies; https://mapsplatform.google.com/pricing/; https://cesium.com/legal/terms-of-service/

### 9. For the AI analyst: which Gemini model and prompts do OSIRIS's /api/ai/{analyze,briefing,overview} use? Is the pinned @google/generative-ai ^0.24.1 SDK deprecated in favour of @google/genai? What are the current Gemini free-tier rate limits and data-use terms? What model IDs, pricing and tool-use API would a pluggable Claude provider need?

- Why it matters: The AI briefing, Region Dossier and Intel Feed 'analysis' are a core differentiator and a documented OSIRIS weakness (keyword heuristics labelled 'AI'). The prompt must name a supported SDK and model, realistic rate limits, and how grounded context gets passed in. Otherwise the builder may target a deprecated SDK or model.
- Where to look: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/ai/briefing/route.ts (and analyze, overview); https://ai.google.dev/gemini-api/docs/migrate; https://ai.google.dev/gemini-api/docs/rate-limits; https://ai.google.dev/gemini-api/terms; https://www.npmjs.com/package/@google/genai; https://docs.claude.com/en/docs/about-claude/models/overview

### 10. Outside the US, where no free filed route exists, what data can show a 'typical flown path' between two airports? Candidates are the historical ADS-B trace archives: adsb.lol globe_history daily GitHub releases (licence, size, format) and OpenSky Trino historical access terms. Also settle the licence conflicts for the route tables: the VRS standing-data LICENSE in the vradarserver repo versus the CC0 on the adsb.lol mirror, and adsbdb's David Taylor restriction.

- Why it matters: The user asked to see the planned path for specific and generic flights. The agents confirmed there is no free, global source of filed waypoint routes: AeroAPI decodes US fixes only, and FPD is sim-only and returned 502. A licence-clean typical-track overlay built from past traces is the main keyless upgrade over a plain great-circle line. The route-table licences decide whether the builder may bundle or cache the callsign-to-airport index.
- Where to look: https://github.com/adsblol (globe_history_* repos and their releases); https://raw.githubusercontent.com/vradarserver/standing-data/main/LICENSE; https://vrs-standing-data.adsb.lol/LICENSE; https://github.com/mrjackwills/adsbdb#readme; https://opensky-network.org/data/trino; https://api.adsb.lol/docs (routeset POST body shape)
