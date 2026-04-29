import { eq, and } from 'drizzle-orm'
import { getDb, schema } from '../db'

// Returns the system-prompt fragment for active standing orders.
// Empty string when no orders are enabled.
export function buildStandingOrdersFragment(scope: { workspaceId?: string | null; conversationId?: string | null } = {}): string {
  try {
    const db = getDb()
    const rows = db.select().from(schema.standingOrders).where(eq(schema.standingOrders.enabled, true)).all()
    if (!rows.length) return ''
    const matches = rows.filter((r) => {
      if (!r.scope || r.scope === 'global') return true
      if (scope.conversationId && r.scope === scope.conversationId) return true
      if (scope.workspaceId && r.scope === scope.workspaceId) return true
      return false
    })
    if (!matches.length) return ''
    const lines: string[] = ['', '## Standing Orders', '']
    for (const o of matches) {
      lines.push(`### ${o.name}`)
      lines.push(o.body.trim())
      lines.push('')
    }
    return lines.join('\n')
  } catch {
    return ''
  }
}

// Resume any tasks left in 'running' or 'queued' state from a prior session by
// marking them cancelled. The scheduler/hook bus will create fresh runs.
export function resumeOrCancelStrandedTasks(): void {
  try {
    const db = getDb()
    const now = new Date()
    db.update(schema.tasks)
      .set({ status: 'cancelled', updatedAt: now })
      .where(and(eq(schema.tasks.status, 'running')))
      .run()
  } catch {
    /* ignore */
  }
}
