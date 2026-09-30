# Current stack versions, breaking changes and visual upgrade research
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.

## Summary

Verified as of 2026-09-30. OSIRIS itself runs on next 16.3.4, react 19.2.4, maplibre-gl 6.7.0, react-map-gl ^8.1.1, framer-motion ^12, lightweight-charts, react-force-graph-2d, hls.js, satellite.js ^7, tailwind 4, eslint 9, typescript ^5 and vitest ^2. It does not use deck.gl. Adding deck.gl GPU layers (trips, great-circle arcs, H3/hexagon, icons at 20k+ points) is the clearest technical way to beat it. The current stack is maplibre-gl 6.11.2, deck.gl 9.4.0 (new @deck.gl/maplibre MapLibreOverlay, interleaved), react-map-gl 8.1.3 via 'react-map-gl/maplibre', next 16.3.7, react 19.3.0, tailwindcss 4.3.3, shadcn 4.21.0, motion 13.4.6, zustand 5.0.15, @tanstack/react-query 5.104.0, satellite.js 7.1.0 (WASM bulk propagation), cmdk 1.1.1, echarts 6.1.0, playwright 1.63.0, vitest 5.0.3, eslint 10.11.0 and typescript 7.0.2. MapLibre added globe in v5 (the v5.0.0 release date is from npm; the changelog entry that names globe was not read). v6 is ESM-only, requires WebGL2, and in Next.js/Turbopack the worker and shared .mjs files must be copied into /public and passed to setWorkerUrl. OSIRIS already does this in tools/prepare-map-worker.mjs.

Three version clashes need handling. First, TypeScript 7 has no programmatic API, so typescript-eslint 8.71 still needs typescript <6.1.0. Next 16.3.7 runs the local tsc CLI by default, so next build works with TS7, but lint needs TS 6.0.x, either pinned or aliased. Second, ESLint 10 dropped eslintrc entirely. Third, CelesTrak ran out of 5-digit catalog numbers on 2026-07-11, so satellites must be ingested as OMM/JSON and parsed with json2satrec, not TLE. Also, Chrome no longer falls back to SwiftShader WebGL automatically, so headless Playwright visual tests of the map need --enable-unsafe-swiftshader or a GPU.

For a zero-cost dark intel look with clean licensing, the best combination is:
- OpenFreeMap vector tiles, styles 'dark' or 'fiord' (no key, no limits, commercial OK, attribution required), restyled to the gold-on-black palette.
- NASA GIBS WMTS rasters, no key and CORS open: VIIRS_Black_Marble for night lights, daily VIIRS true colour, BlueMarble_NextGeneration, Reference_Labels.
- Esri World Imagery for a high-resolution satellite toggle (attribution required; covered by the Esri Master License Agreement).
- AWS Terrarium DEM for terrain.

Avoid these as defaults:
- CARTO: terms updated 2026-09-29 require an API key and forbid server-side proxying or caching.
- Stadia and MapTiler free tiers: non-commercial only.
- EOX Sentinel-2 cloudless: CC BY-NC-SA, commercial use needs a paid licence.
- Protomaps hosted API: non-commercial only. Self-hosting the ~120 GB PMTiles planet file is fine.

For the requested flight-route feature: OurAirports (public domain, nightly CSV with ICAO/IATA codes and coordinates) resolves airport codes. adsbdb.com gives origin and destination for a callsign with no key (tested BAW117 = EGLL to KJFK). deck.gl ArcLayer with greatCircle:true draws the planned great-circle path. OpenSky departure/arrival endpoints need OAuth2 and only cover the previous day. No free global source of filed waypoint routes was verified.

## Findings

### 0. OSIRIS actual dependency baseline (what to beat) (verified)

The package.json on the master branch (main returns 404) lists: next 16.3.4, react/react-dom 19.2.4, maplibre-gl 6.7.0 (pinned), react-map-gl ^8.1.1, framer-motion ^12.38.0, lightweight-charts ^5.2.0 (markets), react-force-graph-2d ^1.29.1 (Entity Graph), hls.js ^1.6.16 (CCTV/live streams), satellite.js ^7.0.0, @google/generative-ai ^0.24.1, rss-parser, ws, sharp ^0.35.4, google-libphonenumber, lucide-react ^1.14, @vercel/analytics. Dev dependencies: tailwindcss ^4 with @tailwindcss/postcss, eslint ^9, eslint-config-next 16.3.4, typescript ^5, vitest ^2.1.9, @types/web-bluetooth. The predev and prebuild scripts both run tools/prepare-map-worker.mjs, which matches the MapLibre v6 Turbopack worker workaround. deck.gl, three, Cesium, Zustand and TanStack Query are all absent.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/package.json

### 1. MapLibre GL JS version and globe history (verified)

The latest is maplibre-gl 6.11.2, published 2026-09-24. Other npm dates: 5.0.0 on 2024-12-31 and 6.0.0 on 2026-07-22. The v1 dist-tag is 1.15.3. Globe arrived with v5; deck.gl 9.1 notes say its GlobeView was updated 'matching MapLibre v5 globe camera'. The MapLibre changelog entry that names globe was not read directly.

Source: https://registry.npmjs.org/maplibre-gl

### 2. MapLibre globe API (verified)

Runtime switch: map.setProjection({ type: 'globe' }), called inside a 'style.load' listener, as in the official example. In the style it can be set as "projection": {"type":"globe"}. The projection type accepts expressions, for example ["interpolate",["linear"],["zoom"],10,"vertical-perspective",12,"mercator"] to morph from globe to flat as the user zooms. Since v6.1.0, global-state expressions work in sky.*, light.* and projection.type, which lets one global-state flag drive a 2D/3D toggle.

Source: https://maplibre.org/maplibre-gl-js/docs/examples/display-a-globe-with-a-vector-map/

### 3. MapLibre sky, atmosphere and light (verified)

