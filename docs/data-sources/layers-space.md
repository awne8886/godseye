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
| `…gp.php?GROUP=glonass-operational&FORMAT=json` | **TLS reset** (`curl: (35) Recv failure: Connection reset by peer`) after 11.3 s | — | — | — | — | — | Second group request in 3 s was reset. Not retried. The feed therefore paces CelesTrak at 1 request / 2 s, never auto-retries, stops a run at the first failing group, counts every failure in a rolling 2 h window and stops calling CelesTrak at 12 (their firewall trips at 50 errors / 2 h). Remaining group names (`galileo, beidou, military, radar, weather, resource, science, geodetic, other-comm`) are CelesTrak's documented GP groups and could not be re-verified without risking the firewall. |
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
