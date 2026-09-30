# OSIRIS brand and visual reference assets
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
**Question answered:** The visual reference assets and brand files the builder should copy or consult were not mentioned.

## Summary

The brand and visual reference assets live in three places: docs/screenshots/ (3 JPEG frame grabs, 1600x~786), public/ (logo SVG, favicons, PNG/JPEG icons, OG image, two manifests, a map style and submarine-cable data), and inline in src/app/page.tsx (header logo SVG at :1401-1405, splash at :1059-1243). The header mark is the Eye of Horus, drawn inline with viewBox "0 0 650 500", fill="currentColor" and text-[#D4AF37] plus a gold drop-shadow. It uses 3 of the 5 paths in public/eye-of-horus.svg: it drops the two fill="#fff" eye-white shapes, so the map shows through them. No code references public/eye-of-horus.svg. The /docs header (DocsClient.tsx:144-151) uses only 2 paths. The splash does not use the Eye at all. It shows three counter-rotating rings (gold, cyan, gold) around a gold crosshair core, a letter-staggered "OSIRIS", a typewriter-style reveal of "GLOBAL INTELLIGENCE PLATFORM", and a 4-stage progress bar with the labels ESTABLISHING SECURE CONNECTION... / INITIALIZING FEEDS... / CALIBRATING SENSORS... / SYSTEM READY. The raster brand art (og-image, osiris-icon, android-chrome, apple-touch, casaos) is a glowing gold Eye of Horus on near-black. og-image adds a wireframe globe and the text "OSIRIS / GLOBAL INTELLIGENCE PLATFORM / 20+ LIVE DATA FEEDS • REAL-TIME TRACKING • OPEN SOURCE". Several brand files are inconsistent: some files named .png are JPEG, the declared sizes are wrong, layout links the empty white site.webmanifest rather than the good manifest.json, and the Discord and live-demo links disagree.

## Findings

### 0. README screenshots (visual ground truth for the HUD)

Screenshots section README.md:22-37. Images: README.md:25 docs/screenshots/taiwan-cctv.jpg, alt "OSIRIS over Taipei on the Night map, with live traffic-camera previews pinned across the city and the Longmen Building rooftop feed open", caption "Taiwan — Taipei's public traffic cameras streaming live on the Night map, one feed open full-size" (:26). README.md:30 docs/screenshots/seoul-live-cctv.jpg, alt "OSIRIS over Seoul in 3D terrain around Namsan Tower, with live CCTV previews and the Cheonggyecheon feed open", caption "Seoul — live CCTV in 3D terrain around Namsan Tower, with the Cheonggyecheon feed playing" (:31). README.md:35 docs/screenshots/save-an-area.jpg, alt "A drawn area over mountain terrain in OSIRIS, with the live cameras inside it and the Drawing Tools panel showing the saved area", caption "Save an Area — draw a region and OSIRIS finds every camera inside it, ready to export as GeoJSON" (:36). All are width="100%". Files: taiwan-cctv.jpg 1600x788 191,682 B; seoul-live-cctv.jpg 1600x786 300,909 B; save-an-area.jpg 1600x784 139,544 B. All carry the JFIF comment "Lavc62.28.101", so they are ffmpeg frame grabs from a screen recording.

Files: `README.md:22-37`, `docs/screenshots/taiwan-cctv.jpg`, `docs/screenshots/seoul-live-cctv.jpg`, `docs/screenshots/save-an-area.jpg`

### 1. What the screenshots show (layout to reproduce)

Top-left: gold Eye logo, spaced "O S I R I S" wordmark and "OPEN SOURCE INTELLIGENCE" underneath. Top-centre/right, in mono text: "ZULU hh:mm:ssZ", "STATUS: LIVE" (green), layer count, entity count (e.g. 65,845), "SOLAR: Kp0" (green), a green "$OSIRIS" pill, a red "SUPPORT" pill and (Taiwan shot only) "MERCH". Left edge: a thin vertical icon rail, where each layer-category icon has a small cyan count badge. Right edge: a vertical round-button tool strip. Bottom-left: a pill segmented control "3D | 2D | MAP | SAT" with a red/pink active outline, a scale bar under it, then a "CURSOR lat,lng  LOCATION <name>  ZOOM n.n" readout. Bottom bar: Discord and X icons, "DOCS" (red), "PRIVACY", a scrolling ticker of quakes (e.g. "M4.9 93 km ESE of ...") and crypto/markets (BTC "$80.3K ▼", ETH "$2.6K"), and a green "• ONLINE" at the far right. Map: pinned CCTV preview cards (about 145x90 thumbnail, corner-bracket frame, red "• LIVE" tag top-left, caption strip "• <CAMERA NAME>" in mono caps) joined by a thin leader line to a white circular marker. Camera viewer (bottom-right): meta bar "CAM-0504-5109  25.0504, 121.5109  <time>  SECURE UPLINK" in gold; a title such as "LONGMEN BUILDING ROOFTOP, TAIPEI" with subtitle "TAIPEI, TW • SOURCE: OPENCCTV / TWIPCAM"; a "• LIVE SAT-LINK" (JPG) or "• LIVE FEED" (HLS) tag; a footer with "FEED TYPE JPG|HLS", "STATUS ACTIVE / RECORDING" and "RAW FEED" / "MAP TARGET" buttons. The Seoul shot shows 3D terrain with satellite imagery and purple extruded buildings. The Save-an-Area shot shows a cyan dashed polygon with a translucent teal fill labelled "Area 1", and a "DRAWING TOOLS" panel: "TRACKED AREA 13.5 km²", "AOIS / PERIM 1 / 19.1km", "STEP 1 — CHOOSE A SHAPE", tiles AREA/BOX/RADIUS/PATH, "Area 1 13.49 km² just now", "EXPORT GEOJSON" (gold) and "CLEAR" (red). A map D-pad and +/- zoom control sits at bottom-right.

Files: `docs/screenshots/taiwan-cctv.jpg`, `docs/screenshots/seoul-live-cctv.jpg`, `docs/screenshots/save-an-area.jpg`, `src/components/CameraViewer.tsx:31`, `src/components/CameraViewer.tsx:183-194`, `src/components/CameraViewer.tsx:347`, `src/components/CameraViewer.tsx:380-404`, `src/components/DrawingToolbar.tsx:174-196`, `src/components/DrawingToolbar.tsx:479`, `src/app/page.tsx:1877-1895`, `src/components/TokenPanel.tsx:12-18`, `src/components/GlobalStatusBar.tsx:154-222`

### 2. Camera ID format shown in the viewer

CameraViewer.tsx:31 builds the ID from the coordinates: `CAM-${Math.abs(camera.lat * 10000).toFixed(0).padStart(4, '0').slice(-4)}-${Math.abs(camera.lng * 10000).toFixed(0).padStart(4, '0').slice(-4)}`, falling back to 'UNKNOWN'. Example: 25.0504,121.5109 gives CAM-0504-5109, as seen in taiwan-cctv.jpg.

Files: `src/components/CameraViewer.tsx:31`

### 3. Header logo (inline Eye of Horus SVG)

page.tsx:1399 wrapper: motion.div, initial {opacity:0,y:-20}, animated in when revealed with hudIn(0.15); className "absolute top-4 z-[200] pointer-events-none flex flex-col"; style left isMobile?'24px':'64px', right '24px'. :1401 `<svg viewBox="0 0 650 500" className="w-8 h-8 md:w-10 md:h-10 shrink-0 transition-colors duration-500 text-[#D4AF37] drop-shadow-[0_0_8px_rgba(255,215,0,0.5)]" fill="currentColor">` with 3 paths. :1402 is the small spiral/curl path starting "m620.39,364.82c-0.53628-7.2677..." (right-hand curl, roughly x 548-631, y 320-402). :1403 is the pupil "m158.66,157a70.231,70.231,0,0,0,-14.44,42.81,70.235,70.235,0,1,0,140.47,0,70.231,70.231,0,0,0,-14.28,-42.81h-111.75z". :1404 is the main body (brow, lids, tear-line, spiral), starting "m140.86,465.53c-6.7333,0-8.7137-5.4462...". Wordmark :1407 `<h1 className="text-lg md:text-xl font-bold tracking-[0.4em] text-[#D4AF37] font-mono">OSIRIS</h1>`. :1408 `<span className="text-[9px] md:text-[10px] font-mono tracking-[0.2em] opacity-80 uppercase text-[#D4AF37]">OPEN SOURCE INTELLIGENCE</span>`. Sub-tagline :1411-1414, indented pl-[44px], text-[9px] text-[var(--text-muted)] opacity-40: "REAL-TIME GLOBAL MONITORING", then on md+ only "· FLIGHTS · MARITIME · SATELLITES · CCTV · WEATHER · CYBER THREATS".

Files: `src/app/page.tsx:1399-1416`

### 4. public/eye-of-horus.svg (source logo file)

5,712 B. `<svg xmlns="http://www.w3.org/2000/svg" height="500" width="650" version="1.1"><title>Eye of Horus</title>`. It has no viewBox attribute, only width/height 650x500; add viewBox="0 0 650 500" when reusing it. It has 5 paths in this order: (1) the curl path m620.39,364.82 (default black fill); (2) white left eye-white m182.52,260.66 fill="#fff"; (3) white right eye-white m366.06,210.87 fill="#fff"; (4) pupil m158.66,157 fill="#000"; (5) main body m140.86,465.53 stroke="#000". The header (page.tsx:1401) reuses paths 1, 4 and 5 recoloured to currentColor, which makes the eye-whites transparent. No code references this file (grep for 'eye-of-horus' finds only globals.css:20, which is a comment). The file itself gives no licence or provenance (ambiguous). It looks like a common public-domain Eye-of-Horus tracing, but that is not stated anywhere.

Files: `public/eye-of-horus.svg`, `src/app/page.tsx:1401-1405`, `src/app/globals.css:20`

### 5. Docs page logo variant

DocsClient.tsx:144-151 has the same viewBox "0 0 650 500", fill="currentColor" and className "w-6 h-6 text-[var(--gold-primary)] transition-all group-hover:drop-shadow-[0_0_10px_rgba(212,175,55,0.6)]", aria-hidden. It contains only 2 paths (pupil + main body) and omits the m620.39 curl path. The wordmark is "OSIRIS" (text-[12px] font-bold tracking-[0.3em] gold mono) above "Docs" (text-[9px] tracking-[0.22em] muted uppercase). The docs background is an ambient wash: 'radial-gradient(900px 480px at 12% -8%, rgba(212,175,55,0.07), transparent 65%), radial-gradient(760px 420px at 92% 4%, rgba(0,229,255,0.05), transparent 62%)' (:128-135). The header also has a ⌘K search pill, a GitHub icon and a gold "Launch Map" button.

Files: `src/app/docs/DocsClient.tsx:126-200`

### 6. Vector favicons

public/favicon.svg (512x512 viewBox) is a stylised geometric eye, not the hieroglyph path. Background rect rx=96 with radialGradient #0C0C14 to #06060C. Rings at cx256 cy240 r180 (stroke #D4AF37, 1px, opacity .15) and r160 (.5px, opacity .1). Ambient ellipse rx120 ry60 with a gold glow gradient (#D4AF37 at 0.4 opacity fading to 0). Eye outline path "M76 240 Q166 140 256 160 Q346 140 436 240 Q346 340 256 320 Q166 340 76 240Z", fill rgba(212,175,55,0.06), stroke #D4AF37 width 3. Inner eye at opacity .5. Iris r52 with radialGradient #F5D76E, then #D4AF37 at 60%, then #8B6914, plus a feGaussianBlur glow. Pupil r18 #06060C, highlight at 248,232 r5 white .3. Teardrop, spiral and eyebrow strokes in gold. Corner tech brackets at opacity .25. Text "OSIRIS" at y460, monospace 36px, letter-spacing 12, weight 700, #D4AF37, opacity .8. Only manifest.json references it (:13). public/favicon-32.svg (32x32) is a simplified version: rect rx6 #06060C, eye path "M3 15 Q10 7 16 9 Q22 7 29 15 Q22 23 16 21 Q10 23 3 15Z" with stroke #D4AF37 1.2, iris r4 gradient #F5D76E to #D4AF37, pupil r1.5, teardrop "M16 19 L14 25 L13 23". Nothing references favicon-32.svg.

Files: `public/favicon.svg`, `public/favicon-32.svg`, `public/manifest.json:12-17`

### 7. Raster icons: real formats, sizes, duplicates

Checked with `file` and md5. favicon-16x16.png: real PNG 16x16. favicon-32x32.png: real PNG 32x32. apple-touch-icon.png: PNG 180x180. android-chrome-192x192.png: PNG 192x192. android-chrome-512x512.png: PNG 512x512. casaos-icon.png: PNG 512x512 RGB. favicon.ico: 3 icons, 16x16 and 32x32. src/app/favicon.ico is byte-identical to public/favicon.ico (md5 71e74269...). icon-192.png and osiris-icon.png are the same file (md5 d27c721a..., 448,430 B) and are actually JPEG 1024x1024 despite the .png name; manifest.json declares them as image/png at 192x192 and 512x512. og-image.png (604,006 B) is also a JPEG, 1024x1024 square, while layout.tsx:101-107 declares width 1200, height 630, type image/png. Artwork: the icons are a flat glowing gold (#D4AF37-ish) Eye of Horus hieroglyph (brow bar, almond eye with round iris, spiral, falcon tear-stroke) on near-black. og-image adds a wireframe dotted globe with gold network nodes, circuit-trace details in the eye, a white "OSIRIS" wordmark, gold "GLOBAL INTELLIGENCE PLATFORM", and a footer band reading "20+ LIVE DATA FEEDS • REAL-TIME TRACKING • OPEN SOURCE".

Files: `public/og-image.png`, `public/osiris-icon.png`, `public/icon-192.png`, `public/android-chrome-192x192.png`, `public/android-chrome-512x512.png`, `public/apple-touch-icon.png`, `public/casaos-icon.png`, `public/favicon.ico`, `public/favicon-16x16.png`, `public/favicon-32x32.png`, `src/app/favicon.ico`

### 8. Manifests

public/manifest.json: name "OSIRIS — Global Intelligence Platform", short_name "OSIRIS", description "Real-time global OSINT intelligence dashboard. Track 10K+ aircraft, 2K satellites, worldwide CCTV, earthquakes, wildfires, nuclear facilities, and more.", start_url "/", display "standalone", background_color "#06060C", theme_color "#D4AF37", orientation "landscape-primary", categories ["security","intelligence","analytics","news"]. Icons: /favicon.svg (sizes any, image/svg+xml, purpose any), /osiris-icon.png (512x512, "any maskable"), /icon-192.png (192x192, "any maskable"). public/site.webmanifest is the favicon-generator default: {"name":"","short_name":"",icons android-chrome-192x192/512x512,"theme_color":"#ffffff","background_color":"#ffffff","display":"standalone"}. layout.tsx:89 sets `manifest: "/site.webmanifest"`, so the empty, white manifest is the one browsers use. Nothing links manifest.json.

Files: `public/manifest.json`, `public/site.webmanifest`, `src/app/layout.tsx:89`

### 9. layout.tsx brand metadata

SITE_URL "https://osirisai.live", SITE_NAME "OSIRIS" (:5-6). SITE_TITLE "OSIRIS — Open Source Intelligence Platform | Live Flight Tracking, CCTV, OSINT Tools & More" (:7). Title template "%s | OSIRIS Intelligence" (:23). Viewport (:11-17): themeColor "#D4AF37", maximumScale 5, colorScheme "dark". icons (:71-88): png 32/16/192/512, apple 180x180, shortcut /favicon.ico, apple-touch-icon-precomposed. OG (:92-110): title "OSIRIS — The Open-Source Palantir Alternative | Live Flights, CCTV, Satellites & OSINT Tools", image `${SITE_URL}/og-image.png` 1200x630, alt "OSIRIS — Open Source Intelligence Platform with Live Tracking & OSINT Tools". Twitter summary_large_image, creator and site "@simplifaisoul" (:111-118). other (:121-128): apple-mobile-web-app-status-bar-style "black-translucent", apple-mobile-web-app-title "OSIRIS", msapplication-TileColor "#06060C". The <head> (:184-199) preconnects to fonts.googleapis.com and fonts.gstatic.com, adds manual icon links and injects WebApplication JSON-LD (:132-176, 20-item featureList). Body className is "antialiased", wrapped in <ErrorBoundary name="OSIRIS Core">.

Files: `src/app/layout.tsx:5-17`, `src/app/layout.tsx:71-128`, `src/app/layout.tsx:132-176`, `src/app/layout.tsx:184-205`

### 10. Splash / boot screen (does NOT use the Eye logo)

Constants at page.tsx:149-159: APP_VERSION = 'V5.0'; SPLASH_STAGES = ['ESTABLISHING SECURE CONNECTION...', 'INITIALIZING FEEDS...', 'CALIBRATING SENSORS...', 'SYSTEM READY']; SPLASH_PROGRESS = ['25%', '50%', '78%', '100%']; HUD_EASE = [0.22, 1, 0.36, 1]; hudIn = (delay) => ({ duration: 0.7, ease: HUD_EASE, delay }). Timing (:387-408): stage 1 at 1100ms, stage 2 at 1700ms, hard cap setShowSplash(false) at 7000ms. When mapReady is true and the stage is 2, stage 3 follows 500ms later. Stage 3 is held 550ms, then the splash hides. So the splash lifts on the map's first frame, never before about 2.2s and never after 7s. After the fade-out completes, onExitComplete sets splashGone, then the camera flies to the viewer's IP location. Markup (:1059-1243): z-[999], background 'radial-gradient(ellipse at center, #0a0a14 0%, var(--bg-void) 70%)'. Exit is {opacity:0, scale:1.04} over 0.7s with ease [0.4,0,0.2,1]. Scanline overlay: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(212,175,55,0.015) 2px, rgba(212,175,55,0.015) 4px)' with animation splashScanDrift 8s (globals.css:307-310, background-position 0 0 to 0 100vh). APP_VERSION appears top-left (11px, tracking .3em, gold, opacity .6). The w-40 h-40 logo is three rings: outer 1px rgba(212,175,55,0.2) rotating 360 in 20s with a glowing gold dot; middle inset 18px 1px rgba(0,229,255,0.15) rotating -360 in 12s with a cyan dot; inner inset 40px rgba(212,175,55,0.25) rotating in 7s. The core is a 48px circle with a 2px gold border, a pulsing radial fill and gradient crosshair lines. A conic-gradient radar sweep runs on a 3s loop. Title: 'OSIRIS' letters stagger in (delay 0.5+i*0.08, from y20 and blur(8px)); text-4xl/5xl, tracking .5em, color var(--text-heading), textShadow '0 0 30px rgba(212,175,55,0.2)'. Subtitle 'GLOBAL INTELLIGENCE PLATFORM' reveals by width 0 to 100% (delay 1.2s, 0.8s). Progress track: 2px, rgba(212,175,55,0.1), fill 'linear-gradient(90deg, var(--gold-primary), var(--cyan-primary), var(--gold-primary))'. Stage text is 10px, muted, and turns cyan at SYSTEM READY. Background grid: 60px squares at opacity .03. Four 32px corner brackets with 2px gold borders at opacity .3, fading in with a 0.8+i*0.1s delay.

Files: `src/app/page.tsx:149-159`, `src/app/page.tsx:178-183`, `src/app/page.tsx:387-408`, `src/app/page.tsx:1059-1243`, `src/app/globals.css:307-310`

### 11. HUD reveal choreography after splash

Every HUD block is a motion.div gated on `revealed = !showSplash` and uses hudIn(delay). Header y:-20 at 0.15. Right tool strip x:12 at 0.3. Top-right status opacity at 0.35. Map view controls y:20 at 0.45. Bottom cursor info at 0.6. The top-right status row (:1420-1445) shows ZuluClock, 'STATUS: LIVE' (var(--alert-green), otherwise alert-red with the status upper-cased), N LAYERS (cyan bold), N ENTITIES, 'SOLAR: Kp{n}' coloured by spaceWeather.storm_color ('N/A' when there is no reading), APP_VERSION, then TokenPanel and SupportMenu. The view control strip (:1383-1389) is rounded-xl with border var(--border-primary), bg var(--bg-panel), backdrop-blur-2xl and shadow-[0_8px_32px_rgba(0,0,0,0.55)]. Its segments are 3D (Globe icon) | 2D (MapPinned) | MAP (Moon, title 'Night Mode') | SAT (Satellite).

Files: `src/app/page.tsx:1374-1395`, `src/app/page.tsx:1420-1445`, `src/app/page.tsx:1467`, `src/app/page.tsx:1877-1895`

### 12. Brand colour and typography tokens tied to the logo

globals.css:1 imports Google Fonts JetBrains Mono and Inter (wght 300-700). :9-10 --gold-rgb 212,175,55 and --cyan-rgb 0,229,255. :12-17 backgrounds --bg-void #04040A, --bg-primary #06060C, --bg-secondary #0C0E1A, --bg-tertiary #121628, --bg-panel rgba(8,10,20,0.88). :20-24 gold: --gold-primary #D4AF37, --gold-light #F0D060, --gold-dim #8B7325. :27-28 --cyan-primary #00E5FF, --cyan-dim #006B7A. :32-35 alerts: red #FF3D3D, orange #FF9500, green #00E676, blue #448AFF. :69-74 text: primary #E8E6E0, secondary #9B978E, muted #5C5A54, heading #F5F0E0. :82-83 --font-hud 'JetBrains Mono', --font-body 'Inter'. .glass-panel (:204-215): bg var(--bg-panel), blur(24px) saturate(1.3), 1px border-primary (gold at .15), radius 14px, gold inset top highlight. .hud-label (:252-258) is 7px mono uppercase with tracking .2em. The 'Ghost Protocol' theme (body.theme-ghost, :97+) swaps gold to #B388FF and cyan to #7C4DFF. The logo follows the theme only where it uses var(--gold-primary): the docs logo does, but the main header hard-codes text-[#D4AF37]. The $OSIRIS pill uses Solana green #14F195 (TokenPanel.tsx:14-17).

Files: `src/app/globals.css:1-84`, `src/app/globals.css:97-140`, `src/app/globals.css:204-258`, `src/components/TokenPanel.tsx:12-18`

### 13. Other public/ assets a builder should know about

public/dark-matter-style.json (70,850 B) is a MapLibre style v8 named "Dark Matter" (maputnik) with source 'carto' vector tiles 'https://tiles-{a,b,c,d}.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt', minzoom 0, maxzoom 14. public/vendor/maplibre/6.7.0/ contains a self-hosted MapLibre build (LICENSE.txt, maplibre-gl-shared.mjs, maplibre-gl-worker.mjs). public/data/submarine-cables.json and submarine-cables-filtered.json are byte-identical (md5 34a75a25..., 665,094 B each). robots.txt sets Allow / and Disallow /api/, /api/scanner and /api/osint/*, Allow /api/health, Sitemap https://osirisai.live/sitemap.xml, Crawl-delay 10. sitemap.xml has a single URL https://osirisai.live/ with lastmod 2026-05-13, changefreq hourly, priority 1.0. The middleware matcher (src/middleware.ts:57) excludes static extensions svg|png|jpg|jpeg|gif|webp|mjs|js|css|json|pbf|mvt|woff|woff2|ico|txt, so those assets bypass middleware.

Files: `public/dark-matter-style.json`, `public/vendor/maplibre/6.7.0/`, `public/data/submarine-cables.json`, `public/robots.txt`, `public/sitemap.xml`, `src/middleware.ts:57`

### 14. CasaOS / Docker brand usage

docker-compose.yml:84 has icon https://raw.githubusercontent.com/simplifaisoul/osiris/master/public/casaos-icon.png, and :85-87 use og-image.png as both thumbnail and screenshot_link. The tagline is "Real-time global OSINT intelligence dashboard". DOCKER.md:98-100 says "The app icon is the gold Eye-of-Horus mark in public/casaos-icon.png (512×512 PNG)".

Files: `docker-compose.yml:75-95`, `DOCKER.md:98-100`

### 15. README brand strings and badges

README.md:3 "# ⬡ OSIRIS" (hexagon glyph). :5 "### Open Source Intelligence & Reconnaissance Integrated System" (the backronym). Badge colours: live demo #00E5FF (:7), Patreon #FF424D (:8), License MIT #D4AF37 (:12). Pitch line at :14. Licence is MIT, "Copyright (c) 2026 simplifaisoul" (LICENSE:1-3).

Files: `README.md:1-18`, `LICENSE`

## Worth copying

- Keep one hieroglyph SVG (viewBox 0 0 650 500, fill=currentColor) and colour it with CSS. Drop the white eye-white paths so the map shows through, and add a gold drop-shadow glow: drop-shadow(0 0 8px rgba(255,215,0,0.5)).
- Make the splash honest: its last stage waits for the map's first rendered frame, with a minimum on-screen time (about 2.2s) and a hard 7s cap. Show SPLASH_STAGES text and SPLASH_PROGRESS widths, then do an exit 'push-through' (opacity 0, scale 1.04, 0.7s).
- Stage the whole HUD entrance through one hudIn(delay) helper (duration 0.7, ease [0.22,1,0.36,1]) with staggered delays (0.15 header, 0.3 tool strip, 0.35 status, 0.45 view controls, 0.6 cursor HUD).
- Splash visuals: three counter-rotating rings (20s/12s/7s) with glowing orbit dots, a conic radar sweep, a CRT scanline overlay drifting over 8s, a 60px faint grid, 4 corner brackets, letter-staggered blur-in title and a typewriter-style subtitle.
- Split the wordmark into tiers: a gold mono 'OSIRIS' at tracking .4em, 'OPEN SOURCE INTELLIGENCE' at 9-10px tracking .2em, and a muted .4-opacity capability tagline that expands on md+.
- Pin CCTV preview cards to the map: corner-bracket frame, red '• LIVE' chip, mono caps caption strip and a leader line to a white circular marker. The camera viewer carries a 'CAM-xxxx-yyyy' ID derived from the coordinates.
- Gold #D4AF37 on near-black (#04040A/#06060C), cyan #00E5FF as secondary, glass panels (rgba(8,10,20,0.88), blur 24px, gold .15 border, radius 14), JetBrains Mono for all HUD text.
- Self-host the MapLibre build under /vendor and ship a local Dark Matter style JSON that points at the Carto vector tiles.

## Weaknesses to fix in GODSEYE

- layout.tsx:89 links /site.webmanifest, which has an empty name and short_name and theme/background #ffffff. The good manifest.json (gold #D4AF37, #06060C, landscape) is never linked, so PWA installs get a blank name and a white splash. The replica should ship one correct manifest.
- og-image.png is a 1024x1024 JPEG, but layout.tsx:101-107 declares it as image/png at 1200x630. Social previews will crop or letterbox it. The replica should produce a true 1200x630 PNG/JPEG with the correct MIME type.
- osiris-icon.png and icon-192.png are the same 1024x1024 JPEG, yet manifest.json declares them as PNG at 512x512 and 192x192 with purpose 'any maskable', and the artwork has no maskable safe-zone padding verified. The replica should generate correctly sized maskable PNGs.
- public/eye-of-horus.svg has no viewBox (only width/height), and no code uses it. favicon-32.svg is also orphaned. src/app/favicon.ico duplicates public/favicon.ico.
- The logo is inconsistent across the app: the header uses 3 paths with hard-coded #D4AF37 (so the Ghost theme does not recolour it), the docs page uses 2 paths (no curl) with var(--gold-primary), favicon.svg is a different geometric eye, and the splash uses no eye at all. Make one shared <Logo> component that follows the theme.
- The header logo lacks aria-label/role='img'. Only the docs version sets aria-hidden. The h1 is the only accessible name.
- public/data/submarine-cables.json and submarine-cables-filtered.json are identical (665 KB each), so the 'filtered' file is not actually filtered.
- README.md:7 labels the live-demo badge 'osirisai.live' but links to https://osirislive.app. The Discord invite is discord.gg/umBykEpb98 in the README (:16, :285) but discord.gg/EPaFD5FFKf in the app (GlobalStatusBar.tsx:154, DocsClient.tsx:600).
- The splash timers use setTimeout without prefers-reduced-motion handling for the infinitely rotating rings and scanline drift.

## Gaps (not verified)

- The Eye-of-Horus hieroglyph path has no stated provenance or licence (no comment, no attribution). It looks like a common public-domain tracing but this is unconfirmed, so the replica should use its own or clearly public-domain artwork.
- I did not open the favicon.ico frames or the 16/32/192 PNG favicons pixel by pixel; I assume they match apple-touch-icon (gold hieroglyph on black) but did not verify.
- It is not known which tool produced the raster art (og-image, osiris-icon); its style suggests AI or design-tool output. There are no source files (e.g. .fig or .psd) in the repo.
- The screenshots are frames from a screen recording, not full-resolution captures. Small text in them (layer counts, ticker values) is only partly legible, so exact numbers in them are illustrative.
