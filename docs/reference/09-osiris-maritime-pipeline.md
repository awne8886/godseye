# OSIRIS maritime/AIS pipeline
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
**Question answered:** The maritime/AIS pipeline is not documented. That covers the aisstream subscription, ship-type mapping, ship expiry, port congestion, dynamic chokepoint risk and the snapshot TTL.

## Summary

The maritime pipeline is one Next.js route, src/app/api/maritime/route.ts (347 lines). When the module loads, it opens a WebSocket to aisstream.io (it needs AIS_API_KEY; the `ws` package is marked as a serverExternalPackage). Incoming messages go into a Map keyed by MMSI and stored on globalThis. The Map holds at most 20,000 entries and evicts the oldest insertion first. Each GET lazily builds a JSON snapshot and reuses it for 5 s (SNAPSHOT_TTL_MS). The build does four things: drops ships not updated for 10 min, scores congestion at 52 static PORTS (ships within 50 km, speed <0.5 kn counts as waiting), escalates risk at 10 static CHOKEPOINTS (ships within 100 km), and returns {ports, chokepoints, ships, total_ports, total_chokepoints, total_ships, timestamp} with Cache-Control 'public, max-age=5, s-maxage=5, stale-while-revalidate=15'. The client (src/app/page.tsx) fetches once when the layer is on, which is the default (maritime: true). After that it re-polls every 10 s while ships are present, or every 300 s when there are none. OsirisMap.tsx turns the payload into three GeoJSON sources ('maritime', 'maritime-choke', 'maritime-ships') and draws them as 8 layers with fixed colour 'match' expressions. Every item in the brief checked out, with some corrections and additions. (1) The feature mapping drops mmsi, so the ship popup links to 'mmsi:undefined'. It also drops congestion and dwell_time from ports, so the port popup's congestion block never shows. (2) Naval bases have no volume, so their volume string reads 'undefined | LIVE: n (WAITING: m)'. (3) Static data that arrives before a ship's first position is thrown away. (4) TrueHeading 511 ('not available') is truthy, so it shows as a 511° heading. (5) The code comment says 58 ports, but the array has 52 (31 container, 8 energy, 13 naval). (6) Map dots show MODERATE and LOW chokepoints as #26A69A, while the popup shows both as #00E676.

## Findings

### 0. AIS WebSocket client: connection lifecycle

Module-level state: `globalThis.shipsCache: Map<number, any>` and `globalThis.isAisConnecting: boolean`, initialised once (route.ts:86-96). connectAisStream() (route.ts:98-207) is called at module import (route.ts:210), i.e. on the first request that loads the route (the first GET /api/maritime, or the server-side fetch from /api/markets). Guard: `if (globalForAis.isAisConnecting) return;` then `const apiKey = process.env.AIS_API_KEY; if (!apiKey) return;`. With no key it never connects and never retries, and ships stays []. URL: `new WebSocket("wss://stream.aisstream.io/v0/stream")` (route.ts:107), using the `ws` package ^8.21.0 (package.json:33) with next.config.ts:21 `serverExternalPackages: ['ws']`. On 'open' it sets isAisConnecting=false and sends the subscription JSON immediately. On 'close' it sets isAisConnecting=false and calls `setTimeout(connectAisStream, 5000); // Reconnect` (route.ts:199-202). On 'error' it calls `ws.close()`, which leads to the close handler and a reconnect. There is no backoff and no heartbeat. The comment at route.ts:83-84 says the state resets per invocation in serverless and only persists in the Node dev server or a Docker container. The build must use a long-lived Node process or a separate worker.

Files: `src/app/api/maritime/route.ts:82-111`, `src/app/api/maritime/route.ts:199-210`, `next.config.ts:21`, `package.json:33`, `.env.example:84-88`, `DOCKER.md:135`, `docker-compose.yml:103-105`

### 1. AIS subscription message (verbatim)

