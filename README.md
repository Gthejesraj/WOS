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

## Testing

The Playwright suite lives in `tests/e2e/`. Build first (so the `.vite/build`
directory exists), then run:

```bash
npx electron-forge package
npm run test:e2e
```

Tests that require a real LLM call are gated behind `WOS_E2E_LIVE=1`.
