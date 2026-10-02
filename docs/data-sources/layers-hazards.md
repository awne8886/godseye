## layers-hazards

Probed **2026-09-30 18:06–18:25 UTC** from the build sandbox with
`curl -sS -m 30 -A 'GODSEYE/0.1.0 (+https://github.com/awne8886/godseye; contact https://github.com/awne8886/godseye/issues)' -H 'Origin: http://localhost:3000'`.
Recorded payloads (trimmed) live in `src/features/hazards/server/__fixtures__/*.2026-09-30.*`.
"CORS" is the `Access-Control-Allow-Origin` answer to that Origin; the browser never calls these
hosts (everything goes through `/api`), except RainViewer tiles and CDSE quicklooks (image hosts).

| Upstream | Status · latency · size | CORS | Auth | Licence / attribution | Notes and sample fields |
|---|---|---|---|---|---|
| USGS `earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson` | 200 · 0.43 s · 24 kB (33 quakes) | `*` | none | Public domain (USGS) | `properties.{mag,magType,place,time(ms),url,felt,alert(lower-case or null),tsunami(0/1),sig}`, `geometry.coordinates=[lng,lat,depthKm]`, `id`. Last-Modified set → conditional GET. |
| FIRMS `…/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv` | 200 · 0.91 s · 5.8 MB (71 093 rows) | none | none | NASA open data; cite FIRMS/LANCE | `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time(HHMM UTC),satellite(N),confidence(low/nominal/high),version,bright_ti5,frp,daynight`. ETag + Last-Modified. |
| FIRMS `…/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv` | 200 · 3.86 s · 6.8 MB (81 270 rows) | none | none | same | `satellite=N20`. |
| FIRMS `…/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv` | 200 · 0.70 s · 6.4 MB (76 907 rows) | none | none | same | `satellite=N21`. |
| FIRMS `…/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv` | 200 · 0.64 s · 1.2 MB (15 839 rows) | none | none | same | `brightness`, `bright_t31`, `confidence` 0–100 (→ low < 30 ≤ nominal < 80 ≤ high), `satellite` T/A. ~245k pixels/day in total → FRP top-30 000 sampling, never stride. Area API (`FIRMS_MAP_KEY`) not needed. |
| NASA EONET `eonet.gsfc.nasa.gov/api/v3/events?status=open&days=7` | 200 · 3.08 s · 73 kB (16 events) | `*` | none | NASA open data | **Content-Type `application/rss+xml` for JSON** (httpJson parses regardless). `events[].{id,title,categories[0].id,sources[].url,geometry[].{date,type,coordinates,magnitudeValue,magnitudeUnit}}`. Fires layer uses `&category=wildfires&days=30`. |
| NWS `api.weather.gov/alerts/active?status=actual&message_type=alert` | 200 · 0.70 s · 686 kB (152 alerts) | `*` | none (UA required) | Public domain | **No `limit` param (NWS answers 400).** 112/152 alerts have `geometry: null` and list `affectedZones` (252 distinct: 216 forecast, 36 county). `properties.{id,@id,event,headline,severity,sent,effective,expires,ends,areaDesc,geocode.UGC}` (times carry offsets). |
| NWS `api.weather.gov/zones/county/ILC007` | 200 · 0.29 s · 4.9 kB (re-probed 2026-10-02: 200 · 0.58 s) | `*` | none | Public domain | `geometry` Polygon/MultiPolygon, `properties.{id,name,type,state}`. Cached 30 days (process + SnapshotStore), ≤ 120 lookups per refresh, 8 req/s, concurrency 8; unresolved alerts reported as `unplacedAlerts`. |
| GDACS `www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF` | 200 · 1.83 s · 128 kB (89 events) | `*` | none | GDACS terms, attribution | `/geteventlist/MAP` answers 400. `features[].properties.{eventtype,eventid,episodeid,name,alertlevel("Orange" → lower-cased),country,fromdate,todate,datemodified (zone-less UTC → normalizeUtc),url.report,severitydata.severitytext}`, Point geometry. EQ skipped (USGS layer). |
| NHC `www.nhc.noaa.gov/CurrentStorms.json` | 200 · 0.57 s · 19 kB (1 storm: Hanna AT3) | none | none | Public domain | `activeStorms[].{id,binNumber,name,classification,intensity(kt),pressure,latitudeNumeric,longitudeNumeric,lastUpdate,publicAdvisory.url}`. `[]` outside storms → truthful empty (`allowEmpty`). |
| NHC MapServer `mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer/60/query?where=1%3D1&outFields=*&f=geojson` | 200 · 0.76 s · 62 kB | echoes Origin | none | Public domain | Forecast-cone layer ids from `MapServer/layers?f=json` (2.3 MB): AT1 8 … AT5 112, EP1 138 … EP5 242, CP1 268 … CP5 372 (stride 26). |
| Smithsonian GVP `volcano.si.edu/news/WeeklyVolcanoRSS.xml` | 200 · 0.61 s · 26 kB (21 items) | none | none | Smithsonian GVP / USGS weekly report, attribution | **`encoding="ISO-8859-1"`** (bytes 0xE9/0xED/0xF3/0xFA present) → decoded as windows-1252. `item.{title,description (entity-encoded HTML),guid (#vn_…),pubDate,georss:point "lat lng"}`. Weekly (latest 2026-09-17). |
| Open-Meteo AQ `air-quality-api.open-meteo.com/v1/air-quality?latitude=51.5&longitude=-0.12&current=pm2_5,us_aqi` | 200 · 0.82 s · 335 B | `*` | none | CC BY 4.0; free tier non-commercial → capability `openmeteo` | Comma-separated lat/lng lists answer a JSON array (0.81 s for 3 points). `current.{time ("2026-09-30T18:00", zone-less GMT),pm2_5,us_aqi}`. CAMS model values, not stations. |
| gpsjam `gpsjam.org/data/manifest.csv` | 200 · 0.99 s · 8 kB gzip | none | none | **Licence unstated** → attributed "gpsjam.org (John Wiseman)" | `date,suspect,num_bad_aircraft_hexes,source`; latest 2026-09-29, suspect=false. |
| gpsjam `gpsjam.org/data/2026-09-29-h3_4.csv` | 200 · 0.98 s · 191 kB gzip | none | none | same | `hex,count_good_aircraft,count_bad_aircraft`; 47 846 cells, 3 047 with bad > 0 (only those are served). |
| CDSE STAC `stac.dataspace.copernicus.eu/v1/search?collections=sentinel-2-l2a&bbox=-0.2,51.4,0,51.6&limit=1` | 200 · 3.56 s · 72 kB per item | `*` | none | Copernicus open data ("Contains modified Copernicus Sentinel data") | `datetime`, `sortby=-properties.datetime` works on GET (4.1 s, 12 items over Paris/10 days). `assets.thumbnail.href` = `datahub.creodias.eu/odata/v1/Assets(<uuid>)/$value` → **301 to `zipper.creodias.eu`** (200, CORS `*`, 2.7 s); the card uses the zipper URL directly (next/image follows no redirects). |
| RainViewer `api.rainviewer.com/public/weather-maps.json` | 200 · 0.77 s · 818 B | `*` | none | RainViewer API terms (free, attribution) | `host=https://tilecache.rainviewer.com`, `radar.past[13]` (10-min spacing, `{time (epoch s), path}`), **`radar.nowcast=[]`, `satellite.infrared=[]`** (§6.2); tiles z ≤ 7, 100 req/IP/min. |

