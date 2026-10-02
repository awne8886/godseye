# layers-space — probe log

All probes 2026-09-30 18:05–18:10 UTC from the build sandbox with the honest UA
`GODSEYE/0.1.0 (+https://github.com/awne8886/godseye; contact https://github.com/awne8886/godseye/issues)`,
`curl -sS -m 30`, one request each (no retry loops). CORS = `Access-Control-Allow-Origin` returned to
`Origin: http://localhost:3000`. Every upstream is called server-side only (browsers talk to `/api/*`).
Recorded fixtures (trimmed) live in `src/features/space/__fixtures__/` with `capturedAt`.

## Satellites

| URL | Status | Latency | Size | CORS | Auth | Licence / attribution | Notes |
|---|---|---|---|---|---|---|---|
| `https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json` | 200 | 0.68 s | 9.3 kB | `*` | none | CelesTrak (Dr T.S. Kelso); cite CelesTrak | 22 OMM objects; `EPOCH` "2026-09-30T03:25:12.177120" (µs, **no Z**) |
| `https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json` | 200 | 2.42 s | **6 993 014 B** | `*` | none | as above | 16 612 objects; max `NORAD_CAT_ID` 100830; **644 ids > 99999** (6-digit since 2026-07-11). Served as SATELLITE_FIELDS rows ≈ 191 B/row → 3.18 MB (cap reached near 21.9k rows) |
| `…gp.php?GROUP=gps-ops&FORMAT=json` | 200 | 0.79 s | 13 kB | `*` | none | as above | 32 objects |
| `…gp.php?GROUP=glonass-operational&FORMAT=json` | **TLS reset** (`curl: (35) Recv failure: Connection reset by peer`) after 11.3 s | — | — | — | — | — | Second group request in 3 s was reset. Not retried. The feed therefore paces CelesTrak at 1 request / 2 s, never auto-retries, stops a run at the first failing group, counts every failure in a rolling 2 h window and stops calling CelesTrak at 12 (their firewall trips at 50 errors / 2 h). **All 12 groups the feed uses were verified on 2026-10-01** (Phase 3 round 4 re-probe below): 200 + OMM JSON for `stations, science, geodetic, gps-ops, glo-ops, galileo, military, radar, resource`; `beidou` 200 with 54 objects at 16:19Z; `weather` and `other-comm` were reset from the sandbox but downloaded by the running server (72 and 30 tagged rows in `/api/satellites`). `glonass-operational` does not exist (200 text "GROUP not found"): the feed uses `glo-ops`. Re-probed 2026-10-02 (last section). |
| `https://db.satnogs.org/api/tle/?format=json` | 200 | 1.39 s | 520 kB | none | none | SatNOGS DB (Libre Space Foundation), CC BY-SA 4.0 | Plain array (not paged) of 1 679 `{tle0, tle1, tle2, tle_source, sat_id, norad_cat_id, updated}`; ISS TLE is the same element set CelesTrak serves (epoch 26273.14250205). Used only as a labelled fallback (`catalogueSource: 'satnogs-fallback'`) when CelesTrak has never answered or its last-good catalogue is > 24 h old. |

Breaking changes encoded (§6.2): `FORMAT=json` always (default is CSV since 2026-05-09); NORAD ids read
from the integer `NORAD_CAT_ID` / `norad_cat_id`, never from TLE columns (Alpha-5); `EPOCH` normalised with
`normalizeUtc()`; 403 = "not updated since last download" (still counted as an error).

## ISS

