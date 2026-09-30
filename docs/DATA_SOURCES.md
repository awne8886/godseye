# GODSEYE data sources — probe log and licences

Every upstream is probed with `curl` from the build machine before it is wired (contract §0.4).
Each agent appends its probes under its own heading. Columns: URL · HTTP status · latency · CORS
(`Access-Control-Allow-Origin` when requested with an Origin) · auth · licence / attribution · notes.
All probes send the honest User-Agent `GODSEYE/<version> (+https://github.com/awne8886/godseye; contact …)`.

## lead (Setup, probed 2026-09-30)

| URL | Status | Latency | CORS | Auth | Licence / attribution | Notes |
|---|---|---|---|---|---|---|
| `https://tiles.openfreemap.org/styles/dark` | 200 | 0.38 s | `*` | none | OpenFreeMap (MIT stack), data © OpenMapTiles / OpenStreetMap (ODbL) | 47 layers, sources `openmaptiles` + unused `ne2_shaded`; glyphs `tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf` (Noto Sans); sprite `sprites/ofm_f384/ofm` lacks `circle-11` (map-engine must resolve missing images) |
| `https://tiles.openfreemap.org/planet` (TileJSON) | 200 | 0.34 s | `*` | none | attribution string supplied by TileJSON (shown by MapLibre) | tiles `planet/20260927_080001_pt/{z}/{x}/{y}.pbf`, maxzoom 14 |
| `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | 200 | 0.17 s | `*` | none | "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community" (Esri MLA) | y/x order |
| `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png` | 200 | 0.47 s | `*` | none | NASA GIBS acknowledgement text required | Level8 max zoom |
| `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | 200 | 0.21 s | CORS only with Origin | none | Tilezen/joerd attribution | raster-dem `encoding: 'terrarium'` |
| `https://photon.komoot.io/api/?q=Kyiv&limit=1` | 200 | 2.68 s | — (server-side only) | none | © OpenStreetMap contributors (ODbL) | slow first byte; cache 10 min |
| `https://nominatim.openstreetmap.org/search?q=Kyiv&format=jsonv2&limit=1` | 200 | 0.41 s | — (server-side only) | none | © OpenStreetMap contributors (ODbL); usage policy: ≤ 1 req/s, identifying UA, no autocomplete | behind `SerialQueue(1100 ms, 40)` + 30-day cache |
| `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson` | 200 | 0.20 s | `*` | none | public domain | (hazards agent owns the feed) |
| `https://fonts.googleapis.com/css2?family=JetBrains+Mono` | 200 | 0.55 s | — | none | SIL OFL | self-hosted at build time by `next/font` |
