/**
 * d3: automations — automation tools, DB seeding, and all AutomationKind values.
 *
 * Covers:
 *   - automation_dryRun is deprecated (stub verifies its response text)
 *   - automation_propose + automation_save creates a persistent DB row
 *   - All 6 AutomationKind values can be inserted directly via SQL
 *   - The automations table has the expected schema columns
 */

import { test, expect } from '@playwright/test'
import { withStub, stubPath, sendChatMessage } from './harness/withStub'
import { dumpState } from './harness/artifacts'

const ALL_AUTOMATION_KINDS = ['cron', 'heartbeat', 'hook', 'standing_order', 'task_flow', 'webhook'] as const

test('d3: automation_dryRun returns deprecated notice via stub', async () => {
  const { wos, db } = await withStub({ scriptPath: stubPath('dry-run.json') })
  try {
    await sendChatMessage(wos.window, 'Run a dry run automation')
    // The stub scripts the agent to call automation_dryRun and then text "deprecated".
    await expect(wos.window.getByText(/automation_dryRun tool is deprecated/i)).toBeVisible({ timeout: 30_000 })

    // No automation row should have been created by a dry run.
    const rows = await db.queryAll<{ id: string }>(
      `SELECT id FROM automations WHERE name = 'Test Cron'`,
    )
    expect(rows).toHaveLength(0)

    await dumpState(wos.window, wos, 'd3-dryrun')
  } finally {
    db.close()
    await wos.close()
  }
})

test('d3: automation_propose + automation_save creates a DB row', async () => {
  const { wos, db } = await withStub({ scriptPath: stubPath('propose-save.json') })
  try {
    await sendChatMessage(wos.window, 'Create a daily cron automation')
    // Wait for the final text reply.
    await expect(wos.window.getByText(/Automation saved successfully!/i)).toBeVisible({ timeout: 30_000 })

    // Verify the automation row was created.
    const row = await db.queryOne<{
      id: string
      kind: string
      name: string
      enabled: number
    }>(`SELECT id, kind, name, enabled FROM automations WHERE name = 'Stub Automation' LIMIT 1`)

    expect(row).toBeDefined()
    expect(row!.kind).toBe('cron')
    expect(row!.name).toBe('Stub Automation')
    expect(row!.enabled).toBeTruthy()

    await dumpState(wos.window, wos, 'd3-propose-save')
  } finally {
    db.close()
    await wos.close()
  }
})

test('d3: all AutomationKind values can be inserted directly into DB', async () => {
  const { wos, db } = await withStub({ scriptPath: stubPath('simple-reply.json') })
  try {
    const now = new Date().toISOString()

    for (const kind of ALL_AUTOMATION_KINDS) {
      const config = getDefaultConfig(kind)
      await db.queryAll(`
        INSERT OR REPLACE INTO automations
          (id, kind, name, description, enabled, prompt, toolsAllow, config, resultDelivery, createdAt, updatedAt)
        VALUES
          ('e2e-${kind}', '${kind}', 'E2E ${kind} test', 'Inserted by E2E', 1, 'Do ${kind} stuff', '[]', '${JSON.stringify(config)}', 'silent', '${now}', '${now}')
      `)
    }

    // Verify all were inserted.
    const rows = await db.queryAll<{ kind: string; name: string }>(
      `SELECT kind, name FROM automations WHERE id LIKE 'e2e-%' ORDER BY kind`,
    )
    expect(rows).toHaveLength(ALL_AUTOMATION_KINDS.length)

    const kinds = rows.map((r) => r.kind).sort()
    expect(kinds).toEqual([...ALL_AUTOMATION_KINDS].sort())
  } finally {
    db.close()
    await wos.close()
  }
})

test('d3: automations table has expected schema columns', async () => {
  const { wos, db } = await withStub({ scriptPath: stubPath('simple-reply.json') })
  try {
    const cols = await db.queryAll<{ name: string }>(
      `SELECT name FROM pragma_table_info('automations') ORDER BY name`,
    )
    const colNames = cols.map((c) => c.name)
    for (const col of ['id', 'kind', 'name', 'enabled', 'prompt', 'toolsAllow', 'config', 'resultDelivery', 'createdAt', 'updatedAt']) {
      expect(colNames).toContain(col)
    }
  } finally {
    db.close()
    await wos.close()
  }
})

test.skip('d3: cron automation fires after system clock advance [TODO: requires time mock]', async () => {
  // TODO: Advancing the system clock to trigger a cron is flaky in CI.
  // Use vitest's fake timers or a mock scheduler when available.
})

// --- helpers ---

function getDefaultConfig(kind: (typeof ALL_AUTOMATION_KINDS)[number]): Record<string, unknown> {
  switch (kind) {
    case 'cron':        return { schedule: '0 9 * * *' }
    case 'heartbeat':   return { intervalSec: 60 }
    case 'hook':        return { event: 'app:connected' }
    case 'standing_order': return { rule: 'Always greet the user politely.' }
    case 'task_flow':   return { steps: [{ name: 'Step 1', prompt: 'Do step 1.' }] }
    case 'webhook':     return {}
  }
}
