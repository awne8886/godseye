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

### Phase 3 round 1 re-probes (2026-09-30 22:20–22:55 UTC, same honest UA)

| Probe | Result | Used for |
|---|---|---|
| TfL `api.tfl.gov.uk/Place/Type/JamCam`, no key | 200 · 0.53 s · 1.15 MB · ACAO `*` | Keyless tier still answers; the row stays keyed as the contract requires (`TFL_APP_KEY`). |
| TfL same URL, `?app_key=bogus0000` | 429 · 0.45 s · "Invalid app_key is provided." | — |
| TfL same URL, header `app_key: bogus0000` | 429 · 0.21 s · "Invalid app_key is provided." | **The header is honoured** → the loader sends `app_key` as a header; the key is never in a URL (SEC-m4). |
| TfL same URL, header `Ocp-Apim-Subscription-Key: bogus0000` | 200 (header ignored) | Not used. |
| Caltrans `cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json` | 200 · 3.14 s · 1.85 MB · ACAO `*` | HLS URLs across d1–d12: 2 300 under `wzmedia.dot.ca.gov/D<n>/`, 1 at the root (`/EB91WO57.STREAM…`, now refused → still fallback). |
| `wzmedia.dot.ca.gov/D7/CCTV-196.stream/playlist.m3u8` | 200 · 0.73 s · 128 B · `application/vnd.apple.mpegurl` | Rule narrowed `/` → `/D1/`…`/D12/`. |
| Caltrans still `…/d7/cctv/image/i110196avenue26offramp/…jpg` | 200 · 0.69 s · 34 kB · image/jpeg | unchanged rule. |
| WSDOT KML | 200 · 1.15 s · 568 kB | Image directories seen: `nw` 756, `sw` 221, `orflow` 181, `rweather` 110, `airports` 99, `spokane` 75, `nc` 62, `sc` 57, `wsf/…` 45, `SC` 13, `ORFlow` 11, `traffic` 3 (map icons only). Rule narrowed `/` → those 11 directories. |
| `images.wsdot.wa.gov/nw/525vc00694.jpg`, `/ORFlow/005vc12750.jpg` | 200 · 1.09 s · 78 kB / 200 · 0.94 s · 80 kB · image/jpeg | — |
| MDOT list | 200 · 0.98 s · 543 kB | Stills: 714 `/thumbs/<x>_cam_<n>.flv.jpg`, 2 root `/image-<n>-<n>-<n>.jpg`. |
| `micamerasimages.net/thumbs/semtoc_cam_253.flv.jpg?item=1` | 301 → `/semtoc_cam_253.jpg?item=1` → 200 · 0.34 s · 55 kB | Rule narrowed `/` → `/thumbs/` + one exact root file per camera (its redirect target). |
| `micamerasimages.net/image-000705102-00-04.jpg?bucket=ftp` | 200 · 0.40 s · 38 kB | exact-file rule. |
| `weathercam.digitraffic.fi/C0150200.jpg` | 200 · 0.53 s · 9.9 kB | Root files → exact-file rule `/[A-Z]\d{5,10}.jpg` (was `/`). |
| `tdcctv.data.one.gov.hk/AID01101.JPG`; HK list | 200 · 1.26 s · 6.7 kB; list 200 · 1.13 s · 405 kB (1 013 keys, all root `/<KEY>.JPG`) | Exact-file rule (was `/`). |
| THB list; `cctv-ss02.thb.gov.tw/T74-3+903/snapshot` | 200 · 2.23 s · 430 kB (ss01–ss08 only); 200 · 1.01 s · 10 kB image/jpeg | Exact `/<stake>/snapshot` rule on ss01–ss08 (was `/`). |
| Trafikverket `api.trafikinfo.trafikverket.se/v2/Images/data/road.infrastructure.camera/TrafficFlowCamera_39636115.jpg` | 200 · 1.43 s · 29 kB · image/jpeg | Rule unchanged (directory prefix). |
| `open.toronto.ca/open-data-license/` vs `/open-data-licence/` | 404 · 0.44 s vs 200 · 0.49 s | Toronto `terms_url` fixed to `open-data-licence`. |

