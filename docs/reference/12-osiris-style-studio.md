# OSIRIS Style Studio: presets, token maths, controls
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
**Question answered:** The Style Studio preset palettes, the buildVars variable list and each control's default and range are not quoted.

## Summary

Style Studio = pure token engine (src/lib/style-tokens.ts, 447 lines) + panel UI (src/components/StyleStudio.tsx, 413 lines) + map palette (src/lib/map-palette.ts). Settings (29 fields) seed from the live theme via getComputedStyle, are applied as inline CSS custom properties on <body> (these override the body.theme-* rules) plus one injected <style id="osiris-style-studio"> for the knobs that have no token (radius, blur, tracking, motion, map-pad hiding, scanline/grain/vignette overlays). Every rule is scoped to body[data-studio="on"]. Settings persist to localStorage key 'osiris:style-studio', are re-applied once on page load, and a window CustomEvent 'osiris:style' tells the WebGL map to re-read its --map-* palette. There are 6 presets (HORUS, PHANTOM, TERMINAL, CRIMSON, ARCTIC, BLACKOUT). Each preset patches only accent, accent2, the 4-step bg ramp, 4 text colours, glow and scanlines. buildVars emits 34 core custom properties plus 12 --map-* properties (46 in total). Six of the core properties are derived: --gold-light = shade(accent, +0.35), --gold-dim = shade(accent, -0.45), --cyan-dim = shade(accent2, -0.5), --gold-glow alpha = glow, --cyan-glow alpha = glow*0.6, and the border/scrollbar/hover alphas are multiples of borderAlpha (0.45, 2.4 capped at 1, 1.2, 0.5, 1.2, 2.4). The findings below give every control's range, step, default, readout format and sanitize clamp exactly.

## Findings

### 0. StyleSettings interface and DEFAULTS (neutral baseline = core 'Horus' theme)

