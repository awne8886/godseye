## layers-surveillance

Probed **2026-09-30 19:58–20:45 UTC** from the build sandbox with
`curl -sS -m 25 --compressed -A 'GODSEYE/0.1.0 (+https://github.com/awne8886/godseye; contact https://github.com/awne8886/godseye/issues)' -H 'Origin: http://localhost:3000'`.
Recorded payloads (trimmed) live in `src/features/surveillance/server/__fixtures__/*.2026-09-30.*`;
`RUN_LIVE_TESTS=1` (`surveillance.live.test.ts`) re-checks every keyless loader (18/18 passed at 20:37 UTC).
"CORS" is the `Access-Control-Allow-Origin` answer; the browser never calls list endpoints or
still hosts (lists go through `/api/cctv`, stills through the stills-only `/api/cctv/proxy`).
Frame time: most operators send `Last-Modified` on stills; the proxy forwards it as
`X-Frame-Observed-At`, and the viewer says "time not published by operator" when it is absent.

### Camera lists (inventory, refreshed every 30 min)

| Provider · endpoint | Status · latency · size | CORS | Auth | Licence / attribution | Notes and sample fields |
|---|---|---|---|---|---|
| Caltrans CWWP2 `cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json` (d1…d12) | 200 · 3.78 s · 1.8 MB (592 records); d4 200 · 4.05 s · 2.4 MB | `*` | none | Public domain unless indicated (dot.ca.gov/conditions-of-use); "no charge"; "neither retained nor archived" | `data[].cctv.{index,inService,location.{district,locationName,nearbyPlace,county,latitude,longitude,direction},imageData.{streamingVideoURL (HLS, 478/592 in D7),static.currentImageURL}}`. `recordTimestamp` is a 2024 inventory date → **not** used as observedAt. Replaces OSIRIS's ArcGIS query truncated at 2 000 of 2 936. |
| WSDOT `wsdot.wa.gov/traffic/api/HighwayCameras/kml.aspx` | 200 · 1.15 s · 568 kB (1 706 placemarks) | none | none | No licence text published; credited | KML `Placemark id="ID n"`, `<name>` CDATA, `<img src>` in description, `<coordinates>lng,lat`. 1 695 on `images.wsdot.wa.gov`; 11 third-party hosts (NPS, lodges, airports) dropped. OSIRIS's `data.wsdot.wa.gov/log/public/cameras.json` is 404. |
| ODOT TripCheck `www.tripcheck.com/Scripts/map/data/cctvinventory.js` | 200 · 0.80 s · 64 kB (1 160) | none | none | Operator terms | Esri FeatureSet served as `application/javascript`; `attributes.{cameraId,filename,latitude,longitude,route,title}` → `tripcheck.com/RoadCams/cams/<filename>`. Needs `Accept: */*`. |
| TxDOT `its.txdot.gov/its/DistrictIts/GetCctvStatusListByDistrict?districtCode=AUS` (25 districts) | 200 · 0.51 s · 19.5 kB | none | none | No camera licence (txdot.gov disclaimer); credit TxDOT | **New shape:** `roadwayCctvStatuses{<roadway>: [{icd_Id,name,latitude,longitude,hasSnapshot,statusDescription,netId}]}` + `cctvStatusRoadways[].ctts[]` (empty in AUS). |
| MDOT Mi Drive `mdotjboss.state.mi.us/MiDrive/camera/list` | 200 · 1.38 s · 35 kB (804) | none | none | Operator terms | Fields are HTML: `county` holds `lat=…&lon=…&id=…`, `image` holds `<img src="https://micamerasimages.net/thumbs/…flv.jpg">` (301 → host root `.jpg`). |
| Ottawa `traffic.ottawa.ca/beta/camera_list` | 200 · 0.60 s · 71 kB (428) | `*` | none | Operator terms | `{number,id,latitude,longitude,description,type}` → `traffic.ottawa.ca/map/camera?id=<number>`. |
| Québec 511 WFS `ws.mapserver.transports.gouv.qc.ca/swtq?…typename=ms:infos_cameras…outputformat=geojson` | 200 · 1.05 s · 41 kB (680) | echoes Origin | none | Operator terms | `properties.{IDEcamera,DescriptionLocalisationEn,NomRegionDiffusion,URL_FLUX_DONNEE}`. Frames `camera.ashx?id=…&format=mp4` answer **403** to a non-browser client → **link-out only** (no Referer forging). |
| Toronto CKAN `ckan0.cf.opendata.inter.prod-toronto.ca/…/traffic-camera-list-4326.geojson` | 200 · 0.71 s · 278 kB (336) | none | none | Open Government Licence – Toronto | Served as `application/octet-stream`. `properties.{REC_ID,IMAGEURL,MAINROAD,CROSSROAD}`, MultiPoint geometry. |
| DriveBC `www.drivebc.ca/api/webcams/` | 200 · 1.26 s · 83 kB (1 066) | none | none | Operator terms | **Moved:** `drivebc.ca/api/webcams` → 301 → `www.drivebc.ca/api/webcams` → 301 → trailing slash. `{id,name,caption,links.imageDisplay,location.coordinates,is_on,should_appear,region_name,orientation,last_update_modified (offset; used as observedAt),update_period_mean}`. |
| Montreal `ville.montreal.qc.ca/…/cameras.json` | 301 → quebec511.info page | — | — | — | **Retired**; not wired (Québec 511 covers Montréal). |
| Alberta 511 / Ontario 511 `…/api/v2/get/cameras` | 400 `Invalid Key` | — | key | — | Now keyed (IBI developer keys); not wired. |
| TfL `api.tfl.gov.uk/Place/Type/JamCam` | 200 · 0.46 s · 62 kB (890) | `*` | **keyless works** (anonymous tier) | TfL Open Data; "Powered by TfL Open Data. Contains OS data © Crown copyright…" | Wired behind the `tfl` capability as the contract requires. `additionalProperties[{key: available,imageUrl,videoUrl,view}]`; `modified` is metadata, not frame time. |
| DGT `www.dgt.es/.content/.assets/json/camaras.json` | 200 · 0.72 s · 57 kB (1 920) | none | none | Public-sector reuse with attribution | `camaras[].{id,latitud,longitud,carretera,pk,sentido,provincia,imagen,fecha}`; `fecha` is a 2025 record date → not observedAt. |
| Rijkswaterstaat `api.rwsverkeersinfo.nl/api/cameras/` | 200 · 1.08 s · 12.9 kB (26) | echoes Origin | none | Operator terms | **Moved:** `/api/cameras` → 301 → `/api/cameras/`. `static_url` (`stream.inmoves.nl/<n>`) answers **401** without a browser Referer → **link-out only** to `stream_url`. |
| Digitraffic `tie.digitraffic.fi/api/weathercam/v1/stations` | 200 · 0.89 s · 37.5 kB gzip (811 stations, 2 277 presets) | `*` | none (`Digitraffic-User` header sent) | CC BY 4.0 — "Source: Fintraffic / digitraffic.fi, license CC 4.0 BY" | GeoJSON `properties.{id,name,collectionStatus,presets[{id,inCollection}]}`; one camera per GATHERING station (first preset). |
| Vegagerðin `gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1` | 200 · 1.59 s · 138 kB (497) | none | none | Operator terms | `{Maelist_nr,Myndavel,Vegheiti,Skyring,Slod,Breidd(lat),Lengd(lng)}`. |
| HK TD `static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml` | 200 · 2.27 s · 405 kB (~1 000) | `*` | none | DATA.GOV.HK terms (commercial + non-commercial with attribution) | `<image>{key,region,district,description,latitude,longitude,url}` → `tdcctv.data.one.gov.hk/<key>.JPG`. |
| LTA `api.data.gov.sg/v1/transport/traffic-images` | 200 · 1.23 s · 2.3 kB (**7 cameras** today) | `*` | none | Singapore Open Data Licence v1.0 | `items[0].cameras[{camera_id,image,timestamp(+08:00 → UTC observedAt),location}]`. Image URLs are per snapshot, so the proxy resolves the current one from a 60-s cached list. |
| Taiwan THB `thbapp.thb.gov.tw/services/cctv/thb` | 200 · 3.02 s · 442 kB (2 251) | none | none | Open Government Data License v1.0 (agency, year, licence link) | `{id,stakenumber,gisx,gisy,html}`; 2 203 on `cctv-ss01…08.thb.gov.tw`; 48 Freeway Bureau MJPEG rows answer 400 → dropped. |
| NZTA `trafficnz.info/service/traffic/rest/4/cameras/all` | 200 · 7.40 s · 332 kB (~250) | none | none | Operator terms | XML `<camera>` with nested `journey/journeyLeg/region/way` blocks; `offline`/`underMaintenance` skipped. |
| Live Traffic NSW `www.livetraffic.com/datajson/all-feeds-web.json` | 200 · 2.57 s · 265 kB (3 102 features, 241 `liveCams`) | none | none | Operator terms | `eventType=liveCams`, `properties.{title,view,href,region,direction}`, `path`. |
| Trafikverket `api.trafikinfo.trafikverket.se/v2/data.json` | not probed (needs key) | — | `TRAFIKVERKET_KEY` | CC0 1.0 | Wired behind the `trafikverket` capability (POST XML query, `Camera.{Id,Name,Geometry.WGS84,PhotoUrl,PhotoTime,HasFullSizePhoto}` per the published data model). |