### Phase 3 round 2 re-probes (2026-10-01 02:00–02:15 UTC, same honest UA)

MAJOR-B: every keyless list was downloaded in full, parsed by the shipped adapters and every
still URL checked against `rulesFor()` (14 793 URLs; recorded in
`__fixtures__/catalogue-stills.2026-10-01.json.gz`, enforced by `allow-list.test.ts`).

| Upstream | Result | Finding / change |
|---|---|---|
| HK list; `tdcctv.data.one.gov.hk/TDSCPRHSK10001.JPG` | 200 · 0.61 s · 405 kB (1 013 keys, 4–14 chars); 200 · 1.11 s · 8.5 kB image/jpeg · ACAO `*` · no redirect | 40 keys longer than 12 were blocked → rule `/[A-Z0-9]{3,16}.JPG`. |
| THB list; `cctv-ss03.thb.gov.tw/T9-109K+286(N)/snapshot` | 200 · 2.28 s · 429 kB (2 199 on ss01–ss08); 200 · 1.75 s · 17 kB image/jpeg · no redirect | 166 stakes with `(N)`/`(S)` were blocked → charset adds `(` `)`. |
| WSDOT KML; `images.wsdot.wa.gov/traffic/FeltsField.jpg`, `/wsf/lopez/approach.jpg` | 200 · 1.04 s · 568 kB; 200 · 0.54 s · 6 kB / 200 · 0.61 s · 37 kB image/jpeg | 2 airport stills live in `/traffic/` → exact-file rule `/traffic/[A-Za-z]{1,40}.jpg` (directory stays closed). |
| NSW feed; `data.livetraffic.com/cameras/victoriapass_3.jpg` | 200 · 2.85 s · 2.0 MB; 200 · 1.83 s · 756 kB image/jpeg | 1 camera on the data host → rule `data.livetraffic.com/cameras/`. `webcams.transport.nsw.gov.au/…/5_ways_miranda.jpeg` still 200 text/html "temporarily unavailable" (refused by the image check). |
| Other lists (Caltrans D4/D7, ODOT, TxDOT AUS, MDOT, Ottawa, Toronto, DriveBC, DGT, Digitraffic, Vegagerðin, LTA, NZTA) | all 200, 0.3–6.7 s | 0 misses. Digitraffic answers 406 without `Accept: application/json` (the loader sends it). |

MAJOR-D:

| Upstream | Result | Decision |
|---|---|---|
| INDOT `POST 511in.org/api/graphql` `mapFeaturesQuery` (Indiana bbox, zoom 16, `normalCameras`) | 200 · 0.98 s · 209 kB · ACAO `*` · no key · robots.txt disallows `/images/` only | **Wired** (`indot`, us-midwest): 748 features, 712 active with `views[0].url` `public.carsprogram.org/cameras/IN/INDOT_<n>_<token>.flv.png`; 35 closed (site icon) + 1 inactive skipped. Fields `uri, title, features[].geometry, active, views[].{category,url}`. |
| `public.carsprogram.org/cameras/IN/INDOT_409_Cjk7MdIeCiKwICHh.flv.png` | 200 · 0.57 s · 135 kB · **image/jpeg** · Last-Modified 2 min old | Rule `public.carsprogram.org/cameras/IN/`; viewer time from Last-Modified. HLS (pre-roll filler) not used. Licence: operator terms, not separately published. |
| Via Lietuva `eismoinfo.lt/eismoinfo-backend/layer-static-features/VKR?lks=false` + `/camera-info-table` | 200 · 0.67 s · 47 kB (321 points) + 200 · 0.79 s · 71 kB (300 rows) · ACAO `*` · no key · robots.txt allows all | **Wired** (`vialietuva`, nordics box widened to 53.8° N): joined on id → 300; `{id,name,roadName,roadNr,km,date(epoch ms),image}`. `date` only filters cameras dead > 6 h (not shown as observedAt). Reuse terms not verified from a primary source (dossier 29 §17) — licence text says so. |
| `eismoinfo.lt/eismoinfo-backend/image-provider/camera/last?id=72` | 200 · 0.73 s · 32 kB image/jpeg · ACAO `*` · no Last-Modified · no redirect | Rule `eismoinfo.lt/eismoinfo-backend/image-provider/camera/last` (no Referer sent). |
| Edmonton `POST edmontontrafficcam.com/Default.aspx/GetCameras` `{}`; `edmonton.ca/conditionsofuse` | 200 · 0.85 s · 23 kB (58, all Status 1; HLS on `cityed1-winkcdn1.winkcdn.com`); terms: "only … personal, educational or non-commercial purposes" | **Not wired** (`NOT_WIRED_SOURCES`): non-commercial-only terms need a deployment gate. |
| IBI 511: `511ga.org/developers/doc`; `prod-ut.ibi511.com/api/v2/get/cameras`; `511ga.org/List/GetData/Cameras` | 200 (key required, 10 calls/60 s); 400 "Invalid Key" · 0.42 s; 200 internal DataTables endpoint (recordsTotal 4 331) | **Not wired**: the official API is keyed; the internal endpoint is not used. |
| MLIT `cam.river.go.jp/` and `/cam/now/` | 200 · 1.27 s · 0 B; 200 · 0.71 s · PNG placeholder | **Not wired**: no machine-readable catalogue. |

