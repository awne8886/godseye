# CCTV camera sources: provenance, stream formats, terms, compliance layer
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
**Question answered:** Where do OSIRIS's roughly 39.5k CCTV cameras come from? This covers the bekijkhet.nu catalogue versus per-agency APIs (TfL, WSDOT, Caltrans, TxDOT, Trafikverket, Lithuania, Edmonton, Taipei, Seoul), the stream format of each (JPEG refresh, MJPEG, HLS, iframe), whether /api/cctv/proxy re-streams them, and each source's terms and attribution rules.

## Summary

OSIRIS's roughly 39.5k cameras come mostly from official traffic agencies that OSIRIS reaches through keyless public endpoints. Only a small share comes from bekijkhet.nu. The live /api/cctv at 2026-09-30T15:17Z returned 35,191 cameras with us-central, turkey and georgia still pending. A second call that included GDOT (4,330) brings the total to about 39.5k, and PR #402 reports 40,389 across 53 regions. Biggest contributors: IBI "511" state sites, about 14.2k (FDOT 4,960, GDOT 4,330, UDOT 2,081, NCDOT 1,154, NDOT 652, ADOT 644, LADOTD 336); TxDOT 4,377; Taiwan THB 2,209; Caltrans 2,000; DGT Spain 1,920; ASFINAG 1,821; ODOT 1,140; DriveBC 1,066; HK TD 1,013; TfL 890; Fintraffic 810; MDOT 804; INDOT 709; SkylineWebcams 681; Quebec 511 680; the OpenCCTV.org aggregator 2,576 across about 100 upstream labels; Iceland 497; Ottawa 428; and smaller sources. bekijkhet.nu supplies only the 300 "Public Webcam" pins (0.8%). It was used once, offline, as a list of links (scratch/scrape_public_webcams.js, INDEX_BASE https://www.bekijkhet.nu/). It has no API and no feeds, and 204 of those 300 entries are YouTube channel /live links. WSDOT, although listed in the README, currently contributes 0 cameras: OSIRIS calls data.wsdot.wa.gov/log/public/cameras.json, which returns 404. Seoul (25 TOPIS HLS streams) and Taipei (57 twipcam JPEG/MJPEG) are not fetched from the cities. They come second-hand through OpenCCTV.org, whose ToS forbids scraping and whose robots.txt has "Disallow: /api/". OSIRIS pulls /api/cameras/markers (7.3 MB) and /api/cameras/batch with a forged Referer.

Stream formats in the live catalogue (35,191 sample): refreshing JPEG 31,032 (26,355 feed_url with no type + 4,677 'jpg'), HLS 2,381, external link only 749, MP4 680 (Quebec 511), iframe 257 (YouTube / ipcamlive / ivideon), MJPEG 92. The player (src/components/CameraViewer.tsx) handles them as follows: hls.js 1.6 in a <video>, with native HLS on Safari; MJPEG as a plain <img>; MP4 as a looping muted <video>; iframes with allow="autoplay; fullscreen"; JPEG re-requested every 5 s with a ?_t= cache-buster. /api/cctv/proxy does not re-stream video. It is a same-origin still-image relay: one GET per request, response fully buffered, returned with Access-Control-Allow-Origin:* and max-age=5, for 10 allow-listed hosts. In the live catalogue it serves THB (2,209), DGT (1,920), Skyline snapshots (250), Via Lietuva (299) and Rijkswaterstaat (52), about 4.7k cameras. TxDOT (4,377) goes through its own /api/cctv/texas/snapshot route, which decodes base64 JPEGs. HLS, MJPEG and iframe sources are played straight from the browser. /api/cctv/stream-status only checks whether rtsp.me embeds are over quota. /api/cctv/resolve turns YouTube channel /live pages and Skyline pages into YouTube embed IDs.

