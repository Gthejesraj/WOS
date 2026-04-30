# WOS E2E Tests

End-to-end tests for the WOS Electron app, powered by Playwright + a deterministic agent stub.

## Quick start

```bash
# Build native module for Electron (runs automatically before each e2e script)
npm run e2e:full
```

Individual suites:

```bash
# Smoke test (boot + basic DB check)
npm run e2e:smoke

# Full Phase D suite
npm run e2e:full
```

## Stub mechanism

Real LLM calls are replaced by a **deterministic agent script** when the env var
`WOS_E2E_AGENT_SCRIPT` is set to the path of a JSON file.

### Script format

```json
{
  "turns": [
    [
      { "type": "text_delta", "content": "Hello from stub!" },
      { "type": "message_stop", "stopReason": "end_turn", "usage": { "inputTokens": 0, "outputTokens": 0 } }
    ]
  ]
}
```

Each element of `turns` is a list of `StreamEvent` objects that are yielded as a single
"LLM response". Turns are consumed globally in order across the entire process lifetime —
including subagent `queryLoop()` calls.

**Turn ordering with subagents:**
1. Turn 0 — parent LLM call (typically includes a `tool_use_start` for `Task`)
2. Turn 1 — the subagent's LLM call (the Task tool calls `queryLoop()` internally)
3. Turn 2 — parent's follow-up LLM call after the subagent completes

> **Warning:** Do not script concurrent `Task` calls. Two subagents racing over the shared
> turn counter will interleave unpredictably.

### Tool execution is real

When the stub scripts a `tool_use_start` event, the tool **actually executes** in the main
process. This means:

- `automation_save` will create a real DB row.
- `automation_dryRun` returns its (deprecated) result.
- **Do not** script `ask_user` — it blocks waiting for a UI response.

### Stub JSON files

Pre-built stubs live in `e2e/scripts/stubs/`:

| File | Description |
|---|---|
| `simple-reply.json` | Single text reply — "Hello from WOS stub!" |
| `dry-run.json` | Calls `automation_dryRun`, then replies "deprecated" |
| `propose-save.json` | Calls `automation_propose` → `automation_save` → "Saved!" |
| `subagent-dispatch.json` | Parent dispatches a `Task`, subagent replies, parent confirms |
| `automation-author-flow.json` | Stub for automation author flow (no real ask_user) |

## Test suites

| File | Tag | What it covers |
|---|---|---|
| `boot-chat.spec.ts` | d1 | App boot, stub reply, DB persistence, conversation history |
| `apps-context.spec.ts` | d2 | `app_context_snapshots` seeding and round-trip |
| `automations.spec.ts` | d3 | `automation_dryRun`, `automation_propose+save`, all `AutomationKind` values |
| `subagents.spec.ts` | d4 | `/subagents list/kill` slash commands, `subagent_runs` seeding |
| `automation-author-repro.spec.ts` | d5 | System-prompt regression: `NEVER use kind: 'form'` |

## Artifacts

| Path | Contents |
|---|---|
| `e2e/.artifacts/test-results/` | Playwright traces, videos, screenshots |
| `e2e/.artifacts/html-report/` | Playwright HTML report |
| `e2e/scratch/` | Per-run state dumps, harness scratch space |

Open the HTML report after a run:
```bash
npx playwright show-report e2e/.artifacts/html-report
```

## Environment variables

| Variable | Description |
|---|---|
| `WOS_E2E=1` | Set automatically by the harness — enables `__wos_db` bridge and skips single-instance lock |
| `WOS_E2E_AGENT_SCRIPT=<path>` | Path to a stub JSON file; bypasses real LLM calls |
| `WOS_USER_DATA=<dir>` | Override the Electron userData directory |
| `WOS_E2E_VERBOSE=1` | Forward Electron main-process logs to the test runner stdout |

## Writing new stub tests

```ts
import { withStub, stubPath, sendChatMessage } from './harness/withStub'

test('my test', async () => {
  const { wos, db } = await withStub({ scriptPath: stubPath('simple-reply.json') })
  try {
    await sendChatMessage(wos.window, 'Hello!')
    await expect(wos.window.getByText('Hello from WOS stub!')).toBeVisible()
  } finally {
    db.close()
    await wos.close()
  }
})
```

## Skipped tests

Tests marked `test.skip` have a `TODO` comment explaining the blocker. Common blockers:

- **Clock mocking** — cron triggers require advancing time (`d3`)
- **OAuth flow** — app context picker requires a mock app connection (`d2`)
- **Multi-turn ask_user** — requires intercepting the `onAskUser` IPC event (`d5`)