| URL | Status | Latency | CORS | Auth | Licence / attribution | Notes |
|---|---|---|---|---|---|---|
| `https://api.wheretheiss.at/v1/satellites/25544` | 200 | 0.36 s | `*` | none | "Where the ISS at?" | `X-Rate-Limit-Limit: 350` per 5 minutes; fields `latitude, longitude, altitude (km), velocity (km/h), visibility (daylight/eclipsed), footprint, timestamp (unix s), units`. SGP4 from the CelesTrak ISS elements agreed within 1° / 15 km at the probe timestamp (test). |
| `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=awQzjn72bI0&format=json` | 200 | 0.15 s | origin echoed | none | NASA (official) | title "Live High-Definition Views from the International Space Station (Official NASA Stream)", `author_name: NASA`. oEmbed refuses non-embeddable videos, so the embed is allowed. |
| `https://www.youtube.com/channel/UCLA_DiR1FfKNvjuUpBHmylQ/live` | 200 (bot wall) | 1.0 s | — | — | — | `playabilityStatus: LOGIN_REQUIRED`; `watch?v=awQzjn72bI0` → 302 to `google.com/sorry`: live state **cannot be verified from this sandbox**. The SPACE panel embeds via `youtube-nocookie.com` (FRAME_HOSTS) and always shows a YouTube link-out. |
| `https://www.youtube-nocookie.com/embed/awQzjn72bI0` | 200 | 0.60 s | — | — | — | player shell (config loads client-side) |

## Space weather (NOAA SWPC, public domain, all `Access-Control-Allow-Origin: *`)

| URL | Status | Latency | Size | Notes |
|---|---|---|---|---|
| `https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json` | 200 | 0.60 s | 4.8 kB | **array of objects** `{time_tag, Kp, a_running, station_count}` (62 rows, 7 days); `time_tag` "2026-09-30T15:00:00" = 3-h interval START, no Z; latest Kp 0.33 |
| `https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json` | 200 | 0.37 s | 1.64 MB | 3 890 rows, newest first, several spacecraft per minute (`source` IMAP / SOLAR1 / ACE), only `active: true` is operational; `bt`, `bz_gsm` nT; time_tag no Z |
| `https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json` | 200 | 0.35 s | 2.91 MB | 3 942 rows; `proton_speed` km/s, `proton_density` p/cc, `proton_temperature` K; same `active`/`source` semantics |
| `https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json` | 200 | 0.22 s | 160 kB | `{time_tag (with Z), satellite: 18, flux, observed_flux, electron_correction, electron_contaminaton, energy: '0.05-0.4nm' | '0.1-0.8nm'}`; class from the 0.1–0.8 nm channel (B2.8 at probe time) |
| `https://services.swpc.noaa.gov/products/noaa-scales.json` | 200 | 0.20 s | 1.1 kB | keys "-1", "0" (current), "1"…"3" (forecast); `R/S/G.Scale` are strings ("0") |
| `https://services.swpc.noaa.gov/products/alerts.json` | 200 | 0.75 s | 37.7 kB | 68 `{product_id, issue_datetime "2026-09-30 10:04:50.050" (no T/Z), message}`; `product_id` repeats daily (EF3A) → ids include the issue time |

`/products/solar-wind/*` is gone (404 per docs/reference/23): solar wind comes from `/json/rtsw/`.
Poll: 5 min while read, gzip requested; RTSW files are the heaviest (≈ 4.5 MB/refresh uncompressed).

## Env keys

None required. (N2YO passes would be a keyed upgrade behind a capability; not implemented.)

## Live integration check (local `next start`, 2026-09-30 19:31 UTC)

- `/api/satellites` 200 in 11.2 s cold: 16 612 rows (comms 12 930, military 334, navigation 170, earth_obs 490,
  science 79, other 2 609); `celestrak` ok 1.4 s; `celestrak-groups` 4/12 — the 5th group request was reset
  and the run stopped there as designed (membership for the rest falls back to the previous run / name rules).
- `/api/space-weather` 200: Kp 0.33 Quiet (15:00Z interval), X-ray B2.6, RTSW SOLAR1 299.8 km/s, 3.81 p/cc,
  Bt 3.78 nT, Bz +0.55 nT, R0/S0/G0, 25 alerts; all six providers ok.
- `/api/iss` 200 with a propagated ground track; `/api/satellites/orbit?id=25544` LEO, 92.98 min.

## Re-probe 2026-09-30 22:42 UTC (Phase 3 round 1)

Same honest UA, one `curl -s` each, `Origin: https://example.org`.

