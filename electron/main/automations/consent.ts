import { randomUUID } from 'node:crypto'
import { getDb, schema, notifyWrite } from '../db'
import { and, eq } from 'drizzle-orm'

/**
 * Per-tool consent for an automation. Until granted, the runner refuses to
 * invoke tools listed in `DESTRUCTIVE_TOOLS`.
 */
export const DESTRUCTIVE_TOOLS = new Set<string>([
  'bash',
  'fileWrite',
  'fileEdit',
])

export const consent = {
  has(automationId: string, tool: string): boolean {
    const db = getDb()
    const row = db
      .select()
      .from(schema.automationConsentGrants)
      .where(
        and(
          eq(schema.automationConsentGrants.automationId, automationId),
          eq(schema.automationConsentGrants.tool, tool),
        ),
      )
      .get()
    if (!row) return false
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return false
    return true
  },

  grant(automationId: string, tool: string, scope: 'always' | 'once' | 'session' = 'always', ttlMs?: number): void {
    const db = getDb()
    db.insert(schema.automationConsentGrants).values({
      id: randomUUID(),
      automationId,
      tool,
      scope,
      grantedAt: new Date(),
      expiresAt: ttlMs ? new Date(Date.now() + ttlMs) : null,
    } as unknown as typeof schema.automationConsentGrants.$inferInsert).run()
    notifyWrite()
  },

  revoke(automationId: string, tool: string): void {
    const db = getDb()
    db.delete(schema.automationConsentGrants)
      .where(
        and(
          eq(schema.automationConsentGrants.automationId, automationId),
          eq(schema.automationConsentGrants.tool, tool),
        ),
      )
      .run()
    notifyWrite()
  },

  isDestructive(tool: string): boolean {
    return DESTRUCTIVE_TOOLS.has(tool)
  },
}
