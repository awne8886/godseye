# OSIRIS public footprint, reception, criticism and comparables
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.

## Summary

OSIRIS (osirisai.live, repo github.com/simplifaisoul/osiris, default branch **master**, MIT) is a Next.js 16 / TypeScript 5 / MapLibre GL JS / Framer Motion / Lucide dashboard deployed on Vercel. It also ships as a Docker image (ghcr.io, about 220 MB Alpine, non-root, CasaOS metadata) and needs Node 20+ and no database. The repo has about 10.3k stars, 2.1k forks, 138 watchers, 326 commits, about 20 open issues and 14 open PRs. That is up from 338 stars on 2026-05-18 and about 8.9k on 2026-09-09. The repo description, the X bio (@soulsimplifai, created 2026-05-14, about 2.7k followers) and a green "$OSIRIS" header button on the live site all promote a Solana pump.fun token (CA ending "[redacted]"). The site's meta tags still say @simplifaisoul, but the rendered header links to x.com/soulsimplifai. There is one tagged release, v5.0.0 (2026-09-28). It opens on the satellite globe (about 19k objects) and flies the camera to the user's IP location, or to a random well-covered city if the IP can't be placed. It also adds the FINGERPRINT username/email/phone search across 462 platforms, alerts pinned to locations with footage, the double-right-click Region Dossier, 3D terrain, Telegram channels labelled by political lean, and security hardening. There is no CHANGELOG.md or ROADMAP.md. /docs holds only screenshots/ and terrain-local-review.md, which documents unusually careful MapLibre terrain engineering: terrain activates at z≥10, the globe switches to a local projection between z7 and z9, pitch is capped at 60°, pixel ratio is capped at 1.5, there is an 8 MiB tile LRU, and a Chromium smoke-test harness runs 603 tests. The live shell shows: a boot splash ("O S I R I S / GLOBAL INTELLIGENCE PLATFORM / ESTABLISHING SECURE CONNECTION..."), a 3D/2D and MAP/SAT strip, a scale bar, a ZULU clock, STATUS, LAYERS and ENTITIES counters, the toolbar (RECON, SPACE, MARKETS, ALERTS, DRAW, ROUTE, SEARCH, ARCGIS, REMOTE), a cursor, location, hover and zoom readout, an animated HUD scanline, and a Discord/X status strip. "Ghost Protocol" is a two-state theme toggle ("core" vs "ghost") with a violet #B388FF accent. "Style Studio" is a live UI-token editor panel with presets, primary and secondary accents, glow strength, and critical/warning/nominal/info signal colours. It also has an on-screen pan/zoom pad toggle, per-layer colours (camera dots, six satellite categories, five aircraft classes), and surface controls for background, panel opacity, border strength, backdrop blur (0–64 px) and corner radius, plus text colours. Themes can be copied or pasted as JSON.

Public reception: OSIRIS was first posted on Reddit (the original thread was not found). It went viral on 2026-05-19 through an X post by @Anubhavhing: 1.30M views, 7.4k likes and a 67 s demo video. That post quoted "10,000+ aircraft on a 3D globe, 2,000+ satellites incl. ISS, 1,400+ CCTV, day/night cycle, SIGINT news aggregator". Hacker News barely noticed it: 6 points, and the one substantive comment was "palantir is not just google earth with flight maps and conflict zones". People praised the "visual wow-factor", having everything in one tab, and that it works without API keys. The criticisms are consistent across sources. Nmap "from your browser" is misleading, because every recon tool is proxied through their server and exposes the operator to abuse and CFAA risk. It is "a LONG way to go in refinement, usability, and actionable intelligence depth". The Palantir label is overclaimed. The same criticisms came from sherafy.com, smartaigist and dev.to.

The strongest "do better" evidence is the GitHub issue tracker. It documents fabricated or synthetic data presented as live intel: cyber-attack arcs invented from a C2 blocklist and cloned to 15 records, random EXFILTRATION-style verbs, a Math.random() escalation probability, GDELT coordinates randomised, the camera viewer faking LIVE status and timestamps, alerts padded with TV channels, the nuclear layer being a static spreadsheet, and a keyword heuristic labelled "AI Analysis". It also documents broken feeds and contract drift: the maritime layer expected ships but the API returned only ports, RECON WHOIS/Threats schemas didn't match the API, the SCM overlay called 127.0.0.1, /api/health always reported operational, the Dutch CCTV source returned 404, a GDELT protocol error, and OpenSky showing only military aircraft on forks. Security issues include SSRF in arcgis, _next/image and cctv stream-status, XSS through setHTML in popups, a hardcoded scanner key with command injection, trust in X-Forwarded-For for rate limits, no CSP/HSTS, and ignoreBuildErrors:true. There is an 896-line god component, pervasive use of `any`, and many issues closed as "invalid" without fixes, which the maintainers answered in a "confrontational" way. Legal and attribution concerns cover GDPR for aggregated UK webcams, missing OSM attribution (opened 2026-09-30) and India boundary depiction.

