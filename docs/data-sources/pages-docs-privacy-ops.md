# pages-docs-privacy-ops — link and licence verification

pages-docs-privacy-ops wires no upstream. This log records every external URL that the README, the
architecture notes, the licence summary in `docs/DATA_SOURCES.md`, the Docker files and the CI workflow
link to or depend on. Probed on 2026-09-30 between 18:15 and 18:25 UTC from the build sandbox with
`curl -sS -L -A 'GODSEYE/0.1.0 (+https://github.com/awne8886/godseye; contact https://github.com/awne8886/godseye/issues)'`.
CORS is not relevant for documentation links and was not recorded.

## Licence and terms pages (linked from the licence summary)

| URL | Status | Latency | What the page says (verified text) |
|---|---|---|---|
| `https://www.openstreetmap.org/copyright` | 200 | 0.80 s | ODbL; "© OpenStreetMap contributors" |
| `https://operations.osmfoundation.org/policies/nominatim/` | 200 | 0.71 s | "an absolute maximum of 1 request per second"; identifying User-Agent or Referer required |
| `https://openfreemap.org/` | 200 | 0.19 s | Attribution "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" |
| `https://www.esri.com/en-us/legal/terms/full-master-agreement` | 200 (redirects to `/legal/terms/master-agreement`) | 0.36 s | Esri Master Agreement; World Imagery attribution string taken from the MapServer JSON below |
| `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=json` | 200 | 0.19 s | service metadata (copyrightText) |
| `https://nasa-gibs.github.io/gibs-api-docs/` | 200 | 0.20 s | "Data Use Guidance and Acknowledgements … We ask that users who make use of GIBS …" |
| `https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api` | 200 | 0.51 s | GIBS API overview |
| `https://github.com/tilezen/joerd/blob/master/docs/attribution.md` | 403 in sandbox | 0.11 s | github.com web pages are blocked by the sandbox egress proxy; repository verified with `git ls-remote` (HEAD 0b86765156d0) |
| `https://www.adsb.lol/privacy-license/` | 200 | 0.95 s | page body is script-rendered; ODbL wording taken from the research pack (`docs/reference/21-*`, contract §6) |
| `https://opensky-network.org/about/terms-of-use` | 403 | 0.47 s | bot protection refuses curl; licence requirement taken from the research pack |
| `https://github.com/adsbfi/opendata` | 403 in sandbox | 0.12 s | sandbox proxy; repository verified with `git ls-remote` (HEAD 9fe1c9ae1bf7) |
| `https://github.com/vradarserver/standing-data` | 403 in sandbox | 0.32 s | sandbox proxy; repository verified with `git ls-remote` (HEAD 8e6d87eae84c) |
| `https://ourairports.com/data/` | 200 | 0.59 s | "All data is released to the Public Domain" |
| `https://openflights.org/data.php` | 200 | 0.36 s | "made available under the Open Database License"; route data "ceased providing updates in June 2014" |
| `https://celestrak.org/usage-policy.php` | 200 | 1.10 s | "only download data once per update. For GP data, updates are once every 2 hours" |
| `https://open-meteo.com/en/terms` | 200 | 0.47 s | Free API "for non-commercial use": < 10 000 calls/day, 5 000/hour |
| `https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits` | 200 | 1.62 s | USGS-authored data "in the U.S. Public Domain" |
| `https://gpsjam.org/faq` | 200 | 0.61 s | no licence, copyright or attribution terms anywhere in the text: licence unstated |
| `https://www.gdeltproject.org/about.html` | 200 (redirects to `gdeltproject.org`) | 0.64 s | "available for unlimited and unrestricted use for any academic, commercial, or governmental use" |
| `https://deepstatemap.live/license-en.html` | 200 | 0.53 s | "Entities operating on a commercial basis may use the API only with prior approval" |
| `https://abuse.ch/terms-of-use/` | 200 | 0.34 s | "Authenticated Users may access the Platforms for not-for-profit purposes"; volumes "reasonably expected for non-commercial or non-profit purposes" |
| `https://ip-api.com/docs/legal` | 200 | 0.23 s | "The use of the API is strictly limited for a non-commercial purpose" |
| `https://internetdb.shodan.io/` | 404 | 0.39 s | API root has no page; `/docs` (200) states no licence terms; non-commercial wording from the research pack |
| `https://internetdb.shodan.io/docs` | 200 | — | OpenAPI docs only |
| `https://www.opensanctions.org/licensing/` | 200 | 0.54 s | "licensed under the terms of Creative Commons 4.0 Attribution NonCommercial" |
| `https://radar.cloudflare.com/about` | 403 | 0.18 s | bot protection |
| `https://developers.cloudflare.com/radar/` | 200 | — | "Data available via Radar API endpoints is made available under the CC BY-NC 4.0 license" |
| `https://www.submarinecablemap.com/` | 200 | 0.28 s | script-rendered; CC BY-NC-SA 3.0 confirmed only by secondary sources (research pack) |
| `https://creativecommons.org/licenses/by-nc-sa/3.0/` | 200 | 0.22 s | licence text |
| `https://creativecommons.org/licenses/by-nc/4.0/` | 200 | 0.22 s | licence text |
| `https://creativecommons.org/licenses/by/4.0/` | 200 | 0.20 s | licence text |
| `https://opendatacommons.org/licenses/odbl/` | 200 | 0.38 s | licence text |
| `https://www.naturalearthdata.com/about/terms-of-use/` | 200 | 0.52 s | "in the public domain" |
| `https://www.wikidata.org/wiki/Wikidata:Licensing` | 200 | 0.16 s | structured data CC0 |
| `https://www.rainviewer.com/api.html` | 200 | 0.38 s | "You must display credit" (attribution required) |
| `https://telegram.org/tos` | 200 | 0.67 s | general terms |
| `https://telegram.org/tos/content-licensing` | 200 | — | "prohibits the scraping … or use of data obtained from its platform to train … artificial intelligence, machine learning models" |
| `https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service` | 403 | 0.33 s | bot protection; terms per the research pack |
| `https://ipwho.is/` | 200 | 0.14 s | provider home page |
| `https://www.xposedornot.com/api_doc` | 200 (redirects to `xposedornot.com`) | 0.49 s | provider home page |