Sky properties and defaults: sky-color #88C6FC, horizon-color #ffffff, fog-color #ffffff (requires 3D terrain), fog-ground-blend 0.5, horizon-fog-blend 0.8, sky-horizon-blend 0.8, atmosphere-blend 0.8 ('best to interpolate this expression when using globe projection'). All are interpolatable and transitionable. The official atmosphere example uses 'sky': {'atmosphere-blend': ['interpolate',['linear'],['zoom'],0,1,5,1,7,0]} and 'light': {'anchor':'map','position':[1.5,90,80]}, with an EOX s2cloudless-2020 raster. Changelog: 6.10.0 shows the sky in globe view, fading out with altitude. 6.11.0 fades the globe atmosphere in with camera altitude. 6.0 added the terrainSkirtLength option.

Source: https://maplibre.org/maplibre-style-spec/sky/

### 4. MapLibre v6 breaking changes (verified)

v6 is ESM-only (maplibre-gl.mjs plus maplibre-gl-worker.mjs and maplibre-gl-shared.mjs). The UMD, CSP and CJS builds are gone; require() fails with ERR_PACKAGE_PATH_NOT_EXPORTED. Replace `import maplibregl from 'maplibre-gl'` with `import * as maplibregl` or named imports. WebGL1 support is removed and WebGL2 is required: the Map constructor throws GPUInitializationError, which is exported and should be caught to show a fallback UI. styleimagemissing can no longer supply images; use map.setMissingStyleImageResolver (sync or async). Nested GeoJSON properties now come back as objects, so remove JSON.parse calls on them. map.transform is removed. zoomLevelsToOverscale now slices vector tiles by default. When loading from a CDN, pin the major version: @latest goes blank.

Source: https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/docs/guides/v5-to-v6-migration-guide.md

### 5. MapLibre v6 with Next.js/Turbopack worker setup (critical) (verified)

Turbopack hashes new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url) as an asset but does not emit its sibling maplibre-gl-shared.mjs. The map then mounts but never requests a tile. Fix: add scripts/copy-maplibre-worker.mjs, which copies both maplibre-gl-worker.mjs and maplibre-gl-shared.mjs from node_modules/maplibre-gl/dist into public/maplibre/. Run it from package.json "predev" and "prebuild" (postinstall alone is not enough). In a 'use client' module call setWorkerUrl('/maplibre/maplibre-gl-worker.mjs'). This is required under both `next build` (Turbopack) and `next build --webpack`. For a self-hosted worker the CSP needs worker-src 'self' and img-src data: blob: 'self'.

Source: https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/docs/index.md

### 6. react-map-gl v8 and MapLibre v6 compatibility (verified)

react-map-gl 8.1.3 and @vis.gl/react-maplibre 8.1.3 declare the peer maplibre-gl >=4.0.0. The map component loads the library with import('maplibre-gl') and accepts a namespace module via `'Map' in module ? module : module.default`, so it works with ESM-only v6. It diffs and applies the projection, sky, light and terrain props through setProjection, setSky, setLight and setTerrain. Import Map from 'react-map-gl/maplibre' and include 'maplibre-gl/dist/maplibre-gl.css'.

Source: https://unpkg.com/@vis.gl/react-maplibre@8.1.3/dist/maplibre/maplibre.js

### 7. deck.gl 9.4 and the new @deck.gl/maplibre (verified)

deck.gl 9.4.0 was released 2026-09-05. The new @deck.gl/maplibre module (first published 2026-08-28; peer maplibre-gl ^4.5.1 || ^5 || ^6) provides MapLibreOverlay in overlaid and interleaved modes. Use it instead of @deck.gl/mapbox. Other 9.4 changes: every layer in the official catalog now supports WebGPU; GlobeView gains terrain compatibility, bearing/pitch and pointer-anchored zoom; ScatterplotLayer gains getPixelOffset; path layers get analytic antialiasing; picking is faster. 9.3 (2026-04-13) added pickable:'3d', TerrainController and new widgets. 9.1 (2025-01-21): 'MapboxOverlay works with maplibre-gl globe without configuration'. React pattern: function DeckGLOverlay(props){ const o = useControl(() => new MapLibreOverlay(props)); o.setProps(props); return null }. In interleaved mode, use beforeId to render beneath labels.

Source: https://deck.gl/docs/whats-new

### 8. deck.gl interleaved limitations (verified)

Interleaved mode requires WebGL2 and shares MapLibre's GL context. Base maps disable MSAA, so interleaved layers look aliased: set antialiasing:true on those layers or enable MSAA on the map. The overlay manages views, viewState, controller, canvas and device itself, and useDevicePixels is ignored when interleaved. Only one view syncs with the base map.

Source: https://deck.gl/docs/api-reference/mapbox/mapbox-overlay

### 9. deck.gl capacity and performance (verified)

Basic layers such as ScatterplotLayer render fluidly at 60 FPS up to about 1M items. Near 10M items the frame rate falls to 10–20 FPS, and layers crash between 10M and 100M because of browser allocation caps (Chrome caps a single allocation at 1 GB). Picking supports 16M items per layer and 256 pickable layers. For frequent updates: use updateTriggers, supply binary/external attributes (typed arrays passed directly to the GPU), avoid recreating accessor functions, and animate with radiusScale-style uniforms. On this basis ~13k flights, ~19k satellites and ~40k CCTV points are well within budget.

Source: https://deck.gl/docs/developer-guide/performance

### 10. deck.gl GlobeView caveats (verified)

GlobeView is experimental. Unsupported: HeatmapLayer, ContourLayer, TerrainLayer and MaskExtension. There is no high-precision rendering above zoom 12, only the 'lnglat' coordinate system is supported, and TileLayer/MVTLayer support is experimental. ArcLayer and TripsLayer can disappear on the globe because of back-face culling; set parameters: {cullMode: 'none'}. For shortest-distance lines use GreatCircleLayer or ArcLayer greatCircle:true. Implication (not tested): in globe mode, draw heatmaps with MapLibre's native 'heatmap' layer type rather than deck HeatmapLayer.

Source: https://deck.gl/docs/api-reference/core/globe-view

### 11. TripsLayer and ArcLayer props (verified)

TripsLayer props: currentTime (the playhead; advance it in a requestAnimationFrame loop), trailLength (default 120, in timestamp units), fadeTrail (default true), getPath and getTimestamps. ArcLayer props: greatCircle (default false; LNGLAT only), getHeight (default 1; 0 gives a flat line), getTilt (-90..90, fans out arcs that share endpoints), numSegments (default 50), widthUnits (default pixels). On the globe, both need cullMode 'none'.