### Frames (fetched through `/api/cctv/proxy` with exact prefixes; never stored)

| Still / stream | Status · latency · size · type | Frame time | Notes |
|---|---|---|---|
| Caltrans `cwwp2.dot.ca.gov/data/d7/cctv/image/…jpg` | 200 · 1.07 s · 36 kB · image/jpeg | Last-Modified | — |
| Caltrans HLS `wzmedia.dot.ca.gov/D7/CCTV-196.stream/playlist.m3u8` | 200 · 0.85 s · `application/vnd.apple.mpegurl` | live | **ACAO `*`** → playable in the browser once `https://wzmedia.dot.ca.gov/` is in MEDIA_HOSTS (requested). |
| WSDOT `images.wsdot.wa.gov/airports/ChewelahN.jpg` | 200 · 1.10 s · 176 kB · image/jpeg | Last-Modified | — |
| ODOT `tripcheck.com/RoadCams/cams/…jpg` | 200 · 1.09 s · 28 kB · image/jpeg | — | — |
| TxDOT `GetCctvSnapshotByIcdId?districtCode=AUS&icdId=…` | 200 · 1.78 s · 46.5 kB JSON | `timestampFormatted` (Texas local, converted to UTC) | `{icd_Id, snippet (base64 JPEG), timestampFormatted}`; decoded server-side, FF D8 FF checked. |
| MDOT `micamerasimages.net/thumbs/…flv.jpg` | 301 → `/semtoc_cam_253.jpg` 200 · 1.52 s · 55 kB | — | Redirect stays on the allow-listed host. |
| Ottawa `traffic.ottawa.ca/map/camera?id=2025` | 200 · 0.59 s · 15 kB · image/jpeg | — | — |
| Toronto `opendata.toronto.ca/…/CameraImages/loc8001.jpg` | 200 · 0.95 s · 109 kB | Last-Modified | — |
| DriveBC `www.drivebc.ca/images/967.jpg` | 200 · 1.20 s · 22.5 kB · image/jpeg | list `last_update_modified` | — |
| TfL `s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.jpg` / `.mp4` | 200 · 0.75 s · 14 kB / 200 · 0.92 s · 131 kB video/mp4 | Last-Modified | mp4 is a short "latest clip" (never badged LIVE); played with plain `<video src>` (no CORS). |
| DGT `etraffic.dgt.es/camarasEtraffic/2.jpg` | 200 · 0.91 s · 35 kB | Last-Modified | `max-age=120` → registry interval 120 s. |
| Digitraffic `weathercam.digitraffic.fi/C0150301.jpg` | 200 · 1.06 s · 250 kB | Last-Modified | — |
| Vegagerðin `www.vegagerdin.is/vgdata/vefmyndavelar/hellisheidi_1.jpg` | 200 · 1.65 s · 50 kB | Last-Modified | — |
| HK `tdcctv.data.one.gov.hk/H429F.JPG` | 200 · 1.25 s · 16 kB | Last-Modified | `s-maxage=60`. |
| LTA `images.data.gov.sg/api/traffic-images/…jpg` | 200 · 0.47 s · 147 kB · **application/octet-stream** | list `timestamp` | Accepted only after JPEG magic-byte sniffing. |
| THB `cctv-ss03.thb.gov.tw:443/T1-123K+850/snapshot` | 200 · 2.62 s · 24.5 kB | — | No Referer sent (none ever is). |
| NZTA `trafficnz.info/camera/714.jpg` | 200 · 2.74 s · 76 kB | Last-Modified | — |
| NSW `webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/5_ways_miranda.jpeg` | 200 · 1.82 s · 307 B **text/html** "temporarily unavailable" | — | Refused by the image content check (FEED UNAVAILABLE), never shown as a frame. |
| Trafikverket `api.trafikinfo.trafikverket.se/v2/Images/…/TrafficFlowCamera_39636115.jpg` | 200 · 1.20 s · 29 kB | Last-Modified | Keyless stills; the list needs the key. |
| Québec `quebec511.info/Carte/Fenetres/camera.ashx?id=4057&format=mp4` | **403** | — | Link-out only. |
| RWS `stream.inmoves.nl/62` | **401** (needs Referer) | — | Link-out only. |

### Live news (`/api/live-news`, hourly server-side check)

`www.youtube.com/channel/<id>/live` for Al Jazeera, DW, France 24, Sky News, NHK World, CNA, WION,
Bloomberg, NBC News, CBS News, ABC News, CBC, CGTN, C-SPAN (+ Euronews, TRT probed, not listed):
all 200 · 0.9–2.7 s · 229–294 kB, no consent wall from this network. 13 pages carried
`"isLive":true` (live watch page); C-SPAN served its channel page (`og:url` = channel → `live: false`);
CBC's page had neither marker (→ `live: null`, unknown). Embeds use
`https://www.youtube-nocookie.com/embed/live_stream?channel=<id>` only for the 7 broadcasters that
allow embedding (OSIRIS's verified split); the other 7 open on YouTube. RT is excluded (Rumble only).
