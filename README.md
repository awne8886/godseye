# GODSEYE

A build kit for a "god's-eye" global intelligence monitor: a 1:1-or-better, open-source replica of
[osirisai.live](https://osirisai.live) (OSIRIS) with better visuals, honest data handling, and a new
**Flight Path Planner** that shows the planned path between any two airports (IATA/ICAO code or place
name) for generic routes and specific flights.

This repository currently contains the **specification and research pack**, not the application yet:

| Path | What it is |
|---|---|
| [`docs/OPUS_5_5_BUILD_PROMPT.md`](docs/OPUS_5_5_BUILD_PROMPT.md) | The complete build prompt for Claude Opus 5.5. It defines the parity target, pinned stack, architecture, verified data-source matrix, visual specification, the Flight Path Planner, quality gates, and a mandatory subagent orchestration plan. |
| [`docs/reference/00-INDEX.md`](docs/reference/00-INDEX.md) | Index of the research pack the prompt refers to: 27 dossiers produced on 2026-09-30 from the OSIRIS source (MIT), the live site, and live probes of every upstream API, including licences and breaking changes. |

## How to use

1. Open this repository in Claude Code with Opus 5.5 (for example `claude --model claude-opus-5-5`).
2. Paste the contents of `docs/OPUS_5_5_BUILD_PROMPT.md` as the first message, or ask Claude to read it
   and start at its section 13.
3. The prompt instructs Opus 5.5 to clone the OSIRIS reference repository read-only, run research and
   build subagents in parallel with strict file ownership, and drive lint, tests, visual QA and
   Lighthouse to green before declaring completion.

## Provenance and licensing

The reference dossiers describe [`simplifaisoul/osiris`](https://github.com/simplifaisoul/osiris)
(MIT, © 2026 simplifaisoul) and publicly documented third-party services. They are research notes to be
re-verified at build time, not instructions. GODSEYE itself is MIT-licensed and must not reuse OSIRIS
branding, links or promotions (see prompt §0).