Source: https://deck.gl/docs/api-reference/layers/arc-layer

### 12. Globe.gl and three-globe alternative (verified)

globe.gl 2.46.2 (MIT) and three-globe 2.45.3 (peer three >=0.154; three latest is 0.186.1). There are 14 layer types: points, arcs, polygons, paths, heatmaps, hex bin, hexed polygons, tiles, particles, rings, labels, HTML elements, 3D objects and custom. A slippy-map tile engine URL setter covers the globe with map tiles. A 'Day/Night Cycle' example exists, and the particles layer handles large point counts. World Monitor uses globe.gl plus Three.js for its 3D globe and deck.gl plus MapLibre for its flat map.

Source: https://github.com/vasturiano/globe.gl

### 13. CesiumJS alternative (verified)

cesium 1.145.0. 'An ion access token is only required if you are using any ion related APIs. A default access token is provided for evaluation purposes only.' The ion-dependent APIs are createWorldImagery, createWorldTerrain, IonImageryProvider, IonGeocoderService and IonResource. Cesium can run without ion if imagery (e.g. GIBS/Esri) and terrain providers are supplied, but its bundle and integration cost is far higher than MapLibre+deck.gl.

Source: https://cesium.com/learn/cesiumjs/ref-doc/Ion.html

### 14. Day/night terminator implementation (verified)

Options: (1) maplibre-gl-nightlayer 1.0.0-alpha.16 (MIT, alpha, published 2026-03). (2) Port the algorithm from @joergdietrich/leaflet.terminator 1.3.0: compute the sun's declination, then trace 361 points with lat = atan(-cos(Δlng)/tan(decl)) and close the polygon toward the dark pole. (3) suncalc 2.0.2, or satellite.js sunPos (v7 returns rsun as {x,y,z}; its mean-anomaly bug was fixed in 7.1.0). Other implementations shade civil, nautical and astronomical twilight bands, e.g. the SOTLAS PR and leaflet-daynight 1.0.0 (2026-09-19). Recommended: compute GeoJSON polygons for 3 twilight bands plus night every 60 s in a worker, render them as MapLibre fill layers with low opacity, and blend GIBS VIIRS_Black_Marble night lights clipped to the night side.

Source: https://registry.npmjs.org/-/v1/search?text=keywords:terminator%20maplibre&size=10

### 15. satellite.js 7 for ~20k objects (verified)

satellite.js 7.1.0 (2026-07-23) is ESM-only and needs Node 20.19+/22.13+/24+ and evergreen browsers. 7.0.0 added a Bulk Propagation API backed by C++ compiled to WASM, 3–12x faster than a propagate() loop, plus shadowFraction (satellite lit/penumbra/shadow). 7.1.0 added checkForDecay and propagate(..., {communityDecayCheckEnabled}) to drop garbage positions from long-decayed objects. Use json2satrec(OMM) and gstime/eciToGeodetic. Breaking in v7: ndot/nddot units changed to rad/min² and rad/min³, and sunPos().rsun is now an object. Unreleased: alpha5ToNumber for Alpha-5 catalog numbers.

Source: https://raw.githubusercontent.com/shashwatak/satellite-js/develop/CHANGELOG.md

### 16. CelesTrak GP data: TLE limit reached (critical) (verified)

'We ran out of 5-digit catalog numbers on 2026-07-11. The official USSF SATCAT is now at 100831.' Use JSON or other OMM formats instead of TLE. Query format: https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json (also CATNR, INTDES, NAME, SPECIAL). The default FORMAT has been CSV since May 2026. CelesTrak checks for new data once every 2 hours, and downloading again before an update returns HTTP 403 'GP data has not updated since your last successful download'. Cache server-side for at least 2 h.

Source: https://celestrak.org/NORAD/documentation/gp-data-formats.php

### 17. OpenFreeMap basemap (verified)

Free public instance: 'no limits on the number of map views or requests. There's no registration, no user database, no API keys, and no cookies.' Commercial use is allowed. Attribution is required (MapLibre adds it automatically). Data: OpenStreetMap in the unmodified OpenMapTiles schema; the stack is MIT-licensed and self-hostable; no SLA. Styles: positron, bright, liberty, dark, fiord, 3d, at https://tiles.openfreemap.org/styles/{name}. Tests: /styles/dark and /styles/fiord return 200 with CORS *. The dark style has sources ne2_shaded and openmaptiles, 47 layers, background rgb(12,12,12), and glyphs at https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf.

Source: https://openfreemap.org/

### 18. CARTO basemaps: key now required (verified)

Terms last updated 29 September 2026: 'Customer must always use the Basemap Services with Customer's own unique API keys.' Free allowance: 5,000,000 tile requests/month non-commercial and 1,000,000 commercial; above that the Commercial plan is $500/mo for 10M or $1,500/mo for 50M. Attribution '© OpenStreetMap contributors, © CARTO' is required. Server-side proxying or caching is prohibited, as is browser caching longer than 30 days. Templates: https://{a-d}.basemaps.cartocdn.com/{dark_all|dark_nolabels|dark_only_labels|light_all|rastertiles/voyager...}/{z}/{x}/{y}{@2x}.png?key=... and GL style https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json. An unkeyed tile still returned 200 today, but the terms require a key. Do not route CARTO tiles through a proxy-tiles API (OSIRIS has /api/proxy-tiles).

Source: https://carto.com/legal/basemap-terms/

### 19. Stadia Maps and MapTiler free tiers (verified)

Stadia free plan: 200,000 credits/month, 'Commercial use not allowed', satellite imagery only on paid tiers; Starter is $20/mo for 1M credits. Themes include Alidade Smooth Dark and Stamen Toner/Terrain/Watercolor. MapTiler free plan: 5k map sessions and 100k API requests per month, non-commercial only, MapTiler logo required; Flex plan $30/mo.

Source: https://stadiamaps.com/pricing/

### 20. Protomaps (verified)