route.ts:115-141: `{ APIKey: apiKey, BoundingBoxes: [ [[34.8, 139.5], [35.7, 140.2]] /*Tokyo Bay*/, [[25.0, 54.0], [27.5, 57.5]] /*Hormuz*/, [[27.0, 32.0], [32.0, 33.5]] /*Suez Canal*/, [[12.0, 42.5], [14.0, 44.0]] /*Bab el-Mandeb*/, [[8.0, -80.5], [10.0, -79.0]] /*Panama Canal*/, [[1.0, 103.0], [3.0, 104.5]] /*Malacca / Singapore*/, [[22.0, 118.0], [26.0, 121.0]] /*Taiwan Strait*/, [[50.0, 0.0], [53.0, 5.0]] /*Rotterdam / English Channel*/, [[33.0, -119.0], [34.5, -117.0]] /*US West Coast (LA/LB)*/, [[-90, -180], [90, 180]] /*Global fallback (often heavily sampled by aisstream)*/ ], FilterMessageTypes: ["PositionReport", "ShipStaticData"] }`. Boxes are [[lat,lng],[lat,lng]]. The comment says: 'Target specific high-value SCM areas to ensure data delivery on free tier'. The global box already covers everything, so the regional boxes are redundant as a union. Whether aisstream weights them differently is not stated in the code.

Files: `src/app/api/maritime/route.ts:113-143`

### 2. AIS message parsing and ship record shape

route.ts:154-197. It parses JSON and reads `mmsi = parsed.MetaData?.MMSI`, returning if that is falsy. `existing = shipsCache.get(mmsi) || { id: mmsi, mmsi: mmsi, timestamp: Date.now() }`. If `MetaData.ShipName` is present, name = ShipName.trim(). PositionReport (`parsed.MessageType === "PositionReport" && parsed.Message?.PositionReport`) sets lat=Latitude, lng=Longitude, speed=Sog, `heading = report.TrueHeading || report.Cog`, and timestamp=Date.now(). ShipStaticData sets name = Name.trim() or the existing name, destination = Destination.trim() or the existing destination, and `type = getOsirisShipType(staticData.Type)`. ShipStaticData does NOT refresh the timestamp. The record is stored only `if (existing.lat && existing.lng)`. Consequences: (a) static data for an MMSI with no stored position is discarded, so most ships end up with no `type`; (b) ships at exactly lat 0 or lng 0 are rejected; (c) AIS sentinel values (lat 91, lng 181, Sog 102.3, Cog 360, TrueHeading 511) are not filtered. TrueHeading 511 is truthy and is reported as the heading, and TrueHeading 0 (due north) falls through to Cog. Parse errors are swallowed. Final ship shape: {id:number, mmsi:number, timestamp:ms, lat, lng, speed, heading, name?, destination?, type?}. `flag`, `imo` and callsign are never set.

Files: `src/app/api/maritime/route.ts:154-197`

### 3. Ship type mapping

route.ts:146-152: `const getOsirisShipType = (typeCode: number) => { if (!typeCode) return 'cargo'; if (typeCode >= 80 && typeCode <= 89) return 'tanker'; if (typeCode >= 70 && typeCode <= 79) return 'cargo'; if (typeCode === 35) return 'military'; return 'cargo'; };`. Everything else is collapsed to 'cargo': fishing 30, passenger 60-69, tug/SAR/law enforcement 50-59, pleasure/sailing 36-37, HSC 40-49, and 0/undefined. Ships that never received static data have no `type`, and the map feature defaults it with `type: s.type || 'cargo'` (OsirisMap.tsx:2179). As a result, the '#B0BEC5' fallback colour for unknown types can never be reached.

Files: `src/app/api/maritime/route.ts:145-152`, `src/components/OsirisMap.tsx:2179`

### 4. Cache size cap and stale expiry

Cap: after each message, `if (shipsCache.size > 20000) { const firstKey = shipsCache.keys().next().value; if (firstKey) shipsCache.delete(firstKey); }` (route.ts:189-193). A JS Map keeps insertion order and re-setting an existing key does not reorder it, so this evicts the earliest-inserted MMSI (FIFO), even if that ship is still actively reporting. It is not LRU. Expiry runs only inside buildSnapshot, so only on a GET after the TTL: `if (now - ship.timestamp > 10 * 60 * 1000) shipsCache.delete(mmsi)` (route.ts:238-243). With no readers, stale ships stay until the cap pushes them out.

Files: `src/app/api/maritime/route.ts:189-193`, `src/app/api/maritime/route.ts:237-245`

### 5. PORTS constant (52 entries)