## Deployment, hosting and tooling references

| URL | Status | Latency | Finding |
|---|---|---|---|
| `https://caddyserver.com/docs/caddyfile/directives/reverse_proxy` | 200 | 0.59 s | reverse_proxy "sets or augments the X-Forwarded-For header"; GODSEYE overwrites it with `header_up X-Forwarded-For {remote_host}` |
| `https://caddyserver.com/docs/caddyfile/directives/log` | 200 | 0.46 s | `log` "Enables and configures HTTP request logging (also known as access logs)": none without the directive |
| `https://vercel.com/docs/functions/limitations` | 200 | 0.50 s | 4.5 MB body limit (dossier 31) |
| `https://vercel.com/docs/functions/configuring-functions/duration` | 200 | 0.65 s | max duration per plan (dossier 31) |
| `https://vercel.com/docs/plans/hobby` | 200 | 0.42 s | Hobby is non-commercial (dossier 31) |
| `https://nextjs.org/docs/app/guides/self-hosting` | 200 | 0.28 s | streaming behind a proxy, multi-instance caching |
| `https://nodejs.org/api/typescript.html` | 200 | 0.48 s | `--experimental-transform-types` used by `tools/ts-loader.mjs` |
| `https://pnpm.io/cli/audit` | 200 | 0.55 s | `pnpm audit --prod --audit-level high` |
| `https://hub.docker.com/v2/repositories/library/node/tags/22-alpine` | 200 | 0.19 s | last updated 2026-09-23, digest `sha256:0a7108bf6c7b…` |
| `https://hub.docker.com/v2/repositories/library/caddy/tags/2-alpine` | 200 | 0.17 s | last updated 2026-09-23, digest `sha256:6aeddd44c307…` |
| `https://hub.docker.com/v2/repositories/library/redis/tags/8-alpine` | 200 | 0.18 s | last updated 2026-09-24, digest `sha256:3811787313eb…` |
| `https://github.com/simplifaisoul/osiris` | 403 in sandbox | 0.16 s | verified with `git ls-remote` (HEAD d972d9af5c6f) |
| `https://github.com/awne8886/godseye` | — | — | verified with `git ls-remote` (HEAD 8c54965da900) |