Comparables the build should beat:
- **God's Eye View** (bilawalsidhu/gods-eye-view): 45.4k stars, MIT, Cesium plus Google Photorealistic 3D Tiles. It has CRT/NVG/FLIR/Noir sensor shaders, cockpit mode, click-to-track with trails, SGP4 orbits with orbit rings, dead-reckoning interpolation, an OpenAI Realtime voice agent, OSRM directions, GTFS transit, and NOAA wind, radar and lightning. This is the "god's eye" reference.
- **World Monitor** (koala73/worldmonitor): 87.6k stars, AGPL-3.0. It pairs a globe.gl/Three.js 3D globe with a deck.gl/MapLibre flat map, runs AI briefs through Ollama/Groq/OpenRouter or Transformers.js in the browser, scores a Country Instability Index for 31 countries, has 6 site variants, a Tauri desktop app, an MCP server and SDKs.
- **Flight-path benchmarks** for the requested airport-to-airport feature: FlightAware draws the filed planned route as a dashed line with waypoints and updates it in flight, and its IFR Route Analyzer lists the routes filed for an origin/destination pair over the last 24 h. Flightradar24's 3D view has Infinite Flight models and liveries, scenery, nearby traffic and trails, plus historical playback.

## Findings

### 0. Repo identity & metrics (verified)

simplifaisoul/osiris: 'Open Source Global Intelligence Platform - Real-Time OSINT Dashboard - A Palantir Alternative - [token address redacted]' (Solana pump.fun contract address in the description). About 10.3k stars, 2.1k forks, 138 watchers, 326 commits on master, about 20 open issues, 14 open PRs. MIT. The README calls it 'Open Source Intelligence & Reconnaissance Integrated System'. OSSInsight shows 10,280 stars and 2,121 forks. Growth markers: 338 stars on 2026-05-18 (explaingit.com) and about 8.9k stars / 1.8k forks on 2026-09-09 (sherafy.com).

Source: https://github.com/simplifaisoul/osiris

### 1. Tech stack (README) (verified)

Next.js 16 (App Router, Turbopack), TypeScript 5, MapLibre GL JS (WebGL), Framer Motion animations, Lucide React icons, custom CSS design system, deployed on the Vercel Edge Network. Also: Vitest (npm test; RUN_LIVE_TESTS=1 or npm run test:live), ESLint (mjs config), PostCSS. Repo dirs: .github/workflows, docs, engine, intel, nginx, public, src, tools. Docker image ghcr.io/simplifaisoul/osiris:latest is a multi-stage Alpine build, about 220 MB, running as non-root, and Docker Compose includes CasaOS one-click metadata. The live docs say Node 20+ and no database.

Source: https://github.com/simplifaisoul/osiris

### 2. README feature table (16 toggleable domains) (verified)