route.ts:9-67. Shape: {name, country (ISO2), lat, lng, type: 'container'|'energy'|'naval', volume?: string, rank?: number, fleet?: string}. Container (31): Shanghai CN 31.23,121.47 '47.3M TEU' r1; Singapore SG 1.26,103.84 '37.2M TEU' r2; Ningbo-Zhoushan CN 29.87,121.55 '33.3M TEU' r3; Shenzhen CN 22.54,114.05 '30.0M TEU' r4; Guangzhou CN 23.08,113.32 '24.2M TEU' r5; Busan KR 35.10,129.04 '22.7M TEU' r6; Qingdao CN 36.07,120.38 '22.0M TEU' r7; Rotterdam NL 51.90,4.50 '14.5M TEU' r8; Tokyo JP 35.61,139.79 '4.5M TEU'; Yokohama 35.45,139.66 '2.9M TEU'; Kobe 34.67,135.21 '2.8M TEU'; Nagoya 35.08,136.87 '2.6M TEU'; Osaka 34.63,135.41 '2.1M TEU'; 'Hakata (Fukuoka)' 33.60,130.40 '0.9M TEU'; Kitakyushu 33.91,130.93 '0.5M TEU'; Shimizu 35.00,138.50 '0.5M TEU'; Tomakomai 42.63,141.63 '0.4M TEU'; Niigata 37.95,139.06 '0.2M TEU'; Sendai 38.27,141.02 '0.2M TEU'; 'Dubai (Jebel Ali)' AE 25.01,55.06 '14.0M TEU' r9; Port Klang MY 2.99,101.39 '13.2M TEU' r10; Antwerp BE 51.30,4.40 '12.0M TEU' r11; Xiamen CN 24.48,118.09 '11.4M TEU' r12; Hamburg DE 53.55,9.97 '8.7M TEU' r14; Los Angeles US 33.74,-118.27 '9.9M TEU' r13; Long Beach US 33.75,-118.19 '8.0M TEU' r15; Tanjung Pelepas MY 1.36,103.55 '9.8M TEU' r16; Savannah US 32.08,-81.09 '5.6M TEU' r20; Felixstowe GB 51.96,1.35 '3.8M TEU' r25; Santos BR -23.95,-46.31 '4.2M TEU' r22; Colombo LK 6.94,79.84 '7.2M TEU' r17. Energy (8): Mizushima JP 34.50,133.72 'Industrial'; Yokkaichi JP 34.95,136.65 'Industrial'; Ras Tanura SA 26.64,50.16 '6.5M bpd'; Fujairah AE 25.14,56.35 '3.5M bpd'; Novorossiysk RU 44.72,37.77 '2.8M bpd'; Houston Ship Channel US 29.73,-95.27 '2.5M bpd'; Kharg Island IR 29.24,50.33 '2.0M bpd'; Primorsk RU 60.35,28.70 '1.6M bpd'. Naval (13; fleet, no volume): Norfolk Naval Station US 36.95,-76.33 'US Atlantic Fleet'; San Diego Naval Base US 32.69,-117.15 'US Pacific Fleet'; Pearl Harbor US 21.35,-157.97 'US Pacific Fleet'; Yokosuka JP 35.28,139.67 'US 7th Fleet'; Severomorsk RU 69.07,33.42 'Russian Northern Fleet'; Tartus SY 34.89,35.89 'Russian Mediterranean'; Zhanjiang CN 21.20,110.39 'PLA Navy South Sea Fleet'; Qingdao Naval CN 36.09,120.43 'PLA Navy North Sea Fleet'; Portsmouth GB 50.80,-1.11 'Royal Navy'; Toulon FR 43.12,5.93 'French Navy Mediterranean'; Changi Naval Base SG 1.33,104.01 'Republic of Singapore Navy'; Visakhapatnam IN 17.69,83.30 'Indian Navy Eastern Command'; Mumbai Naval IN 18.93,72.84 'Indian Navy Western Command'. The comment at route.ts:222 says '58 ports', which is wrong. page.tsx:873 correctly says 52.

Files: `src/app/api/maritime/route.ts:9-67`, `src/app/api/maritime/route.ts:222`, `src/app/page.tsx:873`

### 6. CHOKEPOINTS constant (10) with static risk

