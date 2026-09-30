## design-system-hud

The HUD calls no external upstream. It reads only local routes, all through react-query. It never
invents a value: when a route answers 404 or 503, the HUD shows "—" or nothing, never an estimate.

Probed 2026-09-30 against a local production build (`pnpm build && pnpm start`, zero keys):

| Route | Owner | Status | Latency | Used for | Behaviour when unavailable |
|---|---|---|---|---|---|
| `GET /api/health` | lead | 200 | 4 ms | Capabilities (hide gated layers/tools/AI providers), STATUS (CONNECTING/OFFLINE), `defaultLayersFor()` | STATUS: OFFLINE; only keyless layers listed |
| `GET /api/space-weather` | layers-space | 404 (not merged yet) | — | Telemetry SOLAR (GOES X-ray class) and KP | "SOLAR —", "KP —"; tooltip "Space weather feed unavailable" |
| `GET /api/ticker` | panels-alerts-markets-dossier-graph | 404 (not merged yet) | — | Status-bar ticker (quotes and M4+ quakes, each with its own observedAt) | Falls back to Intel Feed events already on the client, else "NO EVENTS RECEIVED YET" |
| `GET /api/geo/reverse?lat=&lng=` | panels-recon | 404 (not merged yet) | — | Cursor readout place name (3 s debounce, 0.1° cache cell) | Coordinates only; after a failure, retries are paused for 5 min |

`/api/health` shape with zero keys: keys `status, version, uptimeS, capabilities (41), feeds,
geocoder, store, timestamp`. Enabled with zero keys: `ai_user_keys`, `nc_sources`, `openmeteo`.
`feeds` is `{}` until feature builders register their feeds.

Fonts were not changed: the HUD uses the lead's `next/font` variables, so no font host was probed.
Browser storage keys: `godseye:theme` (preset id, read by the pre-paint boot script),
`godseye:style-studio` (sanitised Style Studio edits) and `godseye:settings` (lead's store). All
three stay in the visitor's browser and are never sent to the server.