src/lib/style-tokens.ts:29-61 interface, 78-107 DEFAULTS. Values in this order: accent '#d4af37'; accent2 '#00e5ff'; alertRed '#ff3d3d'; alertOrange '#ff9500'; alertGreen '#00e676'; alertBlue '#448aff'; bg '#04040a'; bgPrimary '#06060c'; bgSecondary '#0c0e1a'; bgTertiary '#121628'; panelAlpha 0.88; borderAlpha 0.15; textPrimary '#e8e6e0'; textSecondary '#9b978e'; textMuted '#5c5a54'; textHeading '#f5f0e0'; fontUi = FONT_UI[0].value; fontMono = FONT_MONO[0].value; glow 0.3; tracking null; blur null (null means AUTO: 'leave the app's own value alone'); radius 1; motion 1; scanlines 0; vignette 0; grain 0; mapControls true; map MAP_DEFAULTS. Constants: STORAGE_KEY = 'osiris:style-studio' (line 26), STYLE_TAG_ID = 'osiris-style-studio' (line 27).

Files: `src/lib/style-tokens.ts:26-27`, `src/lib/style-tokens.ts:29-61`, `src/lib/style-tokens.ts:78-107`

### 1. Font option lists (Segmented controls)

FONT_UI (style-tokens.ts:63-68): INTER = "'Inter', -apple-system, sans-serif"; MONO = "'JetBrains Mono', monospace"; SYSTEM = 'system-ui, -apple-system, sans-serif'; SERIF = "'Iowan Old Style', Georgia, serif". FONT_MONO (70-75): JETBRAINS = "'JetBrains Mono', 'Courier New', monospace"; COURIER = "'Courier New', Courier, monospace"; CONSOLAS = "Consolas, 'SF Mono', Menlo, monospace"; INTER = "'Inter', sans-serif". sanitize accepts a font only if its value matches one of these stacks exactly (normFont, line 175-177). Fonts are loaded in globals.css:1 from https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap

Files: `src/lib/style-tokens.ts:63-75`, `src/lib/style-tokens.ts:175-177`, `src/app/globals.css:1`

### 2. PRESETS: all six palettes verbatim

style-tokens.ts:112-119 (type Preset = {label, patch: Partial<StyleSettings>}; comment: 'Presets carry a full surface ramp so they don't inherit the old one').
HORUS: accent #d4af37, accent2 #00e5ff, bg #04040a, bgPrimary #06060c, bgSecondary #0c0e1a, bgTertiary #121628, textPrimary #e8e6e0, textSecondary #9b978e, textMuted #5c5a54, textHeading #f5f0e0, glow 0.3, scanlines 0.
PHANTOM: accent #b388ff, accent2 #7c4dff, bg #05000f, bgPrimary #08001a, bgSecondary #0d0025, bgTertiary #140033, textPrimary #e1bee7, textSecondary #9575cd, textMuted #6a4c93, textHeading #b388ff, glow 0.35, scanlines 0.
TERMINAL: accent #00ff9c, accent2 #00b36b, bg #000a06, bgPrimary #001410, bgSecondary #00201a, bgTertiary #002d24, textPrimary #c8ffe4, textSecondary #5fbf95, textMuted #2e6b52, textHeading #7dffc4, glow 0.4, scanlines 0.05.
CRIMSON: accent #ff4d5a, accent2 #ff9500, bg #0c0204, bgPrimary #140407, bgSecondary #1e070b, bgTertiary #2a0a10, textPrimary #ffd9dd, textSecondary #c98089, textMuted #6e3a42, textHeading #ff8f97, glow 0.35, scanlines 0.
ARCTIC: accent #8fd3ff, accent2 #4fc3f7, bg #04080f, bgPrimary #070d18, bgSecondary #0b1524, bgTertiary #101f33, textPrimary #e3f2fd, textSecondary #90a4b8, textMuted #4a5d70, textHeading #c9e7ff, glow 0.25, scanlines 0.
BLACKOUT: accent #9e9e9e, accent2 #616161, bg #000000, bgPrimary #070707, bgSecondary #0e0e0e, bgTertiary #161616, textPrimary #e0e0e0, textSecondary #8a8a8a, textMuted #4a4a4a, textHeading #f0f0f0, glow 0.08, scanlines 0.
Presets do NOT set the alert colours, panelAlpha, borderAlpha, fonts, tracking, blur, radius, motion, vignette, grain, mapControls or map, so those carry over from the current base. The panel footer says so explicitly: 'presets do not touch the map layers — those carry meaning, not just a look'. PHANTOM's textMuted #6a4c93 differs from the Ghost theme's --text-muted #4A148C (globals.css:126).

Files: `src/lib/style-tokens.ts:109-119`, `src/app/globals.css:126`

### 3. Colour helpers (derivation math)

shade(hex, amount) (style-tokens.ts:136-142): amount > 0 lerps each channel toward 255, amount < 0 toward 0: c + (t - c)*|amount|. toHex rounds each channel and clamps it to 0-255 (131-134). hexToRgb expands 3-digit hex and returns {0,0,0} on NaN (124-129). rgbList returns the string 'r, g, b' (144). rgba(hex, a) returns `rgba(r, g, b, ${Number(a.toFixed(3))})`, so alpha is rounded to 3 decimals (145). HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i (122).

Files: `src/lib/style-tokens.ts:122-145`

### 4. buildVars: the complete emitted variable list (34 core + 12 map)

style-tokens.ts:226-264, in order:
'--gold-rgb': rgbList(accent)
'--gold-primary': accent
'--gold-light': shade(accent, 0.35)
'--gold-dim': shade(accent, -0.45)
'--gold-glow': rgba(accent, glow)
'--text-gold': accent
'--cyan-rgb': rgbList(accent2)
'--cyan-primary': accent2
'--cyan-dim': shade(accent2, -0.5)
'--cyan-glow': rgba(accent2, glow * 0.6)
'--text-cyan': accent2
'--alert-red': alertRed
'--alert-orange': alertOrange
'--alert-green': alertGreen
'--alert-blue': alertBlue
'--bg-void': bg
'--bg-primary': bgPrimary
'--bg-secondary': bgSecondary
'--bg-tertiary': bgTertiary
'--bg-panel': rgba(bg, panelAlpha)
'--bg-panel-solid': bgSecondary
'--border-primary': rgba(accent, borderAlpha)
'--border-secondary': rgba(accent, borderAlpha * 0.45)
'--border-active': rgba(accent, Math.min(1, borderAlpha * 2.4))
'--border-cyan': rgba(accent2, borderAlpha * 1.2)
'--hover-accent': rgba(accent, borderAlpha * 0.5)
'--scrollbar-thumb': rgba(accent, borderAlpha * 1.2)
'--scrollbar-thumb-hover': rgba(accent, borderAlpha * 2.4)
'--text-primary': textPrimary
'--text-secondary': textSecondary
'--text-muted': textMuted
'--text-heading': textHeading
'--font-body': fontUi
'--font-hud': fontMono
...then one entry per map palette key: MAP_VARS[k] → s.map[k] (line 262).
VAR_NAMES = Object.keys(buildVars(DEFAULTS)) (line 266) is the list that Reset removes. Only --border-active is capped at 1; --scrollbar-thumb-hover (borderAlpha*2.4) is not capped, but borderAlpha is clamped to at most 0.6, so it can reach 1.44 before rgba is applied. The test at style-tokens.test.ts:153-168 checks that every theme property except --accent-weather/--accent-nuclear, --panel-gap and --edge-pad is included. Test expectations: accent '#ff8800' with borderAlpha 0.2 → --gold-rgb '255, 136, 0', --border-primary 'rgba(255, 136, 0, 0.2)'; with the default accent and borderAlpha 0.2 → --border-active 'rgba(212, 175, 55, 0.48)', --border-secondary 'rgba(212, 175, 55, 0.09)'; borderAlpha 0.6 → --border-active 'rgba(212, 175, 55, 1)'.

Files: `src/lib/style-tokens.ts:225-266`, `src/lib/style-tokens.test.ts:123-168`

### 5. Theme CSS values that buildVars replaces (core :root and body.theme-ghost)

globals.css:9-85 :root: --gold-rgb 212, 175, 55; --cyan-rgb 0, 229, 255; --bg-void #04040A; --bg-primary #06060C; --bg-secondary #0C0E1A; --bg-tertiary #121628; --bg-panel rgba(8, 10, 20, 0.88); --bg-panel-solid #0C0E1A; --gold-primary #D4AF37; --gold-light #F0D060; --gold-dim #8B7325; --gold-glow rgba(var(--gold-rgb), 0.3); --cyan-primary #00E5FF; --cyan-dim #006B7A; --cyan-glow rgba(var(--cyan-rgb), 0.15); --alert-red #FF3D3D; --alert-orange #FF9500; --alert-green #00E676; --alert-blue #448AFF; --accent-weather #E040FB; --accent-nuclear #76FF03; --border-primary 0.15; --border-secondary 0.08; --border-active 0.4; --border-cyan rgba(cyan,0.2); --text-primary #E8E6E0; --text-secondary #9B978E; --text-muted #5C5A54; --text-heading #F5F0E0; --text-gold #D4AF37; --text-cyan #00E5FF; --scrollbar-thumb 0.2; --scrollbar-thumb-hover 0.4; --hover-accent 0.08; --font-hud 'JetBrains Mono', 'Courier New', monospace; --font-body 'Inter', -apple-system, sans-serif; --panel-gap 12px; --edge-pad 20px. The global rule * { transition: background-color/border-color/color/box-shadow 0.6s cubic-bezier(0.16, 1, 0.3, 1) } (90-95) is the 600 ms that the motion knob scales.
body.theme-ghost (100-143): --gold-rgb 179, 136, 255; --cyan-rgb 124, 77, 255; bg #05000F/#08001A/#0D0025/#140033; --bg-panel rgba(8, 0, 26, 0.92); --gold-primary #B388FF; --gold-light #D1C4E9; --gold-dim #6A1B9A; --gold-glow rgba(179,136,255,0.3); --cyan-primary #7C4DFF; --cyan-dim #4A148C; --cyan-glow 0.2; --border-primary 0.2; --border-secondary 0.08; --border-active 0.45; --border-cyan rgba(124,77,255,0.25); --text-primary #E1BEE7; --text-secondary #9575CD; --text-muted #4A148C; --text-heading #B388FF; --text-gold #B388FF; --text-cyan #7C4DFF; scrollbar 0.25/0.5; hover 0.1; map overrides --map-cctv #b388ff, --map-flight-civil #b388ff, --map-flight-private #ce93d8, --map-flight-gov #d500f9, --map-flight-unknown #b388ff. The satellite properties are deliberately left at their defaults in the ghost theme. The theme is switched in page.tsx:308-312 via document.body.className = '' or 'theme-ghost'.

Files: `src/app/globals.css:9-95`, `src/app/globals.css:100-143`, `src/app/page.tsx:308-312`

### 6. Map palette (MAP_DEFAULTS / MAP_VARS) driven by the Map layers section

src/lib/map-palette.ts. The keys map to properties as follows: cctv→--map-cctv #00e676; satComms→--map-sat-comms #00e676; satMilitary→--map-sat-military #ff3d3d; satNavigation→--map-sat-navigation #448aff; satEarth→--map-sat-earth #90ee90; satScience→--map-sat-science #ffd700; satOther→--map-sat-other #00e5ff; flightCivil→--map-flight-civil #00e5ff; flightPrivate→--map-flight-private #ffd700; flightGov→--map-flight-gov #ff9500; flightMilitary→--map-flight-military #ff0000; flightUnknown→--map-flight-unknown #546e7a (duplicated in globals.css:44-55). satColorFor(category, missionColor, palette): SAT_CATEGORY maps comms / military / navigation / earth_obs / science / other to their keys. If a category's colour still equals its default, the feed's per-satellite mission colour is used; otherwise the chosen colour applies to the whole category. readMapPalette parses non-hex computed values with a 2d-canvas fillStyle probe, seeded twice (#000000 and #ffffff) with an agreement check, because Lightning CSS minifies #ff0000 to 'red'. OsirisMap.tsx:1852-1865 re-reads the palette immediately, again on the next requestAnimationFrame (a theme class flip in the parent lands after the child effect), and on every STYLE_EVENT 'osiris:style'.

Files: `src/lib/map-palette.ts`, `src/app/globals.css:44-55`, `src/components/OsirisMap.tsx:1843-1865`

### 7. Control inventory: section order, labels, ranges, steps, readouts

StyleStudio.tsx:315-406. The sections are rendered in this order:
1) 'Preset': grid-cols-3 gap-1 of 6 buttons. Each button has a 10px (w-2.5) round dot with background = the preset's accent and boxShadow `0 0 6px ${accent}`, plus the label in 9px mono. Click → edit(p.patch).
2) 'Accent': Primary (Swatch → accent), Secondary (Swatch → accent2), Glow: Slider min 0 max 1 step 0.01, readout `${Math.round(v*100)}%` (default 0.3 → '30%').
3) 'Signal': Critical → alertRed, Warning → alertOrange, Nominal → alertGreen, Info → alertBlue (Swatches).
4) 'Map controls': 'Pan/zoom pad' Segmented ON/OFF → mapControls (default ON).
5) 'Map layers': SubHead 'Cameras': row 'Dots & labels' → map.cctv. SubHead 'Satellites' with note 'Default keeps each satellite's own mission colour. Change one and it takes over that whole category.': Comms, Military, Navigation, Earth obs, Science, Other. SubHead 'Aircraft': Civil, Private, Government, Military, Unknown. All of these are ResettableSwatch with an Undo2 button that restores MAP_DEFAULTS[key]; the button is invisible (opacity-0) while the value is unchanged.
6) 'Surface': Background → setBg, which also re-derives the ramp: bgPrimary = shade(bg, 0.03), bgSecondary = shade(bg, 0.07), bgTertiary = shade(bg, 0.12) (line 245-247). Panel: Slider 0.2-1 step 0.01, readout %. Border: Slider 0-0.6 step 0.01, readout %. Blur: AutoSlider 0-64 step 1, whenEnabled 24, readout `${v}px` or 'auto'. Radius: Slider 0-2.5 step 0.05, readout `${v.toFixed(2)}x`.
7) 'Text': Primary, Secondary, Muted, Heading (Swatches).
8) 'Typography': 'UI font' Segmented FONT_UI; 'Mono font' Segmented FONT_MONO; Tracking: AutoSlider -0.05 to 0.4 step 0.005, whenEnabled 0.2, readout `${v.toFixed(2)}em`.
9) 'Motion & FX': Speed: Slider 0-2 step 0.05, readout 'off' at 0 else `${v.toFixed(2)}x`. Scanlines: 0-0.2 step 0.005, readout 'off' or `${Math.round(v*500)}%`. Grain: 0-0.3 step 0.005, readout 'off' or `${Math.round(v*333)}%`. Vignette: 0-1 step 0.01, readout 'off' or `${Math.round(v*100)}%`.
Footer text (403-406): 'Saved to this browser. AUTO leaves the app's own styling alone, and presets do not touch the map layers — those carry meaning, not just a look. Reset restores the active theme.'

