import { randomUUID } from 'node:crypto'
import { getDb, schema, notifyWrite } from '../db'
import { eq, desc } from 'drizzle-orm'

export interface LedgerEntry {
  id: string
  automationId: string | null
  runId: string | null
  kind: string
  payload: unknown
  status: 'open' | 'done' | 'cancelled'
  createdAt: Date
  completedAt: Date | null
}

export const ledger = {
  add(kind: string, payload: unknown, opts?: { automationId?: string; runId?: string }): string {
    const db = getDb()
    const id = randomUUID()
    db.insert(schema.automationTasksLedger).values({
      id,
      automationId: opts?.automationId ?? null,
      runId: opts?.runId ?? null,
      kind,
      payload: JSON.stringify(payload ?? null),
      status: 'open',
      createdAt: new Date(),
    } as unknown as typeof schema.automationTasksLedger.$inferInsert).run()
    notifyWrite()
    return id
  },

  complete(id: string, status: 'done' | 'cancelled' = 'done'): void {
    const db = getDb()
    db.update(schema.automationTasksLedger)
      .set({ status, completedAt: new Date() })
      .where(eq(schema.automationTasksLedger.id, id))
      .run()
    notifyWrite()
  },

  list(filter?: { status?: 'open' | 'done' | 'cancelled'; automationId?: string }, limit = 200): LedgerEntry[] {
    const db = getDb()
    let rows = db.select().from(schema.automationTasksLedger).orderBy(desc(schema.automationTasksLedger.createdAt)).limit(limit).all()
    if (filter?.status) rows = rows.filter(r => r.status === filter.status)
    if (filter?.automationId) rows = rows.filter(r => r.automationId === filter.automationId)
    return rows.map(r => ({
      id: r.id,
      automationId: r.automationId ?? null,
      runId: r.runId ?? null,
      kind: r.kind,
      payload: typeof r.payload === 'string' ? safeParse(r.payload) : r.payload,
      status: r.status as 'open' | 'done' | 'cancelled',
      createdAt: r.createdAt,
      completedAt: r.completedAt ?? null,
    }))
  },
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}
