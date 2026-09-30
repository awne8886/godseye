# deck.gl 9.4 on the MapLibre v6 globe; Google Photorealistic 3D Tiles / Cesium ion terms
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
**Question answered:** Does deck.gl 9.4's @deck.gl/maplibre MapLibreOverlay in interleaved mode fully work on the MapLibre v6 globe projection? Check ArcLayer greatCircle, TripsLayer, IconLayer, H3HexagonLayer and HexagonLayer, and picking, and look for open issues with React 19.3 or Next 16 Turbopack. Separately, what are the terms, pricing, attribution and caching rules for Google Photorealistic 3D Tiles and Cesium ion, including whether they may be mixed with a non-Google basemap?

## Summary

deck.gl 9.4.0 (released 2026-09-05; still the latest on npm as of 2026-09-30) ships a new @deck.gl/maplibre package whose peer range is maplibre-gl ^4.5.1 || ^5 || ^6. The latest MapLibre is 6.11.2. Interleaved mode does run on the MapLibre v6 globe, but it does not fully work. For a globe, the overlay swaps in deck.gl's experimental GlobeView, which turns on back-face culling by default. With the defaults in 9.4.0: TextLayer and non-billboard IconLayer are invisible (non-billboard icons also render rotated 180° once culling is off), ArcLayer shows only specks, and TripsLayer trails can disappear. Billboard icons and points behind the globe are not hidden, and they can be picked through the globe. ScatterplotLayer z-fights, and large circles do not follow the globe surface. The documented workaround is `parameters: {cullMode: 'none'}` on each layer. The real fixes (PRs #10670 and #10750) are still open. Other checks: H3HexagonLayer works because it switches itself to polygon mode on the globe. HexagonLayer is not listed as unsupported, but reading the source suggests it bins on 3D sphere x/y, which would give wrong bins (not tested). HeatmapLayer and ContourLayer are documented as unsupported. The overlay throws on any MapLibre projection that is not 'mercator' or 'globe', including expressions and 'vertical-perspective'. GlobeView switches to a Web Mercator viewport above zoom 12.

