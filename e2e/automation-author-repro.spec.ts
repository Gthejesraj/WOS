/**
 * d5: automation-author-repro — verify the automation author agent never requests kind:'form'.
 *
 * This spec reproduces the original regression: the automation author was incorrectly
 * using ask_user with kind:'form', which should be explicitly prohibited.
 *
 * Covers:
 *   - Structural: DEFAULT_AUTOMATION_AUTHOR_SYSTEM_PROMPT contains "NEVER use `kind: 'form'`"
 *   - Structural: allowed ask_user kinds are picker, choice, text, confirm, fileDrop
 *   - E2E: an automation-author-like flow (via stub) does not produce any message block
 *     that encodes a 'form' ask_user call
 */

import { test, expect } from '@playwright/test'
// Import the system prompt directly to test its content without running the app.
import { DEFAULT_AUTOMATION_AUTHOR_SYSTEM_PROMPT } from '../electron/main/agent/agentDefs/automationAuthor'
import { withStub, stubPath, sendChatMessage } from './harness/withStub'
import { dumpState } from './harness/artifacts'

// --- Structural tests (no app launch needed) ---

test('d5 structural: system prompt explicitly prohibits kind: form', () => {
  // The regression was that the agent used ask_user({ kind: 'form' }).
  // The system prompt must explicitly say "NEVER use `kind: 'form'`".
  expect(DEFAULT_AUTOMATION_AUTHOR_SYSTEM_PROMPT).toContain("NEVER use `kind: 'form'`")
})

test('d5 structural: system prompt lists allowed ask_user kinds', () => {
  const prompt = DEFAULT_AUTOMATION_AUTHOR_SYSTEM_PROMPT
  // picker, choice, and text are the allowed kinds per the system prompt.
  expect(prompt).toContain("kind: 'picker'")
  expect(prompt).toContain("kind: 'choice'")
  expect(prompt).toContain("kind: 'text'")
})

test('d5 structural: system prompt instructs to use confirm for previews', () => {
  // The agent should use kind:'confirm' to present automation proposals, not kind:'form'.
  expect(DEFAULT_AUTOMATION_AUTHOR_SYSTEM_PROMPT).toContain("kind: 'confirm'")
})

// --- E2E tests (app launch required) ---

test('d5 e2e: automation-author flow stub produces no form ask_user blocks in DB', async () => {
  const { wos, db } = await withStub({ scriptPath: stubPath('automation-author-flow.json') })
  try {
    await sendChatMessage(wos.window, 'Create a Slack notification automation')
    // Wait for the stub's final reply.
    await expect(
      wos.window.getByText(/automation author subagent completed/i),
    ).toBeVisible({ timeout: 60_000 })

    // Check that no message block in the DB is an ask_user with kind:'form'.
    const msgs = await db.queryAll<{ role: string; blocks: string }>(
      `SELECT role, blocks FROM messages ORDER BY createdAt ASC`,
    )

    for (const msg of msgs) {
      let blocks: unknown[]
      try {
        blocks = JSON.parse(msg.blocks) as unknown[]
      } catch {
        continue
      }
      for (const block of blocks) {
        if (typeof block !== 'object' || block === null) continue
        const b = block as Record<string, unknown>
        // The regression: an ask_user tool result block with kind:'form' in its content.
        if (b.type === 'tool_result' && typeof b.content === 'string') {
          expect(b.content).not.toMatch(/"kind"\s*:\s*"form"/)
        }
        // Also check tool_use blocks themselves.
        if (b.type === 'tool_use' && b.name === 'ask_user') {
          const input = b.input as Record<string, unknown> | undefined
          expect(input?.kind).not.toBe('form')
        }
      }
    }

    await dumpState(wos.window, wos, 'd5-no-form-ask-user')
  } finally {
    db.close()
    await wos.close()
  }
})

test.skip('d5 e2e: full multi-turn automation-author flow with real stub [TODO: wire up ask_user response]', async () => {
  // TODO: The automation author makes real ask_user calls that block waiting for user input.
  // To fully test the multi-turn flow, implement a mechanism to intercept the onAskUser IPC
  // event from the test runner and send a synthetic response.
  // See electron/main/ipc/agent.ts for the ask_user response channel.
})
