# OSIRIS basemap/imagery sources and a licence-compliant replacement
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
**Question answered:** Which basemap and imagery sources does OSIRIS use for 2D Map, Night Mode, Satellite View, labels and 3D buildings? Is it the CARTO dark-matter GL style or CARTO rasters, Esri World Imagery, or something else? What exactly does /api/proxy-tiles proxy?

## Summary

This is confirmed in both the repo (raw master) and the live production bundle (osirisai.live /_next/static/chunks/38ncsfuq8twwc.js). OSIRIS has one vector basemap: CARTO Dark Matter GL, from https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json. It is used without an API key. The "Night Mode" button (Moon icon, label "MAP", mapStyle 'dark') is that CARTO style. There is no separate night basemap. The day/night terminator is a separate overlay layer, 'day-night-fill' (#000022 at 0.35 opacity, on by default). "Satellite View" (label "SAT") adds an Esri World Imagery raster at 0.85 opacity from https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}, with tileSize 256 and maxzoom 18. It sits directly below 'day-night-fill', so it covers every CARTO layer, labels included. It is fetched straight from the browser, not through the proxy, and no Esri attribution is set anywhere. Basemap labels are CARTO's own symbol layers, using CARTO glyphs and sprites. 3D Buildings are a fill-extrusion layer on the CARTO 'carto' vector source (source-layer 'building', render_height/render_min_height, minzoom 14.5). 3D Terrain uses AWS/Tilezen Terrain Tiles in terrarium encoding, loaded through a custom 'osiris-dem://' protocol (maxzoom 10, only in globe projection at zoom 10 and above). "2D Map" and "3D Globe" only switch the projection; both use the same CARTO style. Style Studio recolours only the overlay entity palette (the --map-* CSS vars for CCTV, satellites and flights), never the basemap.

/api/proxy-tiles is a generic GET pass-through: ?url=<encoded URL>. It only allows cartocdn.com and *.cartocdn.com hosts. It fetches upstream with UA 'Osiris-Tile-Proxy/1.0', a 15 s timeout and Next.js fetch-cache revalidate=31536000 (one year). It returns the body with the upstream Content-Type, 'Cache-Control: public, max-age=31536000, immutable' and 'Access-Control-Allow-Origin: *'. The map's transformRequest rewrites every URL containing 'cartocdn.com' to go through it: style.json, tiles.json, the carto.streets v1 MVT tiles from tiles-{a-d}.basemaps.cartocdn.com, sprites and glyph PBFs. A live test returned 200 application/x-protobuf behind Cloudflare. For self-hosting, the repo also ships an nginx location /proxy/tiles/<[a-d.]basemaps.cartocdn.com>/<path> that caches for 365 days in a 'tile_cache' zone. So OSIRIS proxies and caches CARTO content on the server for a year. CARTO's Basemaps Terms, last updated 29 September 2026, explicitly forbid 'proxying or caching the content on the server side' and 'offering the Basemap Services to third parties as a substitute for their own access (for example as a proxy or tile-serving service)'. They also require 'Customer's own unique API keys' and attribution that is 'prominent and conspicuous'. CARTO's attribution page adds 'Not hidden, faded or behind a click'. OSIRIS uses attributionControl {compact:true}, which collapses it. Issue #316 (open, 2026-09-04) states outright that OSIRIS uses CARTO Dark Matter. Issue #406 (open, 2026-09-30) reports missing OSM attribution.

Compliant path for a replica: CARTO's carto.streets v1 schema is OpenMapTiles-compatible, with the same layer names and the same building fields (render_height, render_min_height, hide_3d, colour). OpenFreeMap serves unmodified OpenMapTiles with no key, no limits and commercial use allowed. So OpenFreeMap 'dark' (background rgb(12,12,12), water rgb(27,27,29)), recoloured to the Dark Matter palette, is a near drop-in. Fiord (#45516E / #38435C) is blue-grey and not a Dark Matter match. The building-extrusion expression carries over unchanged once the source is switched from 'carto' to 'openmaptiles'. CARTO stays possible as an optional path, but only with a user-supplied key (?key=), loaded directly by the browser, and with the attribution visible and not collapsed. CARTO's FAQ says vector GL styles currently still work without a key but 'we may extend the key requirement to vector in future'. Keyless raster tiles already show an 'API key required' watermark.

## Findings

### 0. Base style used by OSIRIS (2D Map, 3D Globe, Night Mode) (verified)

src/components/OsirisMap.tsx (line ~310): `const styleUrl = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';` passed as `style` to new maplibregl.Map with center [facingLng,20], zoom 1.8, minZoom 1.5, maxZoom 18, maxPitch 85. The same literal appears in the production chunk https://osirisai.live/_next/static/chunks/38ncsfuq8twwc.js. No ?key= parameter, so CARTO is used keyless. The 2D/3D toggle only calls applyMapProjection('mercator'|'globe'). Selecting 2D also turns off terrain_elevation and terrain_3d.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/components/OsirisMap.tsx

### 1. Night Mode = CARTO Dark Matter (not a separate style) (verified)

src/app/page.tsx: `<ViewSegment ... active={mapStyle === 'dark'} onClick={() => setMapStyle('dark')} title="Night Mode" icon={Moon} label="MAP" />` and `<ViewSegment ... active={mapStyle === 'satellite'} ... title="Satellite View" icon={Satellite} label="SAT" />`. The production chunk 1136nyajv2-oe.js passes mapStyle: "satellite"===tN ? '<Esri URL>' : 'dark'. 'Night Mode' is just the default CARTO dark basemap. A separate 'day_night' layer (default ON) adds a terminator fill: `{ id: 'day-night-fill', type: 'fill', paint: { 'fill-color': isGhost ? '#0D0030' : '#000022', 'fill-opacity': 0.35 } }`.

Source: https://github.com/simplifaisoul/osiris/blob/master/src/app/page.tsx

### 2. Satellite View imagery source (verified)

An effect on mapStyle !== 'dark' adds source 'satellite-tiles' {type:'raster', tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize:256, maxzoom:18} and layer {id:'satellite-layer', type:'raster', paint:{'raster-opacity':0.85}}, inserted before 'day-night-fill'. That places it above every CARTO layer, labels included, and below all OSIRIS overlays. Toggling back sets visibility 'none'. The source has no attribution property. A GitHub code search for 'Earthstar' in the repo returns 0 hits, so there is no Esri/Vantor credit. The URL does not contain cartocdn, so it is fetched directly from the browser, not proxied. Confirmed in production chunk 38ncsfuq8twwc.js.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/components/OsirisMap.tsx

### 3. What /api/proxy-tiles proxies (verified)

GET /api/proxy-tiles?url=<encoded>. The target hostname must equal 'cartocdn.com' or end with '.cartocdn.com', otherwise 403 {error:'Forbidden domain'}; a missing url gives 400. Upstream: fetch(url, {signal: AbortSignal.timeout(15000), headers:{Accept:'*/*','User-Agent':'Osiris-Tile-Proxy/1.0'}, next:{revalidate:31536000}}). The response keeps the upstream content-type, with headers 'Cache-Control: public, max-age=31536000, immutable' and 'Access-Control-Allow-Origin: *'. Client side: `transformRequest: (url) => url.includes('cartocdn.com') ? { url: `${origin}/api/proxy-tiles?url=${encodeURIComponent(url)}` } : { url }`. That covers the style.json, tiles.json, MVT tiles, sprite (https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite) and glyphs (https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf). Live test on 2026-09-30: /api/proxy-tiles?url=https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1/2/2/1.mvt returned HTTP 200, content-type application/x-protobuf, cache-control public max-age=31536000 immutable, server cloudflare, cf-cache-status MISS. Proxying style.json returned 200 JSON, 70,431 bytes.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/proxy-tiles/route.ts

### 4. Self-host nginx tile cache (second CARTO proxy) (verified)

nginx/nginx.conf: `location ~ ^/proxy/tiles/(?<target_domain>(?:[a-d]\.)?basemaps\.cartocdn\.com)/(?<target_path>.*)$ { proxy_pass https://$target_domain/$target_path$is_args$args; proxy_cache tile_cache; proxy_cache_valid 200 304 365d; proxy_cache_valid any 1m; proxy_cache_lock on; add_header Cache-Control "public, max-age=31536000, immutable"; }`, plus a catch-all 403 for other /proxy/tiles/ paths. scratch/architecture.html describes 'Cache Layer: 10GB Disk / 100MB RAM Zone tile_cache' and 'Target: basemaps.cartocdn.com (cached 1 year immutable)'.

Source: https://github.com/simplifaisoul/osiris/blob/master/nginx/nginx.conf

### 5. CARTO Dark Matter style internals (to match the look) (verified)

The live style.json has name 'Dark Matter' and 93 layers. There is one vector source 'carto' with url https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json, which lists tiles-{a,b,c,d}.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt at minzoom 0, maxzoom 14, with attribution '© CARTO, © OpenStreetMap contributors'. Vector layers: water, waterway, landcover, landuse, mountain_peak, park, boundary, aeroway, transportation, building, water_name, transportation_name, place, housenumber, poi, aerodrome_label. Building fields: colour, hide_3d, render_height, render_min_height. These are the OpenMapTiles names. Key paints: background #0e0e0e; landcover #0e0e0e; water #2C353C; boundary_country_outline line #2C353C opacity 0.5 width 8; boundary_country_inner line rgba(92,94,94,1)@z4 to rgba(102,102,102,1)@z6, width 1 to 1.5; place_country_1 text rgba(158,182,189,1)@z3 to rgba(120,141,147,1)@z6 with halo #111 width 1; the 'building' fill is transparent. The layer IDs run background, landcover, park_*, landuse*, waterway, boundary_county/state, water, water_shadow, aeroway-*, tunnel_*/road_*/bridge_* (case/fill), rail, building, building-top, boundary_country_*, waterway_label, watername_*, place_* (hamlet to continent, city_r4-r7, capital_dot_z7), poi_stadium, poi_park, roadname_*, housenumber.

Source: https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json

### 6. public/dark-matter-style.json (local snapshot, not used by the live map) (verified)

The repo ships public/dark-matter-style.json: Maputnik metadata, version 8, 93 layers, explicit tiles-a..d MVT URLs, CARTO sprite and glyphs. It is served at https://osirisai.live/dark-matter-style.json (HTTP 200). The production map constructor still loads the cartocdn URL through the proxy. The snapshot is referenced only in a src/middleware.ts comment and in the tools/preview-smoke.mjs 'recovery' scenario. It still points at cartocdn.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/public/dark-matter-style.json

### 7. 3D Buildings (verified)

LayerPanel.tsx: `{ key: 'terrain_3d', label: '3D Buildings', description: 'City detail · zoom 14.5+' }`. OsirisMap.tsx adds {id:'osiris-3d-buildings', source:'carto', 'source-layer':'building', type:'fill-extrusion', minzoom:14.5}. Paint: 'fill-extrusion-color' interpolates linearly on render_height: 0 #1a1a2e, 20 #16213e, 50 #0f3460, 120 #533483, 300 #e94560. 'fill-extrusion-height' interpolates on zoom from 14.5→0 to 15.5→render_height. 'fill-extrusion-base' does the same with render_min_height. 'fill-extrusion-opacity' goes 14.5→0, 15→0.7. The camera eases to pitch 50 if pitch < 40. The code comment reads 'CARTO's already-loaded vector tiles include the building footprints and render heights.'

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/components/OsirisMap.tsx

### 8. 3D Terrain (DEM) (verified)

src/lib/terrain-tiles.ts: BASE_URL 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/'. Fetched directly (cache:'force-cache', credentials:'omit') through a custom MapLibre protocol 'osiris-dem://{z}/{x}/{y}', with an 8 MB LRU, at most 2 concurrent requests and a 12 s timeout. src/lib/map-terrain.ts: source 'osiris-terrain-dem' {type:'raster-dem', encoding:'terrarium', tileSize:256, maxzoom:10, attribution: Tilezen joerd attribution link}, setSourceTileLodParams(10,1.25), setTerrain exaggeration 1. TERRAIN_MIN_ZOOM = 10, TERRAIN_SETTLE_MS = 500. It is enabled only when terrain_elevation is on AND the projection is globe. The AWS registry lists the bucket as usable with no AWS account; attribution per https://github.com/tilezen/joerd/blob/master/docs/attribution.md.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/lib/map-terrain.ts

### 9. Globe sky/atmosphere values (verified)

Globe projection: map.setSky({'sky-color':'#04040A','sky-horizon-blend':0.5,'horizon-color':'#0a0a1a','horizon-fog-blend':0.3,'fog-color':'#04040A','fog-ground-blend':0.9}), and eases to pitch 20 if flat. The IP-sweep mode uses {'sky-color':'#0A0A0F','sky-horizon-blend':0.02,'horizon-color':'#0A0A0F','horizon-fog-blend':0.02}. MapLibre worker is served from /vendor/maplibre/<version>/maplibre-gl-worker.mjs (MapLibre 6, WebGL2 only).

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/components/OsirisMap.tsx

### 10. Style Studio does not touch the basemap (verified)

src/lib/map-palette.ts MAP_VARS covers only overlay colours: --map-cctv, --map-sat-comms/military/navigation/earth/science/other, --map-flight-civil/private/gov/military/unknown. OsirisMap's setPaintProperty calls target only overlay layers (cctv-dots, alert-pin-*, malware-new-ring, arcgis layers, and similar), never CARTO layers.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/lib/map-palette.ts

### 11. Attribution as implemented (verified)

attributionControl: {compact: true, customAttribution: 'Geocoding © OpenStreetMap contributors'}. The code comment says the style credits CARTO and OSM, which arrives via the tiles.json attribution. compact:true collapses the credit behind an (i) button. Issue #406 'Attrribution for OpenStreetMap appears to be missing' (natrius) was opened 2026-09-30 and is open.

Source: https://github.com/simplifaisoul/osiris/issues/406

### 12. Issue #316 confirms CARTO Dark Matter (verified)

'Map basemap uses CARTO/OSM boundary data that does not reflect India's official northern boundaries (J&K, Ladakh)', by krishnag-12, opened 2026-09-04, open, labels Important/To-Review/Bug. The body says 'The OSIRIS project uses CARTO Dark Matter basemaps' and points to the hardcoded style URL in src/components/OsirisMap.tsx. It suggests a Survey of India GeoJSON overlay, a configurable basemap (MapTiler, or Mapbox worldview=IN), region-aware tiles, or self-hosting.

Source: https://github.com/simplifaisoul/osiris/issues/316

### 13. CARTO Basemaps Terms (last updated 29 September 2026) (verified)

Verbatim: 'Customer must always use the Basemap Services with Customer's own unique API keys.' Listed as unacceptable uses: '...offering the Basemap Services to third parties as a substitute for their own access (for example as a proxy or tile-serving service), or downloading or extracting map content in bulk'; 'caching map content on an end user's device or in an end user's browser for longer than thirty (30) days'; 'proxying or caching the content on the server side'. Permitted: 'displaying CARTO basemaps to the users of Customer's own websites... where those users' requests are served directly by the Basemap Services'. Fair use: Non-Commercial 5,000,000 tile requests per month, Commercial 1,000,000 per month, aggregated across keys. Commercial Use covers anything 'offered for a fee, that generates revenue (including through advertising), or that is operated by or on behalf of a business'. Section 13 attribution: 'attribution to both OpenStreetMap and CARTO... prominent and conspicuous'; CARTO may revoke a key if this is not met. The free service is revocable at any time. OSIRIS's /api/proxy-tiles (a Next.js one-year fetch cache) and its nginx 365-day proxy_cache are server-side proxying/caching, which the terms forbid.

Source: https://carto.com/legal/basemap-terms/

### 14. CARTO key mechanics and raster vs vector status (verified)

FAQ: raster basemaps need a key and show an 'API key required' watermark without one ('Your map still works. The watermark is a notice, not an outage'). Vector GL styles currently work without a key, but 'we may extend the key requirement to vector in future'. Key usage: https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json?key=YOUR_KEY, and the same key works for raster, e.g. https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=YOUR_KEY. The equivalent dark raster is dark_all. Keys are free with no account ('Free, no account, in your inbox in a minute') via the form or support-basemaps@carto.com. Paid: Commercial $500/mo or $5,000/yr up to 10M; Commercial Plus $1,500/mo or $15,000/yr up to 50M. Keys registered before 23 Sep 2026 keep working until 30 Nov 2026.

Source: https://docs.carto.com/faqs/carto-basemaps

### 15. CARTO attribution rule (verified)

Paste line: `© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/attribution/">CARTO</a>`. Rules: 'Visible on the map, legible, in any corner. Not hidden, faded or behind a click.' and 'Maps without the credit can have their basemap key suspended'. A collapsed compact attribution control conflicts with 'behind a click'.

Source: https://carto.com/attribution/

### 16. OpenFreeMap (compliant replacement) (verified)

'There's no registration, no user database, no API keys, and no cookies.' 'There are no limits on the number of map views or requests.' Commercial use: 'Yes.' Required attribution: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap' (the OpenFreeMap part is optional). Self-hosting is encouraged; the code is MIT; 'The map schema is unmodified OpenMapTiles.' Styles all return 200: https://tiles.openfreemap.org/styles/dark, /fiord, /liberty, /positron, /bright. The 'dark' style has 47 layers; source 'openmaptiles' {type:'vector', url:'https://tiles.openfreemap.org/planet'} plus raster 'ne2_shaded' (natural_earth/ne2sr, maxzoom 6); sprite https://tiles.openfreemap.org/sprites/ofm_f384/ofm; glyphs https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf. Its background is rgb(12,12,12) and water rgb(27,27,29). Fiord's background is #45516E and water #38435C, blue-grey and not a Dark Matter match.

Source: https://openfreemap.org/

### 17. OpenMapTiles building fields (the extrusion code ports directly) (verified)

The building layer has render_height ('An approximated height from levels and height of the building or building:part'), render_min_height, colour, and hide_3d ('If true, the building (part) should not be rendered in 3D'). These match CARTO carto.streets v1's building fields exactly.

Source: https://openmaptiles.org/schema/

### 18. Esri World Imagery terms and attribution (verified)

The live MapServer?f=json returns copyrightText 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community' (Vantor is the new name for Maxar). maxLOD is 23, but OSIRIS caps at maxzoom 18. Item 10df2279f9684e4a9f6a7f08febac2a9 licenseInfo: 'This work is licensed under the Esri Master License Agreement... Export: This layer is not intended to be used to export tiles for offline.' A keyless tile GET /tile/3/3/4 returned 200 image/jpeg. Esri's MapLibre terms page says 'You are required to include attribution in all applications that use Esri technology'. Esri's blog asks open-source developers on legacy tile services to move to the new ArcGIS basemap layer service (https://www.esri.com/arcgis-blog/products/developers/developers/open-source-developers-time-to-upgrade-to-the-new-arcgis-basemap-layer-service).

Source: https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=json

### 19. Keyless imagery alternatives (tested endpoints) (verified)

NASA GIBS: https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png (200 image/png; real night-lights imagery, max level 8) and .../BlueMarble_ShadedRelief_Bathymetry/default/2004-08-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg (200). GIBS asks for this acknowledgement: 'We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).' EOX Sentinel-2 cloudless: https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg (200), licensed CC BY-NC-SA 4.0 for non-commercial use; commercial use needs an EOX Commercial Attribution-RestrictedUse 1.2 licence. Attribution: 'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data <year>)'.

Source: https://cloudless.eox.at/documentation/license

### 20. AWS Terrain Tiles (verified)

'A global dataset providing bare-earth terrain heights, tiled for easy usage and provided on S3.' Buckets elevation-tiles-prod (us-east-1) and elevation-tiles-prod-eu (eu-central-1); no AWS account required ('--no-sign-request'). Attribution per the Tilezen joerd attribution.md. Managed by Mapzen, a Linux Foundation project.

Source: https://registry.opendata.aws/terrain-tiles/

## Recommendations

- In the build prompt, state exactly what OSIRIS uses: CARTO Dark Matter GL vector style for 2D, 3D Globe and 'Night Mode'; an Esri World Imagery raster at 0.85 opacity for 'Satellite View'; CARTO symbol layers for labels; a fill-extrusion on the OpenMapTiles-schema 'building' source-layer for 3D buildings; AWS terrarium DEM for 3D terrain. Then tell Opus not to copy the CARTO proxy.
- Default basemap: MapLibre GL JS with OpenFreeMap 'dark' (https://tiles.openfreemap.org/styles/dark), loaded directly by the browser. After style load, recolour it toward Dark Matter with setPaintProperty or a patched style JSON committed to the repo: background and landcover #0e0e0e, water #2C353C, country-boundary outline #2C353C at 0.5 opacity width 8 plus an inner line rgba(92,94,94)→rgba(102,102,102) width 1→1.5, country labels rgba(158,182,189)→rgba(120,141,147) with halo #111 width 1, buildings transparent in 2D, and the ne2_shaded raster hidden. Do not use 'fiord' for the Dark Matter look (#45516E, blue-grey).
- Do NOT build a /api/proxy-tiles route or nginx proxy_cache for CARTO, and no transformRequest that rewrites third-party tile URLs to the app server. CARTO's terms from 29 Sep 2026 forbid server-side proxying and caching and require the customer's own key. If a proxy or offline mode is wanted, self-host an OpenMapTiles/Protomaps PMTiles extract instead.
- Optional CARTO mode: read NEXT_PUBLIC_CARTO_BASEMAP_KEY. If set, use https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json?key=<key> fetched directly by the browser, and append ?key= to the sprite, glyph and tile URLs it pulls. If unset, fall back to OpenFreeMap. Warn that keyless CARTO vector access may stop working, since CARTO says 'we may extend the key requirement to vector in future'.
- Attribution: use a non-compact, always-visible MapLibre AttributionControl (compact:false). Credits: '© OpenStreetMap contributors' (link to https://www.openstreetmap.org/copyright) + 'OpenFreeMap © OpenMapTiles' (or '© CARTO' in CARTO mode); in Satellite mode add 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community'; with terrain on add the Tilezen joerd credit link; for any Nominatim use add 'Geocoding © OpenStreetMap contributors'. This avoids OSIRIS issue #406.
- Satellite View improvement: set the attribution field on the Esri raster source, and use maxzoom 19 or higher (the service's maxLOD is 23). Insert the raster below the basemap's label and boundary symbol layers (beforeId = first symbol layer of the base style) and above land and water, rather than below 'day-night-fill' as OSIRIS does. That keeps place labels readable over imagery. Optionally support ARCGIS_API_KEY and Esri's newer basemap styles service. Keyless fallback: EOX s2cloudless (non-commercial CC BY-NC-SA) or NASA GIBS BlueMarble.
- 'Night Mode' improvement: offer a real night-lights layer, NASA GIBS VIIRS_Black_Marble (EPSG:3857 WMTS, GoogleMapsCompatible_Level8, keyless, with the GIBS acknowledgement), blended under the dark vector style. Keep the separate day/night terminator overlay: fill #000022 at 0.35 opacity (#0D0030 in Ghost theme), default ON.
- 3D buildings: reuse OSIRIS's extrusion exactly but point source at 'openmaptiles' (or 'carto' in CARTO mode). Settings: source-layer 'building', minzoom 14.5, filter ['!=',['get','hide_3d'],true], colour ramp on render_height 0 #1a1a2e / 20 #16213e / 50 #0f3460 / 120 #533483 / 300 #e94560, height and base interpolated on zoom 14.5→0 and 15.5→render_height/render_min_height, opacity 14.5:0 → 15:0.7, and ease pitch to 50.
- 3D terrain: raster-dem from https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png, encoding 'terrarium', tileSize 256, maxzoom 10, enabled only at zoom 10 and above after a 500 ms settle, exaggeration 1, with the Tilezen attribution. Globe sky: sky-color #04040A, sky-horizon-blend 0.5, horizon-color #0a0a1a, horizon-fog-blend 0.3, fog-color #04040A, fog-ground-blend 0.9; ease to pitch 20 on globe.
- Make the basemap provider a single config module (style URL, attribution, building source id, optional key) so it can be swapped without code changes. This covers the India worldview request in issue #316 (for example a MapTiler or Mapbox worldview option, or a boundary overlay).

## Gaps (not verified)

- UNVERIFIED: Esri's exact current rule on whether the legacy server.arcgisonline.com World_Imagery tiles may be used in non-ArcGIS commercial apps without an ArcGIS Location Platform key. Keyless tiles return 200 today, the licence is the Esri Master License Agreement, and the Esri attribution doc page could not be text-extracted, so the exact 'Powered by Esri' wording was not verified.
- UNVERIFIED: whether and when CARTO will enforce keys on vector/GL endpoints. The FAQ says only 'may extend ... in future'. Keyless vector tiles and style.json returned 200 on 2026-09-30.
- Could not confirm whether osirisai.live has any agreement or key with CARTO. No key appears in the requested URLs or the production bundle.
- EOX s2cloudless year-by-year licensing (e.g. whether the 2016 mosaic is CC BY 4.0) was not verified; the licence page describes only non-commercial CC BY-NC-SA 4.0 and a paid commercial licence.
- The NASA GIBS maximum zoom and exact layer identifiers were confirmed only for the two test tiles (VIIRS_Black_Marble 2016-01-01 Level8, BlueMarble_ShadedRelief_Bathymetry 2004-08-01 Level8); the full GIBS capabilities document was not read.
- The GitHub REST API was blocked for this repo in this session, so repo file inventory came from raw.githubusercontent.com and GitHub code search, which is indexed at commit d972d9af. Raw master matched the production bundle for every basemap-related line checked.