React 19.3 and Next 16 problems found: under StrictMode, the overlay throws "WebGL context already attached" (#10681, open; workaround `deviceProps: {_reuseDevices: true}`, fix PR #10682 open). React 19 `<Activity>` resets the deck view state (#9983, open). An unmount race on Next 16.1.6 (#10266) is closed. A `beforeId` ordering regression in @deck.gl/maplibre (#10733, open) puts deck layers above labels on first load. A terrain picking fix (#10756) merged on 2026-09-30 but is not in 9.4.0. MapLibre v6 is ESM-only and needs WebGL2. Its official Turbopack/Next.js instructions: copy both maplibre-gl-worker.mjs and maplibre-gl-shared.mjs into public/ and call setWorkerUrl, otherwise the map mounts but never loads tiles. Conclusion: the MapLibre v6 + deck.gl interleaved plan does not need a rewrite, but it needs per-layer globe workarounds, pinned versions and screenshot tests.

Google Photorealistic 3D Tiles are part of the Map Tiles API, which is a Core Service under the Google Maps Platform terms. That means clause 3.2.3(e) "No Use With Non-Google Maps" applies: you may not use them "with or near a non-Google Map". Putting them in the MapLibre/OSM/CARTO view is therefore not allowed. Only your own data (not derived from the tiles) may be overlaid on them. Caching beyond what the HTTP Cache-Control/ETag headers allow is not permitted; offline use, image analysis, object detection and geodata extraction are banned; there are no Map Tiles caching exceptions in the Service Specific Terms. Required attribution is the Google Maps logo (16–19dp) plus all per-tile copyright strings, aggregated and sorted on one line. Price: Enterprise SKU C6E1-98B2-DBD0, 1,000 free per month, then $6.00 per 1,000 (dropping to $2.40 above 5M). One root tileset request covers at least 3 hours of tiles. Default quota is 10,000 root requests per day and 12,000 QPM for the renderer. Projects billed in the EEA get HTTP 403, so the tiles are unavailable there entirely. The terms also ban High Risk Activities (including "the creation or operation of weaponry") and ITAR-controlled use.

Cesium ion: the free Community plan is personal and non-commercial only. A paid plan is needed for companies above $50K revenue or funding, for government work, and for funded research. Commercial costs $149/mo (individual) or $524/mo (team) and includes 5,000 Google root tiles per month; Premium costs $499 or $874/mo. You must show the "Cesium ion" logo prominently in the main window. Offline storage is banned; only general client-side or proxy caching is allowed. Building ion into a product sold to other organisations needs a separate integration licence. Google content streamed through ion carries the same Google restrictions, including no use with non-Google maps. CesiumJS itself (1.145.0) is Apache-2.0 and can load Google tiles directly with a Google key, without ion.

## Findings

### 0. deck.gl 9.4.0 release date and packages (verified)

@deck.gl/core, @deck.gl/mapbox and @deck.gl/maplibre 9.4.0 were published 2026-09-05. That is still the npm 'latest' tag on 2026-09-30; there is no 9.4.1 yet. @deck.gl/maplibre is a new package, first published 2026-08-28, with peerDependencies {'@deck.gl/core':'~9.4.0','@luma.gl/core':'~9.4.0','maplibre-gl':'^4.5.1 || ^5.0.0 || ^6.0.0'}. @deck.gl/react 9.4.0 peers: react/react-dom >=16.3.0. The what's-new page says 9.4 is 'expected to be the final release in the v9 series' and that v10 will bring luma.gl v10 and loaders.gl v5.

Source: https://registry.npmjs.org/@deck.gl/maplibre

### 1. deck.gl 9.4 what's-new (globe, maplibre, picking) (verified)

'New @deck.gl/maplibre module is forked from the former @deck.gl/mapbox module... MapLibre GL JS v4, v5, and the recently released v6.' GlobeView changes: TerrainLayer, TerrainExtension and Tile3DLayer now render on GlobeView; GlobeController gains bearing and pitch. 'Views now support a parameters prop... GlobeView uses this to enable back-face culling by default.' Picking: 'Most layers now use shader builtins (instance_index) instead of picking color buffers.' PathLayer, LineLayer, ArcLayer and PointCloudLayer get analytic antialiasing (`antialiasing` prop). WebGPU remains experimental.

Source: https://raw.githubusercontent.com/visgl/deck.gl/v9.4.0/docs/whats-new.md

### 2. @deck.gl/maplibre official compatibility notes (v9.4.0 docs) (verified)

Quoted: 'MapLibre GL JS v4.5.1, v5, and v6 are supported.' 'Interleaved mode only works when WebGL2 is available.' 'Camera target elevation is synchronized. deck.gl layers are not draped over MapLibre terrain.' 'Mercator is supported. Globe integration uses deck.gl's experimental GlobeView. With default back-face culling, TextLayer and non-billboard IconLayer do not render. Disabling culling makes them visible, but non-billboard icons render rotated 180°.' 'Non-default vertical field of view and camera roll are not synchronized.' 'One interleaved overlay may be attached to a map.' The package is ESM-only. MapLibre's context has antialias:false, so set `antialiasing: true` on Path, Line, Arc and PointCloud layers. `useDevicePixels` and `device` are ignored in interleaved mode. `interleaved` is fixed at construction. Picking methods (pickObject, pickObjects, pickMultipleObjects) are forwarded to Deck.

Source: https://raw.githubusercontent.com/visgl/deck.gl/v9.4.0/docs/api-reference/maplibre/overview.md

### 3. @deck.gl/maplibre source: projection handling (verified)

compatibility.js getMapLibreProjection(): reads `map.getProjection()?.type`. It returns 'globe' or 'mercator'; any other value throws `Unsupported MapLibre projection`. That covers 'vertical-perspective' and interpolate expressions such as the style-spec example ['interpolate',['linear'],['zoom'],10,'vertical-perspective',12,'mercator']. deck-utils.js getMapLibreDefaultView() returns `new GlobeView({id:'maplibre'})` for globe and a MapView otherwise. overlay.js refreshes `views` on the 'styledata' event (interleaved) and on every render (overlaid), so a runtime setProjection toggle should swap views as long as you do not pass your own view with id 'maplibre' (my inference; not tested). An interleaved Deck uses `map.getCanvas().getContext('webgl2')` and throws if WebGL2 is missing. A second interleaved overlay on the same map throws.

Source: https://unpkg.com/@deck.gl/maplibre@9.4.0/dist/compatibility.js

### 4. GlobeView limitations (v9.4.0 docs + source) (verified)

GlobeView is '(Experimental)'. 'No high-precision rendering at high zoom levels (> 12).' Only the 'lnglat' coordinate system is supported. 'Known rendering issues when using multiple views mixing GlobeView and MapView, or switching between the two.' TileLayer and MVTLayer support is experimental. Listed as not working: HeatmapLayer, ContourLayer, and TerrainLayer (the doc still lists TerrainLayer, contradicting what's-new). MaskExtension is unsupported. Straight GeoJSON edges follow Mercator lines, so use GreatCircleLayer for geodesics. Default is `parameters: {cullMode: 'back'}`. Source globe-view.ts: `getViewportType(viewState){ return viewState.zoom > 12 ? WebMercatorViewport : GlobeViewport; }`.

Source: https://raw.githubusercontent.com/visgl/deck.gl/v9.4.0/docs/api-reference/core/globe-view.md

### 5. ArcLayer greatCircle on MapLibre globe (verified)

The ArcLayer docs say: 'When using this layer with GlobeView or MapLibre's globe projection, arcs may be invisible when viewed from certain angles because GlobeView enables back-face culling by default', and give `parameters: {cullMode: 'none'}` as the fix. GreatCircleLayer has the same note. `greatCircle: true` only works with LNGLAT data; use numSegments (default 50) for smooth long arcs. Open PR #10670 says that under globe culling 'LineLayer rendered nothing and ArcLayer only a few specks at the arc tips'. Its fix flips the extrusion winding, and it is not merged. Separately, open issue #10398 (deck 9.2.11): `greatCircle: true` renders as a straight line on some Android GPUs, because the GLSL bool uniform is uploaded as f32.

Source: https://raw.githubusercontent.com/visgl/deck.gl/v9.4.0/docs/api-reference/layers/arc-layer.md

### 6. TripsLayer on MapLibre globe (verified)

TripsLayer docs: 'When using this layer with GlobeView or MapLibre's globe projection, trails may be invisible when viewed from certain angles because GlobeView enables back-face culling by default', with the workaround `parameters: {cullMode: 'none'}`. I found no other open globe-specific TripsLayer issue.

Source: https://raw.githubusercontent.com/visgl/deck.gl/v9.4.0/docs/api-reference/geo-layers/trips-layer.md

### 7. IconLayer / TextLayer / billboard occlusion on globe (verified)

Issue #10519 (open; deck 9.3.7, introduced in 9.3.3, MapLibre 5.6): 'GlobeView's default cullMode: back makes TextLayer and non-billboard IconLayer invisible over MapLibre globe; non-billboard icons also render 180° rotated.' Workaround: per-layer `parameters:{cullMode:'none'}`. Open PR #10750 (2026-09-25) adds project_globe_is_occluded(), a ray-sphere test, so IconLayer, TextLayer and billboard ScatterplotLayer are hidden behind the globe. Its TODO says it has not yet been checked against a MapLibre globe in interleaved mode. Until then, billboard icons on the far side of the globe stay visible.

Source: https://github.com/visgl/deck.gl/issues/10519

### 8. ScatterplotLayer artifacts: MapLibre interleaved + globe (verified)

Issue #10206 (open; deck 9.2.11, MapLibre 5.22): (a) z-fighting flicker while panning or zooming; (b) large-radius circles render as flat discs and do not follow the globe surface. Workaround for (a) only: layer `parameters: {depthCompare: 'always', cullMode: 'back'}`.

Source: https://github.com/visgl/deck.gl/issues/10206

### 9. H3HexagonLayer on globe (verified)

In the v9.4.0 source, `_shouldUseHighPrecision()` with highPrecision:'auto' returns true when `Boolean(viewport?.resolution)`. GlobeViewport has a `resolution` property, so on the globe the layer falls back to the slower PolygonLayer path instead of instanced ColumnLayer. This dates from the 2020 fix PR #5135 / issue #5125. I found no open H3 globe issues.

Source: https://raw.githubusercontent.com/visgl/deck.gl/v9.4.0/modules/geo-layers/src/h3-layers/h3-hexagon-layer.ts

### 10. HexagonLayer (aggregation) on globe (UNVERIFIED)

HexagonLayer is not on the GlobeView 'does not work' list. However, both its CPU path and its GPU (GLSL) path bin points on `viewport.projectPosition(p).xy` / `project_position(...).xy`. In GlobeViewport, projectPosition returns 3D sphere coordinates [sin(λ)cosφ·R, −cos(λ)cosφ·R, sinφ·R], and projectFlat is the identity on lng/lat. Binning on x/y alone would therefore distort bins and merge latitudes φ and −φ into the same bin. This is inferred from the source; I did not run it and found no issue or doc confirming it.

Source: https://raw.githubusercontent.com/visgl/deck.gl/v9.4.0/modules/aggregation-layers/src/hexagon-layer/hexagon-layer.ts

### 11. Picking in interleaved/globe (verified)

Issue #7544 'Globe View Tooltips show on other side of globe' (ArcLayer hover picks geometry hidden behind the globe) was closed as not planned. Issue #10755 (deck 9.4.0 + maplibre 6.11.2): interleaved picking misses objects over terrain until the map moves, because the view state has position [0,0,0] while the center elevation is about 2900 m. The fix, PR #10756, merged 2026-09-30 and is not in the 9.4.0 build on npm. Open issue #10736: standalone GlobeController cannot zoom past 12 ('n.getZoomAnchorStrength is not a function'); fix PR #10737 is open. This does not affect MapLibre-controlled cameras, as far as I can tell.

Source: https://github.com/visgl/deck.gl/issues/10755

### 12. beforeId regression in @deck.gl/maplibre (verified)

Issue #10733 (open, deck 9.4.0): with `beforeId`, MapLibre labels render under deck layers on first load. Cause: resolveMapLibreLayerGroups returns early unless map.isStyleLoaded(), while styledata fires while tiles are still loading. It corrects itself after the next setProps. Fix PR #10734 is open.

Source: https://github.com/visgl/deck.gl/issues/10733

### 13. React 19 / 19.3 issues (verified)

React 19.3.0 was published 2026-09-09. #10681 (open): MapLibreOverlay under StrictMode (deck 9.4.0, maplibre 6.7.0, React 19, react-map-gl 8.1.3) throws 'WebGL context already attached to device', and later pickObject calls then fail. Workaround: `new MapLibreOverlay({interleaved:true, layers, deviceProps:{_reuseDevices:true}})`. Fix PR #10682 is open. #9983 (open): hiding DeckGL with React 19 <Activity> finalizes Deck and resets the view state; workaround is CSS display:none. #10704 (open): deck 9.4.0 + react 19.3.0 + GoogleMapsOverlay interleaved renders nothing (Google overlay, not MapLibre). #9545 (open): deck.gl does not load during a Suspense fallback / loading.tsx.

Source: https://github.com/visgl/deck.gl/issues/10681

### 14. Next.js 16 / Turbopack issues (verified)

Next latest is 16.3.7 (2026-09-29). deck.gl issue search for 'turbopack' returns only #10266: 'this.device.limits is undefined' race on React unmount, reported on deck 9.2.9, React 19.2.0, Next 16.1.6. It is listed closed (completed) on 2026-05-02. The workaround mentioned is to defer `deck.finalize()` with setTimeout. I found no open deck.gl issue specific to Turbopack.

Source: https://github.com/visgl/deck.gl/issues?q=is%3Aissue+turbopack

### 15. MapLibre v6 breaking changes relevant to Next/Turbopack (verified)

v6.0.0 (2026-07-22) is ESM-only: no UMD, CSP or CJS builds. `import maplibregl from 'maplibre-gl'` must become `import * as maplibregl` or named imports. It requires WebGL2 and throws GPUInitializationError otherwise. `map.transform` is removed and Map composes Camera. All events are now classes. `styleimagemissing` is notify-only; use setMissingStyleImageResolver instead. zoomLevelsToOverscale defaults to 4. Nested GeoJSON properties are preserved. Official Turbopack/Next instructions: 'Turbopack turns new URL(... maplibre-gl-worker.mjs ...) into a hashed asset without emitting the worker's maplibre-gl-shared.mjs sibling... the map mounts but never requests a tile. Serve both files from public/.' Copy both files in predev/prebuild scripts and call setWorkerUrl('/maplibre/maplibre-gl-worker.mjs'). This is needed for both `next build` and `next build --webpack`.

Source: https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/docs/index.md

### 16. Google Photorealistic 3D Tiles: policies (attribution, caching, overlays) (verified)

Page last updated 2026-09-24. Caching: 'you must not pre-fetch, index, store, or cache any Content except under the limited conditions stated in the terms'; clients must honour Cache-Control (max-age, stale-while-revalidate, must-revalidate, private) and ETag. Banned: image analysis, machine interpretation, object detection or identification, geodata extraction or resale, and offline uses. Branding: the Google Maps logo, 16–19dp high with clear space, must not be overlapped by the renderer's logo (text 'Google Maps' is acceptable if space is tight). 3D Tiles data attribution: 'You must aggregate, sort, and display in a line, all attributions for displayed tiles', taken from glTF asset.copyright. For CesiumJS, set showCreditsOnScreen:true. Overlays: 'You may overlay your own 3D objects on Photorealistic 3D Tiles as long as the 3D objects aren't extracted, traced, or otherwise derived... from Photorealistic 3D Tiles.' In hybrid views, users must be able to tell which parts come from Google.

Source: https://developers.google.com/maps/documentation/tile/policies

### 17. Google Maps Platform ToS: no use with non-Google maps (verified)

The Core Services list includes 'Map Tiles API', so the general ToS restrictions apply to it. §3.2.3(e): 'To avoid quality issues and/or brand confusion, Customer will not use the Google Maps Core Services with or near a non-Google Map in a Customer Application.' §3.2.3(b): 'No Caching... except as expressly permitted under the Maps Service Specific Terms'; the Service Specific Terms have no Map Tiles API section, so there is no caching exception. §3.2.3(c) bans creating content from Google Maps Content, including training ML models. §3.2.3(d) bans re-creating Google products. The license restrictions ban use 'for High Risk Activities' (defined to include 'the creation or operation of weaponry') and for ITAR-controlled materials. ToS last modified 2026-08-26.

Source: https://cloud.google.com/maps-platform/terms

### 18. Google Photorealistic 3D Tiles: pricing and quotas (verified)

SKU 'Map Tiles API: Photorealistic 3D Tiles', category Enterprise, ID C6E1-98B2-DBD0 (global). 1,000 free per month, then per 1,000: $6.00 (to 100k), $5.10 (100,001–500k), $4.20 (500,001–1M), $3.30 (1M–5M), $2.40 (5M+). The SKU page describes the billable event as 'Request that returns a 3D tile'. The usage page says root tileset requests count against quota and renderer tile requests do not. A single root request allows 'at least three hours' of tile requests. Default quota is 10,000 root tileset queries per day, with unlimited renderer tile requests at 12,000 QPM. Billing must be enabled and an API key is required. Renderers must support copyright display: CesiumJS >= 1.91 or Cesium for Unreal >= 1.12.

Source: https://developers.google.com/maps/billing-and-pricing/pricing

### 19. Google 3D Tiles unavailable to EEA-billed projects (verified)

'Photorealistic 3D tiles are not available. The Map Tiles API will throw a 403 HTTP error when you request these types of tiles from EEA projects.' This applies to projects created after 8 July 2025 with an EEA billing address, or projects modified since then. Satellite 2D tiles are also unavailable to these projects, and Street View Tiles may not be used with any map.

Source: https://developers.google.com/maps/comms/eea/map-tiles

### 20. Google official FAQ on mixing 3D Tiles with other data (verified)

From a 2023-08-09 Google blog post: Cesium World Terrain combined with Photorealistic 3D Tiles is 'not recommended' because of reference-system differences. Overlaying other data (for example precise building models) is allowed. Neither the FAQ nor the docs grant any exception to the 'no use with non-Google maps' rule.

Source: https://mapsplatform.google.com/resources/blog/commonly-asked-questions-about-our-recently-launched-photorealistic-3d-tiles/?hl=en

### 21. Cesium ion Terms of Service (SaaS MLA) (verified)

Major update 2025-08-20. Sublicensing: 'This license does not permit you to include ion in your own solution that you make commercially available to other organizations'; that needs an integration license. Permitted use includes displaying Cesium Data Output to third parties, but only during the Term. §2.2.2 Offline: you may not copy or store output for offline use, although 'client-side and proxy-based caching are allowed as long as it is a general caching mechanism for performance that caches other internet traffic as well'. §2.2.3 Attribution: the 'Cesium ion' logo 'must be prominently displayed on the main application window'. Appendix B §4: third-party data may only be cached per HTTP headers. Tokens may only be used through ion.

Source: https://cesium.com/legal/terms-of-service/

### 22. Cesium ion: Google content terms (Appendix B-2) (verified)

Google content through ion is bound by the Map Tiles API Policies and Google's Acceptable Use Policy. The same restrictions apply: no scraping, no caching, no creating content from it, no re-creating Google products. It also states: 'e. No Use with Non-Google Maps. You will not use the Google Maps Content with or near a non-Google map in a Your Application.' No High Risk Activities, no Prohibited Territories, and no child-directed apps (COPPA).

Source: https://cesium.com/legal/terms-for-google/

### 23. Cesium ion pricing (verified)

Community: free, 'Personal and non-commercial use', 1,000 Google root tiles per month, 1,000 global imagery sessions, 15 GB streaming. Commercial: $149/mo (individual) or $524/mo (team), 5,000 Google root tiles, 150 GB streaming. Premium: $499/mo or $874/mo, 10,000 root tiles, 500 GB. Custom: contact sales. You need a paid plan if your company has more than $50K revenue or funding, for government projects, for funded research, or when you exceed the free limits. Integrating ion into solutions used outside your own organisation needs a separate integration license.

Source: https://cesium.com/platform/cesium-ion/pricing/

### 24. CesiumJS license and deck.gl Google 3D tiles path (verified)

cesium 1.145.0 (2026-09-01) and @cesium/engine 26.3.0 are Apache-2.0, so CesiumJS can load tile.googleapis.com/v1/3dtiles/root.json directly with a Google key and no ion. deck.gl's official google-3d-tiles example uses Tile3DLayer against the same URL, with no basemap. It collects `tile.content.gltf.asset.copyright` split on ';' into a credits string, and can switch between GlobeView and MapView. deck 9.4 says Tile3DLayer 'renders correctly on GlobeView'.

Source: https://raw.githubusercontent.com/visgl/deck.gl/master/examples/website/google-3d-tiles/app.jsx

### 25. Version facts (npm) (verified)

maplibre-gl latest is 6.11.2 (2026-09-24); 6.0.0 was released 2026-07-22. react-map-gl latest is 8.1.3 (peer maplibre-gl >=1.13.0). react 19.3.0 was released 2026-09-09. next latest is 16.3.7. PR #10684, which bumps deck.gl's own repo from maplibre-gl 5.14 to 6.4.1, was still open on 2026-09-09, so the repo's examples and tests may still run against v5 (inferred).

Source: https://registry.npmjs.org/maplibre-gl

## Recommendations

- Keep the core engine: MapLibre GL JS v6 (pin ~6.11.x) + @deck.gl/maplibre 9.4.0 MapLibreOverlay, interleaved:true. No rewrite is needed, but treat the globe as experimental and write the workarounds into the build prompt.
- Tell the builder to set `parameters: {cullMode: 'none'}` on every deck layer drawn in globe mode: ArcLayer/GreatCircleLayer (greatCircle:true, numSegments >= 64), LineLayer, PathLayer, TripsLayer, TextLayer, and any non-billboard IconLayer. Set `antialiasing: true` on Arc/Path/Line layers, or create the Map with `antialias: true`.
- Use IconLayer with billboard:true (the default) for aircraft, ships and satellites. Add a far-side filter: drop or dim points more than about 90° great-circle distance from the map center, or test the dot product with the camera direction. Until PR #10750 lands, billboards behind the globe still draw and can be picked (#7544 was closed as not planned).
- Set the projection only via `map.setProjection({type: 'globe'})` or `{type: 'mercator'}`. Never use 'vertical-perspective' or an interpolate expression: @deck.gl/maplibre throws 'Unsupported MapLibre projection'. Do not pass a custom view with id 'maplibre', so the overlay can swap GlobeView and MapView when the 2D/3D toggle changes.
- Do not use deck.gl HexagonLayer, HeatmapLayer or ContourLayer in globe mode. Pre-aggregate with h3-js (server or worker) and render with H3HexagonLayer (it goes to polygon mode on the globe automatically), or use MapLibre's native heatmap layer. Use HexagonLayer only in 2D Mercator.
- For large-radius ScatterplotLayer circles (conflict zones, quake radii), generate geodesic polygons (for example turf.circle) and render them with PolygonLayer or SolidPolygonLayer, since circles do not follow the globe (#10206). If flicker appears, use `parameters: {depthCompare: 'always'}` on the point layers.
- In Next 16 (Turbopack): put the map in a 'use client' component loaded with next/dynamic and ssr:false. Use named or namespace imports from maplibre-gl (it is ESM-only). Add scripts/copy-maplibre-worker.mjs, which copies maplibre-gl-worker.mjs and maplibre-gl-shared.mjs to public/maplibre, as predev and prebuild hooks, and call setWorkerUrl('/maplibre/maplibre-gl-worker.mjs'). Do not use the Vite `?worker&url` snippet from the deck.gl docs.
- For React 19.3 StrictMode: create the overlay through react-map-gl 8.1.3 useControl with `deviceProps: {_reuseDevices: true}` until PR #10682 merges. Do not hide the map with <Activity>; use CSS display:none. Do not mount deck in a Suspense fallback or loading.tsx. If unmount errors appear, defer overlay.finalize() with setTimeout.
- Work around the beforeId regression (#10733): after map 'load' and the first 'idle', call overlay.setProps({layers}) again so layer groups get inserted under the label layers.
- If MapLibre terrain is enabled, expect interleaved picking to miss over high terrain until 9.4.1 or a later release includes PR #10756. Either keep terrain off by default or upgrade once that release is out.
- Require Playwright visual regression tests: globe and Mercator screenshots per layer type (Arc greatCircle, Trips, Icon, Text, H3, Scatter), a far-side occlusion check, a hover/click picking test, and a 2D to globe toggle test. The upgrades agent's plan has not been tested on the v6 globe.
- Do NOT add Google Photorealistic 3D Tiles to the MapLibre/CARTO/OSM map, either as a deck Tile3DLayer or as an overlay. Map Tiles API is a Core Service, and §3.2.3(e) forbids use 'with or near a non-Google Map'. If you want it, make it an opt-in 'Photoreal City View' that needs a key (GOOGLE_MAPS_API_KEY) and is rendered standalone: deck Tile3DLayer in its own Deck with no basemap, or CesiumJS with globe.show=false and imageryProvider=false. Show the Google Maps logo and aggregated per-tile copyright, overlay only your own non-derived data, add no IndexedDB or service-worker tile cache, and hide the feature when the API returns 403 (EEA).
- Budget for Google 3D tiles: 1,000 free root sessions per month, then $6 per 1,000; each root session lasts about 3 hours; default cap is 10,000 root requests per day. Reuse one root session per page load rather than per interaction, and set a Cloud Console quota cap. Treat the OSINT/military-intel framing as a ToS risk because of the 'High Risk Activities' and weaponry wording, and flag it in the README.
- Prefer CesiumJS (Apache-2.0) with a direct Google key over Cesium ion if 3D tiles are used. Ion's free Community tier is non-commercial only (Commercial is $149/mo+), requires the 'Cesium ion' logo on the main window, bans offline storage, bans embedding ion in a product sold to other organisations, and passes through the same Google 'no non-Google maps' restriction. Default to keyless open data (MapLibre fill-extrusion with OpenFreeMap/OSM buildings, MapLibre raster-dem terrain) so no licensed 3D content is needed.

## Gaps (not verified)

- I could not run anything, so there is no hands-on render or picking test of deck.gl 9.4.0 interleaved on a MapLibre 6.x globe. Every layer verdict comes from docs, issues and source code.
- HexagonLayer on GlobeView is inferred from source only: bins use sphere x/y and latitudes ±φ could merge. No doc or issue confirms it.
- Whether a runtime `map.setProjection()` fires 'styledata' in MapLibre v6, so the overlay swaps views without being recreated, is unverified.
- Whether MapLibre's globe depth buffer hides far-side deck geometry once cullMode is 'none' in interleaved mode is unverified.
- The GitHub REST API and the github MCP were blocked for visgl/deck.gl in this session. Issue and PR details come from WebFetch summaries of github.com pages, which are generally reliable but not word-for-word.
- #10266 (Next 16 unmount race): the issue list shows it closed 2026-05-02, but the fixing PR and release version could not be confirmed.
- No open deck.gl or MapLibre issue specifically about React 19.3 or Next 16.3 with Turbopack was found beyond the ones listed. The `visgl:webgl-only` export condition from deck 9.4 has not been checked for Turbopack support.
- Whether a separate full-screen 'photoreal mode' tab in an app that also has a MapLibre/OSM map counts as 'near a non-Google Map' under §3.2.3(e) is a legal question with no Google guidance found. Treat it as a risk.
- Google's billing trigger for the 3D Tiles SKU is described inconsistently: the SKU page says 'Request that returns a 3D tile', while the usage page and Cesium count root tileset requests. The exact billable unit is not confirmed.
- Status of ArcLayer greatCircle rendering flat on some Android GPUs (#10398) in 9.4.0 is unknown.
- The GlobeView doc still lists TerrainLayer as unsupported while the 9.4 what's-new says it now works. That doc inconsistency is unresolved.