The planet PMTiles file is ~120 GB for z0–15, from daily builds at maps.protomaps.com/builds. It is an ODbL Produced Work requiring OSM attribution, and hotlinking the builds is discouraged: copy to your own storage. Flavors in @protomaps/basemaps 5.7.2: light, dark, white, grayscale, black, customisable with {...namedFlavor('black'), buildings:'...'}; pmtiles 4.5.0. The hosted Tile API 'is free for non-commercial use', needs an API key, and commercial use requires GitHub sponsorship.

Source: https://docs.protomaps.com/basemaps/flavors

### 21. Esri World Imagery (verified)

Tile URL: https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x} (note the y/x order). 200 OK with CORS * and 24 LODs. Copyright text: 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community' (Maxar imagery is now credited as Vantor). 'This work is licensed under the Esri Master License Agreement'. The layer 'is not intended to be used to export tiles for offline'; use World Imagery (for Export) for that. Whether an ArcGIS account or token is formally required for non-ArcGIS clients could not be confirmed from primary docs.

Source: https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=pjson

### 22. NASA GIBS WMTS layers (no key, CORS *) (verified)

Template: https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{Layer}/default/{Time}/{TileMatrixSet}/{z}/{y}/{x}.{ext}. Layers from the live capabilities, with default time: VIIRS_Black_Marble (GoogleMapsCompatible_Level8, png, 2016-01-01); VIIRS_Night_Lights (Level8 png, 2016-01-01); BlueMarble_NextGeneration (Level8 jpeg, no time); VIIRS_SNPP_, VIIRS_NOAA20_ and VIIRS_NOAA21_CorrectedReflectance_TrueColor (Level9 jpeg, daily); MODIS_Terra_ and MODIS_Aqua_CorrectedReflectance_TrueColor (Level9 jpeg, daily); VIIRS_SNPP_DayNightBand (Level7 png); Reference_Labels and Reference_Features (Level9, 15m versions at Level13); Coastlines (Level9); IMERG_Precipitation_Rate (Level6); GHRSST_L4_MUR_Sea_Surface_Temperature (Level7); MODIS_Terra_Aerosol (Level6); VIIRS_SNPP_Thermal_Anomalies_375m_All/Day/Night (Level8, MVT .mvt). Tests: Black Marble, VIIRS true colour, Blue Marble and Night Lights tiles all returned 200 with Access-Control-Allow-Origin *. The capabilities template uses .jpeg for true colour, though .jpg also returned 200. Required acknowledgement: 'We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).'

Source: https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml

### 23. EOX Sentinel-2 cloudless (verified)

Non-commercial use is CC BY-NC-SA 4.0. Commercial use requires the paid 'EOX Commercial Attribution-RestrictedUse 1.2 License', and sub-licensing is prohibited. Attribution: 'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data "year")'. The WMTS tile https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg returned 200 with CORS. Not safe as a commercial default.

Source: https://cloudless.eox.at/documentation/license

### 24. OpenTopoMap and terrain DEM (verified)

OpenTopoMap is CC-BY-SA 3.0. Attribution: 'Kartendaten: © OpenStreetMap-Mitwirkende, SRTM | Kartendarstellung: © OpenTopoMap (CC-BY-SA)'. No mass downloading and no uptime guarantee. For terrain, AWS Terrarium DEM tiles (https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png) returned 200 with CORS * and work as a MapLibre raster-dem source with encoding 'terrarium'. The Terrarium licence page was not fetched.

Source: https://opentopomap.org/about

### 25. Next.js 16.x current state (verified)

next 16.3.7 is latest (2026-09-29); 16.0.0 shipped 2025-10-21/22. Breaking changes in 16: Node ≥20.9, TS ≥5.1, browsers Chrome/Edge/Firefox 111+ and Safari 16.4+. Turbopack is the default for dev and build (opt out with --webpack). middleware.ts is renamed proxy.ts (Node runtime). Sync params, searchParams, cookies(), headers() and draftMode() are removed; they must be awaited. `next lint` is removed; use the ESLint CLI. AMP and runtimeConfig are removed. experimental.ppr and dynamicIO are replaced by cacheComponents:true with 'use cache', cacheLife and cacheTag. revalidateTag(tag, profile) now requires the profile argument; updateTag and refresh were added. Parallel route slots need default.js. next/image defaults changed (minimumCacheTTL 4h, qualities [75], local IP blocked). reactCompiler:true is stable but opt-in. 16.3 (Aug 2026) adds Instant Navigations, partialPrefetching:true, experimental.useOffline with the useOffline() hook, and @next/playwright instant() for E2E.

Source: https://nextjs.org/blog/next-16

### 26. Next.js security floor (verified)

The August 2026 security release, fixed in v16.3.3 (Active LTS) and v15.5.24, patched unauthenticated RCE in the Image Optimization API when optimizing attacker-controlled AVIF (sharp/libheif; the patch disables AVIF optimization) and a Windows-only RCE. Use next ≥16.3.3; 16.3.7 is latest.

Source: https://nextjs.org/blog/august-2026-security-release

### 27. React 19.3 (verified)

react 19.3.0 was released 2026-09-09. <ViewTransition> is stable (enter/exit/update/share, addTransitionType). Also new: Fragment refs (FragmentInstance with addEventListener, focus, observeUsing, scrollIntoView...); use(browser()) to opt a subtree out of SSR, suited to WebGL map components; Trusted Types support; Server Components can render Context imported from 'use client' modules; onFullscreenChange events; batched resize updates. The changelog lists no breaking changes. The Next 16 App Router uses React canary builds.

Source: https://react.dev/blog/2026/09/09/react-19-3

### 28. TypeScript 7 vs typescript-eslint (gotcha) (verified)

typescript 7.0.2 is latest, released 2026-07-08 as the Go-native compiler (7.7–11.9x faster builds). It has no stable programmatic API, which is expected in 7.1, so typescript-eslint must stay on TS 6.0. typescript-eslint 8.71.0 declares the peer typescript '>=4.8.4 <6.1.0' and eslint ^8.57 || ^9 || ^10. Side-by-side pattern from the TS team: "@typescript/native": "npm:typescript@^7.0.2", "typescript": "npm:@typescript/typescript6@^6.0.2". TS 6 and 7 defaults: strict true, module esnext, types: [] (list @types explicitly), rootDir './', noUncheckedSideEffectImports true; baseUrl, AMD/UMD and ES5 target are removed. Next 16.3.7: 'By default, next build runs the project-local tsc command instead of loading the TypeScript JavaScript compiler API' (experimental.useTypeScriptCli, on by default), which enables TS 7. Setting it to false with TS 7 makes the build exit.