Not wired: OpenAQ v3 and WAQI (keyed; no key available to verify). They are not offered as
capabilities and `/api/air-quality` reports only Open-Meteo.

### Re-probe 2026-09-30 22:45–22:55 UTC (Phase 3 round 1, same UA, `Origin: https://example.org`)

| Upstream | Status · latency · size | CORS | Notes |
|---|---|---|---|
| gpsjam `gpsjam.org/data/manifest.csv` | 200 · 0.59 s · 8.4 kB | none | latest `2026-09-29,false,549,merged` |
| USGS `…/summary/2.5_day.geojson` | 200 · 0.29 s · 4.4 kB gzip (38 quakes) | `*` | unchanged shape |
| FIRMS `SUOMI_VIIRS_C2_Global_24h.csv` | 200 · 0.58 s · 6.7 MB (82 535 rows) | none | unchanged header |
| Open-Meteo AQ `…/air-quality?latitude=48.85&longitude=2.35&current=pm2_5,us_aqi` | 200 · 0.56 s · 235 B | `*` | `current.time` "2026-09-30T22:00" (zone-less GMT) |
| adsb.lol `api.adsb.lol/v2/point/{lat}/{lng}/250` (fixture source for live NACp tests; the app reads aircraft only from the in-process flights feed) | 200 · 0.43–0.69 s · 0.1–12 kB | none | ODbL 1.0 · `ac[].{hex,lat,lon,nac_p,seen_pos}`, `now` (ms). Night-time sample: Kuwait/Gulf (29.5, 48.0) 18 aircraft → one r4 cell `84536e1ffffffff` with 5 NACp reporters, one at NACp 0; Baltic (55.5, 21.0) 32 aircraft, 12 at NACp ≤ 4 but no cell with ≥ 3 reporters. |

