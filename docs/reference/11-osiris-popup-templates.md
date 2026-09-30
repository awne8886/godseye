# OSIRIS popup HTML templates and symbol-label constants
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
**Question answered:** The exact popup HTML templates and symbol-label layout constants for non-flight entities were never quoted.

## Summary

Every non-flight popup in osiris is an inline-styled HTML string built in src/components/OsirisMap.tsx and passed to one helper, popup() at line 956. That helper creates `new maplibregl.Popup({ closeButton: true, maxWidth: '420px', offset: 14 })` and removes the previous popup first, so only one is open at a time. All popups except the IP-sweep device popup start from a shared card style `pStyle` (line 960) and a shared button style `linkStyle` (line 961). Each popup then adds its own 1px border, written as the accent hex plus a two-digit alpha suffix (40, 4D/4d, 60, 66). globals.css:325-329 strips MapLibre's own chrome: the popup content is transparent with no padding and the tip is hidden. The card look therefore comes entirely from pStyle. Every template below is quoted verbatim with its line number: earthquake 1109-1117, fire 1216-1223, malware 1240-1257, GDELT event 1270-1285, CF outage 1297-1315, CF attack 1323-1337, GDACS 1364-1368, conflict 1377-1385, SDK link 1407-1419, C2 1436-1453, scan target 1467-1474, SCM 1492-1499, sweep device 1511-1521, balloon 1529-1538, radiation 1547-1555, ship 1566-1580, weather 1589-1599, nuclear 1628-1644, port 1655-1670, chokepoint 1679-1683, alert pin 1702-1740. Live news, CCTV and satellites have no MapLibre popup. News and CCTV call onEntityClick and open a side panel; satellites open a React panel through setSelectedSat. The symbol-label constants for all 18 base-style label layers (lines 438-897) plus the airport and drawn-polygon labels (3017-3028, 2707) are listed in full. Popup accent colours often do not match the dot colours on the map (the nuclear popup is the only one that matches on purpose). Several popups skip escaping, and one popup has no card background at all.

## Findings

### 0. Popup helper, shared style strings, escaping helpers

OsirisMap.tsx:956-959 `const popup = (coords: any, html: string) => { popupRef.current?.remove(); popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '420px', offset: 14 }).setLngLat(coords).setHTML(html).addTo(map); };`
:960 `const pStyle = `background:rgba(12,14,26,0.95);backdrop-filter:blur(16px);border-radius:10px;padding:16px;font-family:'JetBrains Mono',monospace;`;`
:961 `const linkStyle = `display:inline-block;margin-top:8px;padding:5px 12px;font-size:10px;letter-spacing:0.12em;text-decoration:none;border-radius:5px;font-family:'JetBrains Mono',monospace;`;`
:964 `htmlEsc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')`
:965 `idSafe = s => String(s ?? '').replace(/[^a-zA-Z0-9_\.\-]/g, '')`
:966 `urlSafe = s => { const u = String(s ?? ''); return /^https?:\/\//i.test(u) ? u : '#'; }`. Callers test `src !== '#'` before rendering a link.
Shared text palette used in every popup: label grey #5C5A54, primary value #E8E6E0, secondary #9B978E / #8A8880 / #aaa / #999, alert-pin title #F2EFE8, alert 'more' rows #C9C5BC.
The label/value cell repeats verbatim: `<div><span style="color:#5C5A54;">LABEL</span><br/><span style="color:#E8E6E0;">value</span></div>` inside `display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;`.
The "dot header" (GDELT, CF, alert): `<span style="width:7px;height:7px;border-radius:50%;background:${accent};box-shadow:0 0 8px ${accent};"></span>` + `<span style="color:${accent};font-size:10px;font-weight:700;letter-spacing:0.15em;">LABEL</span>` in `display:flex;align-items:center;gap:8px;margin-bottom:10px;`.
The key/value table (GDELT, CF): `display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:10px;color:#9B978E;`. Keys use `<span style="opacity:0.6;">Key</span>`.

Files: `src/components/OsirisMap.tsx:956-966`

### 1. Global CSS overrides for MapLibre popups

