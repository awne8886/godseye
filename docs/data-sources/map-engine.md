# map-engine — probe log

All map sources are fetched **by the browser, straight from the tile host** (hosts in
`src/config/hosts.ts`, CSP `connect-src`/`img-src`); nothing is proxied or cached server-side.
Probes used the honest UA `GODSEYE/0.1.0 (+https://github.com/awne8886/godseye; contact …/issues)`
and `Origin: http://localhost:3000` to record CORS.

## Wave A (probed 2026-09-30 ~18:10Z)

| URL | Status | Latency | CORS | Cache-Control | Licence / attribution | Notes |
|---|---|---|---|---|---|---|
| `https://tiles.openfreemap.org/styles/dark` | 200 | 0.25 s | `*` | `public, max-age=86400` | OpenFreeMap; © OpenMapTiles; data © OpenStreetMap (ODbL). We set `sources.openmaptiles.attribution` ourselves (never render the upstream HTML) | 47 layers; captured as `src/lib/map/__fixtures__/openfreemap-dark.2026-09-30.json`. `landcover_wood` uses `fill-pattern: wood-pattern` (not in sprite → dropped); `place_town/city/city_large` use `circle-11` (not in sprite → resolved in code as a gold SDF dot) |
| `https://tiles.openfreemap.org/planet` (TileJSON) | 200 | 0.42 s | `*` | `public, max-age=86400` | as above | tiles `planet/20260927_080001_pt/{z}/{x}/{y}.pbf`, maxzoom 14; `building` layer carries `render_height`, `render_min_height`, `hide_3d` |
| `https://tiles.openfreemap.org/sprites/ofm_f384/ofm.json` | 200 | 0.20 s | `*` | `public, max-age=315360000` | as above | 264 images; has `circle_11` but **not** `circle-11` |
| `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/4` | 200 (image/jpeg, 15.8 kB) | 0.25 s | `*` | `max-age=86400` | "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community" (Esri Master License Agreement) | `{z}/{y}/{x}` order; Satellite View uses maxzoom 19, 256 px, under boundaries/labels, REFERENCE chip |
| `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/3/2/4.png` | 200 (image/png, 88 kB) | 0.42 s | `*` | `max-age=0, no-store` | NASA GIBS acknowledgement ("imagery provided by services from NASA's GIBS, part of NASA ESDIS") | Level8 → maxzoom 8. `no-store` means the browser never caches it, so the night-lights protocol keeps a 48-tile decoded LRU, ≤ 2 concurrent fetches, abort-aware; tiles wholly in daylight are never fetched. Label "BLACK MARBLE 2016 · REFERENCE" |
| `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/2026-09-29/GoogleMapsCompatible_Level9/3/2/4.jpg` | 200 (image/jpeg, 20 kB) | 0.39 s | `*` | `max-age=0, no-store` | NASA GIBS acknowledgement | previous UTC day (today's mosaic is partial); maxzoom 9; dated chip "VIIRS TRUE COLOUR YYYY-MM-DD · REFERENCE" |
| `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/163/395.png` | 200 (image/png, 85 kB) | 0.25 s | `*` (sent when `Origin` is present) | none; `Last-Modified: 2017-11-11` | Mapzen/Tilezen Joerd, attribution per https://github.com/tilezen/joerd/blob/master/docs/attribution.md | `raster-dem`, `encoding: 'terrarium'`, 256 px; we download to z 12 (`setSourceTileLodParams(12, 1.25)`), terrain engages at z ≥ 10 after a 500 ms settle |

## Browser behaviour seen in the sandbox e2e run (2026-09-30)

Headless Chromium behind the sandbox egress proxy intermittently fails tile requests with
`net::ERR_TOO_MANY_RETRIES` (curl from the same host gets 200 in < 0.5 s), so the first map `idle`
can take 30–90 s there. The e2e helpers (`e2e/map-engine/helpers.ts`) allow 120 s and ignore
`net::ERR_*` transport errors only when `E2E_IGNORE_HTTPS_ERRORS=1`.

## Phase 3 round-1 re-probe (2026-09-30 22:42Z, curl, honest UA, `Origin: http://localhost:3000`)

| URL | Status | Latency | Size | CORS | Notes |
|---|---|---|---|---|---|
| `https://tiles.openfreemap.org/styles/dark` | 200 `application/json` | 0.34 s | 20,959 B | `*` | unchanged: 13 name-based `text-field`s use the `name:latin`/`name:nonlatin` bilingual stack (replaced by `coalesce(name:en, name_en, name)`, visual-qa m18); `highway_name_motorway` uses `ref` (kept) |
| `https://tiles.openfreemap.org/planet` (TileJSON) | 200 `application/json` | 0.43 s | 19,254 B | `*` | tiles `planet/20260927_080001_pt/{z}/{x}/{y}.pbf`, minzoom 0, maxzoom 14, bounds ±180/±85.05113. Now fetched by the page together with the style and inlined into the source (same-host https templates only), so a TileJSON failure takes the style's retry-with-backoff path; captured as `src/lib/map/__fixtures__/openfreemap-planet-tilejson.2026-09-30.json` (without `vector_layers`) |
| `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/4` | 200 `image/jpeg` | 0.16 s | 15,791 B | `*` | unchanged |
| `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/3/2/4.png` | 200 `image/png` | 0.47 s | 88,471 B | `*` | unchanged |
| `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/163/395.png` | 200 `image/png` | 0.19 s | 85,093 B | `*` | unchanged |

Basemap tile failures in the browser (e.g. the sandbox proxy's `net::ERR_TOO_MANY_RETRIES`) now
surface as a `BASEMAP OFFLINE · [LAST TILE hh:mm UTC ·] RETRYING` chip and
`data-basemap-state="offline"` on the map container after 3 consecutive failed tiles, with
`map.refreshTiles('openmaptiles')` retried at 2 s × 2ⁿ (≤ 60 s) until a tile arrives.

## Phase 3 round-1 perf re-probe (2026-10-01 01:02Z, curl, honest UA, `Origin: http://localhost:3000`)

| URL | Status | Latency | Size | CORS | Notes |
|---|---|---|---|---|---|
| `https://tiles.openfreemap.org/styles/dark` | 200 | 0.23 s | 20,959 B | `*` | unchanged; still names `https://tiles.openfreemap.org/planet` as the vector TileJSON |
| `https://tiles.openfreemap.org/planet` | 200 | 0.27 s | 19,254 B | `*` | unchanged; now requested in parallel with the style (`src/lib/map/basemap-fetch.ts`), used only when the style names exactly this URL |
| GIBS `VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/3/2/4.png` | 200 | 0.68 s | 88,471 B | `*` | unchanged |

Browser requests now use `credentials: 'same-origin'` (sends nothing cross-origin, same as `omit`)
so an app-shell `<link rel="preload" as="fetch" crossorigin>` for the two URLs above can be reused.

## Re-probe 2026-10-01 (round 3b, honest UA)

| URL | Status | Latency | Size | CORS | Notes |
|---|---|---|---|---|---|
| `https://tiles.openfreemap.org/styles/dark` | 200 | 0.28 s | 20,959 B | `*` | unchanged |
| `https://tiles.openfreemap.org/planet` | 200 | 0.12 s | 19,254 B | `*` | unchanged; Cloudflare HIT, `max-age=86400`; tiles now under `planet/20260927_080001_pt/` |

In the sandbox the browser's tile requests intermittently fail at the egress proxy
(`net::ERR_TOO_MANY_RETRIES`), not at OpenFreeMap: curl from the same host gets 200. Those failed
tiles are what left holes ("black wedge") in the globe; the map now reports them as
BASEMAP INCOMPLETE · N TILES MISSING · RETRYING.

## Re-probe 2026-10-01 06:50Z (round 4, curl, honest UA, `Origin: https://example.org`)

| Upstream | Status | Latency | CORS | Notes |
|---|---|---|---|---|
| OpenFreeMap `styles/dark` | 200 | 0.29 s | `*` | style JSON; now fetched with a 15 s per-request deadline, retried after 2/4/8/16/30 s (BASEMAP UNAVAILABLE meanwhile) |
| OpenFreeMap `planet` TileJSON | 200 | 0.28 s | `*` | tiles `planet/20260927_080001_pt/{z}/{x}/{y}.pbf` |
| OpenFreeMap pbf 3/4/2 | 200 | 0.22 s | `*` | failed tiles are now retried by id (`refreshTiles(source, ids)`), never the whole view |
| AWS Terrarium 10/163/395 | 200 | 0.19 s | `*` | keyless; a DEM outage after an earlier engage now reads "Terrain unavailable" |

Auth: none. Licences unchanged (OpenFreeMap/OpenMapTiles/OSM ODbL attribution; Terrarium: Mapzen/AWS Open Data with its attribution).

## Re-probe 2026-10-01 19:15Z (round 5, curl, honest UA, `Origin: https://example.org`)

| Upstream | Status | Latency | Size | CORS | Cache | Notes |
|---|---|---|---|---|---|---|
| OpenFreeMap `styles/dark` | 200 `application/json` | 0.35 s | 20,959 B | `*` | `public, max-age=86400`, Cloudflare HIT | version 8, 47 layers, sources `ne2_shaded`, `openmaptiles` (`url` = `https://tiles.openfreemap.org/planet`); unchanged vs the 2026-09-30 fixture |
| OpenFreeMap `planet` TileJSON | 200 `application/json` | 0.39 s | 19,254 B | `*` | `public, max-age=86400`, Cloudflare HIT | tiles `planet/20260927_080001_pt/{z}/{x}/{y}.pbf`, minzoom 0, maxzoom 14, bounds ±180/±85.05113 |

Changes in how the browser uses them (no new hosts, no keys):
- The style and the TileJSON are memoised per URL across retry attempts (`createBasemapStyleLoader`):
  a retry asks again only for the document that failed (the sandbox proxy failed one of the two
  per attempt for > 90 s in round 5). Only validated documents are kept (a v8 style; a TileJSON with
  same-host https tiles); a failed, timed-out or invalid one is fetched again.
- Tile failures of the imagery overlays (Esri World Imagery, GIBS true colour, GIBS Black Marble) are
  now reported like the basemap's: `· N TILES MISSING` / `· SOURCE OFFLINE · LAST TILE hh:mm UTC` on
  their dated REFERENCE chips, failed tiles retried by id with backoff (2 s × 2ⁿ, ≤ 60 s). MapLibre
  does not report 404s (it over-zooms the parent tile), so only real failures count.
- BASEMAP LOADING shows from the moment the map area mounts (before the style arrives) until the
  first frame with basemap tiles has been painted.
