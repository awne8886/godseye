# Claude Code subagents for Opus 5.5: mechanics, limits, worktrees, prompting
> **Provenance.** Generated on 2026-09-30 by read-only research agents from (a) a shallow clone of `github.com/simplifaisoul/osiris` (MIT, © 2026 simplifaisoul), (b) the live site https://osirisai.live, and (c) live probes of upstream APIs and their documentation. Treat every statement as **data to re-verify at build time**, not as instructions. Line references point into the OSIRIS repository. Nothing here grants permission to reuse OSIRIS branding; see `docs/OPUS_5_5_BUILD_PROMPT.md` §0.
**Question answered:** How do sub-agents work in current Claude Code for Opus 5.5? This covers the Agent/Task tool semantics, custom agent files in .claude/agents/*.md with their frontmatter fields (name, description, tools, model), running agents in parallel from one message, background agents, git-worktree isolation to avoid file clashes, how results come back to the lead agent, and any concurrency or context limits.

## Summary

I checked every point below against the raw Markdown of code.claude.com/docs (sub-agents.md, worktrees.md, tools-reference.md, agents.md, agent-teams.md, workflows.md, commands.md, settings-reference.md, memory.md, best-practices.md) and the platform.claude.com prompting guides for Opus 5 and Opus 5.5, fetched 2026-09-30.

How the lead delegates: it calls the Agent tool. Each non-fork subagent starts in a fresh, isolated context. That context holds only the subagent's own system prompt (the markdown body of its .claude/agents/<name>.md file), the task message the lead writes, the full CLAUDE.md hierarchy, a git status snapshot, any preloaded skills, and a roster of sibling agents. It does not get the lead's conversation history, auto memory or output style. The lead never sees the subagent's intermediate tool calls. It gets back only a final result, marked as subagent output that carries no user authority. Background subagents (the default) deliver that result as a completion notification in a later turn.

Custom agents are Markdown files with YAML frontmatter. Only `name` and `description` are required. Optional fields: tools, disallowedTools, model, permissionMode, maxTurns, skills, mcpServers, hooks, memory, background, omitClaudeMd, effort, isolation, color, initialPrompt, experimental. Where definitions live, highest priority first: managed settings, the --agents CLI JSON, .claude/agents/, ~/.claude/agents/, a plugin's agents/ folder. Files are hot-reloaded, except that the first file in a newly created agents directory needs a restart. The `/agents` wizard was removed in v2.1.198, so agent files are written by hand or by asking Claude.

Limits:
- **Concurrency:** 20 subagents running at once by default (CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS). Past that, spawning fails with "Concurrent subagent limit reached". There is no cap on the total spawned over a session.
- **Nesting:** 3 levels deep by default (CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH).
- **Web searches:** 200 per session, shared across all agents.
- **Agent descriptions:** a startup warning appears if all custom descriptions together exceed 15,000 tokens.
- **Context:** each subagent's context window is sized by its own model, and subagents auto-compact.

Fork mode is on by default in interactive sessions. It forces every subagent into the background, and Claude can no longer ask for the foreground.

Worktree isolation: set `isolation: worktree` in frontmatter, or pass `isolation` on a single Agent call. The subagent then works in a temporary git worktree under .claude/worktrees/, and git commands that target the main checkout are blocked. The worktree is removed automatically if the agent made no changes; if it did, the worktree stays on disk. Important catch: the worktree branches from the remote default branch (worktree.baseRef "fresh") unless you set worktree.baseRef "head". Even then it only contains committed HEAD, so the lead must commit the scaffold before it fans out. The docs don't say how the lead gets a worktree agent's branch back or merges it. The prompt should require each worker to commit and report its branch and commit SHA, and the lead merges them with git.

Opus 5.5 guidance on platform.claude.com: it sustains multi-hour runs with parallel subagents, and it responds to time budgets such as "elapsed Ns / budget". The Opus 5 guide warns that Opus models delegate too readily, so the prompt should say when delegation is and isn't warranted. For fan-out within one message, Anthropic publishes a sample `<use_parallel_tool_calls>` prompt block.

## Findings

### 0. What a subagent is and how its result comes back (verified)

Each subagent runs in its own context window with its own system prompt, tool access and permissions, and returns only a summary. From the Agent tool docs: 'The subagent works through its task autonomously, then returns its result to the parent conversation. The parent doesn't see the subagent's intermediate tool calls or outputs, only that final result.' The report arrives 'under a header marking it as subagent output' that says instructions inside it carry no user authority. Claude Code scans the output first, adding a backslash to anything that imitates harness tags and prepending a '[harness: subagent output matched instruction-shaped pattern(s):' line when needed. Subagent requests count toward the same usage limits as the main session.

Source: https://code.claude.com/docs/en/tools-reference.md

### 1. Where custom agent files live, and their priority (verified)

Priority from highest to lowest: 1 managed settings, 2 the `--agents` CLI JSON (session only), 3 `.claude/agents/` (project; every such directory from the cwd up to the repo root is scanned, and the closest wins), 4 `~/.claude/agents/` (user), 5 a plugin's `agents/` folder (named `plugin:agent`). Directories are scanned recursively, and subfolders don't affect names. Duplicate names inside one directory give an undefined winner. Files are hot-reloaded within seconds, except: the first file in a newly created agents directory needs a restart, `--add-dir` directories aren't watched, and `--disable-slash-commands` turns watching off. `/agents` stopped opening the creation wizard in v2.1.198; you ask Claude to write the file or edit it yourself. `claude plugin validate .claude/agents` checks the YAML.

Source: https://code.claude.com/docs/en/sub-agents.md

### 2. Frontmatter fields (verified)

Only `name` and `description` are required. Field names are camelCase, and unknown fields are silently ignored.
- `name`: unique; no ':' and cannot start with '-'. The filename doesn't need to match.
- `description`: when Claude should delegate to this agent.
- `tools`: comma string or YAML list. Omit it to inherit every tool available to subagents.
- `disallowedTools`: removed from the set; wins over `tools`.
- `model`: `sonnet`, `opus`, `haiku`, `fable`, a full ID such as `claude-opus-5-5`, or `inherit`.
- `permissionMode`: default, acceptEdits, auto, dontAsk, bypassPermissions, plan, or manual.
- `maxTurns`: output is marked partial when reached, and the agent can be resumed.
- `skills`: full skill content is preloaded.
- `mcpServers`, `hooks`: ignored for plugin agents.
- `memory`: user, project or local.
- `background`: true keeps the agent in the background.
- `omitClaudeMd`: true skips user, project and local CLAUDE.md (v2.1.271+).
- `effort`: low, medium, high, xhigh or max.
- `isolation`: worktree.
- `color`: red, blue, green, yellow, purple, orange, pink or cyan.
- `initialPrompt`, `experimental.cacheTtl`: 5m or 1h.
The markdown body becomes the agent's system prompt; it does not get the Claude Code system prompt. Example from the docs: ---\nname: code-reviewer\ndescription: Reviews code for quality and best practices\ntools: Read, Glob, Grep\nmodel: sonnet\n---\n<system prompt>

Source: https://code.claude.com/docs/en/sub-agents.md

### 3. How a subagent's model is chosen (verified)

Order: (1) the per-invocation `model` parameter on the Agent call, (2) the frontmatter `model` (`inherit` means the main model), (3) the CLAUDE_CODE_SUBAGENT_MODEL env var, (4) the main conversation's model. If the alias `opus` is requested while the main session runs an Opus model, the subagent gets the main model's exact ID, including any [1m] suffix. CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 forces one model for all subagents. Subagents inherit the main session's extended-thinking setting (v2.1.198+). `/tasks` shows each subagent's model and effort.

Source: https://code.claude.com/docs/en/sub-agents.md

### 4. Built-in subagent types (verified)

- **Explore:** read-only (Write and Edit denied). Inherits the main model, capped at Opus on the Claude API. Skips CLAUDE.md and git status. Takes a thoroughness level: quick, medium or very thorough. One-shot, so it can't be resumed.
- **Plan:** read-only; used in plan mode; one-shot.
- **general-purpose:** has every tool available to subagents; for tasks that mix exploring and editing.
- **Others:** `claude` (catch-all), `statusline-setup`, `claude-code-guide`.
An Agent call with no `subagent_type` falls back to general-purpose. If no general-purpose agent exists, the call fails with 'subagent_type is required'.

Source: https://code.claude.com/docs/en/sub-agents.md

### 5. Tool availability inside subagents (verified)

Removed from every subagent: AskUserQuestion, EnterPlanMode, EndConversation, ScheduleWakeup, WaitForMcpServers and Workflow; ExitPlanMode (unless the agent's permissionMode is plan); and Agent once the depth limit is reached. Background subagents (the default) keep all MCP tools but only these built-ins: Read, Grep, Glob, LSP, Bash, PowerShell, Edit, Write, NotebookEdit, WebFetch, WebSearch, TodoWrite, Skill, ToolSearch, EnterWorktree, ExitWorktree, Monitor, TaskStop, SendMessage and Artifact. Forks get the parent's exact tool pool. A `tools` list that resolves to nothing fails with 'Agent would be spawned with zero tools'.

Source: https://code.claude.com/docs/en/sub-agents.md

### 6. Foreground vs background, and fork mode (verified)

Foreground subagents block the lead. Background subagents run concurrently and raise their permission prompts in the main session; Esc denies that one call. How the mode is chosen:
- An agent-team teammate's subagent runs in the foreground.
- CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 forces the foreground.
- With fork mode on, which is the default in interactive sessions (v2.1.232+), every spawned subagent runs in the background and the `run_in_background` parameter is removed.
- With fork mode off (the default for `-p` and the Agent SDK), Claude picks the background by default and the foreground when it needs the result.
Ctrl+B backgrounds a running task. A background agent's result 'reach[es] Claude as a completion notification in a later turn', and Claude waits for it before reporting. `/tasks` lists running and finished subagents. A fork (`/subtask`, or Agent type `fork`) inherits the full conversation and shares the parent's prompt cache, and only its final result returns. A fork can take `isolation: "worktree"` but cannot spawn further forks.

Source: https://code.claude.com/docs/en/sub-agents.md

### 7. Running several agents in parallel (verified)

From the sub-agents doc: 'For independent investigations, spawn multiple subagents to work simultaneously', for example: 'Research the authentication, database, and API modules in parallel using separate subagents'. Claude then combines the findings. The doc warns that 'Running many subagents that each return detailed results can consume significant context.' Anthropic's prompting guide gives a `<use_parallel_tool_calls>` block: 'If you intend to call multiple tools and there are no dependencies between the tool calls, make all of the independent tool calls in parallel ... if some tool calls depend on previous calls ... call them sequentially. Never use placeholders or guess missing parameters.' The idea of issuing several Agent calls in one assistant message comes from this general guidance. The Claude Code docs don't name it as a single-message mechanism.

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices.md

### 8. Concurrency, nesting and other limits (verified)

- **Concurrent:** 20 running subagents by default, set with CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS (v2.1.217+). The error is 'Concurrent subagent limit reached', and the lead is told not to retry. There's no cap on the session total. Resumes and `/subtask` forks take slots without checking the limit. Ultracode sessions are exempt.
- **Nesting:** up to 3 levels below main by default, set with CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH (1 disables nesting). At the limit the Agent tool is withheld. In interactive sessions a subagent waits for the background subagents it launched before it finishes.
- **Web searches:** 200 per session across all agents (CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION).
- **Descriptions:** a startup warning if all custom agent descriptions together exceed 15,000 tokens.
- **Context and transcripts:** a subagent's window is sized by its own model, and subagents auto-compact. Transcripts are stored at ~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl.

Source: https://code.claude.com/docs/en/sub-agents.md

### 9. Worktree isolation for parallel editing (verified)

`isolation: worktree` in frontmatter, or `isolation` passed on the Agent call, gives the subagent 'an isolated copy of the repository branched by default from your default branch rather than the parent session's HEAD'. The worktree is removed automatically if nothing changed. If there are changes it stays on disk until a sweep after cleanupPeriodDays. Worktrees go under `.claude/worktrees/` (add that to .gitignore). Claude Code blocks Bash commands whose working directory or git target resolves to the main checkout, and holds a `git worktree lock` while the agent runs. `worktree.baseRef`: "fresh" (the default) branches from origin/<default-branch>; "head" branches from local HEAD, including unpushed commits. With no remote, it falls back to local HEAD. `.worktreeinclude` in the repo root copies gitignored files such as .env into new worktrees. `worktree.symlinkDirectories: ["node_modules"]` avoids reinstalling dependencies in each worktree. Example agent from the docs: ---\nname: refactorer\ndescription: Applies mechanical refactors across many files\nisolation: worktree\n---. For separate sessions: `claude --worktree <name>` creates `.claude/worktrees/<name>/` on branch `worktree-<name>`, and the repo needs at least one commit.

Source: https://code.claude.com/docs/en/worktrees.md

### 10. Resuming subagents and messaging them (verified)

Every invocation starts a new instance. A completed subagent returns an agent ID (Explore and Plan don't). Claude resumes it with SendMessage (to = the ID or a name), and the full history is kept; this doesn't need agent teams. Setting `name` on the Agent call makes a subagent addressable. If agent teams are enabled, a named spawn becomes a teammate unless the call is a fork or passes `isolation`. Messages from the launching agent count as task direction, but no agent message counts as user approval or can change permissions, CLAUDE.md or config.

Source: https://code.claude.com/docs/en/sub-agents.md

### 11. Other parallel mechanisms (verified)

- **Agent teams:** experimental. Enable with CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1; interactive sessions only. They use a shared task list and direct messaging between teammates, and do NOT isolate teammates in worktrees. The docs say: 'Two teammates editing the same file leads to overwrites. Break the work so each teammate owns a different set of files.'
- **Dynamic workflows:** a JS script that runs dozens to hundreds of agents. Triggered by the keyword `ultracode` or by asking for 'a workflow'; `/workflows` shows progress.
- **`/batch <instruction>`:** a bundled skill that splits a change into 5 to 30 units, one background subagent per unit, each in its own worktree.
- **`/code-review`:** reviews the diff in a fresh subagent.

Source: https://code.claude.com/docs/en/agents.md

### 12. CLAUDE.md conventions for a multi-agent build (verified)

CLAUDE.md can live at ./CLAUDE.md or ./.claude/CLAUDE.md (project), ~/.claude/CLAUDE.md (user), or ./CLAUDE.local.md (gitignored). All of them are concatenated, from the root down. Keep each file under about 200 lines. `@path` imports work up to 4 hops deep. `.claude/rules/*.md` files with `paths:` globs load only when matching files are read. Non-fork subagents load the full CLAUDE.md hierarchy; Explore and Plan and agents with `omitClaudeMd` don't. The main session's auto memory isn't loaded into subagents. The docs advise: 'If a rule must [reach the subagent] ... restate it in the prompt you give Claude when delegating.' CLAUDE.md is guidance, not enforcement; use hooks or permissions for hard rules. The project-root CLAUDE.md survives /compact.

Source: https://code.claude.com/docs/en/memory.md

### 13. Prompting guidance for Opus 5.5 and Opus 5 (verified)

- **Opus 5.5 capabilities:** 'sustains long-running autonomous work ... multi-hour audits and migrations ... with parallel subagents and little oversight'. The default effort is `medium`.
- **Unattended runs:** Opus 5.5 may end a turn with a text-only status update. The guide says to keep a checklist in a to-do tool or file, and: 'If something the model started is still running, such as a background command or a subagent, don't treat the task as done yet.'
- **Time signals:** in a lead-plus-subagents setup, appending 'elapsed Ns / budgetNs' to each message improves parallelization. Without a budget, add: 'Time matters here: do not spend time that can be avoided...'
- **Opus 5 delegation:** it 'delegates to subagents more readily than prior models'. Suggested damping text: 'Delegate to a subagent only for large tasks that are genuinely independent and parallelizable ... do not use subagents to verify or double-check your own work.' The Opus 5 guide also says it has 'few cases of agents overwriting each other's work'.
- **Best-practices doc:** use a fresh-context reviewer subagent, and tell it to 'flag only gaps that affect correctness or the stated requirements'.

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5.md

## Recommendations

- Have the prompt tell Opus 5.5 to write project agent files in `.claude/agents/` before any fan-out. Each needs YAML frontmatter with at least `name` and `description` (both required), plus `tools`, `model` (`opus`/`inherit`, or `sonnet` for cheap workers), `isolation: worktree` for builders, and `color`. Suggested roster for an OSIRIS clone: `map-engine` (MapLibre globe, 2D/3D/night/satellite, layers), `data-feeds` (Next.js /api routes: ADS-B, TLE, USGS, FIRMS, EONET, GDELT, maritime), `osint-tools` (/api/osint/* routes and the RECON panel), `flight-path` (airport-code lookup and great-circle or filed-route rendering), `ui-hud` (gold/black HUD, panels, keyboard shortcuts), plus read-only `researcher` (tools: Read, Grep, Glob, WebFetch, WebSearch) and `reviewer` agents (tools: Read, Grep, Glob, Bash; no Edit or Write).
- Tell the lead to set up the repo before spawning builders: init git, create the Next.js scaffold, write shared contracts (types/, the layer registry, the API response envelope, design tokens), write CLAUDE.md, then COMMIT. Also set `"worktree": {"baseRef": "head", "symlinkDirectories": ["node_modules"]}` in .claude/settings.json. Worktree agents branch from origin's default branch (or committed HEAD with baseRef head), so they can't see uncommitted scaffolding. Add `.claude/worktrees/` to .gitignore and a `.worktreeinclude` listing `.env.local`.
- Give each builder exclusive file ownership, listed by directory glob in its task message (e.g. map-engine owns src/components/map/** and src/lib/map/**; data-feeds owns src/app/api/feeds/**). Shared files (package.json, layer registry, root layout, CLAUDE.md) belong only to the lead. Workers that need a change there should ask for it in their final report instead of editing.
- To make the fan-out parallel, the prompt should tell the lead to issue all independent Agent calls in a SINGLE assistant message, and quote Anthropic's `<use_parallel_tool_calls>` block. Keep concurrent agents well under the default cap of 20 (6 to 10 builders is reasonable). Don't rely on deep nesting (default depth 3).
- Specify the report contract for each worker: under about 300 words, listing files created or changed, the branch name and last commit SHA of its worktree, commands run with pass/fail (typecheck, lint, build), env vars or keys needed, and open issues. The lead then merges each branch (`git merge <branch>`), resolves conflicts, and runs `npm run build` and typecheck after each merge. The docs don't describe automatic merge-back, so the workers must commit.
- Restate critical rules in every delegation message, because subagents don't see the lead's conversation: the tech stack, design tokens (#D4AF37 on #06060C, monospace), the rule of keyless public APIs with optional env keys, the no-mock-data rule, and file ownership. Keep CLAUDE.md under about 200 lines. Put path-scoped conventions in `.claude/rules/*.md` with `paths:` frontmatter.
- Tell the lead to wait for every background subagent's completion notification before claiming a phase is done. Keep a checklist (TODO.md or the task tool) and don't end a turn with open items. The Opus 5.5 guide flags text-only early stops and running subagents as the main failure mode on long unattended runs.
- Add a verification phase: after merging, spawn a fresh-context `reviewer` subagent, or run `/code-review`, against the spec and the diff. Tell it to flag only correctness or requirement gaps. Also run a headless or visual check of the globe and the flight-path feature.
- Add a delegation-damping line from Anthropic's Opus 5 guidance, so the lead doesn't spawn agents for small edits: 'Delegate only large, genuinely independent, parallelizable tracks; do small edits yourself.' Mention that CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS and CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH are the hard caps if the user wants them.
- Optionally mention the alternatives: `/batch <instruction>` (5 to 30 worktree-isolated subagents), `ultracode` dynamic workflows for very large fan-outs, and agent teams (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1, no worktree isolation, so strict file ownership is needed). The main plan should still use plain subagents, because they are the stable, documented path.

## Gaps (not verified)

- The exact Agent tool input schema isn't published as a table. The docs mention `subagent_type`, `name`, `model`, `isolation` and `run_in_background` in prose; I assumed parameters beyond those (description, prompt) from context — UNVERIFIED.
- The docs don't say whether a worktree-isolated subagent's result automatically includes its worktree path or branch name, or how a subagent worktree's branch is named (for `--worktree` sessions it is `worktree-<name>`) — UNVERIFIED. Having each worker report its branch and SHA explicitly works around this.
- There is no published automatic merge-back of subagent worktree changes into the lead's checkout. The lead has to merge the branches with git.
- The Claude Code docs don't state that several Agent calls in one assistant message run concurrently. This relies on general parallel tool-calling guidance plus the background-by-default behavior (UNVERIFIED as a single-message guarantee).
- How much of this applies when Opus 5.5 runs in the Claude Code web/cloud environment rather than a local CLI (worktree support, fork mode defaults) was not checked.
- Exact per-subagent context window sizes for Opus 5.5 (e.g. whether [1m] is available) were not checked.