route.ts:69-80 {name, lat, lng, traffic, risk}: 'Strait of Hormuz' 26.57,56.25 '21M bpd oil' HIGH; 'Strait of Malacca' 2.50,101.50 '16M bpd oil' MODERATE; 'Suez Canal' 30.43,32.34 '12% world trade' ELEVATED; 'Bab el-Mandeb' 12.58,43.33 '6.2M bpd oil' CRITICAL; 'Panama Canal' 9.08,-79.68 '5% world trade' LOW; 'Turkish Straits' 41.12,29.07 '3M bpd oil' MODERATE; 'Danish Straits' 55.70,12.60 '3.2M bpd oil' LOW; 'Cape of Good Hope' -34.36,18.47 'Alt route Suez' LOW; 'Taiwan Strait' 24.00,119.00 '88% large ships' ELEVATED; 'Lombok Strait' -8.47,115.72 'Alt Malacca' LOW. Risk vocabulary: CRITICAL > HIGH > ELEVATED > MODERATE > LOW.

Files: `src/app/api/maritime/route.ts:69-80`

### 7. Distance function

route.ts:248-252 uses a flat-earth (equirectangular) approximation, not Haversine (despite the comment 'Fast approximation of Haversine'): `dx = (lng1 - lng2) * Math.cos((lat1 + lat2) / 2 * Math.PI / 180); dy = lat1 - lat2; return Math.sqrt(dx*dx + dy*dy) * 111.32;` (km). It does not handle the antimeridian (dx is not wrapped). It is O(ports × ships) with no spatial index. The comment at route.ts:221-225 estimates about 1.4M distance calculations per build at 20k ships.

Files: `src/app/api/maritime/route.ts:247-252`, `src/app/api/maritime/route.ts:218-230`

### 8. Port congestion heuristic

route.ts:254-287. For each port it counts ships with distance < 50 km (nearbyCount). A ship counts as waiting if `ships[i].speed < 0.5 && ships[i].type !== 'military'` (the comment reads 'anchored/waiting'; there is no NavigationalStatus check, so ships moored at a berth count too, and untyped ships are included). `congestionRatio = nearbyCount > 0 ? waitingCount / nearbyCount : 0`. Defaults are congestion 'NORMAL' and dwell '1-2 Days'. `if (congestionRatio > 0.6 || waitingCount > 30)` gives 'SEVERE' with dwell '7+ Days'. `else if (congestionRatio > 0.4 || waitingCount > 15)` gives 'CONGESTED' with dwell '3-5 Days'. There is no minimum sample size, so a single stationary ship near a port makes it SEVERE (the test at route.test.ts:32-40 has one speed-0 ship at Singapore). The output merges `...port` with `volume: `${port.volume} | LIVE: ${nearbyCount} (WAITING: ${waitingCount})``, `congestion`, and `dwell_time`. Naval entries have no `volume`, so their string becomes 'undefined | LIVE: n (WAITING: m)'.

Files: `src/app/api/maritime/route.ts:254-287`, `src/app/api/maritime/route.test.ts:32-40`

### 9. Dynamic chokepoint risk

route.ts:289-306. nearbyCount is the number of ships with distance < 100 km. `let dynamicRisk = choke.risk; if (nearbyCount > 50) dynamicRisk = 'CRITICAL'; else if (nearbyCount > 20 && dynamicRisk !== 'CRITICAL') dynamicRisk = 'HIGH'; else if (nearbyCount > 5 && dynamicRisk === 'LOW') dynamicRisk = 'ELEVATED';`. Risk only ever escalates and never drops below the static value: Bab el-Mandeb is always CRITICAL and Hormuz is always at least HIGH. A MODERATE chokepoint with 6-20 ships stays MODERATE, because only LOW becomes ELEVATED. Output: `{...choke, traffic: `${choke.traffic} | LIVE SHIPS: ${nearbyCount}`, risk: dynamicRisk}`.

Files: `src/app/api/maritime/route.ts:289-306`

### 10. Snapshot cache, response and headers