## GitHub Actions pinned in `.github/workflows/ci.yml`

github.com web pages and the REST API are blocked in the sandbox (403 / "GitHub access to this
repository is not enabled for this session"); tags were resolved with `git ls-remote --tags` on
2026-09-30 and pinned by commit SHA.

| Action | Latest tag | Commit |
|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.0.0 | `820762786026740c76f36085b0efc47a31fe5020` |
| `pnpm/action-setup` | v6.1.0 | `ea17c68df8912ef543352723c149a84f56e3d413` |
| `actions/upload-artifact` | v7.0.1 | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| `GoogleChrome/lighthouse-ci` | (not used as an action; `@lhci/cli` runs from devDependencies) | HEAD `ebee453dad3f` |

## Licence links added to the licence summary (probed 2026-09-30 22:42–22:56 UTC)

Same honest User-Agent; `curl -I -L` (HEAD), falling back to GET where HEAD is refused. CORS not relevant.

| URL | Status | Latency | What the page says (verified text) |
|---|---|---|---|
| `https://db.satnogs.org/about/` | 200 | 0.99 s | names a Creative Commons licence for the DB; CC BY-SA 4.0 per the layers-space probe log |
| `https://creativecommons.org/licenses/by-sa/4.0/` | 200 | 0.25 s | licence text |
| `https://en.wikipedia.org/wiki/Wikipedia:Copyrights` | 200 | 0.17 s | text under "Creative Commons Attribution-ShareAlike 4.0 International License" |
| `https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use` | 200 | 0.22 s | Wikimedia terms of use |
| `https://www.earthdata.nasa.gov/data/tools/firms` | 200 | 0.80 s | "We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) …" |
| `https://firms.modaps.eosdis.nasa.gov/` | 200 | 0.38 s | FIRMS home |
| `https://www.earthdata.nasa.gov/engage/open-data-services-software/data-use-guidance` | 404 | 1.03 s | dead; not linked |
| `https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice` | 200 | 0.54 s | PDF; text not extracted |
| `https://dataspace.copernicus.eu/terms-and-conditions` | 200 | 1.14 s | CDSE terms |
| `https://www.gdacs.org/About/termofuse.aspx` | 200 | 0.53 s | "this information is purely indicative and should not be used for any decision making without alternate sources of information" |
| `https://drmkc.jrc.ec.europa.eu/inform-index` | 200 | 1.09 s | INFORM home; CC BY 4.0 per the layers-threats-network probe log |
| `https://datacatalog.worldbank.org/public-licenses` | HEAD 404, GET 200 | 0.41 s | "Creative Commons Attribution 4.0 International license (CC-BY 4.0)" is the default for its datasets |
| `https://www.worldbank.org/en/about/legal/terms-of-use-for-datasets` | 200 (redirects to `/ext/en/legal/terms-conditions`) | 0.45 s | general terms |
| `https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html` | 200 | 0.38 s | "You may not in connection with the Services engage in commercial activity on non-commercial properties or apps or high volume activity without our prior written consent" |
| `https://libre.space/licenses/` | 200 (redirects to `www.libre.space/`) | 1.04 s | home page, no licence text; not linked |

## Container images pinned in the Dockerfile and CI (resolved 2026-09-30)

| Image | Digest | How resolved |
|---|---|---|
| `node:22-alpine` | `sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402` | `registry-1.docker.io` manifest HEAD (multi-arch index), 22:53 UTC |
| `mcr.microsoft.com/playwright:v1.63.0-noble` | `sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27` | `mcr.microsoft.com` manifest HEAD, 22:56 UTC |
| `caddy:2-alpine`, `redis:8-alpine` | not pinned | Docker Hub answered 429 (anonymous pull-rate limit) from the sandbox; compose comments say how to pin |
