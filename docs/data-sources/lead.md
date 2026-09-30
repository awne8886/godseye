# lead — probe log

## Setup (probed 2026-09-30)

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

## Phase 1 contract review (probed 2026-09-30 ~17:30Z)

| URL | Status | Latency | CORS | Notes |
|---|---|---|---|---|
| `https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP` | 400 | 0.71 s | none | "Eventtype is required": use `…/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF` (200, 2.25 s, 89 events, `alertlevel` capitalised, `url` is an object, dates without Z) |
| `https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json` | 200 | 2.26 s | none | no TLS reset this time; EPOCH has µs and no Z; max NORAD id 100712 (> 99999) |
| `https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json` | 200 | 0.27 s | `*` | objects `{time_tag (no Z, 3 h interval START), Kp, a_running, station_count}` |
| `https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json` | 200 | 0.29 s | `*` | `time_tag` no Z; `source` ∈ IMAP/ACE/SOLAR1; `bt`, `bz_gsm` nT |
| `https://aviationweather.gov/api/data/metar?ids=EGLL,KJFK&format=json` | 200 | 0.26 s | none | `obsTime` epoch s, `altim` hPa, `visib` string (`6+`), clouds `{cover, base ft}` |
| `http://data.gdeltproject.org/gdeltv2/lastupdate.txt` | 301 → https 200 | 0.46 s | `*` | lists `http://` zip URLs: upgrade to https |
| `https://urlhaus.abuse.ch/downloads/csv_recent/` | 200; 304 on If-Modified-Since and If-None-Match | — | — | 2.9 MB identity / 434 KB gzip, `max-age=300` |
| `https://api.rainviewer.com/public/weather-maps.json` | 200 | 0.2 s | `*` | malformed ETag; tiles on `tilecache.rainviewer.com` |
| `https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.01251.mp4` | 200 | — | none | plain `<video src>` only (no `crossOrigin`, no hls.js/XHR) |
| `https://photon.komoot.io/api/?q=London&limit=1` | 200 | 3.5 s | — | no rate-limit headers; politeness bucket 2 req/s |