Files: `src/components/StyleStudio.tsx:315-406`, `src/components/StyleStudio.tsx:244-247`

### 8. sanitize clamps (these match the slider ranges; used for stored and pasted JSON)

style-tokens.ts:179-211. Colours go through normHex (153-161), which trims the value, strips an 8-digit or 4-digit alpha suffix (browsers serialise rgba(var(--x),a) as #rrggbbaa), validates against HEX_RE and normalises to lowercase 6-digit hex. Invalid values fall back to the base value. Number clamps: panelAlpha [0.2,1]; borderAlpha [0,0.6]; glow [0,1]; tracking nullable [-0.05,0.4]; blur nullable [0,64]; radius [0,2.5]; motion [0,2]; scanlines [0,0.2]; vignette [0,1]; grain [0,0.3]. normNullableNum: null stays null (AUTO) and undefined takes the base value. mapControls must be a boolean. map is normalised key by key with normHex. The code comment says the reason: unvalidated numbers reach the injected stylesheet as text and would allow CSS injection (147-150).

Files: `src/lib/style-tokens.ts:147-223`

### 9. buildCss: the conditional injected rules

style-tokens.ts:272-338. Every rule is prefixed with at = 'body[data-studio="on"]'.
radius != 1: .rounded 4px, .rounded-md 6px, .rounded-lg 8px, .rounded-xl 12px, .rounded-2xl 16px, each × radius and formatted with toFixed(1)+'px'. .rounded-full stays 9999px.
blur != null: [class*="backdrop-blur"] { backdrop-filter: blur(Npx) saturate(1.2); -webkit-backdrop-filter: same }. A blur of 0 counts as a real value, not AUTO.
tracking != null: .font-mono { letter-spacing: Nem }.
motion != 1: `*, *::before, *::after { transition-duration: ${Math.round(600*motion)}ms !important; }`.
!mapControls: [data-map-controls] { display: none !important; } (hidden rather than unmounted).
Overlays share a single ::after (content ''; position fixed; inset 0; pointer-events none; z-index 9998; background-image: the layers joined with ', ') in this order: scanlines `repeating-linear-gradient(0deg, rgba(255,255,255,S) 0px, rgba(255,255,255,S) 1px, transparent 1px, transparent 3px)`; grain = SVG data URI `<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/></filter><rect width='140' height='140' filter='url(%23n)' opacity='G'/></svg>`, passed through encodeURIComponent with ' replaced by %27; vignette `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,V) 100%)`. When every knob is neutral, buildCss returns an empty string and the style tag is removed.

Files: `src/lib/style-tokens.ts:268-338`

### 10. readTheme seeding, apply, persist, load

readTheme (361-387) starts from DEFAULTS and reads getComputedStyle(document.body): accent from --gold-primary, accent2 from --cyan-primary, the alerts, bg from --bg-void plus the ramp, and the texts. panelAlpha, borderAlpha and glow come from parseAlpha applied to --bg-panel, --border-primary and --gold-glow; parseAlpha handles rgba(..., a), a % alpha, #rrggbbaa and #rgba (345-358). map comes from readMapPalette. applySettings(s) (404-425) runs body.style.setProperty for every var, sets body[data-studio='on'], writes buildCss into <style id='osiris-style-studio'> in <head> and dispatches window CustomEvent 'osiris:style'. applySettings(null) removes all VAR_NAMES and data-studio, deletes the tag and announces. saveSettings writes JSON to localStorage['osiris:style-studio'] inside try/catch (private mode). loadSavedSettings returns sanitize(JSON.parse(raw), readTheme()) or null. page.tsx:316-319 re-applies saved settings once on mount. The inline vars survive theme switches.

Files: `src/lib/style-tokens.ts:340-446`, `src/app/page.tsx:314-319`

### 11. Panel behaviour and visuals

StyleStudio.tsx:188-411. State: s (null until initialised), plus a dirty ref. Nothing is applied until the first edit; otherwise Reset would pin a snapshot of the theme and break the Ghost toggle (192-198). While clean, edit() re-seeds from readTheme() (224-232). Changes apply instantly; saveSettings is debounced 250 ms (208-216). Esc closes the panel. Reset: dirty = false, clearSettings(), applySettings(null), setS(readTheme()). Copy writes JSON.stringify(s, null, 2) to the clipboard and shows a Check icon in var(--alert-green) for 1600 ms. Paste reads the clipboard, then edit(sanitize(JSON.parse(text), s ?? readTheme())). Header: 'Style Studio' (11px mono, tracking 0.22em, var(--gold-light)) over 'Live UI tokens' (9px, white/25). Icon buttons, in order: ClipboardPaste, Copy, RotateCcw, X, each w-7 h-7. The panel is portalled to document.body because the rail has a framer-motion transform. motion.div spring: stiffness 320, damping 30; initial opacity 0 with x -12 (desktop) or y 12 (mobile). Classes: z-[400], rounded-xl, border var(--border-primary), shadow 0 16px 48px rgba(0,0,0,0.7). Desktop: fixed left-[58px] bottom-6 w-[340px] max-h-[min(78vh,720px)]. Mobile: fixed inset-x-3 bottom-3 top-20. Style: background rgba(6, 4, 14, 0.96), backdropFilter blur(28px) saturate(1.2). Row label 10px mono, tracking 0.15em, uppercase, white/40. Section title 9px, tracking 0.25em, white/25, border-b white/[0.07]. Swatch: 7x7 rounded-md with glow `0 0 10px ${value}55`, a hex readout and an invisible native <input type=color> overlaid on it. Active Segmented/AUTO buttons: border var(--border-active), bg var(--gold-primary)/15, text var(--gold-light). Slider track: h-1 bg-white/10 accent-[var(--gold-primary)]. Trigger: the SlidersHorizontal icon in LayerPanel's desktop rail (w-10 h-10, title 'Style Studio', icon 15px, active colour var(--gold-primary) with drop-shadow(0 0 6px var(--gold-glow)), inactive rgba(255,255,255,0.15)) and a mobile row labelled 'Style Studio'.

Files: `src/components/StyleStudio.tsx:188-411`, `src/components/LayerPanel.tsx:211`, `src/components/LayerPanel.tsx:309-326`, `src/components/LayerPanel.tsx:507-527`

## Worth copying

- Two-channel override: palette values as inline custom properties on <body>, which beat the body.theme-* class rules, plus one <style> tag for knobs with no token. Every rule is scoped to body[data-studio="on"] so it switches on and off in one step.
- Conditional emission: a knob at its neutral value (radius 1, motion 1, overlays 0, blur/tracking null = AUTO) emits nothing, so touching one control never flattens unrelated app styling.
- Seed from getComputedStyle of the live theme, and stay 'clean' until the first edit (dirty ref) so Reset and theme toggles keep working.
- sanitize() every stored or pasted JSON value (hex normalisation, numeric clamps, font allow-list, boolean check) because the values become CSS text, which prevents CSS injection.
- Derive the accent family from one colour: shade() lerps toward white or black, and the border/hover/scrollbar alphas are fixed multiples of one borderAlpha.
- Stack scanlines, grain (an SVG feTurbulence data-URI tile, percent-encoded) and vignette in one ::after pseudo-element rather than competing pseudo-elements.
- Use a window CustomEvent ('osiris:style') to tell the WebGL map to re-read its --map-* palette, plus an extra requestAnimationFrame read for theme-class flips. The token engine stays unaware of the map.
- Parse computed colours with a canvas 2d fillStyle probe, seeded twice with an agreement check, to survive minifiers that turn #ff0000 into 'red'.
- Default-as-sentinel for satellite colours: each mission's own colour shows until the user moves the category off its default. ResettableSwatch shows an undo button only when the value is changed.
- Export/import a theme as JSON through the clipboard. Debounce localStorage writes (250 ms) while applying instantly.
- Portal the panel to <body> so a transformed ancestor does not re-anchor position: fixed.

## Weaknesses to fix in GODSEYE

- The derived tokens do not reproduce the hand-tuned theme values, so the first edit shifts other colours slightly. With DEFAULTS, shade('#d4af37', 0.35) is about #e3cb7d against the CSS --gold-light #F0D060, shade(-0.45) is about #75601e against --gold-dim #8B7325, and --cyan-dim is about #007380 against #006B7A. --cyan-glow alpha is 0.18 against 0.15. --border-active is 0.36 against 0.4, and --border-secondary is about 0.0675 against 0.08. --bg-panel becomes rgba(4,4,10,0.88) against rgba(8,10,20,0.88). These hex values are my own arithmetic, not quoted from the code; they should be verified if they matter. A replica could store explicit light/dim overrides per preset, or derive in OKLCH.
- Presets leave the alert colours, panelAlpha/borderAlpha, fonts and map untouched, so the result depends on whatever was active before (e.g. BLACKOUT keeps gold-tinted alerts and ghost borderAlpha 0.2 if applied from Ghost).
- The PHANTOM preset does not match the Ghost theme exactly: textMuted is #6a4c93 against #4A148C, glow is 0.35 against 0.3, and there are no map overrides.
- --accent-weather and --accent-nuclear are not covered by the studio.
- The motion knob scales only CSS transition-duration (base 600 ms). framer-motion springs and CSS animations/keyframes are unaffected, and the code does not check prefers-reduced-motion.
- Radius scaling touches only the Tailwind .rounded/-md/-lg/-xl/-2xl classes. Arbitrary rounded-[Npx] classes and inline radii are missed. The blur override matches only [class*="backdrop-blur"], so inline backdropFilter styles (including the studio panel's own blur(28px)) are ignored.
- Colour inputs are opaque hex only; there is no alpha or OKLCH, and no contrast/accessibility check between the text and bg values chosen.
- The sentinel design means a user cannot pin a satellite category to exactly its default colour and override the mission colours.
- Scanline, grain and vignette readouts use arbitrary scale factors (×500, ×333, ×100), so the percentages shown are cosmetic.
- --scrollbar-thumb-hover alpha (borderAlpha*2.4) is not capped at 1 the way --border-active is. This is harmless in CSS but inconsistent.

## Gaps (not verified)

- I did not read style-tokens.test.ts lines 1-122 or 170-240 in full; only the test names and the buildVars block (123-168) were read.
- The derived hex values in the weaknesses section are my own arithmetic from shade(), not constants in the code.
- Whether 0.15*0.45 serialises as 0.067 or 0.068 after toFixed(3) is not verified (floating-point rounding).
- I did not check where the [data-map-controls] attribute is placed in OsirisMap/the map controls component.
- I did not check how OsirisMap applies palette.flight* and satColorFor to the MapLibre paint properties beyond the read effect at 1843-1865.