The proxy's code has several legal and ethical problems. It sets rejectUnauthorized=false, which disables TLS verification. It sends a spoofed Chrome User-Agent and forges the Referer to the target origin; its own header comment says it "bypasses CORS / hotlink protection". stealthFetch adds a random residential-ISP IP in X-Forwarded-For and X-Real-IP to catalogue requests. The catalogue also includes material that should not be copied: 5 Opentopia cameras (an Insecam-style index of unsecured cameras, e.g. "Telephone Booth, Osaka" and "Parking Lot, Narashino"), hot-linked Windy imgproxy images (265 + 69) that bypass the Windy API terms, and EarthCam HLS. OSIRIS also scrapes internal endpoints on the IBI 511 sites (/List/GetData/Cameras) instead of the official keyed developer API; 511GA's documented limit is 10 calls per 60 s. OSIRIS's /privacy page covers only data about its users. It has no notice for people seen on camera and no camera takedown route, which is the gap issue #298 asks about. The issue is closed and no reply is visible.

## Findings

### 0. Live camera count and per-source breakdown (verified)

Live GET /api/cctv (2026-09-30T15:17Z): total 35,191, pendingRegions [us-central, turkey, georgia]. A second call included GDOT 4,330 (georgia), which gives the ~39.5k headline. /api/stats reported cctv 35,824 at 15:16Z. Top sources: FDOT 4960, TxDOT 4377, GDOT 4330, THB Highway Bureau 2209, UDOT 2081, Caltrans 2000, DGT 1920, ASFINAG 1821, NCDOT 1154, ODOT TripCheck 1140, DriveBC 1066, HK Transport Dept 1013, TfL 890, Fintraffic 810, MDOT 804, INDOT 709, SkylineWebcams 681, Quebec 511 680, NDOT 652, ADOT 644, OpenCCTV (all sub-sources) 2576, Vegagerdin 497, Ottawa 428, Toronto 336, LADOTD 336, Public Webcam (bekijkhet) 300, Via Lietuva 299, NZTA 252, NSW Live Traffic 241, nadmorski24.pl 71, Edmonton 58, Rijkswaterstaat 52, 511 Ontario 3 (only 3 hard-coded placeholders whose feed_url is the API URL itself), WSDOT 0.

Source: https://osirisai.live/api/cctv

### 1. PR #402: target size of the catalogue (verified)

Merged 2026-09-28. Production was serving only '27–33k of 40k cameras'. After the fix: '40,389 cameras across 53 regions ... zero pending regions'. us-central (travelmidwest returns no cameras) and turkey (empty) were removed as dead regions, turkey.ts was deleted, and Docker .cache permissions were fixed. Note: master's route.ts, as fetched, still registered us-central and turkey, and turkey.ts is still served from raw.

Source: https://github.com/simplifaisoul/osiris/pull/402

### 2. PR #403: region backoff (verified)

Merged 2026-09-29. A region that goes past REGION_BUDGET_MS=12s is put in a 5-minute cooldown (BACKOFF_MS) and returns []. Fetches run through a pool of REGION_CONCURRENCY=4. Warm responses wait at most WARM_GRACE_MS=2s. The payload is prebuilt, gzipped and served with an ETag; a snapshot is persisted to disk.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/cctv/route.ts

### 3. PR #404: Sweden (verified)