### Phase 3 round 4 re-probes (2026-10-01 07:49–08:04 UTC, same honest UA, `Accept: FRAME_ACCEPT`, 2 s pacing)

Frame time vs fetch time (item 1) and HTML frames (item 2). One official still per provider; headers recorded in
`__fixtures__/frame-headers.2026-10-01.json`, the NSW page body in `__fixtures__/nsw-frame-unavailable.2026-10-01.html`.
"Frame age" = upstream `Date` − `Last-Modified`.

| Still | Status · latency · type | CORS | Frame time published | Frame age at probe | Effect |
|---|---|---|---|---|---|
| HK TD `tdcctv.data.one.gov.hk/H429F.JPG` | 200 · 1.54 s · image/jpeg 22.9 kB | `*` | Last-Modified | 68 s | `X-Frame-Observed-At` = Last-Modified, `X-Frame-Time-Source: last-modified`, `X-Frame-Fetched-At` separate. |
| Caltrans `cwwp2.dot.ca.gov/data/d7/cctv/image/i110196avenue26offramp/…jpg` | 200 · 0.49 s · image/jpeg 27.3 kB | `*` | Last-Modified | 91 s | same |
| Fintraffic `weathercam.digitraffic.fi/C0150301.jpg` | 200 · 0.54 s · image/jpeg 318 kB (CloudFront `RefreshHit`) | `*` | Last-Modified (= `x-amz-meta-last-modified`) | **61 min** | Shown as a 1 h-old frame (was the concern: an age near 0 would have been the fetch time). |
| NSW `webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/5_ways_miranda.jpeg`, `airport_dr_mascot.jpeg` | 200 · 1.31–1.38 s · **text/html 307 B** (`x-cache: Error from cloudfront`, Last-Modified 2023-08-30) | none | — | — | Refused by declared Content-Type before any byte is inspected → 502 `{detail: not_an_image, state: offline, upstreamType: text/html}`; HTML never parsed or relayed; frame-health ledger marks NSW **FRAMES UNAVAILABLE** once ≥ 5 cameras fail operator-wide (rule tightened in the round-4 fix pass, below). |
| Ottawa `traffic.ottawa.ca/map/camera?id=148` | 200 · 0.50 s · image/jpg | none | **none** | unknown | `X-Frame-Time-Source: none`; viewer reads UNTIMED + fetch time, never LIVE. |
| THB `cctv-ss06.thb.gov.tw/T3-262K+800/snapshot` | 200 · 1.75 s · image/jpeg (no `Date` either) | none | **none** | unknown | same |
| Via Lietuva `eismoinfo.lt/…/camera/last?id=305` | 200 · 0.77 s · image/jpeg 151 kB | `*` | **none** | unknown | same |
| WSDOT `images.wsdot.wa.gov/nw/520vc00570.jpg` | 200 · 0.65 s · image/jpeg | none | Last-Modified | 34 s | — |
| ODOT `tripcheck.com/RoadCams/cams/US30%20at%20Rainier%20Summit%20EB_pid4055.jpg` | 200 · 0.45 s · image/jpeg | none | Last-Modified | 24 min | Viewer: `SNAPSHOT · STALE · 24m` (6 × 60 s cadence exceeded). |
| INDOT `public.carsprogram.org/cameras/IN/INDOT_508_…flv.png` | 200 · 0.53 s · declared image/jpeg, **PNG bytes** | `*` | Last-Modified | 3 min | Sniffed type wins (`image/png`). |
| Toronto `opendata.toronto.ca/…/CameraImages/loc8170.jpg` | 200 · 0.40 s · declared image/jpeg, PNG bytes | none | Last-Modified | **16 h** | Viewer: `SNAPSHOT · STALE · 16h`. |
| MDOT `micamerasimages.net/thumbs/semtoc_cam_130.flv.jpg?item=1` | 301 · 0.44 s (to host-root `.jpg`, exact-file rule) | none | — | — | unchanged |