| URL | Status | Latency | Size | CORS | Notes |
|---|---|---|---|---|---|
| `https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json` | **000** (no response; connection dropped after 11.4 s) | 11.4 s | 0 | — | Not retried (firewall budget). The server feed keeps its last-good catalogue with its age; minutes later the app's own server fetch of `active` succeeded (`/api/satellites` 200, 16 612 rows, 2 909 461 B uncompressed). A 403 would mean "not updated since last download". |
| `https://db.satnogs.org/api/tle/?format=json&norad_cat_id=25544` | 200 | 0.85 s | 312 B | none | ISS TLE, `tle_source: Space-Track.org`, epoch 26273.46514106. |
| `https://api.wheretheiss.at/v1/satellites/25544` | 200 | 0.34 s | 312 B | `*` | lat 11.44, lng −42.90, alt 416.95 km, velocity 27 594.6 km/h, `visibility: eclipsed`, timestamp 1790808175. |
| `https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json` | 200 | 0.18 s | 4 872 B | `*` | Array of objects `{time_tag, Kp, a_running, station_count}`; `time_tag` zone-less UTC. |

Client change recorded here because it affects how the catalogue reaches the browser: the
`tle-propagate` worker now fetches `/api/satellites` itself (same origin) and transfers typed arrays
to the main thread; the SPACE panel asks `/api/satellites?id=25544` (one row) instead of the whole
catalogue.

## Re-probe 2026-10-01 06:14–06:21 UTC (Phase 3 round 4)

Same honest UA, `curl -sS -m 90 --compressed`, one request each, ≥ 15 s apart, `Origin: https://example.org`.

| URL | Status | Latency | Size (gzip) | CORS | Notes |
|---|---|---|---|---|---|
| `…gp.php?GROUP=active&FORMAT=json` | 200 | 1.15 s | 1 166 586 B | `*` | 16 612 objects, max id 100 830. **1 epoch in the future**: CXO 25867 `2026-10-02T03:42:59.671584` (21.5 h after the download); newest epoch not after the download: STARLINK-2185 `2026-10-01T03:22:47`. The feed's `observedAt` is now the newest epoch ≤ download time; per-object epochs are served unchanged. Fixture `celestrak-future-epoch.json`. |
| `…GROUP=stations` | 200 | 1.40 s | 1.5 kB | `*` | ISS epoch 2026-09-30T20:27:19 |
| `…GROUP=science` | reset (000, 11.25 s) then 200 (0.79 s, 46 objects) 60 s later | | | `*` | random resets, not group-specific |
| `…GROUP=geodetic` | 200 | 0.80 s | 1.1 kB | `*` | |
| `…GROUP=gps-ops` | 200 | 3.02 s | 2.6 kB | `*` | |
| `…GROUP=glonass-operational` | **200 text/plain** | 0.70 s | 102 B | `*` | `Invalid query: "GROUP=glonass-operational&FORMAT=json" (GROUP=glonass-operational not found)` → the feed's 5th group could never succeed, so a run that "stops at the first failure" never reached groups 6–12. |
| `…GROUP=glo-ops` | 200 | 1.15 s | 2.3 kB | `*` | 29 objects — the correct GLONASS group (now used). |
| `…GROUP=galileo` | 200 | 0.67 s | 2.4 kB | `*` | |
| `…GROUP=beidou` | reset (000, 11.12 s) | | | | |
| `…GROUP=beidou` (16:19Z) | 200 | — | — | `*` | 54 objects (BeiDou-2/-3) — the group name is valid; the 06:2x reset was the random sandbox reset. |
| `…GROUP=military` | 200 | 21.5 s | 1.9 kB | `*` | slow |
| `…GROUP=radar` | 200 | 21.4 s | 1.1 kB | `*` | slow |
| `…GROUP=weather` | reset ×2 (000, 11.2 s) | | | | |
| `…GROUP=resource` | 200 | 0.63 s | 13.8 kB | `*` | |
| `…GROUP=other-comm` | reset (000, 11.29 s) | | | | |
| `https://db.satnogs.org/api/tle/?format=json` | 200 | 1.79 s | 519 914 B | none | 1 679 items |
| `https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json` | 200 | 0.33 s | 405 B | `*` | Last-Modified 06:17:45Z |
| `https://services.swpc.noaa.gov/products/noaa-scales.json` | 200 | 0.51 s | 208 B | `*` | |