Aviation: commercial/private/military/jets (OpenSky). Maritime: 39 ports and 10 chokepoints (static). CCTV: 17,000+ cameras (TfL, WSDOT, Caltrans, and more; catalogue from bekijkhet.nu). Seismic: USGS M2.5+. Fires: NASA FIRMS. News: 23 global 24/7 broadcasters. Weather: NASA EONET. Space: NOAA SWPC and N2YO. Cyber: NVD CVEs plus a custom scanner. Conflict: 13 static zones. Crypto: BTC/ETH wallet tracing (blockstream.info, Blockscout) with OFAC SDN match. Sanctions: OpenSanctions OFAC mirror. Telegram OSINT: t.me/s/<channel> web-preview scraping with a geoparser covering English, Cyrillic and Arabic place names. Performance claims: '75% reduction in edge requests', 15–30 min polling for stable data, 60fps WebGL, 'viewport-aware' progressive loading (issue #77 disputes the viewport-aware claim).

Source: https://github.com/simplifaisoul/osiris

### 3. README screenshots & live-demo URL (verified)

Three screenshots were added in PR #396 (2026-09-26). (1) Taipei: public traffic cameras streaming on the Night map, one feed open full-size. (2) Seoul: live CCTV in 3D terrain around Namsan Tower with the Cheonggyecheon feed playing. (3) Save an Area: draw a region and OSIRIS finds every camera inside it, exportable as GeoJSON. The README badge links to https://osirislive.app, which returned 502 through the research proxy. The Discord invite in the README (discord.gg/umBykEpb98) differs from the one on the site (discord.gg/EPaFD5FFKf). There is a Patreon; supporters get a '🔴 RedTeam Console' role.

Source: https://github.com/simplifaisoul/osiris

### 4. README vs live keyboard shortcuts conflict (verified)

README: F=flights, E=earthquakes, S=satellites, D=day/night, Esc=close. Live docs: F fullscreen, S share view, L layers, M markets, I intel feed, R reset, ? help, ESC close; docs search opens with ⌘K or /. The README is stale. A replica should use one coherent shortcut map plus a command palette.

Source: https://osirisai.live/docs

### 5. Releases / changelog (verified)

Only one release: v5.0.0 'OSIRIS V5.0' (2026-09-28, commit 7a3daec). Contents: opens on the satellite globe (~19,000 tracked objects) and auto-flies the camera to the user's location (PR #399 falls back to a random well-covered city). A readiness gate before content is revealed. FINGERPRINT replaces INFOSTEALER: public-profile search across 462 platforms by username, email or phone, with streaming results and false-positive checks. Live Alerts anchored to geographic locations with video playback. New cameras: TxDOT, Lithuania, Edmonton; camera catalogues are cached. Region Dossier on double right-click, naming places even in remote areas. 3D terrain with refined camera controls. Telegram sources labelled by political lean. Hardening: ArcGIS proxy restricted, rate limits, Nominatim/OSM compliance, derived data no longer shown as observed. Docker images for amd64 and arm64. CHANGELOG.md and ROADMAP.md return 404.

Source: https://github.com/simplifaisoul/osiris/releases

### 6. Terrain / 3D engineering (docs/terrain-local-review.md) (verified)

Terrain and 3D Buildings are toggles in the DISPLAY section; a bottom view strip selects globe/flat and map/satellite. One MapLibre renderer. Terrain starts at zoom ≥10 after 500 ms of no camera movement and is released below z9.5. The globe switches to a local projection between z7 and z9. Terrarium 256 px DEM, maxzoom 10, exaggeration 1. At most 2 concurrent elevation requests, a 12 s deadline, and an 8 MiB LRU. Pitch capped at 60°; pixel ratio capped at 1.5 while terrain is on. Buildings come from the CARTO source from z14.5. Satellite GPU programs are cached per projection. A smoke harness (tools/preview-smoke.mjs) runs scenarios: startup, zoom, terrain, terrain-camera, mobile, recovery, imagery, buildings, satellites. As of 2026-09-08: Next 16.3.4, 603 tests passing.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/docs/terrain-local-review.md

### 7. Live site shell / HUD text (verified)

Homepage text in visual order: boot splash 'V5.0 / O S I R I S / GLOBAL INTELLIGENCE PLATFORM / ESTABLISHING SECURE CONNECTION...'. View strip '3D 2D MAP SAT'. Scale bar '1000 km'. Wordmark 'OSIRIS / OPEN SOURCE INTELLIGENCE / REAL-TIME GLOBAL MONITORING · FLIGHTS · MARITIME · SATELLITES · CCTV · WEATHER · CYBER THREATS'. 'ZULU --:--:--Z' clock. 'STATUS: CONNECTING'. '12 LAYERS', '0 ENTITIES', 'V5.0', a green (#14F195, Solana colour) '$OSIRIS' button and a SUPPORT menu (merch was folded into Support in PR #389). Toolbar: RECON, SPACE, MARKETS, ALERTS, DRAW, ROUTE, SEARCH, ARCGIS, REMOTE. Readout: CURSOR / LOCATION / HOVER MAP / ZOOM 2.5. Links to Docs and Privacy, an 'ONLINE' indicator, and the hint 'Press ? for shortcuts · F fullscreen · R reset view'. Meta: theme-color #D4AF37, tile colour #06060C, color-scheme dark; the status strip has an animated 'hud-scanline' and a --cyan-primary token. The JSON-LD featureList includes an 'Interactive 3D globe with day/night cycle', 'SIGINT news aggregation feed', 'GPS jamming detection' and 'Region intelligence dossier reports'.

Source: https://osirisai.live/

### 8. Ghost Protocol (verified from production JS bundle) (verified)

A binary theme toggle at the bottom of the left rail with the title 'Ghost Protocol'. It switches the theme state between 'core' and 'ghost'. When active the icon turns violet #B388FF with a drop-shadow glow of rgba(179,136,255,0.5) and background rgba(179,136,255,0.1). The rail itself slides in from x:-60 with a Framer spring (damping 30, stiffness 200, delay 0.25), is 48 px wide, and has a rgba(0,0,0,0.1) background. The fork carbon-evolution/osiris describes 'Ghost Protocol' as the dark palette and uses a Google-Maps-style light theme (CartoDB Voyager, Google blue) as its default.

Source: https://osirisai.live/_next/static/chunks/39v3nav0fooxj.js

### 9. Style Studio (verified from production JS bundle) (verified)

A dialog labelled 'Style Studio' with the subtitle 'Live UI tokens'. On desktop it is a 340 px panel at left:58px, bottom:6, max-h min(78vh,720px); on mobile it is a sheet. Background rgba(6,4,14,0.96), backdrop-filter blur(28px) saturate(1.2), shadow 0 16px 48px rgba(0,0,0,.7), spring animation (stiffness 320, damping 30). Header buttons: paste theme JSON from the clipboard, copy theme as JSON, reset to active theme, close. Sections: Preset (3-column grid of accent swatches). Accent (primary, secondary, glow 0–100%). Signal (critical, warning, nominal, info colours). Map controls (on-screen pan/zoom pad on/off). Map layers: camera dot and label colour; satellite colours for comms, military, navigation, earth obs, science and other (the default keeps each satellite's mission colour); aircraft colours for civil, private, government, military and unknown. Surface (background colour, panel opacity 20–100%, border strength 0–60%, backdrop blur 0–64 px, corner radius 0–2.5x). Text colours. Layer rows show a label, an optional description and a live count formatted with toLocaleString in a tabular-nums mono font.

Source: https://osirisai.live/_next/static/chunks/39v3nav0fooxj.js

### 10. Live docs: interface guide & API conventions (verified)

The docs are at /docs: a three-column layout with ⌘K search, a 'Launch Map' button, and a 'Send request' button on every GET endpoint. They advertise '57 endpoints, no key required', '20+ live feeds', '0 keys required'. Panels are toggles, not destinations: Layer Panel (left rail with the theme selector), RECON Toolkit, Intel Feed, Region Dossier (double right-click), Entity Graph (expand one node at a time), and Status Bar (community and docs links plus a ticker of prices and significant quakes). Conventions: GET returns JSON; errors come as {error, detail}; Cache-Control is 45–60 s for fast feeds and up to 1 day for static data; the three AI POST endpoints are limited to 5 req/min per IP; timestamps are ISO-8601 UTC. /api/stats returns about 100 bytes of counters instead of about 10 MB of GeoJSON. The /api/news risk_score is a keyword count and its coordinates are preset country anchors (the docs admit this). /api/cyber-attacks is described as 'blocklist entries, not observed attacks'.

Source: https://osirisai.live/docs

### 11. Author / social footprint (verified)

GitHub simplifaisoul: 'Full-Stack Engineer · OSINT Builder · AI Infrastructure Architect', 412 followers, other projects Draco AI and Simplifa-i (an AI automation agency), Instagram osirisai.live, portfolio simplifai-1.com. X account @soulsimplifai ('Osirisai.live'): joined 2026-05-14, 2,716 followers, 313 posts; the bio contains the token CA. The site's meta twitter:site is still @simplifaisoul.

Source: https://github.com/simplifaisoul

### 12. Viral moment (X) (verified)

@Anubhavhing on 2026-05-19: 'Someone just dropped Open Source Palantir on reddit named Osiris', listing 10,000+ aircraft on a 3D globe, 2,000+ satellites incl. ISS, 1,400+ CCTV, quakes, wildfires, nuclear sites, severe weather, 'Nmap port scanning from the browser', DNS, WHOIS, CT, BGP/ASN, IP reputation, a '3D interactive globe with day/night cycle' and a 'SIGINT news aggregator'. 1,303,432 views, 7,361 likes, 1,038 reposts, 162 replies, with a 67 s demo video at 3018x1654. Follow-ups: @DivyanshT91162 ('feels… like something out of a surveillance simulation') and @CurieuxExplorer ('beyond the visual wow-factor, it still has a LONG way to go in refinement, usability, and actionable intelligence depth').

Source: https://x.com/Anubhavhing/status/2056701575431884986

### 13. Criticism: 'Nmap from your browser' is misleading (verified)

@suavecito585 on 2026-05-20: 'You cannot run Nmap from a browser. JS has no raw sockets. Every one of those 10 recon tools is proxied through their server. So they've shipped a free, unauthenticated vuln scanner where strangers scan targets they don't own… CFAA countdown timer. Slick globe. Someone else's liability. The demo is real. The from-your-browser part is a lie.'

Source: https://x.com/suavecito585/status/2056998508603883946

### 14. Hacker News reception (verified)

'Osiris – An open-source Palantir alternative for global intelligence' by Shmrad, 2026-05-16: 6 points, 2 comments. Ecys: 'palantir is not just google earth with flight maps and conflict zones'. The submitter replied, suggesting Recon Tools / Vuln Sweep. A second submission, 'Osint Aggregation Platform' (2026-09-09), got 1 point.

Source: https://news.ycombinator.com/item?id=48161829

### 15. Independent audit (sherafy.com, 2026-09-09) (verified)

Verdict 7.5/10, 'qualified green light'. Positives: data aggregation works (USGS, FIRMS, OpenSky, sanctions), and the scanner has been hardened (target validation, internal IPs blocked, rate limits). Negatives: country risk comes from a hand-written base-risk table; the 'AI Analysis' label is shown on keyword heuristics (war/missile/bomb); conflict dots use RSS keyword matching with preset coordinates and deliberate offsets; geomagnetic status defaults to 'Quiet' when data is missing, which gives false negatives; the site IP-geolocates visitors via ipapi.co, freeipapi and ip-api and centres the map on them within about 3 s with no clear privacy notice; email lookups are forwarded to XposedOrNot. It cites a May 2026 audit by James Sawyer (Math.random escalation probabilities, SSRF) and maintainer responses that were 'unusually confrontational', with issues closed without fixes. 'Aggregation is not verification.' The token is flagged as a separate question.

Source: https://sherafy.com/osiris-ai-osint-review-safe-legit/

### 16. Other articles (verified)

smartaigist.com (2026-09-13, by Babatunde): 'a glowing world map tracking planes, earthquakes, and news'. It praises the single interface and an AI analyst chat that handles cross-layer questions ('any military flights near active conflict zones?'). Criticisms: conflict zones are less reliable and update less often, the Palantir comparison is misleading, self-hosting needs Docker and terminal skills, and scanning carries legal risk. dev.to (2026-05-28) is a promotional repost with no criticism. The Hackers-Arise tutorial exists but is behind a Cloudflare challenge.

Source: https://smartaigist.com/osiris-ai-live/

### 17. GitHub issues: fabricated / synthetic data (the core 'do better' list) (verified)

#347: the cyber-attack feed invents attacker origins from a hardcoded malware-family table (e.g. Emotet mapped to Moscow with Math.random jitter), clones one C2 record into 15 arcs, and assigns random EXFILTRATION / CREDENTIAL HARVEST / LATERAL MOVE verbs under an abuse.ch label. #144: GDELT coordinates randomised. #96: inferOrigin() assigns nation-state attribution by bounding box, labelled GDELT_LIVE_OSINT. #79: the camera viewer fakes LIVE status and timestamps from image load and the client clock. #78: Live Alerts padded with TV-channel entries. #74: the 'real-time' infrastructure layer is a hardcoded nuclear spreadsheet. #68: the balloon tracker fabricated SondeHub telemetry and 'unknown' objects. #70: company intel mixed SEC data with fabricated emails and LinkedIn URLs. #136: the SEO '10,000+ aircraft' claim isn't guaranteed. #76: protests labelled as 'conflict'.

Source: https://github.com/simplifaisoul/osiris/issues?page=7&q=is%3Aissue

### 18. GitHub issues: broken features / contract drift (verified)

#122: the maritime frontend expects maritime_ships but the API returned only ports and chokepoints. #121 and #120: the RECON WHOIS and Threats tabs don't match their API schemas, giving blank or false-safe output. #72: VULN SCAN is 'dead UI theater' because the backend forbids type=vuln. #71/#73: six RECON tools need an undocumented private scanner backend. #119: the README advertises N2YO but the code uses only Celestrak. #130: markets fallbacks don't exist. #129/#128: removed radiation and balloon layers are still wired in. #361 (open): the SCM supplier overlay's fire and conflict signals call http://127.0.0.1:3000, so they are dead on Vercel. #362 (open): /api/health always reports operational. #386: OpenSky showed only military aircraft on a Vercel fork. #318: GDELT ERR_INVALID_PROTOCOL. #306: the Dutch CCTV source returned 404. #75: EONET non-point geometries dropped. #124: the exchange ticker ignores holidays. #123: sentinel defaults a missing lat/lng to 0,0. #115: a 4-step sequential dossier waterfall with a 23 s worst case. #127: the dossier reverse-geocodes twice. #210: search bar missing on desktop. PRs #402 and #403 (2026-09-28/29) fixed a CCTV catalogue 'rebuild storm' that kept a third of cameras off the map.

Source: https://github.com/simplifaisoul/osiris/issues?page=5&q=is%3Aissue

### 19. GitHub issues: security & code quality (verified)

#348: /api/arcgis was an unrestricted SSRF primitive (fixed in PR #385). #243: /_next/image accepted any HTTPS host (SSRF plus a vulnerable sharp). #156: CCTV stream-status SSRF. #242/#150/#125: rate limiters trust X-Forwarded-For. #95: popup XSS via unsanitised .setHTML(). #104: no CSP, HSTS, XFO or nosniff headers. #101/#100: hardcoded scanner key '[redacted]', wildcard CORS, and OS command injection. #102: Tailscale IP hardcoded and SCANNER_KEY sent in the query string. #94/#69: 'conflict simulator auth' used a NEXT_PUBLIC token. #97: ignoreBuildErrors:true. #146: OsirisMap.tsx is an 896-line god component. #147/#148: pervasive `any` and no shared typed API contracts. #153: silent exception swallowing. #383: /api/ai/overview was not rate-limited (fixed in PR #384). #364/#363 (open): Tor-exit and country-risk checks still use substring matching. Many were closed as 'invalid' on 2026-05-21, and later 'regression' issues say fixes never landed.

Source: https://github.com/simplifaisoul/osiris/issues?page=6&q=is%3Aissue

### 20. GitHub issues: legal / attribution / geopolitics (verified)

#298: an open question on whether aggregating UK council webcams needs its own GDPR basis (purpose mismatch, audience scale, an Art. 14 takedown notice). #406 (opened 2026-09-30): OpenStreetMap attribution appears to be missing. #316 (open): the CARTO/OSM basemap doesn't reflect India's official northern boundaries. #381: Nominatim use brought into line with its usage policy. Requests for more cameras: Sweden (PR #404 added 837 Trafikverket cameras and 48 CamStreamer streams), NYC (#405), Spain DGT (#276), Istanbul IBB (#194). Rejected as 'not planned': NASA Black Marble night lights (#197), Eurostat/OECD subnational data (#196), WHO GHO (#195), custom LLM providers (#188).

Source: https://github.com/simplifaisoul/osiris/issues?page=2&q=is%3Aissue

### 21. Recent PR trail (Sept 2026) (verified)

#404: Sweden cameras. #403: CCTV region backoff of 5 min. #402: catalogue rebuild storm fix. #398/#399/#400: V5.0 opens on the satellite globe with random-city fallback. #394: FINGERPRINT. #393: ArcGIS results filter. #392: dossier on double right-click. #391 (open): DigitalDon token analysis in Markets→Crypto→DeFi. #390: 'satellites that come back, search that looks nearby'. #389: Merch folded into Support. #387: 'a map that fills the screen'. #380: Live Alerts pinned to places with footage. #378: Lithuania and Edmonton, 652 cameras. #376: alerts rebuilt so posts are no longer dated by fetch time. #382: ark.intel.source.v1 source manifests. #379 (open): compose fix for an external umami network.

Source: https://github.com/simplifaisoul/osiris/pulls?q=is%3Apr

### 22. Notable fork: carbon-evolution/osiris (verified)

Adds: live AIS vessels drawn as MarineTraffic-style directional arrows; a global SST and land-temperature field with a °C legend; CISA KEV, Spamhaus DROP, Tor exit nodes and MITRE ATT&CK; a 20-tool recon kit whose results drop verdict-coloured markers on the map (red malicious, cyan clean); a Gemini 2.5 Flash analyst grounded with Google Search; a force-directed entity graph (aircraft, vessels, companies, sanctions, IPs, APTs, CVEs); a Redis and Postgres cache-first layer across 42 routes; marker clustering; a real-time day/night terminator; glassmorphism; a light theme by default with Ghost Protocol dark. Documented limits: GDELT GEO intermittently down, Indonesian CCTV geo-restricted, ipapi.co capped at 1k/day, Yahoo Finance fallback goes stale.

Source: https://github.com/carbon-evolution/osiris

### 23. Mirror / clone ecosystem (verified)

Many forks and rebrands exist: enzg/osiris-live, ZEZE1020/osiris-ai, inde5media/osiris-Palantir, vsrc/simplifaisoul-osiris, Guo-astro/osiris. A full mirror runs at spacetross.com (same title and meta), and there is a SourceForge mirror.

Source: https://spacetross.com/

### 24. YouTube coverage (verified)

'This Free Tool Went Viral as "Open Source Palantir" — I Tested It So You Don't Have To' (channel stuffy24). 'OSIRIS | Open Source Global Intelligence Platform | Real-Time OSINT Dashboard' (TechnocracyHub). 'OSIRIS open source inteligence' (Kind Spirit Technology). 'OSIRIS Platform Breakdown | AI + OSINT + Reconnaissance' (6wAkuYKNlog). Titles were verified via oEmbed; the video content was not reviewed.

Source: https://www.youtube.com/watch?v=uayYPAW4C94

### 25. Comparable: God's Eye View (bilawalsidhu/gods-eye-view) — the 'god's eye' benchmark (verified)

45.4k stars, 9.3k forks, MIT, #1 on GitHub Trending in Aug 2026. Stack: vanilla JS, CesiumJS, Vite, Google Photorealistic 3D Tiles or Cesium ion, with Esri World Imagery as fallback. Visual modes on keys 1–7: CRT, NVG, FLIR, Noir, Snow. Also a detection mesh with bounding boxes and a tactical HUD (H), cockpit mode that rides an aircraft with terrain collision (C), and click-to-track with trails. A 250 km contact roster, SGP4 propagation with GMST alignment and orbit rings, and 15–30 s feeds smoothed by dead reckoning. An OpenAI Realtime voice agent with 29 tools ('Measure LAX to DFW', 'When does ISS pass?'). 19 layers: OpenSky and adsb.lol (incl. military), AISStream, CelesTrak, USGS, TomTom traffic, about 3,600 CCTV, ALPR from OSM, Radio Browser, GTFS-RT transit, GBFS bikeshare, OSRM directions, FIRMS, Launch Library 2, OSM military sites, GFS/ECMWF wind, NOAA radar, clouds and lightning, and NHC cyclone tracks. Principle: 'events, assets, infrastructure are queryable; individuals are not'. Cold start about 1.86 s.

Source: https://github.com/bilawalsidhu/gods-eye-view

### 26. Comparable: World Monitor (koala73/worldmonitor, worldmonitor.app) (verified)

87.6k stars, 13.4k forks, AGPL-3.0. Two map engines: a 3D globe (globe.gl/Three.js) and a flat WebGL map (deck.gl plus MapLibre) sharing one layer catalogue. AI-synthesised news briefs with cross-stream correlation. Local or alternative AI via Ollama, Groq, OpenRouter, or Transformers.js in the browser. Country Instability Index v8 for 31 tier-1 countries with 24 h movement. Provider attribution and freshness tracking on data. Six site variants (world, tech, finance, commodity, happy, energy). Tauri 2 desktop apps, PWA, MCP server, REST, CLI, and Python/Ruby/Go SDKs. Site tagline: 'By the time it's news, you already knew.' It does better than OSIRIS on analytic synthesis, provenance and freshness, and multi-engine rendering.

Source: https://github.com/koala73/worldmonitor

### 27. Comparable: FlightAware (planned-route benchmark for the airport-to-airport feature) (verified)

Maps show the filed planned route as a dashed line with waypoint markers (navaids and intersections) and update it when the flight plan changes (announced 2009-09-17). The IFR Route Analyzer takes an origin and destination airport code and lists routes filed for that pair in the last 24 h, with altitude and aircraft type (login required). This is the reference UX for the 'planned flight path by airport code' feature.

Source: https://discussions.flightaware.com/t/planned-route-now-displayed-on-maps-for-airborne-flights/8376

### 28. Comparable: Flightradar24 (verified)

3D view since October 2023 on web, Android and iOS: select an aircraft, then '3D view'. Uses Infinite Flight's ultra-realistic models and airline liveries, with scenery and nearby traffic. Free users get 3 sessions. The aircraft trail changes colour with altitude. Also AR View and historical playback. Better than OSIRIS on aircraft realism, trails and playback.

Source: https://support.fr24.com/support/solutions/articles/3000123424-the-new-flightradar24-3d-view

### 29. Comparable: Liveuamap (verified)

Human-verified event mapping: AI crawlers filter posts and analysts fact-check them. Covers 30+ regional maps with a typed icon taxonomy (drones, explosions, police actions, etc.), filters by type, place and time, a chronological archive, and polygon and distance tools. Pro costs $150/mo; the API costs $150–$1,000+/mo. Better than OSIRIS on the provenance and precision of conflict events, where OSIRIS uses keyword matching and preset coordinates.

Source: https://bellingcat.gitbook.io/toolkit/more/all-tools/liveuamap

### 30. Comparable: Windy / Zoom Earth (UNVERIFIED)

Windy: 50+ animated weather layers with wind particles, global radar, a satellite composite from NOAA, EUMETSAT and Himawari every 5–15 min, and ECMWF/GFS model comparison (search snippet; windy.com not fetched). Zoom Earth: geostationary imagery from GOES, Himawari and Meteosat every 10 min, twice-daily HD imagery from Aqua and Terra, Doppler radar with nowcasting, hurricane tracks from NHC, JTWC, NRL and IBTrACS, and a FIRMS fire overlay combined with GeoColor smoke. Both are far ahead of OSIRIS's EONET point markers on animated weather and imagery.

Source: https://zoom.earth/

### 31. Comparable: Cloudflare Radar (verified)

Traffic anomalies that are automatically detected and manually verified. An Outage Center map with outage types (nationwide, network, regional, platform). BGP hijack events with hijacker and victim ASNs, prefixes and a confidence level. Layer-7 attack origin and target breakdowns, all through a public API and an MCP server. Better than OSIRIS on real (not synthetic) internet-disruption and attack telemetry.

Source: https://developers.cloudflare.com/api/resources/radar/subresources/bgp/subresources/hijacks/

### 32. Comparable: Kaspersky Cybermap (verified)

A rotating 3D globe with a 2D toggle, black or white colour schemes, and multiple languages. Streams are colour-coded by detection type (OAS, ODS, MAV, WAV, IDS, VUL, KAS, RMW codes present in the page). Running totals reset at midnight GMT. The cinematic benchmark for animated attack arcs, with arcs backed by real detections rather than invented ones.

Source: https://cybermap.kaspersky.com/

### 33. Comparable: MarineTraffic (UNVERIFIED)

350,000+ vessels a day from terrestrial and satellite AIS. Past track coloured by speed (1 day logged-out, 3 days logged-in, more on paid plans). Density-map heat layers (Enterprise). Reported destination and ETA. 21,000+ ports. Route Forecast showing the predicted route with the weather on the way (Mobile Pro). Better than OSIRIS, whose maritime layer was ports and chokepoints only (#122).

Source: https://support.marinetraffic.com/en/articles/9552735-display-density-maps-on-the-live-map

### 34. Comparable: GDELT (as data source/tool) (UNVERIFIED)

The GKG processes world news every 15 minutes in 65 languages, extracting people, organisations, locations, themes and tone. The GEO 2.0 API builds realtime maps; the DOC 2.0 API searches a rolling 3-month window. OSIRIS's GDELT route had randomised coordinates (#144) and protocol errors (#318). A replica should use the GEO/DOC APIs deterministically and show tone and theme.

Source: https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/

### 35. Other newer OSINT map comparables (verified)

IntelMap (intelmap.watch): news, hazards, cyber, internet routing, aircraft, vessels and maritime security. situation.watch: flights, ships, conflicts, news. PizzINT Polyglobe (pizzint.watch/polyglobe): a live OSINT conflict globe. WarWatch (warwatchlive.com): a live war map. VrushankPatel/godseye: a frontend-only globe with a tactical HUD. Titles and meta for intelmap and situation.watch were verified; the others come from search snippets only.

Source: https://intelmap.watch/

## Recommendations

- Parity set to replicate exactly. Boot splash ('ESTABLISHING SECURE CONNECTION…'). A gold #D4AF37 on #06060C monospace HUD with an animated scanline. ZULU clock, STATUS, LAYERS and ENTITIES counters. A 3D/2D plus MAP/SAT view strip and scale bar. A cursor lat/lon, hover place and zoom readout. A 48 px left layer rail sliding in on a spring (damping 30, stiffness 200), grouped AVIATION, MARITIME, NATURAL HAZARDS, NETWORK INTEL, SPACE TRACKING, SURVEILLANCE, THREATS & INTEL, SDK and DISPLAY, with live per-layer counts in tabular-nums. The toolbar (RECON, SPACE, MARKETS, ALERTS, DRAW, ROUTE, SEARCH, ARCGIS, REMOTE). Region Dossier on double right-click, Entity Graph, Intel Feed, and a status ticker. Shortcuts F, S, L, M, I, R, ?, ESC plus ⌘K. On first load, open on the satellite globe and fly to the visitor's location (with consent) or to a well-covered city.
- Replicate 'Ghost Protocol' as a theme mode (core vs ghost, violet #B388FF accent). Replicate 'Style Studio' as a live design-token editor: presets; primary and secondary accent; glow; critical, warning, nominal and info colours; pan/zoom pad toggle; per-category colours for cameras, six satellite classes and five aircraft classes; background, panel opacity, border strength, blur 0–64 px and corner radius; text colours; copy and paste theme JSON; reset. Go beyond it with God's-Eye-style sensor post-processing modes (CRT, NVG, FLIR/thermal, Noir) on number keys 1–7.
- Beat OSIRIS visually. Add the photorealistic 3D-tiles path that God's Eye View has (CesiumJS plus Google Photorealistic 3D Tiles or Cesium ion, with a keyless MapLibre globe fallback). Add an accurate real-time day/night terminator with city lights, an atmosphere, and click-to-track with trails. Colour aircraft trails by altitude, the way FR24 does. Add SGP4-propagated satellite orbit rings and footprints, and dead-reckoning interpolation between feed polls so entities glide instead of jumping. Add FR24-style 3D follow and cockpit cameras.
- Planned flight path feature. Accept an IATA or ICAO origin and destination (e.g. JFK→LHR / KJFK→EGLL) or a place name resolved to its nearest airports. Always draw the great-circle geodesic as a dashed line with distance, initial bearing and estimated block time. When available, overlay filed or typical routes the way FlightAware does (dashed planned route with waypoint markers, updated in flight) and list recent flights on that pair (the IFR Route Analyzer pattern). For a specific flight number or callsign, show the flown ADS-B track (solid, coloured by altitude) against the planned route (dashed) and the remaining path to the destination. Label clearly what is 'filed', what is 'typical' and what is 'great-circle estimate'.
- Honesty rule. It is OSIRIS's biggest criticised weakness, so encode it in the prompt. Never fabricate, randomise, jitter, clone or pad data. Never label heuristics as 'AI'. Never show LIVE status or timestamps that were not observed. Keep observation time separate from fetch time. Mark static reference layers (nuclear sites, chokepoints, conflict polygons) as 'reference', not 'live'. Attack arcs only come from real, attributed telemetry; otherwise render blocklist indicators as points labelled 'indicator'. Every entity popup shows its source, the observed-at time and a freshness badge (World Monitor-style provenance).
- Reliability rule. Use shared typed API contracts (e.g. zod schemas shared between the route and UI) to prevent the maritime, WHOIS and Threats drift OSIRIS had. Give each feed its own timeout, backoff and circuit breaker, and back off failed regions for 5 minutes. /api/health must report the real status of each upstream. No loopback self-fetches between routes; share modules instead. Viewport-aware loading and clustering for real. Poll no faster than the Cache-Control TTL. Surface degraded or empty feeds in the UI rather than silently showing 'Quiet' or 'safe'.
- Security rule. SSRF allowlists on every proxy route (tiles, CCTV streams, ArcGIS, next/image remotePatterns). Sanitise all popup HTML or render popups with React, never setHTML with upstream strings. CSP, HSTS, X-Frame-Options and nosniff headers. Rate limits keyed on the platform-verified client IP, not raw X-Forwarded-For. No secrets in NEXT_PUBLIC variables or query strings. Keep ignoreBuildErrors off. Split the map into layer modules rather than one god component. Active scanning is either left out or restricted to targets the user owns and has verified, with the proxying disclosed honestly. Do not claim 'Nmap in your browser'.
- Legal and attribution rule. Always show OSM, CARTO, Esri and Google attribution. Follow the Nominatim usage policy, or proxy and cache geocoding on the server. Add a privacy notice covering IP geolocation, and ask for consent before geolocating. Provide camera takedown and GDPR contact paths. Adopt God's Eye View's line: events, assets and infrastructure are queryable, private individuals are not (so no people-search 'FINGERPRINT' clone). Keep any crypto token or merch promotion out of the product.
- Borrow World Monitor's analytic layer. Offer AI briefs with a pluggable provider (Gemini, Claude, Ollama or in-browser) and rate limits, a documented country-instability or risk index with its method shown (not a hand-typed table), cross-stream correlation alerts, and optional variants or presets (world, cyber, maritime, aviation).
- Borrow the best from specialists. Liveuamap: a typed event-icon taxonomy plus a time slider and archive. Windy and Zoom Earth: animated wind particles, radar nowcast, near-real-time geostationary imagery and cyclone cones. Cloudflare Radar: real outage, BGP-hijack and L7 attack layers from its public API. MarineTraffic: AIS arrows with speed-coloured past tracks, density heatmaps and destination/ETA. Kaspersky Cybermap: cinematic but real arc animation with daily counters.
- Tell Opus to use sub-agents in parallel workstreams. (1) Design system and HUD shell (tokens, Style Studio, Ghost Protocol, sensor shaders). (2) Map engine (MapLibre globe, terrain, day/night, optional Cesium 3D-tiles mode, entity layers with interpolation and clustering). (3) Data-route agents, one per domain group: aviation and space; hazards and weather; maritime; cyber and network; geopolitical and news; CCTV. Each writes typed contracts and tests. (4) The flight-route planner (airport DB from OurAirports, geodesic math, ADS-B track overlay). (5) The OSINT toolkit (passive lookups only). (6) The AI analyst. (7) A security, legal and a11y reviewer. (8) A QA agent running Playwright smoke scenarios (startup, zoom, terrain, mobile, recovery, satellites), modelled on OSIRIS's tools/preview-smoke.mjs.

## Gaps (not verified)

- I could not find the original Reddit post that started the viral wave (the viral tweet only cites 'dropped on reddit'). Reddit search JSON returned nothing, and site:reddit.com search returned no match.
- Hackers-Arise's 'Using Osiris for Global Intelligence' article is behind a Cloudflare challenge. Its content is UNVERIFIED.
- YouTube review contents are UNVERIFIED (stuffy24 'I Tested It So You Don't Have To', TechnocracyHub, Kind Spirit Technology, 6wAkuYKNlog). Only titles and channels were confirmed via oEmbed. The 67 s video in the viral X post was not viewed.
- The GitHub REST API and MCP were blocked for simplifaisoul/osiris in this session. Per-issue comment counts, maintainer replies, a contributor count, and a dated star-history series were not retrieved. OSSInsight gave only totals.
- No Product Hunt listing was found. It is UNVERIFIED whether one exists.
- 'Ravenwatch' could not be found as an OSINT or intelligence map product. The nearest match is qeeqbox/raven, a D3 cyber threat map. Treat it as UNVERIFIED or nonexistent.
- osirislive.app (the README's demo badge) returned a proxy 502, so its relationship to osirisai.live is UNVERIFIED.
- Some details come from search snippets rather than fetched pages: the Flightradar24 Enhanced 3D blog (403), windy.com and zoom.earth feature lists, MarineTraffic Route Forecast, and GDELT API specifics. Those findings are marked verified=false.
- The exact left-rail layer list with per-layer descriptions and keys was not extracted from the lazily loaded JS chunks; I relied on the known context for category names.
- The token's ($OSIRIS) market data and on-chain details were not researched; they are out of scope.
