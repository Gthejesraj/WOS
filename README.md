# WOS

WOS is a desktop AI agent. It runs a Cursor-inspired chat UI on top of a
React/Electron renderer and an agentic loop in the main process. WOS is
extensible through three surfaces:

- **Apps** — first-class integrations (Slack today) stored encrypted in SQLite.
- **MCP servers** — any Model Context Protocol server (stdio, HTTP, SSE).
- **Skills & Rules** — Claude-style `SKILL.md` packs and Cursor-compatible rule
  files that shape the agent's behaviour.

## Quick start

```bash
npm install
npm run dev         # launches Electron with HMR
npm run lint        # tsc --noEmit
npm run test        # vitest unit tests
npm run test:e2e    # Playwright integration tests (requires a build)
```

Set an API key under **Settings → API Keys**. OpenAI and Anthropic are
supported; models are fetched from each provider's `/models` endpoint and
cached locally.

## `~/.wos/` layout

WOS keeps all user-editable configuration under your home directory so it is
portable and easy to back up. This directory is separate from the Electron
`userData` directory (which stores the SQLite database, logs, and encrypted
credential material).

```
~/.wos/
├── apps/
│   └── <appId>/config.json        # optional per-app metadata (enabled, scopes)
├── mcp.json                       # canonical list of MCP servers (mirror of DB)
├── skills/
│   └── <skillId>/
│       ├── SKILL.md               # frontmatter + markdown body
│       ├── resources/             # files the skill can pull in (optional)
│       └── scripts/               # executable scripts referenced by the skill
└── rules/
    └── <ruleId>.md                # user-level rules with frontmatter
```

### Skills (`~/.wos/skills/<id>/SKILL.md`)

```markdown
---
name: Create PowerPoint decks
description: Generate editable .pptx slide decks from an outline.
triggers:
  - pptx
  - slide deck
  - presentation
---

# Create PowerPoint decks

Step 1: Use `python-pptx`...
```

On boot (and on demand from **Settings → Skills → Rescan**) WOS walks this
directory, parses frontmatter, and adds each skill to the system prompt as a
compact index. The agent calls the built-in `ReadSkill` tool with the skill's
id to pull the full body when it decides the skill is relevant.

### Rules

Rules come from two places and are merged in this order:

1. User rules: `~/.wos/rules/*.md`
2. Workspace rules: `<workspacePath>/.cursor/rules/*.mdc` (Cursor-compatible)

Supported frontmatter:

```yaml
---
name: Always prefer TypeScript
description: Prefer TypeScript over JavaScript.
alwaysApply: true          # inlined into every system prompt
globs: ["**/*.ts", "**/*.tsx"]  # attach on demand when matching files are touched
---
```

- `alwaysApply: true` rules are inlined into the system prompt.
- Glob-scoped rules surface a one-line hint; the agent can call `ReadRule(id)`
  when it needs the full body.

### Apps

Built-in apps (e.g. Slack) are connected from the **Apps → Marketplace** tab.
Tokens are encrypted with a machine-derived AES-256 key (see
[`electron/main/crypto.ts`](electron/main/crypto.ts)) before being persisted.
Dynamic tool registration means newly connected apps become available to the
agent without restarting WOS.

### MCP servers

Add a server from **Apps → Marketplace → MCP server** or the **Installed MCP**
tab. Supported transports:

- `stdio` — spawn a local process (`command` + `args` + `env`).
- `http` — JSON-RPC over HTTP with streaming support.
- `sse` — JSON-RPC over Server-Sent Events.

WOS mirrors the DB into `~/.wos/mcp.json` so the configuration survives
migrations and is easy to inspect. Tools exposed by an MCP server are exposed
to the agent under the prefix `mcp__<serverId>__<toolName>` and are subject to
the standard permission rules.

## Projects

The **Projects** tab (sidebar entry between **Apps** and **Meetings**) gives
each work effort a single home. A project links resources from connected
apps — Slack channels, GitHub repos, Jira projects, Gmail labels, Drive
folders, MCP resources — plus WOS-native objects (meeting recordings,
workspace files, saved chats, notes, custom URLs) and aggregates them into
a live dashboard.

Key behaviours:
- **Resource catalogue is fully dynamic.** The picker is built from each
  connected `AppModule`'s `projectResourceTypes()` capability — connecting
  a new app instantly adds new linkable resource kinds without code
  changes.
- **Smart-cadence refresh.** A background loop polls each linked resource
  on its per-kind interval (Slack ~5–10min, GitHub/Jira ~15–30min, Drive/
  Docs ~1h) by invoking the app's `fetcher` and normalising the result
  into a deduped `project_activity` feed.
- **AI summaries on demand.** The detail view's Overview tab can
  regenerate executive summaries (`status`, `daily`, `weekly`, `standup`)
  using the user's default model, with a per-project model override.
- **Health + risk signals.** A computed health score and risk level are
  shown on each gallery card and in the hero header.
- **Main-chat integration.** A `projects` subagent is registered; the
  main WOS agent delegates project-scoped questions to it via the
  `Task` tool with `preset: "projects"`. Read-only tools
  (`wos_projects_list`, `wos_projects_find`, `wos_projects_get`,
  `wos_projects_activity`, `wos_projects_summary`,
  `wos_projects_health`, etc.) are available to both agents.
- **Static export.** Projects can be exported as a self-contained HTML
  status page (no external assets) for handoff or sharing.

## Testing

### Unit tests (vitest)

```bash
npm test           # rebuilds better-sqlite3 for Node, runs vitest
```

### Visual E2E harness (Playwright)

The harness in `e2e/` launches the real Electron app under Playwright control
with a hermetic `userData` dir, captured main + renderer logs, and a DB query
helper that runs queries inside the live main process (no ABI mismatch).

```bash
npm run e2e:build   # one-time: produces .vite/{build,renderer}
npm run e2e:smoke   # boot → window → DB sanity check (~1s)
npm run e2e:live    # opens Playwright Inspector — drive the app interactively
npm run e2e:trace   # records video + trace under e2e/scratch/
```

Each `e2e:*` script has a `pre` hook that rebuilds `better-sqlite3` against
Electron's Node ABI; running `npm test` first rebuilds it against the host
Node ABI, so always run e2e via `npm run e2e:smoke` (not directly via
`playwright test`) to keep the binding correct.

Inside a spec, the `wos`, `harnessDb`, and `dump` fixtures are available:

```ts
test('example', async ({ wos, harnessDb, dump }) => {
  await wos.window.click('text=Settings')
  const rows = await harnessDb.queryAll("SELECT * FROM workspaces")
  await dump('after-settings-open')   // screenshot + DOM + logs to e2e/scratch
})
```

Live LLM-backed flows are gated behind `WOS_E2E_LIVE=1`.