**Why the groups failed 0/12 after a restart (R2 minor 5):** from this network ~30 % of CelesTrak
requests are reset after ≈ 11 s (5 of 15 today, random groups, even at 15–20 s spacing), and the old
run stopped at the first failure and then waited for the next 2 h refresh. With no previous membership
after a restart, one reset on `stations` meant 0/12 for 2 h; and `glonass-operational` (wrong name)
failed deterministically. Fixes: `glo-ops`; per-group download times (a regular run only asks for
groups missing or > 12 h old); up to 2 failures per run; missing groups retried 20 min later by the
recovery loop and handed to the feed without a second `active` download.

**SatNOGS fallback:** CelesTrak is retried 20, 40, 80, then every 120 min while the fallback is
served (each try counts against the 12-error budget); the first good `active` download replaces the
fallback at once. Providers name the fallback `satnogs-fallback`, the newest failed CelesTrak attempt
replaces the snapshot's `celestrak` entry, the note gives the next attempt time, Cache-Control drops
to 300 s and the rail shows a `FALLBACK · SatNOGS DB TLEs, n objects` line.

**Payload:** `epoch` now travels as integer ms (`epochUnit: 'ms'`): ≈ 161 B/row on the live catalogue
(≈ 2.68 MB for 16 612 rows, 64 % of the 4 MB cap, was 71 %); 20k rows stay < 80 % and 24k < 100 % (route test).

## Re-probe 2026-10-02 00:20–00:29 UTC (Phase 3 round 6: all 12 groups)

Same honest UA, `curl -sS -m 40 --compressed`, `Origin: https://example.org`, one request per group
20 s apart (resets retried once, 45–60 s later; 6 errors in total, far under the 50 / 2 h firewall
limit). Object count = length of the OMM JSON array; newest `EPOCH` as served (zone-less UTC).

| Group | Status | Latency | Size (gzip) | CORS | Objects | Newest EPOCH / note |
|---|---|---|---|---|---|---|
| `stations` | 200 | 2.78 s | 9 295 B | `*` | 22 | 2026-10-01T14:41:22 (first row ISS (ZARYA)); max NORAD id 100 712 (6-digit) |
| `science` | 200 | 2.69 s | 19 037 B | `*` | 46 | 2026-10-02T03:42:59 — CXO's epoch is again ahead of the download (cf. `celestrak-future-epoch.json`) |
| `geodetic` | 200 | 0.75 s | 4 113 B | `*` | 10 | 2026-10-01T14:53:53 |
| `gps-ops` | reset (000, 12.29 s); retry reset (000, 11.33 s) | | | | | verified 200 on 2026-10-01 (3.02 s); the resets are this network's, not the group's |
| `glo-ops` | 200 | 1.44 s | 11 933 B | `*` | 29 | 2026-10-01T18:53:09 |
| `galileo` | 200 | 7.79 s | 13 257 B | `*` | 32 | 2026-10-01T12:16:36 |
| `beidou` | 200 | 4.99 s | 22 277 B | `*` | 54 | 2026-10-01T15:48:53 (first row BEIDOU-2 IGSO-1 (C06)) |
| `military` | 200 | 6.43 s | 10 169 B | `*` | 24 | 2026-10-01T15:38:21 |
| `radar` | 200 | 1.25 s | 4 212 B | `*` | 10 | 2026-10-01T15:39:11 |
| `weather` | reset (000, 11.27 s); retry reset (000, 12.43 s) | | | | | not reachable from the sandbox on either day; 72 rows tagged by the server run of 2026-10-01 |
| `resource` | 200 | 1.07 s | 69 615 B | `*` | 167 | 2026-10-01T18:51:16 |
| `other-comm` | reset (000, 12.31 s); retry reset (000, 12.32 s) | | | | | not reachable from the sandbox on either day; 30 rows tagged by the server run of 2026-10-01 |