Source: https://nextjs.org/docs/app/api-reference/config/next-config-js/useTypeScriptCli

### 29. ESLint 10 flat config (verified)

eslint 10.11.0 is latest; 10.0.0 was released 2026-02-06; the maintenance line is 9.39.5. eslintrc is removed completely (.eslintrc.*, .eslintignore, --no-eslintrc, --env). Requires Node ≥20.19. Config lookup starts from each linted file's directory. jiti must be ≥2.2.0 for TS config files. eslint-config-next 16.3.7 has the peer eslint >=9. Recommended eslint.config.mjs: import { defineConfig, globalIgnores } from 'eslint/config'; import nextVitals from 'eslint-config-next/core-web-vitals'; import nextTs from 'eslint-config-next/typescript'; export default defineConfig([...nextVitals, ...nextTs, globalIgnores(['.next/**','out/**','build/**','next-env.d.ts'])]). eslint-plugin-react-hooks is 7.1.1.

Source: https://nextjs.org/docs/app/api-reference/config/eslint

### 30. Tailwind CSS v4 gotchas (verified)

tailwindcss and @tailwindcss/postcss are 4.3.3. Config is CSS-first: @import "tailwindcss" plus @theme tokens. There is no tailwind.config.js by default (use @config for a legacy one). Custom utilities use @utility; theme values are CSS vars (var(--color-...)) and theme() is discouraged. Browser floor: Safari 16.4+, Chrome 111+, Firefox 128+. Renames: shadow-sm→shadow-xs, shadow→shadow-sm, blur-sm→blur-xs, rounded-sm→rounded-xs, outline-none→outline-hidden; ring is 1px by default (ring-3 for the old width). Border and ring colour default to currentColor. Buttons default to cursor:default. hover: applies only under @media (hover:hover). The important modifier is a suffix (bg-red-500!), CSS-var shorthand is bg-(--brand), and Sass/Less are unsupported. Run npx @tailwindcss/upgrade to migrate.

Source: https://tailwindcss.com/docs/upgrade-guide

### 31. shadcn/ui and Radix (verified)

shadcn CLI 4.21.0 initialises Tailwind v4 projects. tailwindcss-animate is deprecated in favour of tw-animate-css 1.4.0 (via @import). Colours are OKLCH. Every primitive carries a data-slot attribute for styling. forwardRef is removed. The 'default' style is deprecated and new-york is the default. The unified radix-ui package is 1.6.7 (peer React ^19 OK).

Source: https://ui.shadcn.com/docs/tailwind-v4

### 32. Motion (formerly Framer Motion) (verified)

motion and framer-motion are both 13.4.6 (peer react ^18 || ^19). Migrate with npm i motion and import { motion } from 'motion/react'. v13 removed the optional @emotion/is-prop-valid dependency; v12 had no breaking changes. OSIRIS is still on framer-motion ^12.

Source: https://motion.dev/docs/react-upgrade-guide

### 33. Zustand v5 gotchas (UNVERIFIED)

zustand 5.0.15 (peer react >=18, use-sync-external-store >=1.2 optional). A selector that returns a new object or array causes 'Maximum update depth exceeded'; wrap it with useShallow from 'zustand/shallow'. Custom equalityFn moved to createWithEqualityFn from 'zustand/traditional'. For 60 fps entity data, keep positions in typed arrays or refs outside React state and store only UI state in Zustand.

Source: https://zustand.docs.pmnd.rs/reference/migrations/migrating-to-v5

### 34. Data fetching and live layers (verified)

@tanstack/react-query is 5.104.0 and swr 2.5.1. The Next 16.3 guide recommends starting the request in a Server Component and passing it through HydrationBoundary (TanStack) or SWRConfig with preload (SWR), then polling on the client with refreshInterval. Route Handlers can stream with a ReadableStream Response, which is how Server-Sent Events should be served, e.g. for malware and SDK feeds.

Source: https://nextjs.org/blog/building-app-like-experiences-with-nextjs-16-3

### 35. Other UI library versions (npm latest, 2026-09-30) (verified)

cmdk 1.1.1; @tanstack/react-virtual 3.14.13; echarts 6.1.0 (v6 has a new default theme, built-in dark mode, overflow and overlap prevention on by default; revert with echarts/theme/v5.js; tree-shake with 'echarts/core'); recharts 3.10.1; @visx/visx 4.0.0; sonner 2.0.8; vaul 1.1.2; react-resizable-panels 4.14.1; nuqs 2.10.1 (URL state for shareable views); lucide-react 1.49.0; h3-js 4.5.0; @turf/turf 7.4.0; suncalc 2.0.2; pmtiles 4.5.0; @maplibre/maplibre-gl-style-spec 26.4.4; three 0.186.1; @deck.gl/* 9.4.0; @fontsource/jetbrains-mono 5.3.0; geist 1.7.2 (OFL).

Source: https://registry.npmjs.org/

### 36. Fonts (verified)

The Google Fonts css2 endpoint returns 200 for Geist, Geist Mono, JetBrains Mono, IBM Plex Mono, Space Grotesk, Space Mono, Rajdhani, Orbitron and Share Tech Mono, so all can be loaded self-hosted via next/font/google. The geist npm package (1.7.2, SIL OFL) is an alternative.

Source: https://fonts.googleapis.com/css2?family=JetBrains+Mono&display=swap

### 37. Design reference: World Monitor (verified)

github.com/koala73/worldmonitor, AGPL-3.0, so use it for ideas only and do not copy code into an MIT project. It runs a dual engine: a 3D globe (globe.gl + Three.js) and a WebGL flat map (deck.gl + MapLibre GL) sharing one layer catalog. Built with vanilla TypeScript and Vite, Tauri 2 desktop, and a PWA. Data spans geopolitics, finance, energy, climate, aviation, cyber, military and infrastructure, with source freshness tracking.

Source: https://raw.githubusercontent.com/koala73/worldmonitor/main/README.md

### 38. Design reference: Orodruin (Gotham alternative) (verified)

AGPL-3.0; live at orodruin.dev. It has five basemaps (dark, streets, satellite, 3D globe, Google Photorealistic 3D). The actor co-occurrence graph encodes node size as connections, edge width as frequency and colour as country. Windows are draggable and resizable. The AI analyst drives the UI through tools (open_camera, area_intel, focus_map, toggle_layer, apply_filters) in an 'intelligence-terminal tone — no emojis'. Extra free sources beyond OSIRIS: GDACS, RainViewer radar, TeleGeography submarine cables, WRI power plants (~35k), ransomware.live, HIBP, Polymarket, USASpending, TfL/Caltrans/DriveBC/NZTA/Digitraffic cameras (MP4/HLS/JPEG/iframe player).

Source: https://raw.githubusercontent.com/Dev-next-gen/orodruin/main/README.md

### 39. Design reference: Palantir Gotham Gaia map (UNVERIFIED)

Gaia is Gotham's collaborative map and common operating picture. From the Palantir docs and blog, as seen in search snippets: a top toolbar for selection, Search Around (relationship expansion) and drawing (polygon, circle, rectangle, line, point); right-side panels for selected-object details plus a time range and current-timestamp scrubber applied to the map and time-series views; Find (go to coordinates); a Histogram for filtering by property and time; and 'Follow Along' to mirror another user's cursor and viewport. The blog post itself returned 403.

Source: https://www.palantir.com/docs/foundry/map/map-overview

### 40. Design reference: Anduril Lattice (UNVERIFIED)

From search snippets only: Lattice fuses air, land, sea and subsurface sensors into one common operating picture, using 2D/3D map UIs on laptop, desktop, web and VR, where a single operator tasks multiple assets. The pattern to borrow is track-centric entities with tasking side panels.

Source: https://www.anduril.com/command-and-control/

### 41. Contrast checks for the OSIRIS palette (verified)

Computed with the WCAG 2 relative-luminance formula against background #06060C. #D4AF37 gold = 9.61:1 (passes AA/AAA body text). #9BA3AF = 7.94:1. #6B7280 = 4.18:1 (fails 4.5:1 for body text; use only for ≥18.66px bold or 24px text, or decoration). #4B5563 = 2.67:1 (decorative only). Darker gold #8A7424 = 4.43:1 (fails for body text). Accents: #22D3EE 11.18, #F43F5E 5.5, #34D399 10.51, #F59E0B 9.41, #A78BFA 7.43, #E8E6E3 16.22. On panel #0B0D14: gold 9.23 and #6B7280 4.01.

Source: https://www.w3.org/TR/WCAG22/#contrast-minimum

### 42. Playwright visual testing (verified)

@playwright/test 1.63.0 (Chromium 153; Ubuntu 20.04 support ends). Use await expect(page).toHaveScreenshot({ maxDiffPixels, stylePath, mask, animations:'disabled' }) and update baselines with --update-snapshots. Rendering varies by OS, GPU and headless mode, so generate baselines in Docker/CI. 1.62 added WebP screenshots and bundled `npx playwright mcp` / `npx playwright cli`. 1.63 adds ARIA snapshot 'boxes'. next 16.3 declares @playwright/test ^1.51.1 as an optional peer, and @next/playwright instant() asserts prefetched UI.

Source: https://playwright.dev/docs/test-snapshots

### 43. Headless WebGL in CI (gotcha) (UNVERIFIED)

Chrome is removing the automatic SwiftShader fallback for WebGL (deprecation started in Chrome 130) because of JIT security risk. Headless or GPU-less runs need --enable-unsafe-swiftshader, e.g. launchOptions.args, or a GPU runner. MapLibre v6 throws GPUInitializationError when WebGL2 is unavailable, so without the flag map screenshots will be blank or fail.

Source: https://chromestatus.com/feature/5166674414927872

### 44. Vitest 5 (verified)

vitest 5.0.3; 5.0 was announced 2026-09-03. Requires Vite ≥6.4.0 and Node ≥22.12.0. Browser mode uses @vitest/browser-playwright 5.0.3 and gains Trace View. clearMocks is on by default. Unawaited async assertions now fail. New vi.when(). Fake timers also mock Temporal. Output goes to a single .vitest directory. OSIRIS is on vitest ^2.1.9.

Source: https://vitest.dev/blog/vitest-5

### 45. Lighthouse and Core Web Vitals budgets (verified)

lighthouse 13.5.0 and @lhci/cli 0.15.1. Assertion format: "categories:performance": ["warn",{"minScore":0.9}], "categories:accessibility": ["error",{"minScore":1}], and audit-level maxNumericValue, e.g. "largest-contentful-paint", "cumulative-layout-shift", "total-blocking-time", "resource-summary:script:size" (in bytes). Good thresholds at the 75th percentile: LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1.

Source: https://web.dev/articles/vitals

### 46. Flight route feature: airports by code (verified)

OurAirports: 'All data is released to the Public Domain', updated nightly. airports.csv (~12.7 MB; mirror https://davidmegginson.github.io/ourairports-data/airports.csv returns 200) has columns id, ident, type, name, latitude_deg, longitude_deg, elevation_ft, continent, iso_country, iso_region, municipality, scheduled_service, icao_code, iata_code, gps_code, local_code, home_link, wikipedia_link, keywords. Filter to type in {large_airport, medium_airport} with scheduled_service=yes for search, and build a prebuilt IATA/ICAO/name/city search index.

Source: https://ourairports.com/data/

### 47. Flight route feature: callsign to route (verified)

GET https://api.adsbdb.com/v0/callsign/BAW117, with no key, returned airline (BAW/BA, 'SPEEDBIRD'), origin EGLL/LHR (51.4706, -0.461941) and destination KJFK/JFK (40.639801, -73.7789) with names and elevations. Use it to label live aircraft with their planned origin and destination, and draw the remaining great-circle leg from current position to destination.

Source: https://api.adsbdb.com/v0/callsign/BAW117

### 48. Flight route feature: OpenSky (verified)

'OpenSky exclusively supports the OAuth2 client credentials flow. Basic authentication ... is no longer accepted.' Token URL: https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token (30-min tokens). Anonymous /states/all gets 400 credits/day at 10 s resolution; authenticated gets 4,000/day at 5 s. /flights/departure and /flights/arrival take an ICAO airport plus begin and end; intervals are limited to about 2 days (the doc wording is contradictory), and arrivals are available only from the previous day or earlier. /tracks/all is experimental with 30 days of history. Good for 'recent flights between A and B', not future schedules.

Source: https://openskynetwork.github.io/opensky-api/rest.html

### 49. Keyless ADS-B aggregators (verified)

https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{nm} returned live aircraft (hex, flight, reg, type, alt, gs...). https://api.adsb.lol/v2/callsign/{cs} returns {ac:[...]} (empty at test time). POST https://api.adsb.lol/api/0/routeset returned HTTP 201 with an empty body. api.airplanes.live returned an error asking to email them for access.

Source: https://opendata.adsb.fi/api/v2/lat/51.47/lon/-0.45/dist/25

## Recommendations

- Pin the stack: next@16.3.7, react/react-dom@19.3.0, maplibre-gl@^6.11.2, react-map-gl@8.1.3 (import from 'react-map-gl/maplibre'), @deck.gl/core, layers, geo-layers, aggregation-layers, react and maplibre all at 9.4.0 (use MapLibreOverlay from @deck.gl/maplibre with interleaved:true), tailwindcss and @tailwindcss/postcss@4.3.3, shadcn@4.21.0 with tw-animate-css, radix-ui@1.6.7, motion@13.4.6 (import from 'motion/react'), zustand@5.0.15, @tanstack/react-query@5.104.0, cmdk@1.1.1, @tanstack/react-virtual@3.14.13, echarts@6.1.0 (or keep lightweight-charts for price tickers), satellite.js@7.1.0, h3-js@4.5.0, @turf/turf@7.4.0, nuqs@2.10.1, sonner@2.0.8. Require Node ≥22.12, because Vitest 5 needs it.
- Handle TypeScript this way: keep 'typescript' at ^6.0.3 so typescript-eslint 8.71 works (its peer is <6.1.0). Optionally add "@typescript/native": "npm:typescript@^7.0.2" for fast `tsgo`-style checks. Next 16.3.7 runs the project-local tsc CLI by default. Put strict:true, noUncheckedIndexedAccess:true and an explicit "types" array in tsconfig, because TS 6+ defaults types to [].
- Lint with ESLint 10 and a flat config: eslint.config.mjs using defineConfig, spreading eslint-config-next/core-web-vitals and eslint-config-next/typescript, plus globalIgnores. Do not use `next lint` or .eslintrc.
- The prompt must spell out the MapLibre v6 plus Turbopack worker recipe. A predev/prebuild script copies maplibre-gl-worker.mjs AND maplibre-gl-shared.mjs to public/maplibre/. Call setWorkerUrl('/maplibre/maplibre-gl-worker.mjs') in the client map module. Use namespace or named imports only. Wrap map creation to catch GPUInitializationError and show a WebGL2-required fallback.
- Globe/2D architecture: one MapLibre map with projection toggled between 'globe' and 'mercator'. Optionally use an interpolate expression on projection.type to morph from globe to mercator between z5 and z7. Set sky atmosphere-blend interpolated 0:1, 5:1, 7:0 and a dark sky (sky-color #05070D, horizon-color #0E1A2B). Put deck.gl layers interleaved on top: ScatterplotLayer/IconLayer for aircraft, vessels and CCTV with binary attributes; TripsLayer for trails; ArcLayer greatCircle:true for routes; H3HexagonLayer for density. On the globe, set parameters:{cullMode:'none'} on arcs and trips, and draw heatmaps with MapLibre's native heatmap layer because deck's HeatmapLayer is unsupported on the globe.
- Basemap strategy with zero cost and clean licences: default to OpenFreeMap 'dark' or 'fiord' vector style, recoloured through a style-transform function (background #06060C, water #070B14, land #0A0D16, boundaries in gold at low opacity, labels in #9BA3AF). Add NASA GIBS raster overlays: VIIRS_Black_Marble (night lights, Level8 png), BlueMarble_NextGeneration, daily VIIRS_NOAA20_CorrectedReflectance_TrueColor with a date picker, Reference_Labels. Use Esri World Imagery for 'Satellite View', with its exact attribution string. Use AWS Terrarium raster-dem for 3D terrain with hillshade. Keep an attribution control visible with OSM, OpenFreeMap, NASA GIBS and Esri/Vantor. Do not ship CARTO, Stadia, MapTiler or EOX as defaults, and never proxy or cache CARTO tiles server-side.
- Day/night: run a Web Worker every 60 s that computes the subsolar point and emits GeoJSON for civil, nautical and astronomical twilight and night. Render these as stacked fill layers with alpha 0.12 / 0.18 / 0.24 / 0.32, show a glowing gold subsolar marker, and mask Black Marble night lights to the night polygon.
- Satellites: ingest CelesTrak GROUP=active&FORMAT=json (OMM), not TLE. Cache it server-side for ≥2 h and honour HTTP 403 as 'not updated'. Propagate ~20k objects in a Web Worker with satellite.js 7 bulk (WASM) propagation, posting Float32Array positions every 1 s through a transferable. Enable communityDecayCheckEnabled, and use shadowFraction to dim satellites in Earth's shadow. Draw the selected satellite's orbit as a PathLayer covering ±1 period.
- Flight route feature (the user's explicit ask): an 'ROUTE' panel takes FROM and TO as IATA/ICAO/city with cmdk autocomplete over a prebuilt OurAirports index (large and medium airports with scheduled_service=yes). It draws the planned great-circle path with deck ArcLayer greatCircle:true and getHeight scaled by distance, or a PathLayer from turf.greatCircle for a flat, draped line. The panel shows distance (nm/km), initial bearing, estimated block time at ~480 kt, and the time-zone and local-time difference. It lists live aircraft currently on that city pair by joining adsb.fi/adsb.lol positions with adsbdb callsign routes, and shows OpenSky recent departures and arrivals when OAuth credentials exist. Clicking a live flight shows its origin→current→destination path (flown track solid, remaining leg dashed). Put the route in the URL via nuqs for sharing, e.g. ?route=LHR-JFK.
- Design system tokens to give the build model: bg #06060C, panel rgba(11,13,20,0.72) with backdrop-blur 12–16px and a 1px border of rgba(212,175,55,0.18), primary gold #D4AF37 (9.6:1 contrast), muted text #9BA3AF (7.9:1), and never #6B7280 or darker for body text. Semantic colours: cyan #22D3EE for air, emerald #34D399 for maritime, amber #F59E0B for hazards, rose #F43F5E for threats, violet #A78BFA for space. Typography: JetBrains Mono or Geist Mono for data, Space Grotesk for headings; scale 11/12/13/15/18/24 px; tabular-nums and uppercase letter-spaced 0.08em labels.
- Visual rules for the prompt: (1) a 1px hairline grid and corner brackets on panels; (2) an optional scanline/noise overlay at ≤3% opacity, off under prefers-reduced-motion; (3) glow only on live or selected entities, via a text-shadow or box-shadow in the category colour at 40% alpha; (4) pulse rings for new alerts, capped at 3 at once; (5) motion budget of 150–250 ms ease-out for UI and no animated layout shift (CLS ≤0.1); (6) dense but aligned data on a 4px grid with right-aligned numerics; (7) a status bar with UTC and Zulu clocks, live counters and a price/seismic ticker; (8) resizable, dockable panels (react-resizable-panels) and a command palette on Cmd/Ctrl-K; (9) keyboard parity with OSIRIS (F, S, L, M, I, R, ?, ESC); (10) freshness badges per layer (LIVE / 2m / STALE); (11) a timeline scrubber for replay, as in Gotham; (12) the Entity Graph as a WebGL force graph; (13) accessibility: focus rings in gold, ARIA live region for alerts, and every layer toggle reachable by keyboard.
- Performance: keep all per-frame entity data out of React state. Store typed arrays in refs or workers, and hold only selection and filter state in Zustand. Use updateTriggers and binary attributes, set pickable only on interactive layers, and virtualise feeds with @tanstack/react-virtual. Serve live layers over SSE with a ReadableStream Response from Route Handlers, falling back to TanStack Query polling. Lazy-load heavy panels with next/dynamic and ssr:false, or React 19.3 use(browser()).
- Quality gates: Vitest 5 unit tests for parsers, propagation and great-circle maths; Playwright 1.63 E2E with toHaveScreenshot baselines generated in the official Playwright Docker image, with launch args ['--enable-unsafe-swiftshader','--use-angle=swiftshader'] (the second flag is the prompt author's addition, not verified) and animations disabled, masking clocks and tickers. Lighthouse CI assertions: performance ≥0.85 (a WebGL app), accessibility =1.0, LCP ≤2.5 s, CLS ≤0.1, TBT ≤300 ms, initial JS ≤350 KB gzip excluding lazily loaded map chunks.
- Sub-agent plan for Opus 5.5: (1) Recon agent: read the MIT OSIRIS repo at github.com/simplifaisoul/osiris, branch master, and inventory its routes, layers, panels and shortcuts. (2) Map-engine agent: MapLibre, deck.gl, globe, terminator, basemaps. (3) Data-API agent: /api route handlers, caching and rate limits. (4) Space agent: satellites worker. (5) Aviation and route-planner agent. (6) UI/design-system agent: tokens, shadcn, panels, command palette. (7) OSINT/Intel agent: recon tools and AI briefing. (8) QA agent: Playwright screenshots, Lighthouse, a11y. Each agent returns diffs plus screenshots, and the lead integrates behind feature flags. Note: World Monitor and Orodruin are AGPL, so borrow ideas only and copy no code.
- Security and compliance: stay on next ≥16.3.3 because of the AVIF RCE. Keep all third-party keys server-side. Show legal attributions for every tile source. Rate-limit /api/osint/* and the AI routes. Label CCTV and OSINT features for lawful and ethical use.

## Gaps (not verified)

- 'Ravenwatch' could not be found as a product or site; it may be niche, renamed or misremembered (UNVERIFIED).
- Esri's exact terms for using World Imagery tiles in non-ArcGIS clients without an ArcGIS account or token were not confirmed; the developer attribution page is JS-rendered and returned no text. Only the service metadata was verified: Esri Master License Agreement and the attribution string.
- NASA GIBS rate limits and fair-use terms are not stated in the docs fetched. GIBS VIIRS_SNPP_Thermal_Anomalies_375m_All MVT tiles returned 404 at every z/x/y and date tried, so the correct time or zoom for that vector layer is unverified.
- The OpenFreeMap fair-use or abuse policy beyond 'no limits' was not examined, nor was its availability track record.
- Whether deck.gl 9.4 MapLibreOverlay in interleaved mode on the MapLibre v6 globe fully supports aggregation layers (HexagonLayer, H3HexagonLayer) was not tested. GlobeView docs list HeatmapLayer and ContourLayer as unsupported.
- No known React 19.3 incompatibilities with deck.gl or react-force-graph were checked in issue trackers; the GitHub API was unavailable. Only the npm peer ranges (which accept React 19) were verified.
- Zustand v5 migration details come from search-result summaries, and the Chrome SwiftShader removal comes from search results and chromestatus; the primary pages were not fetched.
- Palantir Gotham/Gaia and Anduril Lattice UI details come from search snippets. The Palantir blog returned 403 and no screenshots were inspected. Flightradar24 dark mode, Windy, Bloomberg Terminal and Cesium Stories were not researched in this pass.
- No free, global source of filed flight plans (waypoint-level planned routes) was verified. FlightAware AeroAPI, AviationStack and AeroDataBox (paid or limited tiers) were not checked. The adsb.lol routeset endpoint returned HTTP 201 with an empty body, so its payload format is unverified.
- Which basemap OSIRIS itself uses was not identified: GitHub code search returned nothing and codeload tarball access was blocked.
- The Vitest 5 migration-guide specifics (removed options, jsdom and happy-dom changes) were not fetched.
- The AWS Terrain Tiles (Terrarium) licence and attribution page was not fetched; only availability and CORS were tested.