globals.css:325 `.maplibregl-popup-content { background: transparent !important; border: none !important; box-shadow: none !important; padding: 0 !important; }`
:326 `.maplibregl-popup-tip { display: none !important; }`
:327 `.maplibregl-ctrl-attrib { display: none !important; }`
:328 `.maplibregl-popup-close-button { color: var(--text-muted) !important; font-size: 16px !important; padding: 4px 8px !important; }` (--text-muted is #5C5A54 in the core theme at :66 and #4A148C in ghost at :126)
:329 `:hover { color: var(--gold-primary) !important; }` (#D4AF37 core :21, #B388FF ghost :110)
:331 `.map-focus-active .maplibregl-canvas-container { filter: brightness(0.3); transition: filter 0.3s ease; }`
:332 `.map-focus-active .maplibregl-popup { z-index: 10 !important; }`
Inside @media (max-width: 768px), :453-455: `.maplibregl-popup { max-width: 260px !important; font-size: 10px !important; } .maplibregl-popup-content { max-width: 260px !important; padding: 8px !important; } .maplibregl-popup-close-button { font-size: 18px !important; padding: 4px 8px !important; }`
Inside @media (min-width: 2560px), :502: `.maplibregl-popup-content { font-size: 14px !important; }`

Files: `src/app/globals.css:325-332`, `src/app/globals.css:440-467`, `src/app/globals.css:499-503`

### 2. Earthquake popup (layer eq-circles)

OsirisMap.tsx:1109-1117 verbatim:
`<div style="${pStyle}border:1px solid rgba(255,149,0,0.3);">
<div style="color:#FF9500;font-size:14px;font-weight:700;margin-bottom:4px;">M${p.magnitude} EARTHQUAKE</div>
<div style="font-size:9px;color:#E8E6E0;margin-bottom:8px;">${htmlEsc(p.place||'Unknown location')}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;">
<div><span style="color:#5C5A54;">DEPTH</span><br/><span style="color:#E8E6E0;">${p.depth||'—'}km</span></div>
<div><span style="color:#5C5A54;">COORDS</span><br/><span style="color:#E8E6E0;">${coords[1].toFixed(3)}, ${coords[0].toFixed(3)}</span></div>
</div>
<a href="${p.source === 'NIGGG-BAS' ? 'https://ndc.niggg.bas.bg/' : `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(p.id||'')}`}" target="_blank" style="${linkStyle}color:#FF9500;border:1px solid rgba(255,149,0,0.4);background:rgba(255,149,0,0.1);">📊 ${p.source === 'NIGGG-BAS' ? 'NIGGG-BAS' : 'USGS DETAILS'}</a></div>`
Note that COORDS here has no degree sign, unlike the fire, conflict and weather popups.

Files: `src/components/OsirisMap.tsx:1104-1118`

### 3. Fire popup (layer fires-heat)

OsirisMap.tsx:1216-1223:
`<div style="${pStyle}border:1px solid rgba(255,107,0,0.3);">
<div style="color:#FF6B00;font-size:12px;font-weight:700;margin-bottom:6px;">🔥 ACTIVE FIRE DETECTED</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;margin-bottom:8px;">
<div><span style="color:#5C5A54;">BRIGHTNESS</span><br/><span style="color:#FF6B00;">${p.brightness||'—'}K</span></div>
<div><span style="color:#5C5A54;">COORDS</span><br/><span style="color:#E8E6E0;">${coords[1].toFixed(3)}°, ${coords[0].toFixed(3)}°</span></div>
</div>
<a href="https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;l:noaa20-viirs,viirs,modis_a,modis_t;@${coords[0]},${coords[1]},10z" target="_blank" style="${linkStyle}color:#FF6B00;border:1px solid rgba(255,107,0,0.4);background:rgba(255,107,0,0.1);">🛰️ NASA FIRMS MAP</a></div>`

Files: `src/components/OsirisMap.tsx:1211-1224`

### 4. Malware popup (layer malware-dots, abuse.ch URLhaus)

OsirisMap.tsx:1231-1238 derived values: `tType = (p.threat_type || 'malware').replace(/_/g, ' ').toUpperCase()`; `statusColor = p.status === 'online' ? '#39FF14' : '#FF1744'`; `place = [p.city, p.country].filter(Boolean).join(', ') || 'UNKNOWN'`; `host = p.as_name ? `AS${p.asn} ${p.as_name}` : ''`; `urls = Number(p.url_count) || 1`; `ref = urlSafe(p.reference)`.
:1240-1257 template:
`<div style="${pStyle}border:1px solid rgba(255,23,68,0.4);box-shadow:inset 0 0 12px rgba(255,23,68,0.1);min-width:250px;">
<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,23,68,0.3);padding-bottom:6px;margin-bottom:8px;">
<div style="color:#FF1744;font-size:12px;font-weight:700;letter-spacing:0.1em;text-shadow:0 0 4px rgba(255,23,68,0.5);">[ ${htmlEsc(tType)} ]</div>
<div style="color:#5C5A54;font-size:9px;">${htmlEsc(place)}</div></div>
<div style="color:#E8E6E0;font-size:11px;font-weight:bold;margin-bottom:2px;">${htmlEsc(p.malware || 'Unclassified payload')}</div>
${host ? `<div style="color:#5C5A54;font-size:9px;margin-bottom:10px;">${htmlEsc(host)}</div>` : '<div style="margin-bottom:10px;"></div>'}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:9px;margin-bottom:8px;background:rgba(0,0,0,0.3);padding:6px;border-radius:4px;">
  HOST → `<span style="color:#00E5FF;font-family:monospace;">${htmlEsc(p.ip)}:${htmlEsc(String(p.port ?? 0))}</span>`
  STATUS → `<span style="color:${statusColor};">${htmlEsc((p.status||'unknown').toUpperCase())}</span>`
  LIVE URLS → `#E8E6E0 ${urls}`
  LAST REPORT → `${htmlEsc((p.last_seen || '').split(' ')[0] || '—')}`</div>
<div style="color:#5C5A54;font-size:9px;margin-bottom:10px;">First seen ${htmlEsc((p.first_seen || '').split(' ')[0] || '—')}${p.reporter ? ` · reported by ${htmlEsc(p.reporter)}` : ''}</div>
<div style="display:flex;gap:6px;">${ref ? `<a href="${ref}" target="_blank" style="${linkStyle}flex:1;text-align:center;color:#E8E6E0;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.05);">URLHAUS REPORT ↗</a>` : ''}</div></div>`
The label spans in the grid are `color:#5C5A54;`.

Files: `src/components/OsirisMap.tsx:1226-1258`

### 5. GDELT 2.0 event popup (layer gdelt-events-dots)

OsirisMap.tsx:1262 `QUAD_COLOR = { '1': '#00E676', '2': '#00E5FF', '3': '#FF9500', '4': '#FF3D3D' }`, falling back to `'#9B978E'`. `src = urlSafe(p.url)`; `tone = Number(p.tone)`.
:1270-1285:
`<div style="${pStyle}border:1px solid ${accent}66;min-width:250px;">
[dot header] label=`${htmlEsc(p.quad_label)}`
<div style="color:#E8E6E0;font-size:12px;font-weight:700;margin-bottom:8px;">${htmlEsc(p.name)}</div>
<div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:10px;color:#9B978E;">
<span style="opacity:0.6;">Goldstein</span><span style="color:${Number(p.goldstein) < 0 ? '#FF3D3D' : '#00E676'};">${htmlEsc(p.goldstein)}</span>
<span style="opacity:0.6;">Avg tone</span><span style="color:${tone < 0 ? '#FF9500' : '#00E676'};">${htmlEsc(p.tone)}</span>
<span style="opacity:0.6;">Articles</span><span style="color:#E8E6E0;">${htmlEsc(p.articles)}</span>
<span style="opacity:0.6;">Country</span><span style="color:#E8E6E0;">${htmlEsc(p.country || '—')}</span></div>
<div style="margin-top:8px;font-size:9px;color:#5C5A54;">GDELT 2.0 · ${htmlEsc(String(p.date).slice(0, 16).replace('T', ' '))}Z</div>
${src !== '#' ? `<a href="${src}" target="_blank" rel="noopener noreferrer" style="${linkStyle}color:${accent};border:1px solid ${accent}66;background:${accent}1a;">SOURCE ARTICLE</a>` : ''}</div>`

Files: `src/components/OsirisMap.tsx:1261-1286`

### 6. Cloudflare Radar outage popup (layer cf-outage-dots)

OsirisMap.tsx:1294 `ongoing = p.ongoing === true || p.ongoing === 'true'` (comment: MapLibre serialises properties, so booleans can arrive as strings). `accent = ongoing ? '#FFB300' : '#8B7325'`.
:1297-1315: `<div style="${pStyle}border:1px solid ${accent}66;min-width:250px;">` + dot header text `${ongoing ? 'ONGOING OUTAGE' : 'RESOLVED OUTAGE'}` + `<div style="color:#E8E6E0;font-size:12px;font-weight:700;margin-bottom:8px;">${htmlEsc(p.country_name)}</div>` + `${p.description ? `<div style="color:#9B978E;font-size:10px;line-height:1.6;margin-bottom:8px;">${htmlEsc(p.description)}</div>` : ''}`. Then an auto/1fr grid with rows: Cause=`${htmlEsc(p.cause || 'Unspecified')}`, Scope=`${htmlEsc(p.scope || 'Nationwide')}`, Started=`String(p.start).slice(0, 16).replace('T', ' ')`, and Ended (only if p.end, same slice). All values are #E8E6E0. Footer: `<div style="margin-top:8px;font-size:9px;color:#5C5A54;">Cloudflare Radar</div>`. Link (only if src !== '#'): `...style="${linkStyle}color:${accent};border:1px solid ${accent}66;background:${accent}1a;">RADAR DETAIL</a>`.

Files: `src/components/OsirisMap.tsx:1288-1316`

### 7. Cloudflare Radar L3 attack popup (layer cf-attack-dots)

OsirisMap.tsx:1323-1337:
`<div style="${pStyle}border:1px solid rgba(255,61,61,0.4);min-width:230px;">` + dot header in #FF3D3D with text `L3 ATTACK ORIGIN` + `<div style="color:#E8E6E0;font-size:12px;font-weight:700;margin-bottom:8px;">${htmlEsc(p.country_name)}</div>` + an auto/1fr grid: `<span style="opacity:0.6;">Share</span><span style="color:#FF6B6B;font-weight:700;">${htmlEsc(p.share)}%</span>` and `<span style="opacity:0.6;">Code</span><span style="color:#E8E6E0;">${htmlEsc(p.country)}</span>` + footer `<div style="margin-top:8px;font-size:9px;color:#5C5A54;line-height:1.5;">Share of observed layer-3 attack traffic by origin · Cloudflare Radar</div>`. There is no link button.

Files: `src/components/OsirisMap.tsx:1318-1338`

### 8. GDACS disaster popup (layer gdelt-dots — the layer id says GDELT but the data is GDACS)

OsirisMap.tsx:1354-1362 `KIND = { earthquake: ['🌐 EARTHQUAKE','#FF9500'], wildfire: ['🔥 WILDFIRE','#FF6B1A'], flood: ['🌊 FLOOD','#00B0FF'], weather: ['🌀 TROPICAL CYCLONE','#00E5FF'], volcano: ['🌋 VOLCANO','#FF3D3D'], drought: ['☀️ DROUGHT','#FFD500'] }`, falling back to `['⚠️ GLOBAL INCIDENT', '#FF3D3D']`.
:1364-1368: `<div style="${pStyle}border:1px solid ${kindColor}4d;"><div style="color:${kindColor};font-size:12px;font-weight:700;margin-bottom:6px;">${kindLabel}</div><div style="font-size:9px;color:#E8E6E0;margin-bottom:8px;line-height:1.4;">${htmlEsc(p.name||'Unclassified incident')}</div>${src !== '#' ? `<a href="${src}" target="_blank" rel="noopener noreferrer" style="${linkStyle}flex:1;text-align:center;color:${kindColor};border:1px solid ${kindColor}66;background:${kindColor}26;display:inline-block;width:100%;box-sizing:border-box;margin-top:4px;">[ OPEN SOURCE ↗ ]</a>` : ''}</div>`.
The map dot, gdelt-dots at :565-567, is a fixed `circle-radius: 4, circle-color '#D32F2F', circle-opacity 0.5, circle-stroke-width 1, circle-stroke-color '#D32F2F', circle-stroke-opacity 0.25`. Its colour does not depend on kind.

Files: `src/components/OsirisMap.tsx:1340-1369`, `src/components/OsirisMap.tsx:565-567`

### 9. Conflict popup (layer conflict-icons) and how conflict features are built

OsirisMap.tsx:1376 `color = p.severity === 'war' ? '#FF1744' : p.severity === 'high' ? '#FF9500' : '#FFD500'`.
:1377-1385: `<div style="${pStyle}border:1px solid ${color}40;"><div style="color:${color};font-size:12px;font-weight:700;margin-bottom:6px;">⚠️ ${htmlEsc(p.label || 'WARNING EVENT')}</div><div style="font-size:10px;color:#E8E6E0;margin-bottom:8px;line-height:1.4;">${htmlEsc(p.description || 'Global event detected at this location.')}</div>`. Then a 1fr 1fr grid (gap:4px;font-size:9px;margin-bottom:8px): SEVERITY=`<span style="color:${color};">${(p.severity||'unknown').toUpperCase()}</span>`, COORDS=`${coords[1].toFixed(3)}°, ${coords[0].toFixed(3)}°`. Link: `${p.sourceUrl ? `<a href="${urlSafe(p.sourceUrl)}" target="_blank" style="${linkStyle}flex:1;text-align:center;color:${color};border:1px solid ${color}40;background:${color}15;display:inline-block;width:100%;box-sizing:border-box;margin-top:4px;">[ OPEN SOURCE ↗ ]</a>` : ''}`.
Data mapping at :2306-2365 (fetch '/api/conflicts'):
- zones → `{label: z.label, severity: z.severity, description: `${z.description}${z.eventCount > 0 ? ` [${z.eventCount} live events detected]` : ''}`, sourceUrl, eventCount}`
- liveEvents (filtered on lat && lng) → `label: (e.title || 'CONFLICT EVENT').substring(0, 60).toUpperCase(), severity: 'war', description: e.title || 'Live conflict event detected by GDELT.', sourceUrl: e.url || ''`
- FALLBACK_ZONES used when the API fails (:2348-2355): UKRAINE WAR war 48.5,31.2 'https://liveuamap.com/'; GAZA CONFLICT war 31.35,34.35 'https://israelpalestine.liveuamap.com/'; SUDAN CIVIL WAR war 15.0,30.0 'https://sudan.liveuamap.com/'; YEMEN WAR war 15.5,48.0 'https://yemen.liveuamap.com/'; MYANMAR CONFLICT war 19.5,96.5 'https://myanmar.liveuamap.com/'; SYRIA high 35.0,38.5 'https://syria.liveuamap.com/'. Descriptions: 'Ongoing Russian invasion of Ukraine.', 'Active military operations in Gaza.', 'SAF vs RSF armed conflict.', 'Houthi operations and Red Sea threats.', 'Military junta vs opposition forces.', 'Ongoing civil conflict.'

Files: `src/components/OsirisMap.tsx:1371-1386`, `src/components/OsirisMap.tsx:2306-2365`

### 10. Warning-triangle icons used by the conflict layer

OsirisMap.tsx:416-436 createWarningIcon(id,color): 20x20 canvas. Fills a triangle `moveTo(s/2,1) lineTo(s-1,s-1) lineTo(1,s-1)` in `color`, then draws a black '!' with `ctx.font = 'bold 11px sans-serif'`, center-aligned at `(s/2, s-4)`, and registers it with map.addImage. Icons: `createWarningIcon('warn-icon', '#D32F2F'); createWarningIcon('warn-orange', '#E65100'); createWarningIcon('warn-yellow', '#F9A825');`

Files: `src/components/OsirisMap.tsx:416-436`

### 11. SDK lattice link popup (layers sdk-sea / sdk-air / sdk-intel)

OsirisMap.tsx:1390-1397 SDK_SOURCE_URLS: 'AIS Maritime'→'https://www.marinetraffic.com', 'AIS Stream'→'https://aisstream.io', 'AIS → Lattice'→'https://aisstream.io', 'ADS-B / OpenSky'→'https://opensky-network.org', 'ADS-B → Lattice'→'https://opensky-network.org', 'Naval Intelligence'→'https://www.odni.gov'. Fallback is 'https://osirisai.live'.
:1404-1405 `domainLabel = SEA '⚓ MARITIME' | AIR '✈ AIR CORRIDOR' | else '🛡 NAVAL INTEL'`; `domainColor = SEA '#4FC3F7' | AIR '#B3E5FC' | '#81D4FA'`.
:1406 overrides linkStyle locally: `'text-decoration:none;padding:3px 8px;border-radius:4px;font-size:9px;font-weight:700;letter-spacing:0.05em;'`.
:1407-1419: `<div style="${pStyle}border:1px solid ${domainColor}40;"><div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;"><div style="width:8px;height:8px;border-radius:50%;background:${domainColor};box-shadow:0 0 8px ${domainColor};"></div><span style="color:${domainColor};font-size:11px;font-weight:700;letter-spacing:0.1em;">${domainLabel}</span></div>`. Then a 1fr 1fr grid (gap:6px;font-size:9px;margin-bottom:8px): FROM `${htmlEsc(p.fromName || 'Origin')}`, TO `${htmlEsc(p.toName || 'Destination')}`, DOMAIN `<span style="color:${domainColor};">${p.domain}</span>`, SOURCE `<a ... style="color:${domainColor};text-decoration:underline;cursor:pointer;">${htmlEsc(p.source || 'OSIRIS')}</a>`. Button: `<a href="${urlSafe(srcUrl)}" target="_blank" style="${linkStyle}color:${domainColor};border:1px solid ${domainColor}40;background:${domainColor}18;display:inline-block;margin-top:4px;">OPEN SOURCE ↗</a>`. The popup is anchored at e.lngLat (the click point), not at a feature coordinate.

Files: `src/components/OsirisMap.tsx:1388-1421`

### 12. Botnet C2 popup (layer cyber-heads, abuse.ch Feodo Tracker)

OsirisMap.tsx:1432-1435 `online = p.status === 'online'; c = online ? '#FF6D00' : '#8A8880';` row helper: `<div><span style="color:#5C5A54;font-size:7px;letter-spacing:0.1em;">${label}</span><br/><span style="color:${color};${mono ? 'font-family:monospace;' : ''}">${value}</span></div>`.
:1436-1453: `<div style="${pStyle}border:1px solid ${c}40;"><div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid ${c}30;padding-bottom:6px;margin-bottom:8px;"><div style="color:${c};font-size:12px;font-weight:700;letter-spacing:0.12em;">BOTNET C2 SERVER</div><div style="font-size:8px;padding:2px 6px;border-radius:3px;font-weight:700;letter-spacing:0.1em;background:${c}20;color:${c};border:1px solid ${c}50;">${htmlEsc((p.status || 'unknown').toUpperCase())}</div></div><div style="color:#E8E6E0;font-size:11px;font-weight:bold;margin-bottom:10px;">${htmlEsc(p.malware || 'Family not reported')}</div>`. Grid style: `display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:9px;margin-bottom:8px;background:rgba(0,0,0,0.35);padding:8px;border-radius:4px;border:1px solid rgba(255,255,255,0.04);`. Rows: row('C2 ADDRESS', ip||'—', '#00E5FF', true), row('PORT', String(p.port ?? '—'), '#FFD600', true), row('HOSTED IN', country||'Not reported'), row('AS', p.as_number ? `AS${p.as_number}` : '—', '#E8E6E0', true), row('FIRST SEEN', first_seen||'Not reported'), row('LAST ONLINE', last_online||'Not reported'). Hostname (optional): `<div style="font-size:9px;color:#8A8880;margin-bottom:8px;font-family:monospace;word-break:break-all;">`. Disclaimer: `<div style="font-size:8px;color:#5C5A54;line-height:1.5;margin-bottom:8px;">Blocklist entry, not an observed attack. Marker sits at the hosting country's centroid, not the host's location.</div>`. Footer: `<div style="font-size:7px;color:#5C5A54;text-align:center;letter-spacing:0.1em;">SOURCE: <a href="${urlSafe(p.source_url || 'https://feodotracker.abuse.ch/browse/')}" target="_blank" style="color:${c};text-decoration:underline;">ABUSE.CH FEODO TRACKER ↗</a></div>`

Files: `src/components/OsirisMap.tsx:1423-1454`

### 13. Scan target, SCM supplier, IP-sweep device and balloon popups

Scan target (:1467-1474): `<div style="${pStyle}border:1px solid rgba(255,61,61,0.5);"><div style="color:#FF3D3D;font-size:12px;font-weight:700;margin-bottom:6px;">🎯 TARGET: ${htmlEsc(p.id)}</div><div style="font-size:9px;color:#E8E6E0;margin-bottom:8px;">${htmlEsc(p.city || 'Unknown')}, ${htmlEsc(p.country || 'Unknown')} — ${htmlEsc(p.isp || 'Unknown ISP')}</div>`. Grid: TYPE `<span style="color:#00E5FF;">${(p.type || 'UNKNOWN').toUpperCase()}</span>`, COORDS `x.xxx°, y.yyy°`.
SCM (:1482-1499, layer 'scm-dots'): color = CRITICAL '#FF1744' / HIGH '#FF9500' / else '#00BCD4'. Title `🏢 ${name}` at 12px/700/mb4. Sub-line `font-size:9px;color:#aaa;margin-bottom:8px;` showing `${category} | ${city}, ${country}`. One-column grid with 'SCM RISK LEVEL' (label 9px) and value bold in color at 11px. Threats block: `<div style="margin-top:8px;padding-top:6px;border-top:1px solid ${color}40;color:${color};font-size:9px;font-weight:bold;">ACTIVE THREATS:<br/>⚠ t…</div>` (from JSON.parse(p.active_threats)).
Sweep device (:1510-1521): riskColors `{ CRITICAL: '#FF3D3D', HIGH: '#FF6B00', MEDIUM: '#FFD700', LOW: '#76FF03', INFO: '#5C5A54' }`. Root is `<div style="font-family:monospace;font-size:11px;color:#E8E6E0;">` and does not use pStyle. Title is device_type at 13px bold in p.color, ip at 12px #fff, hostnames 9px #8A8880. Grid shows PORTS count and RISK. Lines: `Open: ${ports.slice(0, 12).join(', ')}${ports.length > 12 ? ' ...' : ''}` (9px #8A8880) and `⚠ CVEs: ${vulns.slice(0,5)}${vulns.length > 5 ? ` +${vulns.length - 5} more` : ''}` (9px #FF3D3D).
Balloon (:1529-1538): `border:1px solid ${p.color}40`. Title `🎈 ${p.callsign}` 12px/700/letter-spacing 0.1em in p.color. Sub-line `${p.type.toUpperCase()} / STATUS: ${p.status.toUpperCase()}` (9px #aaa). Grid: ALTITUDE `${p.altitude} m`, SPEED `${Math.round(p.speed)} km/h`, VERT RATE colored `p.verticalRate > 0 ? '#00E676' : '#FF3D3D'` `${p.verticalRate.toFixed(1)} m/s`, TEMP `${p.temperature}°C`.

Files: `src/components/OsirisMap.tsx:1462-1539`

### 14. Radiation and ship (AIS vessel) popups

Radiation (:1546-1555): color = DANGER '#FF1744' / WARNING '#FF9500' / else '#AB47BC'. `<div style="${pStyle}border:1px solid ${color}40;"><div style="color:${color};font-size:12px;font-weight:700;margin-bottom:4px;">☢️ ${p.name}</div><div style="font-size:9px;color:#aaa;margin-bottom:8px;">${p.city}, ${p.country}</div>`. One-column grid (gap:4px;font-size:11px). Label spans are `color:#5C5A54;font-size:9px;`. Rows: READING `<span style="color:${color};font-weight:bold;">${p.reading} nSv/h</span>`, STATUS in color, NETWORK #E8E6E0.
Ship (:1563-1580): color = military '#FF1744' / tanker '#FF9500' / else '#00E5FF'; icon = '⚔️' / '🛢️' / '🚢'. `<div style="${pStyle}border:1px solid ${color}60;box-shadow:inset 0 0 12px ${color}15;">`. Header row: `display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid ${color}40;padding-bottom:6px;margin-bottom:8px;`. Left side: `${icon} [ ${(p.type||'VESSEL').toUpperCase()} ]` (12px/700/ls 0.1em in color). Right side: `FLAG: ${p.flag||'UNK'}` (#5C5A54 9px). Name: `${p.name || 'UNIDENTIFIED VESSEL'}` (#E8E6E0 11px bold mb10). Grid (1fr 1fr;gap:6px;font-size:9px;margin-bottom:8px;background:rgba(0,0,0,0.3);padding:6px;border-radius:4px): SPEED `${Number(p.speed).toFixed(1)} kn` and HEADING `${Number(p.heading).toFixed(0)}°` in color monospace; LATITUDE/LONGITUDE `toFixed(4)°` in #E8E6E0 monospace. Then `DESTINATION: ` (#5C5A54 9px) + `${p.destination || 'UNKNOWN'}` (#E8E6E0 9px). Button: `<a href="https://www.marinetraffic.com/en/ais/details/ships/mmsi:${p.mmsi}" target="_blank" style="${linkStyle}flex:1;text-align:center;color:${color};border:1px solid ${color}40;background:${color}15;display:inline-block;width:100%;box-sizing:border-box;margin-top:4px;">[ OPEN SOURCE ↗ ]</a>`

Files: `src/components/OsirisMap.tsx:1541-1581`

### 15. Weather (EONET/NWS/GDACS) popup

OsirisMap.tsx:1588 `iconEmoji = cyclone '🌀' | volcano '🌋' | flood '🌊' | drought '🏜️' | ice '🧊' | weather '⚠️' | else '⚡'`.
:1589-1599: `<div style="${pStyle}border:1px solid rgba(224,64,251,0.3);"><div style="color:#E040FB;font-size:14px;font-weight:700;margin-bottom:6px;">${iconEmoji} ${p.type || 'Weather Event'}</div><div style="font-size:10px;color:#E8E6E0;margin-bottom:8px;line-height:1.4;">${p.title || 'Unknown event'}</div>`. Grid (1fr 1fr;gap:4px;font-size:9px;margin-bottom:8px): SEVERITY `<span style="color:${p.severity === 'high' ? '#FF1744' : '#FFD700'};">${(p.severity||'low').toUpperCase()}</span>`, COORDS in degrees. Footer: `<div style="display:flex;gap:6px;">${p.source ? `<a href="${p.source}" target="_blank" style="${linkStyle}color:#E040FB;border:1px solid rgba(224,64,251,0.4);background:rgba(224,64,251,0.1);">📡 SOURCE</a>` : ''}</div>`

Files: `src/components/OsirisMap.tsx:1583-1600`

### 16. Nuclear infrastructure popup (accent matches the dot on purpose)

OsirisMap.tsx:1611-1616 `accent = status.includes('SEISMIC RISK') ? '#E65100' : status === 'Active Conflict Zone' ? '#D32F2F' : status.includes('Decommission') ? '#546E7A' : status === 'Under Construction' ? '#FFA726' : '#26A69A'`. This uses the same order as the infra-dots paint at :638-644. row helper: `<div><span style="color:#5C5A54;">${label}</span><br/><span style="color:${color};">${value}</span></div>`.
:1624-1626 `ref = p.sourceUrl ? `<a href="${htmlEsc(p.sourceUrl)}" target="_blank" rel="noopener noreferrer" style="${linkStyle}color:${accent};border:1px solid ${accent}66;background:${accent}1A;">REFERENCE</a>` : ''`.
:1628-1644: `<div style="${pStyle}border:1px solid ${accent}4D;"><div style="color:${accent};font-size:14px;font-weight:700;margin-bottom:2px;">☢️ ${htmlEsc(p.name || 'Nuclear Facility')}</div><div style="color:#5C5A54;font-size:9px;letter-spacing:0.1em;margin-bottom:10px;">${htmlEsc([p.city, p.country].filter(Boolean).join(', ')) || '—'}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 6px;font-size:9px;">`. Rows: STATUS (accent), OWNER, REACTORS (accent; '—' when 0), CAPACITY `${Number(p.capacityMW).toLocaleString()} MWe` or '—'. Coordinates footer: `<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);font-size:9px;color:#5C5A54;">lat°, lng°</div>`. Button row: `display:flex;gap:6px;flex-wrap:wrap;` with ref plus `<a href="https://www.google.com/maps/@${coords[1]},${coords[0]},14z/data=!3m1!1e3" target="_blank" rel="noopener noreferrer" style="${linkStyle}color:#8A8880;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);">SATELLITE</a>`

Files: `src/components/OsirisMap.tsx:1602-1645`

### 17. Port / naval base and chokepoint popups

Port (:1652-1670): `typeColor = naval '#FF3D3D' | energy '#FF9500' | '#00BCD4'`; `typeLabel = 'NAVAL BASE' | 'ENERGY PORT' | 'CONTAINER PORT'`. Congestion block (only if p.congestion): `<div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.1);">` containing a 1fr 1fr grid. CONGESTION label is 9px #5C5A54; its value color is SEVERE '#FF1744' / CONGESTED '#FF9500' / else '#00E676', bold 10px. EST. DWELL TIME is `${p.dwell_time || 'Unknown'}` #E8E6E0 bold 10px. Body: `<div style="${pStyle}border:1px solid ${typeColor}40;"><div style="color:${typeColor};font-weight:bold;font-size:11px;margin-bottom:4px;">${p.name}</div><div style="color:#999;font-size:9px;margin-bottom:6px;">${typeLabel} — ${p.country}</div>`. Optional lines: `<div style="font-size:9px;color:#aaa;">Volume: <span style="color:${typeColor};font-weight:bold;">${p.volume}</span></div>`, the same for `Fleet:`, and `Global Rank: ... #${p.rank}`. There is no link button.
Chokepoint (:1678-1683): `riskCol = CRITICAL '#FF1744' | HIGH '#FF9500' | ELEVATED '#FFD700' | '#00E676'`. `<div style="${pStyle}border:1px solid ${riskCol}40;"><div style="color:#FF9500;font-weight:bold;font-size:11px;margin-bottom:4px;">${p.name}</div><div style="font-size:9px;color:#aaa;">Traffic: <span style="color:#fff;">${p.traffic}</span></div><div style="font-size:9px;color:#aaa;">Risk: <span style="color:${riskCol};font-weight:bold;">${p.risk}</span></div></div>`

Files: `src/components/OsirisMap.tsx:1647-1684`

### 18. Live Alert pin popup (Telegram/OSM-geocoded reports) with stacking, selection ring and pulse

src/lib/alert-digest.ts:30-34 `ALERT_KINDS = { rocket: { label: 'ROCKET', color: '#FF3D3D' }, event: { label: 'EVENT', color: '#FF9500' }, news: { label: 'NEWS', color: '#00E5FF' } }`. timeAgo (:215-224) returns 'just now', `${mins}m ago`, `${hrs}h ago` or `${d}d ago`.
OsirisMap.tsx:1702-1740 alertPopupHtml(reports): `link/video/thumb = urlSafe(...)`. Media: if video, `<video src poster controls playsinline preload="none" style="display:block;width:100%;max-height:180px;margin-top:10px;border-radius:6px;background:#000;">`. Otherwise if thumb, an `<a ... style="display:block;position:relative;margin-top:10px;"><img referrerpolicy="no-referrer" style="display:block;width:100%;max-height:180px;object-fit:cover;border-radius:6px;">` plus, when media_kind==='video', an overlay `<span style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.75);color:#fff;font-size:9px;letter-spacing:0.1em;padding:4px 10px;border-radius:12px;">▶ WATCH ON TELEGRAM${duration ? ` · ${duration}` : ''}</span>`.
Outer: `<div style="${pStyle}border:1px solid ${c}66;width:300px;max-width:100%;padding:14px;max-height:min(44vh,440px);overflow-y:auto;">`. Header: `display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:9.5px;letter-spacing:0.12em;` with a 7px dot and glow, `<span style="color:${c};font-weight:700;">${label}</span>`, and `<span style="color:#8A8880;margin-left:auto;">${timeAgo(p.published)}</span>`. Title: `<div style="color:#F2EFE8;font-family:Inter,system-ui,sans-serif;font-size:12.5px;font-weight:600;line-height:1.35;">`. Source line: `margin-top:6px;font-size:9.5px;color:#8A8880;` showing `${source_name}${lean ? ` · <span style="color:#9B978E;">${lean}</span>` : ''}`. Place line: `<div style="margin-top:6px;font-size:9.5px;color:${c};" title="The place the post names, resolved against OpenStreetMap. Town-level: a post names a place, not an exact spot.">📍 ${place_label}<span style="color:#5C5A54;"> · ${precision === 'region' ? 'region' : 'place'} named in the post · © OpenStreetMap</span></div>`. Then the media, then the `OPEN POST ↗` link (linkStyle, color c, border c66, bg c1a). The ALSO HERE block holds up to 4 more reports (rest.slice(0,4)): `<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);"><div style="font-size:8.5px;letter-spacing:0.14em;color:#5C5A54;">ALSO HERE</div>…`. Each row is `<a style="display:flex;gap:6px;align-items:baseline;color:#C9C5BC;text-decoration:none;font-size:10px;line-height:1.35;margin-top:5px;">` with a 6px dot (`transform:translateY(-1px)`) and `${title} <span style="color:#5C5A54;">· ${source_name} · ${timeAgo}</span>`.
Stacking (:1743-1750): reports with identical coordinates are deduped by id and sorted with leadId first, then by newest published. Clicks are matched by feature id, because rendered geometry is tile-quantised (:1762-1768). Selection (:1753-1760): `setFilter('alert-pin-selected', ['==',['get','id'],id])`, cleared on the popup 'close' event. Pulse (:2291-2303): every 200ms, `circle-radius = 9 + Math.sin(Date.now()/260)*3.5` and `circle-stroke-opacity = 0.55 + Math.sin(Date.now()/260)*0.25`.

Files: `src/components/OsirisMap.tsx:1701-1773`, `src/components/OsirisMap.tsx:2289-2303`, `src/lib/alert-digest.ts:30-34`, `src/lib/alert-digest.ts:215-224`

### 19. Entities that have no MapLibre popup

CCTV (cctv-dots, :1081-1102) calls onEntityClick({type:'cctv', id, name, city, country, source, feed_url, stream_url, stream_type, external_url, lat, lng}) and `map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 13), duration: 1000 })`. Live news (news-dots, :1687-1699) calls onEntityClick({type:'live_news', name, city, country, url, category, embed_allowed: p.embed_allowed !== false && p.embed_allowed !== 'false'}). Satellites (:1133-1187) are GPU-picked on the custom 'sat-3d' layer and open a React panel via setSelectedSat, not a popup, because 'a popup can only anchor to a ground coordinate'. The click first bails if queryRenderedFeatures hits any layer in CLICKABLE_LAYERS, removes any open popup, then fetches `/api/satellites/orbit?id=${noradId}${at ? `&t=${at}` : ''}`. Hover pick is throttled to 100ms and skipped while the map is moving.

Files: `src/components/OsirisMap.tsx:1080-1102`, `src/components/OsirisMap.tsx:1686-1699`, `src/components/OsirisMap.tsx:1120-1209`

### 20. Symbol label layout/paint constants, verbatim (all non-flight symbol layers)

All from OsirisMap.tsx. Format is id [minzoom] | text-field | size | font | offset | extras | paint.
1. conflict-icons (:438-450) | ['get','label'] | ['interpolate',['linear'],['zoom'], 1,7, 4,9, 8,11] | ['Open Sans Bold'] | [0,1.4] | icon-image match severity war→'warn-icon', high→'warn-orange', else 'warn-yellow'; icon-size interpolate zoom 1,0.6 4,0.8 8,1; icon-allow-overlap true; text-allow-overlap false | text-color match war '#D32F2F' high '#E65100' '#F9A825', halo '#000' 1.5, text-opacity 0.9
2. eq-label (:462-464) filter ['>=',['get','magnitude'],4.5] | ['concat','M',['to-string',['get','magnitude']]] | 9 | ['Open Sans Regular'] | [0,1.5] | — | '#F9A825', halo '#000' 1
3. cctv-label minzoom 10 (:484-487) | ['get','name'] | 9 | Open Sans Regular | [0,1.8] | text-max-width 12, allow-overlap false | cameraColor (CSS palette), halo '#000000' 1.5, opacity 0.8
4. malware-label minzoom 5 (:525-528) | ['get','malware'] | 8 | ['JetBrains Mono Bold','Open Sans Bold'] | [0,1.5] | max-width 10 | '#D32F2F', halo '#111' 1.5, opacity 0.85
5. cyber-labels minzoom 3 (:560-563) | ['get','malware'] | 9 | ['JetBrains Mono Bold','Open Sans Bold'] | [0,1.5] | max-width 10 | '#333333', halo '#000' 1.5, opacity 0.85
6. cf-outage-label minzoom 3 (:597-600) | ['get','country_name'] | 9 | JetBrains Mono Bold/Open Sans Bold | [0,1.4] | max-width 12 | '#FFB300', halo '#000' 1.5, opacity 0.85
7. cf-attack-label minzoom 2 (:608-612) | ['concat',['get','country'],' ',['to-string',['get','share']],'%'] | 9 | JetBrains Mono Bold/Open Sans Bold | [0,1.6] | allow-overlap false | '#FF6B6B', halo '#000' 1.5, opacity 0.9
8. weather-label (no minzoom) (:625-628) | ['get','title'] | 9 | Open Sans Regular | [0,2] | max-width 14 | '#7E57C2', halo '#000' 1, opacity 0.8
9. infra-label minzoom 5 (:648-651) | ['get','name'] | 9 | Open Sans Regular | [0,2] | max-width 14 | case SEISMIC RISK '#E65100' else '#26A69A', halo '#000' 1, opacity 0.7
10. maritime-label minzoom 4 (:685-688) | ['get','name'] | 9 | Open Sans Regular | [0,1.8] | max-width 12 | '#26C6DA', halo '#000' 1, opacity 0.7
11. choke-label minzoom 3 (:701-704) | ['get','name'] | 10 | ['Open Sans Bold'] | [0,2] | max-width 14 | '#E65100', halo '#000' 1, opacity 0.9
12. news-label minzoom 4 (:716-719) | ['get','name'] | 9 | Open Sans Regular | [0,1.8] | max-width 12 | '#EC407A', halo '#000' 1, opacity 0.8
13. alert-pin-label minzoom 5 (:744-751) | ['case',['>',['get','stack'],1],['concat',['get','place_name'],' ·',['to-string',['get','stack']]],['get','place_name']] | 10 | Open Sans Bold | [0,1.2] | text-anchor 'top', max-width 12 | alertColor match kind, halo '#000' 1.2, opacity 0.9
14. sweep-device-labels minzoom 13 (:771-777) | ['concat',['get','device_type'],'\n',['get','ip']] | 9 | Open Sans Regular | [0,2.2] | max-width 12 | ['get','color'], halo '#000' 1.5, opacity 0.9
15. scan-targets-label (:789-792) | ['get','id'] | 11 | Open Sans Bold | [0,2] | max-width 14 | '#D32F2F', halo '#000' 1.5, opacity 0.9
16. balloon-label minzoom 4 (:817-820) | ['get','callsign'] | 9 | Open Sans Regular | [0,1.2] | max-width 12 | ['get','color'], halo '#000' 1 (no opacity)
17. rad-label minzoom 5 (:834-837) | ['concat',['to-string',['get','reading']],' nSv/h'] | 9 | Open Sans Bold | [0,1.5] | — | match status DANGER '#D32F2F' WARNING '#E65100' '#7E57C2', halo '#000' 1
18. ship-label minzoom 5 (:894-897) | ['get','name'] | 9 | Open Sans Regular | [0,1.2] | — | match type military '#D32F2F' tanker '#E65100' cargo '#26C6DA' '#B0BEC5', halo '#000' 1
19. watched-airport-label (:3017-3028) | ['get','label'] | 11 | Open Sans Bold | [0,1.6] | text-allow-overlap TRUE | '#FFB300', halo '#0C0E1A' 1.5. The matching dots are watched-airport-glow r13 #FFB300 op0.16 blur0.8 and watched-airport-dot r5 #FFFFFF stroke 2 #FFB300. This is a template for an airport marker in the new route feature.
20. drawn-polygon label (:2707) | ['get','name'] | 11 | (default font) | — | allow-overlap true, ignore-placement true | poly.color, halo '#000000' 2. Its fill opacity is 0.12; its line is 2.5 wide with dasharray [6,3].
Unless a row says otherwise, text-allow-overlap is false.

Files: `src/components/OsirisMap.tsx:438-897`, `src/components/OsirisMap.tsx:2707`, `src/components/OsirisMap.tsx:3000-3028`

### 21. Circle paint constants for non-flight entity dots (to match the popups)

eq-circles :457-461 radius interpolate magnitude 2.5,4 5,12 7,24; color magnitude 2.5 '#F9A825' 4 '#E65100' 6 '#D32F2F'; opacity 0.55, blur 0.3, stroke 1 '#F9A825' 0.25. fires-heat :467-470 radius zoom 1,2 5,4 10,8; '#E65100' op 0.45 blur 0.5. malware-glow r zoom 1,6 5,12 10,20 '#D32F2F' op0.06 blur0.5. malware-dots :507-514 nested interpolate: zoom 1→ sqrt(max(url_count,1)) 1,1.6 3,2.4 9,4; zoom 5→ 1,3.2 3,4.8 9,8; zoom 10→ 1,4.8 3,7.2 9,12; '#D32F2F' op0.9 stroke 1 #000 0.8. malware-new-ring r8 stroke '#FF1744' w2, opacity interpolate age 0,0.9 1,0 (radius animated at :2089-2090 to `['interpolate',['linear'],['get','age'],0, 6+Math.sin(now/200)*2, 1, 26]` every 200ms). cyber-heads r zoom 1,2.5 5,4 10,6; case status online '#FF6D00' else '#555555'; op0.95 stroke 1.5 '#333' 0.9. gdelt-events-dots r interpolate articles 1,3 10,5 50,8 200,12; quad match 1 '#00E676' 2 '#00E5FF' 3 '#FF9500' 4 '#FF3D3D' else '#9B978E'; op0.75 stroke 1 #000 0.6. cf-outage-halo r zoom 1,14 5,26 10,40 '#FFB300' op0.12 blur0.9. cf-outage-dots r 1,4 5,6 10,9; case ongoing '#FFB300' else '#8B7325'; op0.9 stroke 1.5 #000 0.7. cf-attack-dots r interpolate share 0,4 5,9 20,16 50,24; '#FF3D3D' op0.35 blur0.3 stroke 1 '#FF3D3D' 0.7. weather-glow r 1,12 5,20 10,30 '#7E57C2' op0.08 blur1. weather-dots r 1,5 5,8 10,14; icon cyclone '#7E57C2' volcano '#D32F2F' else '#7E57C2'; op0.75 stroke1.5 '#7E57C2' 0.35. infra-glow r 1,8 5,14 10,22; infra-dots r 1,4 5,6 10,10, same status case as the popup accent, op0.75. maritime-glow r 1,6 5,12 10,20; maritime-dots r 1,3 5,5 10,9; type naval '#D32F2F' energy '#E65100' else '#26C6DA'. choke-glow r 1,10 5,18 10,28 '#E65100' op0.1; choke-dots r 1,4 5,7 10,12; risk CRITICAL '#D32F2F' HIGH '#E65100' ELEVATED '#F9A825' else '#26A69A'; stroke '#E65100' 0.4. news-glow r 1,8 5,14 10,22 '#EC407A' 0.08; news-dots r 1,4 5,6 10,10 '#EC407A' 0.8. alert-pin-glow r zoom 1,7 6,14 10,22 op0.16 blur0.8; alert-pin-dots r 1,3.5 6,6 10,8; opacity case precision=='region' 0.15 else 0.95 (a region pin draws as a ring); stroke 1.5, stroke-color region→alertColor else '#0A0A0A'. alert-pin-pulse is filtered on fresh==true, r9, stroke 1.5, op0.7. alert-pin-selected r13 stroke '#FFFFFF' 1.5 0.85. balloon-dots r 1,3 5,5 10,7 ['get','color'] stroke 1 '#fff' 0.5. rad-glow r 1,10 5,20 10,40; rad-dots r 1,4 5,6 10,8, status DANGER '#D32F2F' WARNING '#E65100' else '#7E57C2'. ship-dots r 1,2 5,4 10,6; type military '#D32F2F' tanker '#E65100' cargo '#26C6DA' else '#B0BEC5'; op0.75. day-night-fill '#000022' (ghost '#0D0030') op0.35. cctv-glow r 1,5 5,8 10,14 14,20 #000 0.35 blur1; cctv-dots r 1,3 5,5 10,8 14,12 stroke 2.5 #000.

Files: `src/components/OsirisMap.tsx:453-897`

### 22. Glyphs and fonts

Basemap style is `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json` (:310). Every cartocdn.com request, including glyph PBFs, is rewritten by transformRequest to `${origin}/api/proxy-tiles?url=${encodeURIComponent(url)}` (:335-342). The proxy only allows hosts that are cartocdn.com or end with .cartocdn.com (src/app/api/proxy-tiles/route.ts:13-14). Label fonts therefore come from CARTO's glyph server. The repo sets no custom glyphs URL, so it is unverified whether CARTO serves a 'JetBrains Mono Bold' fontstack. The array `['JetBrains Mono Bold','Open Sans Bold']` probably renders as Open Sans Bold in practice. HTML popups use the CSS font 'JetBrains Mono' through pStyle. The alert title uses Inter, system-ui.

Files: `src/components/OsirisMap.tsx:310-342`, `src/app/api/proxy-tiles/route.ts:13-14`

### 23. Hover cursor and click-priority lists

:1457 layers that set the pointer cursor on hover: ['conflict-icons','cctv-dots','eq-circles','fires-heat','gdelt-dots','weather-dots','infra-dots','maritime-dots','choke-dots','news-dots','balloon-dots','rad-dots','ship-dots','sweep-device-dots','scan-targets-dots','sdk-sea','sdk-sea-glow','sdk-sea-atmo','sdk-air','sdk-air-glow','sdk-air-atmo','sdk-intel','sdk-intel-glow','sdk-intel-atmo','malware-dots','cyber-heads','gdelt-events-dots','cf-outage-dots','cf-attack-dots','alert-pin-dots']. Flights get their own hover handler at :1076. :1123-1127 CLICKABLE_LAYERS is the set a satellite pick yields to; it includes 'flight-dots','military-dots','jet-dots','private-dots' (see weaknesses).

Files: `src/components/OsirisMap.tsx:1123-1127`, `src/components/OsirisMap.tsx:1456-1460`

## Worth copying

- One popup at a time: remove the previous one, then create `new maplibregl.Popup({closeButton:true,maxWidth:'420px',offset:14})`. Hide MapLibre's content chrome and tip in CSS so a single glass card style (rgba(12,14,26,0.95) + backdrop-filter blur(16px) + 10px radius + 16px padding + JetBrains Mono) defines the look.
- Colour each popup from the entity's accent hex plus a two-digit alpha suffix: border ${c}40/4D/66, button background ${c}1a/15/26, inset glow ${c}15. One accent then drives the whole card.
- Reuse a small set of micro-layouts: the grey-label/light-value 2-column grid, the 7px glowing dot + letter-spaced uppercase header, and the auto/1fr key-value table with opacity:0.6 keys.
- Guard every URL with urlSafe (http/https only, otherwise '#') and hide the link button when the result is '#'. Pass every string through htmlEsc before interpolating it.
- Match the popup accent to the dot colour with the same ordered conditions as the paint expression. The nuclear popup does this (infra accent, lines 1611-1616).
- Size malware dots by sqrt(url_count) inside zoom-interpolate output stops. A zoom expression must be the top-level interpolate input, so the data-driven scaling lives inside each stop.
- For shared animations, use a single setInterval (200ms) that calls setPaintProperty. This drives the malware arrival ring and the alert-pin pulse (sin(Date.now()/260)).
- Stack alert reports that share a location. Label the pin 'Place ·N', dedupe by id and put the lead report first, then list up to 4 'ALSO HERE' rows. Use a dedicated filtered ring layer for the selected pin and clear it on the popup's close event.
- Draw region-precision pins as rings (fill opacity 0.15 with a coloured stroke). Draw town-precision pins as solid dots with a dark stroke. This makes geocoding precision visible.
- Coerce booleans that MapLibre serialised to strings (p.ongoing === true || p.ongoing === 'true').
- Reuse the watched-airport marker triplet (13px glow #FFB300 @0.16, 5px white dot with 2px #FFB300 stroke, 11px Open Sans Bold label with offset [0,1.6], halo #0C0E1A) as the airport-endpoint style for the new planned-flight-path feature.
- Put an honesty note in a popup when the data is only approximate, for example the C2 note "Marker sits at the hosting country's centroid" and the alert note "place named in the post · © OpenStreetMap".

## Weaknesses to fix in GODSEYE

- The popup accent colours and the map dot colours drift apart. Earthquake popup #FF9500 vs dots #F9A825/#E65100/#D32F2F. Fire #FF6B00 vs #E65100. Weather #E040FB (magenta) vs #7E57C2 (violet). Radiation #FF1744/#FF9500/#AB47BC vs #D32F2F/#E65100/#7E57C2. Conflict #FF1744/#FF9500/#FFD500 vs #D32F2F/#E65100/#F9A825. Ship #FF1744/#FF9500/#00E5FF vs #D32F2F/#E65100/#26C6DA/#B0BEC5. Port #FF3D3D/#FF9500/#00BCD4 vs #D32F2F/#E65100/#26C6DA. Chokepoint risk #FFD700/#00E676 vs #F9A825/#26A69A. C2 offline #8A8880 vs dot #555555. A replica should use one shared token map.
- The chokepoint title is hard-coded to #FF9500 whatever the risk level (line 1680).
- Several popups interpolate data without escaping it. Affected: ship (name, flag, destination, mmsi in href), weather (p.type, p.title, and p.source as a raw href without urlSafe, so javascript: URLs are possible), port (name, country, volume, fleet), chokepoint, radiation, balloon, SCM category/risk, sweep device (device_type, ip, hostnames, ports, vulns), and scan target type. The nuclear REFERENCE link uses htmlEsc instead of urlSafe, so the javascript: scheme is not blocked. The earthquake link has no rel=noopener.
- The sweep-device popup (line 1511) does not use pStyle. Because .maplibregl-popup-content is forced transparent with padding 0, it renders as bare text straight on the map with no card.
- The cyber-labels text colour is '#333333' with a #000 halo on a dark basemap, which is nearly invisible (line 563).
- The network-mesh-atmo/glow/core layers (lines 531-547) have no line-color; the lines where it was set are blank. MapLibre's default is black, so the mesh is effectively invisible on dark-matter.
- CLICKABLE_LAYERS (lines 1123-1127) lists 'flight-dots','military-dots','jet-dots','private-dots', but the real flight layers are 'fl-commercial','fl-private','fl-jets','fl-military'. So the satellite GPU pick does not yield to aircraft. A satellite behind a plane can win the click, and the satellite handler calls popupRef.current?.remove(), which can close the flight popup that just opened.
- Orphan handlers: map.on('click','scm-dots') at line 1478 targets a layer that is never added. Hover and click registrations also target 'sdk-sea-glow','sdk-sea-atmo' and others that are never added (only sdk-sea exists for SEA). Whether MapLibre raises errors for these at event time is unverified.
- Every liveEvents conflict feature is forced to severity 'war', and its label is the article title uppercased and truncated to 60 characters (line 2338). The result is long, noisy red labels. There is no clustering.
- globals.css:327 `.maplibregl-ctrl-attrib { display: none !important; }` hides the attribution control. That contradicts the code comment at OsirisMap.tsx:323-333, which says the attribution was enabled to satisfy OSM/Nominatim (issue #16).
- Popups hard-code the dark theme colours and ignore the 'ghost' theme CSS variables. Only cctv-dots and cctv-label are recoloured at runtime (lines 1907-1908).
- Coordinate formatting is inconsistent: toFixed(3) without ° (earthquake), with ° (fire, conflict, weather), toFixed(4)° (ship), toFixed(2) (flight). Date formats are also inconsistent: slice(0,16) with 'Z' (GDELT), without 'Z' (CF), and split(' ')[0] (malware).
- The balloon popup calls p.type.toUpperCase(), p.status.toUpperCase() and p.verticalRate.toFixed(1) without null guards, so a missing field throws inside the click handler.
- The 'JetBrains Mono Bold' label fontstack depends on CARTO's glyph server, which likely does not host it, so labels probably fall back silently. A replica should self-host glyphs (for example a PBF font build) if the monospace map labels matter.

## Gaps (not verified)

- The live-site glyph rendering of the fontstack ['JetBrains Mono Bold','Open Sans Bold'] was not verified. The CARTO glyph server's fontstack support was not checked, and running the app was prohibited.
- The flight-route layers added after setMapReady and the rest of the flight popup (airframe/route resolution after line 1019) were not re-read, because the question excludes flight popups.
- The CameraViewer, live-news feed viewer and satellite readout panels are React components outside OsirisMap.tsx. Their markup and styles were not captured here.
- No test was done of whether MapLibre throws or warns for handlers bound to non-existent layers (scm-dots, sdk-*-glow/atmo).
- The readMapPalette CSS variables (the --map-* values for cameraColor/flight colours) were not resolved to hex values in this pass.