`const SNAPSHOT_TTL_MS = 5_000;` (route.ts:231), stored at `globalThis.maritimeSnapshot = { body: string; builtAt: number }`. GET (route.ts:324-347) first `await fetchVesselApiFallback()`, which is an empty no-op ('Mock data removed per user request'; `lastVesselApiFetch` is unused, route.ts:212-216). Then `snapshot = cached && now - cached.builtAt < SNAPSHOT_TTL_MS ? cached : { body: buildSnapshot(now), builtAt: now }`. The body is pre-serialised JSON: `{ ports, chokepoints, ships, total_ports, total_chokepoints, total_ships, timestamp: new Date(now).toISOString() }` (route.ts:308-316). Ships are the full raw records, including mmsi and id. Headers: 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${5}, s-maxage=${5}, stale-while-revalidate=15`. Test seam: `export function clearMaritimeSnapshot()` deletes the snapshot (route.ts:319-322). There is no in-flight dedupe. The build is synchronous, so concurrent requests do not race. The browser's max-age is bypassed anyway, because the client fetches with `cache: 'no-store'` (page.tsx:665), so only a CDN benefits.

Files: `src/app/api/maritime/route.ts:212-235`, `src/app/api/maritime/route.ts:308-347`, `src/app/page.tsx:665`

### 11. Tests

route.test.ts has four vitest cases. They use fake timers at 2026-01-01T00:00:00Z and drive globalThis.shipsCache directly. (1) One ship at 1.26,103.84 makes Singapore.volume contain 'LIVE: 1' and 'WAITING: 1', with total_ships 1. (2) A second GET within 4 s returns identical bytes even after adding a ship. (3) After 5_000 ms it rebuilds and total_ships is 2. (4) cache-control contains 's-maxage=5' and 'max-age=5', does not contain 'no-store', and content-type is application/json.

Files: `src/app/api/maritime/route.test.ts:1-74`

### 12. Client fetch and poll cadence

The default layer state is `maritime: true` (page.tsx:333) and `sdk_sea: true` (page.tsx:360). First fetch (page.tsx:770-773): `fetchEndpoint('/api/maritime', d => ({ maritime_ports: d.ports, maritime_chokepoints: d.chokepoints, maritime_ships: d.ships }))`, guarded by layerFetchedRef. Poll (page.tsx:871-890) is a recursive setTimeout, not setInterval: `vesselGapMs = () => ((dataRef.current.maritime_ships?.length ?? 0) > 0 ? 10_000 : 300_000)`. The comment explains that without AIS the reply is byte-identical, so the fast rate is 'earned by actually carrying vessels'. fetchEndpoint (page.tsx:656-680) merges into dataRef and bumps dataVersion. On failure it sets backendStatus 'error' and logs '[OSIRIS] Suppressed error:'. On a cold start the AIS socket only opens when the route module first loads, so the first reply has 0 ships. If the first timer is scheduled before that reply lands, it waits 300 s. I did not verify this timing, but it would make vessels take up to 5 min to appear.

Files: `src/app/page.tsx:333`, `src/app/page.tsx:360`, `src/app/page.tsx:656-680`, `src/app/page.tsx:769-773`, `src/app/page.tsx:871-890`

### 13. Map sources and feature mapping (field drops)

The source ids 'maritime', 'maritime-choke' and 'maritime-ships' are registered in the source list at OsirisMap.tsx:410. Mapping at OsirisMap.tsx:2177-2180 (each is an empty array when the layer is off). Ports: `properties: { name, country, type, volume, fleet, rank }`, so congestion and dwell_time are DROPPED. Chokepoints: `{ name, traffic, risk }`. Ships: `{ name: s.name || s.mmsi?.toString(), type: s.type || 'cargo', speed, heading, destination, flag }`, so mmsi is DROPPED and flag is always undefined because the server never sets it. Visibility toggles at OsirisMap.tsx:2396-2398: setVis(['maritime-glow','maritime-dots','maritime-label']), (['choke-glow','choke-dots','choke-label']), and (['ship-dots','ship-label']) all key off activeLayers.maritime. Click and hover layers include 'maritime-dots', 'choke-dots' and 'ship-dots' (OsirisMap.tsx:1124-1125, 1457).

Files: `src/components/OsirisMap.tsx:410`, `src/components/OsirisMap.tsx:2177-2180`, `src/components/OsirisMap.tsx:2396-2398`, `src/components/OsirisMap.tsx:1457`

### 14. Map layer paint tokens (ports/chokepoints/ships)

Ports, commented 'ocean teal' (OsirisMap.tsx:673-688). maritime-glow: radius interpolate zoom 1→6, 5→12, 10→20; colour `['match',['get','type'],'naval','#D32F2F','energy','#E65100','#26C6DA']`; opacity 0.08; blur 1. maritime-dots: radius 1→3, 5→5, 10→9; same colour match; opacity 0.8; stroke 1.5 in the same colour at stroke-opacity 0.35. maritime-label: minzoom 4, text-field name, size 9, 'Open Sans Regular', offset [0,1.8], max-width 12, no overlap, colour '#26C6DA', halo '#000' width 1, opacity 0.7. Chokepoints, commented 'amber threat spectrum' (OsirisMap.tsx:690-704). choke-glow: radius 1→10, 5→18, 10→28; '#E65100'; opacity 0.1; blur 1. choke-dots: radius 1→4, 5→7, 10→12; colour `['match',['get','risk'],'CRITICAL','#D32F2F','HIGH','#E65100','ELEVATED','#F9A825','#26A69A']` (MODERATE and LOW both fall to #26A69A); opacity 0.85; stroke 1.5 '#E65100' at 0.4. choke-label: minzoom 3, size 10, 'Open Sans Bold', offset [0,2], max-width 14, colour '#E65100', halo '#000' width 1, opacity 0.9. Ships, commented 'ocean teal family' (OsirisMap.tsx:888-897). ship-dots: radius 1→2, 5→4, 10→6; colour `['match',['get','type'],'military','#D32F2F','tanker','#E65100','cargo','#26C6DA','#B0BEC5']`; opacity 0.75. ship-label: minzoom 5, size 9, 'Open Sans Regular', offset [0,1.2], text colour uses the same type match, halo '#000' width 1. All of these are plain circle dots with no heading-rotated icons.

Files: `src/components/OsirisMap.tsx:673-704`, `src/components/OsirisMap.tsx:888-897`

### 15. Popups (ship/port/chokepoint)

Ship popup (OsirisMap.tsx:1558-1581). Colour: military '#FF1744', tanker '#FF9500', otherwise '#00E5FF'. Icon: military '⚔️', tanker '🛢️', otherwise '🚢'. Header `${icon} [ ${(p.type||'VESSEL').toUpperCase()} ]` and right-aligned `FLAG: ${p.flag||'UNK'}`, which always shows UNK. Name, or 'UNIDENTIFIED VESSEL'. 2×2 grid: SPEED `Number(p.speed).toFixed(1)} kn`, HEADING `toFixed(0)°`, LATITUDE/LONGITUDE `toFixed(4)°`. `DESTINATION: ${p.destination || 'UNKNOWN'}`. Link `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${p.mmsi}` labelled '[ OPEN SOURCE ↗ ]'. It always renders 'mmsi:undefined' because mmsi is dropped at line 2179. Port popup (OsirisMap.tsx:1647-1671). typeColor: naval '#FF3D3D', energy '#FF9500', otherwise '#00BCD4'. typeLabel: 'NAVAL BASE', 'ENERGY PORT' or 'CONTAINER PORT', shown as `${typeLabel} — ${p.country}`. Rows 'Volume:', 'Fleet:' and 'Global Rank: #n'. A CONGESTION block (SEVERE '#FF1744', CONGESTED '#FF9500', otherwise '#00E676') plus 'EST. DWELL TIME' exists, but it is dead code because the features have no congestion. Naval bases show 'Volume: undefined | LIVE: n (WAITING: m)'. Chokepoint popup (OsirisMap.tsx:1673-1684). riskCol: CRITICAL '#FF1744', HIGH '#FF9500', ELEVATED '#FFD700', otherwise '#00E676'. Name in '#FF9500', 'Traffic:' in #fff, 'Risk:' in riskCol. The map and popup palettes differ: #D32F2F/#E65100/#F9A825/#26A69A on the map versus #FF1744/#FF9500/#FFD700/#00E676 in popups.

Files: `src/components/OsirisMap.tsx:1558-1581`, `src/components/OsirisMap.tsx:1647-1684`

### 16. Downstream consumers of the maritime payload

(1) ScmPanel.tsx is titled 'SCM RISK COMMAND' and toggled with key 'c' (page.tsx:515). congestedPorts = ports with congestion SEVERE or CONGESTED. riskyChokes = chokepoints with risk CRITICAL or HIGH. The section 'CONGESTED NODES' shows '✓ Global maritime flow optimal.' when empty. Rows have a left border and a badge: '#FF1744' for SEVERE/CRITICAL, otherwise '#FF9500'. Rows show `DWELL: {p.dwell_time}` and `p.volume.split(' | ')[1]` (e.g. 'LIVE: 3 (WAITING: 2)'). The badge counts `{totalRisks} ALERTS`. Hormuz is always ≥HIGH and Bab el-Mandeb is always CRITICAL, so this panel always shows at least 2 chokepoint alerts. (2) /api/markets fetchScmAlerts (markets/route.ts:190-212) server-fetches `${origin}/api/maritime` with AbortSignal.timeout(3000). For risk CRITICAL or HIGH it pushes these strings: '🚨 HORMUZ ${risk}: High risk of WTI/Brent Crude price spike due to congestion.', '🚨 SUEZ ${risk}: Potential supply chain delays impacting European markets and Energy.', '🚨 PANAMA ${risk}: LNG and Agriculture (Corn/Wheat) shipment delays expected.'. These appear as 'MARKET IMPACT ALERTS'. (3) The SDK mesh (page.tsx:1002-1011) samples ships with step `Math.max(1, Math.floor(ships.length / 60))`, about 60 nodes, as `{domain:'SEA', name: s.name || `MMSI-${s.mmsi}`, source:'AIS Stream'}`. The popup shows the label '⚓ MARITIME' (OsirisMap.tsx:1404), and source links map 'AIS Stream' to https://aisstream.io (OsirisMap.tsx:1391-1393). (4) The AOI watch layer (aoi.ts:70) is `{ key: 'maritime_ships', label: 'Vessels', color: '#448AFF', labelFields: ['name','mmsi','imo'], detail: destination || flag }`, with entity id `e.id ?? e.icao24 ?? e.mmsi ?? ...` (aoi.ts:156). (5) PolybolosClient.translateMaritime maps ships to id `osiris-sea-${mmsi}`, feed 'maritime-ais', confidence 0.85. (6) LayerPanel has a group 'MARITIME' (Ship icon) with a single toggle { key: 'maritime', label: 'Maritime / Naval', dataKey: 'maritime_ships,maritime_ports,maritime_chokepoints' }, plus the SDK group { key: 'sdk_sea', label: 'Maritime Lines' }. (7) The docs catalogue entry at apiCatalog.ts:303-309 reads 'Ports, chokepoints, and vessel positions.' with env ['AIS_API_KEY'].

Files: `src/components/ScmPanel.tsx:18-26`, `src/components/ScmPanel.tsx:91-124`, `src/app/api/markets/route.ts:189-212`, `src/app/page.tsx:1002-1011`, `src/lib/aoi.ts:70-71`, `src/lib/aoi.ts:156`, `src/lib/sdk/PolybolosClient.ts:50-62`, `src/components/LayerPanel.tsx:52-79`, `src/app/docs/apiCatalog.ts:303-309`

## Worth copying

- Keep the ship map on globalThis so it survives Next dev HMR and repeated route-module evaluation, and mark `ws` as serverExternalPackages.
- Build a pre-serialised JSON snapshot once per TTL window (5 s) and hand every caller the same string, so CPU cost does not grow with the number of viewers. Pair it with `public, max-age=5, s-maxage=5, stale-while-revalidate=15` for CDN reuse. Export a clear-snapshot test seam.
- Use adaptive client polling: re-poll every 10 s when vessels are present and every 300 s when the feed is empty (so replies are static). Use a recursive setTimeout that re-reads the count from a ref each time.
- Derive port congestion and chokepoint risk from live vessel density around static coordinates: 50 km port radius, 100 km chokepoint radius, and speed <0.5 kn meaning waiting. Risk escalates from the static baseline and never drops below it.
- Use the cheap equirectangular distance (dx scaled by cos of mean latitude, times 111.32 km) for proximity counting, but add antimeridian wrapping.
- Use AIS MetaData.ShipName as the name fallback, since it arrives on every message, before static data comes in.
- Link chokepoint risk to market-impact alerts (Hormuz → crude, Suez → EU supply chain, Panama → LNG and agriculture) and to an SCM risk panel.
- Colour-code everything consistently by type/risk with MapLibre 'match' expressions, zoom-interpolated radii, glow underlays (low opacity with blur 1), and minzoom-gated labels (ports 4, chokepoints 3, ships 5).

## Weaknesses to fix in GODSEYE

- mmsi is dropped in the ship feature mapping (OsirisMap.tsx:2179), so the MarineTraffic link is always `.../mmsi:undefined` (OsirisMap.tsx:1579). Pass mmsi, imo and callsign through.
- The port feature mapping (OsirisMap.tsx:2177) drops `congestion` and `dwell_time`, so the port popup's CONGESTION / EST. DWELL TIME block never renders. Only ScmPanel shows congestion.
- Naval PORTS have no `volume`, so the server produces 'undefined | LIVE: n (WAITING: m)' and the popup prints 'Volume: undefined | ...'. Keep live counts in separate numeric fields (live_count, waiting_count) instead of concatenating them into display strings. The same applies to the chokepoint `traffic` string.
- ShipStaticData that arrives before a ship's first PositionReport is discarded (the record is stored only if lat && lng). Most ships therefore never get a `type` and default to 'cargo'. Cache static data separately and merge it on the next position.
- AIS sentinel values are not filtered: TrueHeading 511 (unavailable) is truthy and shows as '511°'; heading 0 falls through to Cog; Cog 360, Sog 102.3 and lat 91 / lng 181 pass through; lat or lng exactly 0 is rejected by the truthiness check.
- The ship-type mapping is too coarse. Only 80-89 → tanker, 70-79 → cargo, 35 → military, and everything else → cargo. Passenger (60-69), fishing (30), tug/SAR/law enforcement (50-59), pleasure/sailing (36-37) and HSC (40-49) are all shown as cargo. Law-enforcement type 55 is not treated as military/government.
- flag is never computed, so the popup always shows 'FLAG: UNK'. Derive it from the MMSI MID (the first 3 digits) with a country lookup.
- Congestion ignores NavigationalStatus (1 = at anchor, 5 = moored). Ships at berth count as 'waiting', there is no minimum sample size (one stationary ship makes a port SEVERE / '7+ Days'), and untyped ships are included.
- MODERATE (Malacca, Turkish Straits) has no case in the map colour match and falls to '#26A69A', the same as LOW. The popup maps MODERATE and LOW to '#00E676'. The map palette (#D32F2F/#E65100/#F9A825/#26A69A) and the popup palette (#FF1744/#FF9500/#FFD700/#00E676) are inconsistent.
- The dynamic risk rules are asymmetric: >5 ships upgrades LOW → ELEVATED but leaves MODERATE unchanged, and risk can never fall below the static value. Hormuz (HIGH) and Bab el-Mandeb (CRITICAL) therefore always raise SCM alerts, and the HORMUZ market alert fires permanently.
- Eviction is FIFO by insertion order, not least-recently-updated, so an active ship can be evicted while stale ones remain. Stale expiry (10 min) only runs during a snapshot build, i.e. only when someone GETs.
- Scaling is O(ports × ships) with no spatial index (about 1.4M distance calculations at 20k ships), and there is no antimeridian handling in dx.
- The global bounding box [[-90,-180],[90,180]] makes the nine regional boxes redundant, since the union is already global.
- There is no reconnect backoff or jitter (a fixed 5 s), no heartbeat or stale-socket watchdog, and no retry if AIS_API_KEY is missing. The connection only starts when the route module is first imported, so the first response after a cold start always has 0 ships. The client may then schedule its next poll 300 s out (not verified), delaying vessels by up to 5 minutes.
- This does not work on serverless platforms such as Vercel functions, as the code admits at route.ts:83-84. It needs a persistent Node process or a separate ingest worker.
- The client fetches with cache:'no-store', which defeats the browser max-age the route sets. Only a CDN benefits.
- Ships are plain circles with no heading-rotated arrow icon, no trail/wake history, and no clustering at 20k points. The ship popup has no IMO, callsign, dimensions, ETA, draught or navigational status, even though ShipStaticData provides them.
- fetchVesselApiFallback is an empty no-op and lastVesselApiFetch is unused (route.ts:212-216). This is dead code that still costs an await on every GET.
- The code comment claims '58 ports', but the array has 52.

## Gaps (not verified)

- I did not read the dependency array of the page.tsx polling effect (around lines 850-900), so it is unconfirmed whether the first vesselGapMs() is evaluated before the initial /api/maritime reply lands. That determines whether the 300 s cold-start delay actually happens.
- I did not inspect the shared `popup()` helper, `pStyle` or `linkStyle` definitions used by the maritime popups (OsirisMap.tsx, defined before line 1200), so the popup container styling is not captured here.
- I did not verify the aisstream-side behaviour: how the global box is sampled on the free tier, rate limits, and the 3-second subscribe deadline. Nothing in the repo documents these.
- I did not read the SDK 'sdk-sea' line rendering, the layer that draws 'Maritime Lines' between the sampled SEA nodes, beyond the entity sampling in page.tsx:1002-1011.
- I did not check how ScmPanel's suppliers data (scm_suppliers) is produced. It shares the panel with the maritime data but is outside this pipeline.