`/api/cctv` `providers.*.age_s` (R2 MINOR-2): the precompressed payload's version now carries a minute bucket, so
`age_s` = seconds since that provider's inventory fetch (± 60 s), no longer frozen at the first request's 0–3 s.

### Phase 3 round 4 fix pass (2026-10-01 10:35–10:37 UTC, same honest UA, `Accept: FRAME_ACCEPT`)

Which failures are the operator's (frame-health review). Recorded `__fixtures__/livetraffic-livecams.2026-10-01.json`
(first six `liveCams` features of the NSW feed).

| Request | Status · latency · type | CORS | Effect |
|---|---|---|---|
| NSW `www.livetraffic.com/datajson/all-feeds-web.json` | 200 · 3.65 s · application/json 1.78 MB (2 829 features, 241 `liveCams`) | none | Inventory unchanged (`ok: true`, 241 cameras). |
| NSW stills `5_ways_miranda`, `airport_dr_mascot`, `alison_road_randwick` `.jpeg` | 200 · 0.62–1.18 s · **text/html 307 B** (Last-Modified 2023-08-30) | none | Outage continues → `not_an_image`, operator-wide. |
| HK TD `tdcctv.data.one.gov.hk/H429F.JPG` | 200 · 0.24 s · image/jpeg 17.4 kB · Last-Modified 2 min | `*` | Frame relayed. |
| HK TD `tdcctv.data.one.gov.hk/ZZZZZ.JPG` (no such camera) | **404** · 1.20 s · text/html 236 B | — | `upstream_404`: the camera's, never counted against the operator. |
| Caltrans `cwwp2.dot.ca.gov/data/d7/cctv/image/i110196avenue26offramp/…jpg` | 200 · 0.56 s · image/jpeg 27.6 kB · Last-Modified 1 min | `*` | Frame relayed. |
| Caltrans `…/cctv/image/doesnotexist/doesnotexist.jpg` | **500** · 0.58 s · text/html 193 B | — | Caltrans answers 5xx for a missing image, so a 5xx is not always operator-wide: the verdict needs ≥ 5 distinct cameras and > 90 % of them failing (one dead camera cannot mark Caltrans unavailable). |

Rule now: only `not_an_image`, 5xx, network, `parse`, `redirect` and operator timeouts (the operator had its full
8 s request time) count against an operator; `upstream_404/410`/other 4xx, `no_snapshot`, `too_large` and `blocked` are
per camera; a request still waiting in this server's per-operator limiter (or cut short by the 15 s deadline because of
that wait) is `queued` (503, `Retry-After: 15`) and never recorded. A failure answered without any request to the
operator carries `fetchedAt: null` and no `X-Frame-Fetched-At`.
