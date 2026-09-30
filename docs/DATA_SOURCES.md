# GODSEYE data sources — probe log and licences

Every upstream is probed with `curl` from the build machine before it is wired (contract §0.4), with
the honest User-Agent `GODSEYE/<version> (+https://github.com/awne8886/godseye; contact …)`.
Each agent keeps its own log in `docs/data-sources/<agent>.md` (columns: URL · HTTP status · latency ·
CORS · auth · licence / attribution · notes); pages-docs-privacy-ops compiles them into this file with
the licence summary. Until then, see the per-agent files:

- [lead](data-sources/lead.md)