Merged 2026-09-30: 837 Trafikverket road cameras + 48 CamStreamer streams. The camera list is scraped from Kolla Trafiken (www.kollatrafiken.se /api/v1/counties and /api/v1/cameras POSTs with X-Requested-With), not from Trafikverket's own API. Images load directly in the browser from api.trafikinfo.trafikverket.se. CamStreamer players are resolved to YouTube embeds. UA 'OSIRIS/5.0 (+https://osirisai.live)'. Not yet in the live catalogue (no 'Trafikverket' source in the live /api/cctv).

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/cctv/sweden.ts

### 4. bekijkhet.nu's role (PR #378) (verified)

Used only as a list of links, once and offline: scratch/scrape_public_webcams.js (INDEX_BASE='https://www.bekijkhet.nu/') scrapes 16 pages (cams-wd.html ... vid.html, cruise.html). The index has no coordinates and no stream URLs, across 383 hosts. Places are geocoded with Nominatim (UA 'osiris-cctv/1.0') and emitted to public-webcams.generated.ts. 300 cameras result (216 NL), all source 'Public Webcam': 204 YouTube channel /live links resolved at runtime by /api/cctv/resolve, 8 HLS on Wowza streamlock.net (ACAO:*), a few ipcamlive/rtsp.me iframes, and the rest link-out only. Operator Wowza playlists that show ad-block notices are deliberately linked out, not replayed. PR #378 (merged 2026-09-19): 316 checked, 166 play in-app, 85 link out, 36 show recordings, 9 have embedding disabled, 16 dead removed. The README credits bekijkhet.nu (Bram and Annelies).

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/scratch/scrape_public_webcams.js

### 5. bekijkhet.nu terms (verified)

A hobby site listing 'ruim 700 links' to Dutch webcams. No API, no stated data licence, no reuse terms. The privacy/about page says it links to the operator's full site so visitors do not think bekijkhet owns the camera ('Ere wie ere toekomt'), and that it is ad-funded (Google Ads). Contact info@bekijkhet.nu. Scraping it is not addressed either way. Safe pattern: link each camera to its operator and credit bekijkhet as the discovery index.

Source: https://www.bekijkhet.nu/privacy.html

### 6. /api/cctv/proxy behaviour (does it re-stream?) (verified)

No video re-streaming. GET ?url=<allow-listed still>. Allow-list: cdn.skylinewebcams.com, cdn2.skylinewebcams.com, s3-eu-west-1.amazonaws.com, voyage.aprr.fr, stream.inmoves.nl, thb.gov.tw, etraffic.dgt.es, eismoinfo.lt, infobanjirjps.selangor.gov.my. Buffers the whole upstream body and returns it with the sniffed image type, Cache-Control public max-age=5 swr=10, ACAO *. It sends a spoofed Chrome/126 UA and a Referer of https://<target host>/ (omitted for thb.gov.tw), and sets options.rejectUnauthorized=false (TLS verification disabled). It tries up to 2 DNS addresses with a 6 s timeout each. The header comment reads 'bypasses CORS / hotlink protection on camera CDNs'. Live usage: THB 2,209 + DGT 1,920 + Skyline snapshots 250 + Via Lietuva 299 + Rijkswaterstaat 52 cameras.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/cctv/proxy/route.ts

### 7. /api/cctv/stream-status and /api/cctv/resolve (verified)

stream-status: only for rtsp.me/embed URLs. It fetches the embed page through safeFetch and reports blocked=true when the page says 'temporarily limited|Top up'; anything else returns not_rtsp_me. resolve: allow-list of SkylineWebcams pages and YouTube channel /live URLs. It fetches the page and extracts the current YouTube video id, caching 30 min OK / 5 min no-feed / 30 s unreachable (max 1,000 entries). The official docs describe /api/cctv/proxy as 'Same-origin proxy for camera streams that set restrictive CORS headers'. In the code it is a stills-only proxy.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/cctv/resolve/route.ts

### 8. Player spec as implemented (verified)

CameraViewer.tsx: hls.js (package.json 'hls.js': '^1.6.16') new Hls({enableWorker:false}), native HLS fallback via canPlayType('application/vnd.apple.mpegurl'), <video autoPlay muted playsInline>; mjpeg -> <img src=stream_url>; mp4 -> <video loop muted>; iframe -> <iframe allow='autoplay; fullscreen'> (no sandbox); jpg -> <img> refreshed every 5000 ms with &_t=Date.now(). The header shows 'SOURCE: {camera.source}'. External link button opens external_url or feed_url. Camera type: {id, lat, lng, name, city, country, feed_url?, stream_url?, stream_type?: 'jpg'|'hls'|'iframe'|'mjpeg' (+'mp4' used by Quebec), external_url?, source}. Live mix: JPEG 31,032, HLS 2,381, external 749, MP4 680, iframe 257, MJPEG 92.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/components/CameraViewer.tsx

### 9. stealthFetch (header spoofing) (verified)

src/lib/stealthFetch.ts 'Generates randomized HTTP headers to distribute API requests across a pool of spoofed residential IP addresses and browser fingerprints'. It sets X-Forwarded-For and X-Real-IP to random Comcast/AT&T/BT/Telekom and other ISP ranges plus a random UA. Used for TfL, WSDOT, Caltrans, Canada, Singapore, OpenCCTV, Lithuania and Edmonton fetches. A lawful rebuild should not copy this.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/lib/stealthFetch.ts

### 10. TfL JamCams (verified)

OSIRIS: GET https://api.tfl.gov.uk/Place/Type/JamCam (keyless; 890 cameras live). additionalProperties include imageUrl (https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/<id>.jpg) AND videoUrl (<id>.mp4 short clip). OSIRIS uses only the JPEG, loaded directly from S3 (not proxied in the live catalogue). Terms: TfL open data is under a modified Open Government Licence with call limits and a ban on presenting apps as official TfL products. The required attribution is widely cited as 'Powered by TfL Open Data' + 'Contains OS data © Crown copyright and database rights'. tfl.gov.uk returned 403 to this environment, so the exact primary text is UNVERIFIED. Third parties report images refresh about every 5 min.

Source: https://api.tfl.gov.uk/Place/Type/JamCam

### 11. TfL terms (primary page not reachable) (UNVERIFIED)

Terms page: https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service (HTTP 403 from this environment). The attribution string 'Powered by TfL Open Data. Contains OS data © Crown copyright and database rights' is taken from secondary sources (bilawalsidhu/gods-eye-view DATA_SOURCES.md; jamcams.co.uk). UNVERIFIED against the primary source.

Source: https://raw.githubusercontent.com/bilawalsidhu/gods-eye-view/main/DATA_SOURCES.md

### 12. WSDOT (verified)

OSIRIS fetches https://data.wsdot.wa.gov/log/public/cameras.json, which returns HTTP 404, so WSDOT contributes 0 cameras. Official options: REST GetCamerasAsJson?AccessCode=... (a free AccessCode is emailed on request; 'Currently only supports snap shots (not full video)'), and a keyless KML https://wsdot.wa.gov/traffic/api/HighwayCameras/kml.aspx (1,706 placemarks with coordinates and JPEG URLs on images.wsdot.wa.gov) plus RSS rss.aspx. No explicit licence or attribution text was found on the API page.

Source: https://wsdot.wa.gov/traffic/api/

### 13. Caltrans (verified)

OSIRIS queries the ArcGIS FeatureServer caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/CCTV/FeatureServer/0/query?where=1=1&outFields=*&f=json without paging. The layer has count 2,936 but maxRecordCount 2000 (exceededTransferLimit true), so OSIRIS silently drops 936 cameras. It uses currentImageURL (JPEG on cwwp2.dot.ca.gov, currentImageUpdateFrequency e.g. '15') and ignores the streamingVideoURL field (HLS where present). Alternative: per-district CWWP2 JSON, e.g. https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json. CWWP2: 'There is no charge for the use of this data'; 'Caltrans traffic camera video footage and still images are neither retained nor archived.' Conditions of Use: site information 'is considered in the public domain' unless otherwise indicated.

Source: https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm

### 14. Caltrans conditions of use (verified)

'In general, information presented on this website, unless otherwise indicated, is considered in the public domain. It may be distributed or copied as permitted by law. However, the California Department of Transportation does make use of copyrighted data (e.g., photographs) which may require additional permissions.' Dated July 19, 2021.

Source: https://dot.ca.gov/conditions-of-use

### 15. TxDOT (verified)

Inventory: https://its.txdot.gov/its/DistrictIts/GetCctvStatusListByDistrict?districtCode=XXX for 25 districts (ABL...YKM), keeping rows where hasSnapshot===true (4,377 live). Frames: GetCctvSnapshotByIcdId?districtCode=&icdId= returns JSON {snippet: base64 JPEG}. OSIRIS decodes this server-side at /api/cctv/texas/snapshot (validates the FFD8FF header, Cache-Control max-age=20, nosniff). stream_type 'jpg'. external_url https://its.txdot.gov/its/District/<D>/cameras. No camera-specific licence; the ITS site footer links only a general disclaimer (txdot.gov/about/disclaimer.html). Courtesy credit 'Texas Department of Transportation'.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/cctv/texas/snapshot/route.ts

### 16. Trafikverket official API (verified)

Trafikverket's open traffic API is licensed CC0 1.0. It requires registration, acceptance of the licence and email verification, and traffic is monitored against limits. Camera images load keyless: https://api.trafikinfo.trafikverket.se/v2/Images/data/road.infrastructure.camera/TrafficFlowCamera_39636115.jpg returned 200 image/jpeg. Camera object fields PhotoUrl / HasFullSizePhoto, with ?type=fullsize|thumbnail. The field details come from secondary Go-package and repo docs, so they are UNVERIFIED against the primary docs. OSIRIS instead scrapes the camera list from third-party kollatrafiken.se.

Source: https://www.trafikverket.se/e-tjanster/trafikverkets-oppna-api-for-trafikinformation/

### 17. Lithuania (Via Lietuva / eismoinfo.lt) (verified)

Keyless: layer-static-features/VKR?lks=false (WGS84 coordinates) joined with camera-info-table (road/km + frame date). Frames: https://eismoinfo.lt/eismoinfo-backend/image-provider/camera/last?id=N, JPEG ~10-min cadence, dropped if older than 6 h. Served through /api/cctv/proxy because 'eismoinfo refuses a foreign Referer'. 299 live. The attribution claim in the code comment ('terms permit reuse provided Via Lietuva or eismoinfo.lt is named as the source') is UNVERIFIED: the EIS regulations PDF (vialietuva.lt EIS-nuostatai_2026.pdf) could not be text-extracted here, and a search summary says data recipients must not modify EIS data and must follow the data agreement.

Source: https://raw.githubusercontent.com/simplifaisoul/osiris/master/src/app/api/cctv/lithuania.ts

### 18. Edmonton (verified)

POST https://edmontontrafficcam.com/Default.aspx/GetCameras with body {} returns rows in d[] (Code, Forge, Latitude, Longitude, MMSUrl, StreamCode, Status). Playlist = https://{MMSUrl}/{Forge}/public/hls/{StreamCode}.m3u8 on *.winkcdn.com. The CDN echoes Origin in ACAO, so hls.js plays it directly with no proxy. Stream codes rotate: 55 of 58 saved codes were dead after 5 months, so they must be read live. 57-58 live. City FAQ: 'The City of Edmonton does not record any video footage.' Terms (edmonton.ca/conditionsofuse): use 'only ... for personal, educational or non-commercial purposes', do not modify content, display the copyright notice. This is not an open-data licence.

Source: https://www.edmonton.ca/conditionsofuse

### 19. Taiwan THB (provincial highways) (verified)

Keyless list https://thbapp.thb.gov.tw/services/cctv/thb with fields id, stakenumber, gisx, gisy, html (e.g. https://cctv-ss01.thb.gov.tw:443/T2-140K+300). Frames: {html}/snapshot JPEG via /api/cctv/proxy, with no Referer (DigiEver encoders emit a malformed header when a Referer is sent) and an Accept header required. 2,209 live. Taiwan government open data is under 政府資料開放授權條款 v1: commercial use allowed, CC BY 4.0 compatible, and attribution must name the agency and year, state the licence and link to it.

Source: https://data.gov.tw/license

### 20. Taipei (README screenshot) actual source (verified)

All 57 cameras in the Taipei box on the live map come from 'OpenCCTV / twipcam' (JPEG https://c01.twipcam.com/cam/snapshot/<id>.jpg, plus Freeway Bureau MJPEG https://cctvc.freeway.gov.tw/abs2mjpg/bmjpg?camera=N). twipcam is itself a third-party aggregator of 9 government datasets, including 臺北市CCTV設施 and 新北市CCTV點位. It has its own keyless API https://www.twipcam.com/api/v1/cam-list.json licensed CC BY 3.0 TW with 'please credit the source'. twipcam.com is behind a bot check; the API doc was read via WebFetch.

Source: https://www.twipcam.com/api/document

### 21. Seoul (README screenshot) actual source (verified)

The 25 live Seoul cameras are 'OpenCCTV / topis-seoul' HLS streams, e.g. https://topiscctv1.eseoul.go.kr/edge13/ch5.stream/playlist.m3u8, played directly with hls.js. Busan (its-stream3.busan.go.kr:8443/rtplive/...), Ansan (its.ansan.go.kr:50004/live/...), Incheon, Daegu and others are the same pattern. TOPIS Open API terms: Seoul traffic data is offered through data.seoul.go.kr (application and key required), granting the right to use it 'for non-profit purposes' (비영리를 목적으로 활용할 수 있는 권리). OSIRIS bypasses that route by taking the stream URLs from OpenCCTV.

Source: https://topis.seoul.go.kr/refRoom/openRefRoom_4.do

### 22. OpenCCTV.org (aggregator) terms vs OSIRIS use (verified)

OSIRIS module opencctv.ts pulls GET https://opencctv.org/api/cameras/markers (7.3 MB, parallel id/lat/lng arrays) and POST /api/cameras/batch {ids} (≤50 rows) with Referer https://opencctv.org/. It samples eastasia cap 1200, seasia 800, westasia 600. Without a Referer, markers returned 403 here. ToS (Impactful Technology LLC, July 2026): users agree not to 'scrape, bulk-download, overload ... circumvent security, rate limits, or access controls; or use camera imagery to harass, surveil, or identify individuals'. robots.txt: 'Disallow: /api/'. Operators can request removal by email.

Source: https://opencctv.org/terms

### 23. Insecam-style and restricted content inside the OSIRIS catalogue (verified)

Via OpenCCTV, the live catalogue includes 'OpenCCTV / opentopia' (5), e.g. 'Telephone Booth, Osaka' https://images.opentopia.com/cams/19951/big.jpg and 'Parking Lot, Narashino'. Opentopia is described as listing thousands of unsecured cameras, like Insecam. The UK ICO condemned Insecam in 2014. Also present: 'OpenCCTV / windy' 265 + 'windy-providers' 69 hot-linking https://imgproxy.windy.com/_/full/plain/current/<id>/original.jpg outside the Windy API (Windy terms: 'Use images only with URLs provided by the API', link each image to the Windy page, credit 'Webcams provided by Windy.com'; API image tokens expire after 10 min on the free tier); EarthCam HLS (videos-3.earthcam.com); ivideon iframes.

Source: https://learncctv.com/how-to-view-unsecured-cameras/

### 24. Insecam regulatory context (verified)

Insecam 'lists unsecured live IP surveillance and CCTV cameras with a default password'. About 73,000 cameras in 152 countries by Nov 2014. UK ICO's Christopher Graham condemned it on 2014-11-20; the FTC issued a warning the same day.

Source: https://en.wikipedia.org/wiki/Insecam

### 25. SkylineWebcams (verified)

681 in OSIRIS: 431 link out and 250 are snapshots cdn.skylinewebcams.com/liveNNN.jpg proxied with a forged Referer. Skyline pages backed by YouTube are resolved to YouTube embeds. Skyline ToS: content 'cannot be used, modified, adapted, reformatted, downloaded, reproduced (even in partial form), transmitted, published'; it is 'prohibited to reproduce frames that are generated by the webcams'; commercial use needs VisioRay approval; removing VisioRay marks is forbidden. OSIRIS's own camera-feed.ts notes that Skyline snapshot ids get reused (live341.jpg labelled Trevi Fountain shows a Canaries beach).

Source: https://www.skylinewebcams.com/en/terms-of-use.html

### 26. IBI 511 states (FL, GA, UT, NC, AZ, NV, LA): about 14.2k cameras (verified)

OSIRIS uses the sites' internal DataTables endpoint /List/GetData/Cameras (100 rows/page) and image URLs /map/Cctv/{id}; FDOT, NCDOT, NDOT and LADOTD also expose HLS. The official route is the developer API: 511GA's docs say 'Requires a developer key ... Throttling is enabled. Ten calls every 60 seconds.' OSIRIS takes the keyless internal path.

Source: https://511ga.org/developers/doc

### 27. Other licensed sources worth copying (verified)

Fintraffic/Digitraffic weathercams (810; https://weathercam.digitraffic.fi/<preset>.jpg; station list tie.digitraffic.fi/api/weathercam/v1/stations): CC BY 4.0, attribution 'Source: Fintraffic / digitraffic.fi, license CC 4.0 BY'. HK Transport Department snapshots (tdcctv.data.one.gov.hk/<id>F.JPG, 1,013): DATA.GOV.HK allows commercial and non-commercial reuse with attribution to the Government/organisation and DATA.GOV.HK. Ontario 511 is listed by gods-eye-view under OGL-Ontario (UNVERIFIED primary).

Source: https://www.digitraffic.fi/en/terms-of-service/

### 28. HK data.gov.hk terms (verified)

'You are allowed to browse, download, distribute, reproduce, hyperlink to, and print the Data for both commercial and non-commercial purposes on a free-of-charge basis'; you must identify the source and give proper attribution to the Government, the Relevant Organisations and DATA.GOV.HK.

Source: https://data.gov.hk/en/terms-and-conditions

### 29. Issue #298 (GDPR) (verified)

Opened by @beecho01 on 2026-08-27, now closed; no comments visible. Asks whether republishing public UK webcam feeds on a national-scale 'OSINT/monitoring' platform needs its own UK GDPR lawful basis, quoting IAPP: 'the GDPR applies in full irrespective of if the data are or were publicly available'. Argues that purpose alignment favours a 'traffic viewer' framing, and asks about an Art. 14(5)(b) public privacy notice with a takedown procedure. OSIRIS's /privacy page (src/app/privacy/page.tsx, reviewed 2026-09-17) covers only user data flows (geo-IP, OSINT lookups, Gemini, Telegram). It has no camera-subject notice and no takedown process.

Source: https://github.com/simplifaisoul/osiris/issues/298

### 30. Parallel project policy (reference implementation) (verified)

bilawalsidhu/gods-eye-view DATA_SOURCES.md documents per-source licence and attribution for camera feeds, e.g. TfL 'Powered by TfL Open Data. Contains OS data © Crown copyright and database rights'; TxDOT frames 'fetched live at request time and are never stored or redistributed'. It also has an explicit frame-content policy: no blurring, enhancement, or face/plate/object detection on camera frames. Their issue #269 covers face/plate policy.

Source: https://raw.githubusercontent.com/bilawalsidhu/gods-eye-view/main/DATA_SOURCES.md

## Recommendations

- Source mix for the rebuild: build the CCTV layer on first-party agency feeds with a clear licence, and give every source a registry row {id, operator, list_endpoint, frame_url_template, stream_type, licence, attribution_string, terms_url, key_required, max_poll_interval, proxy_allowed:boolean}. Show attribution_string in the viewer header and in a global Data Attribution panel.
- Tier-1 lawful sources (open licence or public-domain terms): Caltrans CWWP2 per-district JSON (page the ArcGIS layer with resultOffset, or use cwwp2 dNN JSON, to get all 2,936; use streamingVideoURL for HLS where present); Trafikverket official API (register for a free key; CC0; images direct from api.trafikinfo.trafikverket.se); Fintraffic Digitraffic (CC BY 4.0; send a Digitraffic-User header); HK TD via DATA.GOV.HK (attribution); Taiwan THB and Freeway Bureau under the Taiwan OGD licence v1 (attribution with agency, year, licence link); TfL JamCams (register an app_key; show 'Powered by TfL Open Data'; offer the mp4 clip as 'latest clip', not 'live'); WSDOT keyless KML (1,706 cameras) or REST with a free AccessCode.
- Tier-2 (public but restricted terms): TxDOT ITS (no explicit licence; decode base64 server-side like OSIRIS, cache at most 20-30 s, credit TxDOT); Seoul TOPIS via data.seoul.go.kr with a key (non-profit use only); twipcam API (CC BY 3.0 TW, credit twipcam and the underlying agencies) instead of going through OpenCCTV; IBI 511 states through their official developer APIs with keys (respect 10 calls/60 s; cache the inventory for hours); Edmonton (non-commercial only; keep a 'City of Edmonton' notice; read stream codes live).
- Exclude: OpenCCTV /api/* (ToS and robots.txt forbid it); any Opentopia or Insecam-type or default-password camera source (hard-block hosts such as images.opentopia.com and insecam.org); Windy images not obtained through the Windy API with a key; EarthCam and SkylineWebcams frames (link out only, or use their official embed or YouTube); spoofed X-Forwarded-For, User-Agent or Referer; rejectUnauthorized=false.
- bekijkhet.nu: treat it only as a discovery index. Store operator page URLs, link out by default, and embed only where the operator publishes an official embed (YouTube live or the operator's own player). Credit bekijkhet.nu, and do not replay ad-supported Wowza playlists. Ask info@bekijkhet.nu before re-scraping.
- Player spec: one CameraViewer with these branches. 'jpg': <img> refreshed at max(source refresh, 10 s) with a cache-buster only where the source accepts query strings; pause when hidden (IntersectionObserver or document.visibilityState). 'hls': hls.js with lowLatencyMode off and capLevelToPlayerSize, native HLS on Safari, a 20 s start timeout, then fall back to the snapshot. 'mjpeg': <img>, closed when the viewer closes to release the connection. 'mp4': <video loop muted>. 'iframe': only YouTube (youtube-nocookie) and allow-listed operator players, with sandbox='allow-scripts allow-same-origin allow-presentation' and referrerpolicy='strict-origin-when-cross-origin'. 'external': link card. Show a LIVE / SNAPSHOT (age) / CLIP badge from frame timestamps. Map previews must use thumbnails and at most N concurrent tiles.
- Proxy spec (if needed at all): a stills-only relay for sources that are CORS-blocked or HTTP-only and whose terms allow it. Strict host allow-list tied to the registry's proxy_allowed flag, TLS verification ON, honest UA 'GodsEye/1.0 (+contact URL)', no forged Referer or IP headers, max-age equal to the source cadence, response size cap, image content-type sniffing, per-host rate limit, no disk persistence of frames. Never proxy HLS segments.
- Compliance layer (answers issue #298): a /cameras-notice page with an Art. 13/14-style notice for people who appear on camera (purpose: situational and traffic awareness; no recording, no archiving, no face or plate recognition); a one-click 'Report / remove this camera' button on every feed, emailing the operator contact with a documented SLA; a region-level kill switch (e.g. an EU/UK 'link-out only' mode); no server-side frame storage; state explicitly that the product does no face, plate or object detection on frames.
- Headline counter: report the camera count by class (live video / snapshot / link-out) and exclude placeholders. The honest total from lawful Tier-1 and Tier-2 sources should still land around 30-40k: IBI 511 (~14k via official keys) + TxDOT 4.4k + THB 2.2k + Caltrans 2.9k + WSDOT 1.7k + Trafikverket ~840 + TfL 890 + Fintraffic 810 + HK 1k + DGT 1.9k + ASFINAG 1.8k + Canada ~2.5k + others.
- Fix OSIRIS bugs rather than copying them: WSDOT endpoint 404 (0 cameras); Caltrans truncated at 2,000 of 2,936; 511 Ontario placeholders whose feed_url is the API URL; us-central (travelmidwest) empty; the docs describe /api/cctv/proxy as a stream proxy but it only handles stills.

## Gaps (not verified)

- The TfL transport-data-service terms and the exact required attribution wording could not be read from the primary source: tfl.gov.uk and techforum.tfl.gov.uk return 403 to this environment. The string comes from secondary sources.
- The attribution and reuse terms for eismoinfo.lt / Via Lietuva could not be confirmed from a primary source. The claim comes only from an OSIRIS code comment; the EIS regulations PDF text could not be extracted.
- The WSDOT camera-image licence or attribution requirements were not found. The API page shows only the access-code process and a bridge-clearance disclaimer.
- DGT Spain, ASFINAG, Rijkswaterstaat, IBI 511 site terms of use (beyond 511GA's developer throttling), THB snapshot usage terms, and Seoul TOPIS stream-specific terms were not verified individually.
- GitHub PR diffs and file lists for #378/#402/#403/#404 were not read. Only the WebFetch summaries of the PR pages were used, because the GitHub API and MCP were not enabled for this repository in the session. Current master still lists us-central and turkey, contrary to PR #402's description; this may be a caching or branch difference that was not investigated.
- Trafikverket Camera object field names (PhotoUrl, HasFullSizePhoto, type=fullsize/thumbnail) were confirmed only through secondary package docs and search summaries. The primary data-model page did not render them.
- The exact per-source mix behind the ~39.5k figure changes minute to minute with pending regions. The breakdown is from one 35,191-camera snapshot plus the GDOT count (4,330) from a second call, not a single complete response.
- OpenCCTV's /api endpoints returned 403 without a Referer. Their current rate-limit or access-control policy beyond the ToS and robots.txt was not tested further, on purpose.