9 of 12 answered 200 with OMM JSON today. `gps-ops` answered on 2026-10-01 and `science`/`beidou`
(reset on 2026-10-01) answer today; `weather` and `other-comm` were reset from the sandbox on both
days, so for those two the evidence is the server's tagged rows, not a sandbox probe. The feed's tolerance (≤ 2 failures per run, missing groups
retried 20 min later, per-group download times) covers exactly this.

**Client change recorded here (round 6):** satellites are drawn as mission glyphs (one deck.gl
IconLayer per category over a 6-glyph mask atlas rasterised at runtime). The worker now sorts the
drawn rows by category and posts `categoryOffsets`; `radii` became `sizes` (glyph px: 8, ISS 14,
selected 16). No upstream or payload change.

## Re-probe 2026-10-02 07:19 UTC (Phase 3 round 7: ISS provenance)

| URL | Status | Latency | CORS | Auth | Sample |
|---|---|---|---|---|---|
| `https://api.wheretheiss.at/v1/satellites/25544` | 200 | 0.48 s | `*` | none | lat −4.14, lng −167.63, alt 417.65 km, `timestamp` 1790925560 (computed-for instant). |
| `https://api.wheretheiss.at/v1/satellites/25544/tles` | 200 | 0.59 s | `*` | none | `{requested_timestamp, tle_timestamp: 1790800039, id: "25544", header: "ISS (ZARYA)", line1, line2}`; line 1 epoch `26273.85230731` = 2026-09-30T20:27:19.352Z (`tle_timestamp` is the same epoch, rounded to the second). |

wheretheiss.at's position is computed (SGP4) from that TLE, not observed. `/api/iss` now carries
`position: {method: 'propagated', by: 'wheretheiss.at', elementsEpoch}` (epoch parsed from line 1,
re-read hourly; null if `/tles` never answered, provider `wheretheiss-tles` in `providers`), and the
SPACE panel badges the readout COMPUTED (ageing to `COMPUTED · 2m`, then STALE/OFFLINE), never
LIVE. The upstream `timestamp` was up to 2 s after our receive time in round 7, so
`meta.observedAt` is clamped to the receive time (never after `fetchedAt`). Fixture:
`src/features/space/__fixtures__/wheretheiss-tles.json`. Rate cost: one extra request per hour
against the 350 / 5 min limit.

## Re-probe 2026-10-02 10:30 UTC (Phase 3 round 8: NASA embed readiness)

| URL | Status | Latency | Size | CORS / framing | Notes |
|---|---|---|---|---|---|
| `https://www.youtube-nocookie.com/embed/awQzjn72bI0?autoplay=0&mute=1&playsinline=1&rel=0&enablejsapi=1&origin=…` | 200 | 0.46 s | player shell | CSP `require-trusted-types-for 'script'`; no `X-Frame-Options` (embeddable) | Loads `/s/_/ytembeds/…/m=root,base` (embed client) and `/s/player/8ab5c328/player_embed.vflset/en_US/base.js`. |
| `https://www.youtube-nocookie.com/s/_/ytembeds/_/js/k=ytembeds.base.en_US…/m=root,base` | 200 | — | 558 543 B | — | The IFrame Player API lives here: on a JSON-string message `{"event":"listening","id",…}` it stores the sender's origin as its target and answers `initialDelivery` + `onReady` (or `alreadyInitialized` to a repeat), JSON strings with `channel: "widget"`. Messages are accepted only from `typeof data === "string"`. |

Why: Chrome fires the iframe `load` event for its own network-error page too, so `onLoad` cannot
mean "the player loaded" (round 8 MINOR). The SPACE panel embeds with `enablejsapi=1&origin=<page
origin>`, posts the "listening" handshake to `https://www.youtube-nocookie.com` only (an error page
never receives it), and shows the player only when that origin answers from that frame with
onReady / initialDelivery / infoDelivery / alreadyInitialized. No answer in 15 s = "did not load
here; open it on YouTube". Only the `event` name of a player message is read; nothing is rendered.