Live NACp binning reads `FlightsSnapshot.records[].{lat,lng,nacP,seenAt}` (aviation `nacP` = readsb
`nac_p`), drops positions older than 300 s (60 s since 2026-10-01, see below), and reports `live_nacp` `ok:false` with
`flights_feed_not_running` / `no_flights_snapshot` / `no_recent_positions` / `nacp_not_reported`
instead of a zero count when the binning could not run.

### Re-probe 2026-10-01 02:07 UTC (Phase 3 round 2, same UA)

| Upstream | Status · latency · size | CORS | Notes |
|---|---|---|---|
| gpsjam `gpsjam.org/data/manifest.csv` | 200 · 0.67 s · 8.4 kB | none | latest `2026-09-30,false,512,merged` |
| gpsjam `gpsjam.org/data/2026-09-30-h3_4.csv` | 200 · 1.10 s · 190 kB gzip | none | 47 695 cells; 3 106 with bad > 0, 1 548 with bad ≥ 2. With gpsjam's formula: HIGH 449 / MEDIUM 604 (HIGH was 857 with `bad / aircraft`). |
| gpsjam `gpsjam.org/faq` | 200 · 0.78 s | none | Published formula `percent_bad_aircraft = 100 * (num_bad_aircraft - 1) / (num_good_aircraft + num_bad_aircraft)`, implemented as `gpsjamBadShare()` (round-2 MINOR-1). Cells whose share is 0 (a single bad aircraft) are not served; `totalCells` still counts the whole grid. |
| adsb.lol `api.adsb.lol/v2/point/51.5/-0.1/100` | 200 · 0.50 s · 2.5 kB | none | 18 aircraft: 7 `alt_baro:"ground"`, 1 `type:"mlat"`, no `~` (TIS-B) addresses at this hour. Recorded as fixture `adsblol-point-51.5_-0.1_100.2026-10-01.json`. |

Live NACp binning since round 2 (MAJOR-A, MINOR-3): only **airborne ADS-B** positions count.
Aircraft `onGround`, non-ICAO `~` addresses (TIS-B / ADS-R track files) and any `posSource` other
than `adsb` (MLAT, TIS-B, ADS-R, Mode S, unknown) are skipped (docs/reference/03: "the aircraft is
not grounded"). In the recorded Gulf fixture the only NACp-0 aircraft of the former live cell
`84536e1ffffffff` was `89405c`, on the ground at Bahrain, so that cell was an artefact and is now
excluded. The position window is **60 s** (was 300 s), and positions of unknown age are skipped.
Both rules are stated in the `/api/gps-interference` `meta.note` and on the card.

### Re-probe 2026-10-01 06:23 UTC (Phase 3 round 4, same UA, `Origin: https://example.org`)

| Upstream | Status · latency · size | CORS | Notes |
|---|---|---|---|
| RainViewer `api.rainviewer.com/public/weather-maps.json` | 200 · 0.47–0.69 s · 818 B | `*` | `cache-control: no-cache`; `radar.past[13]` (10-min spacing, newest 06:20 UTC, `generated` 06:20:25 UTC), `radar.nowcast=[]`; shape unchanged. The frame time is shown in the map's bottom-right control stack (visual-qa r4 M2). |
| USGS `…/summary/2.5_day.geojson` | 200 · 0.47 s · 27 kB (38 quakes) | `*` | `cache-control: public, max-age=60`, `Last-Modified` set; shape unchanged. |
| OpenFreeMap `tiles.openfreemap.org/styles/dark` (basemap style, map-engine; checked for the e2e skip rule) | 200 · 0.67 s | n/a | Reachable now. The round-4 e2e failure of `earthquakes.spec.ts:65` was this style failing at the sandbox proxy (`net::ERR_TOO_MANY_RETRIES`, trace): BASEMAP UNAVAILABLE, no map canvas. Map steps now skip with that reason. |
