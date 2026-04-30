import { randomUUID } from 'node:crypto'
import { getDb, schema, notifyWrite } from '../db'
import { eq, desc } from 'drizzle-orm'

export type AutomationKind =
  | 'cron'
  | 'heartbeat'
  | 'hook'
  | 'standing_order'
  | 'task_flow'
  | 'webhook'

export type ResultDelivery = 'silent' | 'notify' | 'chat' | 'external'

export interface AutomationRow {
  id: string
  kind: AutomationKind
  name: string
  description: string | null
  enabled: boolean
  prompt: string
  toolsAllow: string[]
  config: Record<string, unknown>
  resultDelivery: ResultDelivery
  resultTarget: string | null
  owner: string | null
  createdAt: Date
  updatedAt: Date
  lastRunAt: Date | null
  nextRunAt: Date | null
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback
  if (typeof value !== 'string') return value as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function rowFromDb(r: typeof schema.automations.$inferSelect): AutomationRow {
  return {
    id: r.id,
    kind: r.kind as AutomationKind,
    name: r.name,
    description: r.description ?? null,
    enabled: !!r.enabled,
    prompt: r.prompt ?? '',
    toolsAllow: parseJson<string[]>(r.toolsAllow as unknown, []),
    config: parseJson<Record<string, unknown>>(r.config as unknown, {}),
    resultDelivery: (r.resultDelivery as ResultDelivery) || 'silent',
    resultTarget: r.resultTarget ?? null,
    owner: r.owner ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    lastRunAt: r.lastRunAt ?? null,
    nextRunAt: r.nextRunAt ?? null,
  }
}

export interface AutomationInput {
  id?: string
  kind: AutomationKind
  name: string
  description?: string | null
  enabled?: boolean
  prompt?: string
  toolsAllow?: string[]
  config?: Record<string, unknown>
  resultDelivery?: ResultDelivery
  resultTarget?: string | null
  owner?: string | null
}

export const registry = {
  list(filter?: { kind?: AutomationKind; enabled?: boolean }): AutomationRow[] {
    const db = getDb()
    let rows = db.select().from(schema.automations).orderBy(desc(schema.automations.updatedAt)).all()
    if (filter?.kind) rows = rows.filter(r => r.kind === filter.kind)
    if (typeof filter?.enabled === 'boolean') rows = rows.filter(r => !!r.enabled === filter.enabled)
    return rows.map(rowFromDb)
  },

  get(id: string): AutomationRow | null {
    const db = getDb()
    const r = db.select().from(schema.automations).where(eq(schema.automations.id, id)).get()
    return r ? rowFromDb(r) : null
  },

  upsert(input: AutomationInput): AutomationRow {
    const db = getDb()
    const now = new Date()
    const id = input.id ?? randomUUID()
    const existing = db.select().from(schema.automations).where(eq(schema.automations.id, id)).get()

    const values = {
      id,
      kind: input.kind,
      name: input.name,
      description: input.description ?? null,
      enabled: input.enabled ?? true,
      prompt: input.prompt ?? '',
      toolsAllow: JSON.stringify(input.toolsAllow ?? []),
      config: JSON.stringify(input.config ?? {}),
      resultDelivery: input.resultDelivery ?? 'silent',
      resultTarget: input.resultTarget ?? null,
      owner: input.owner ?? null,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    }

    if (existing) {
      db.update(schema.automations)
        .set(values as unknown as Partial<typeof schema.automations.$inferInsert>)
        .where(eq(schema.automations.id, id))
        .run()
    } else {
      db.insert(schema.automations).values(values as unknown as typeof schema.automations.$inferInsert).run()
    }
    notifyWrite()
    return this.get(id)!
  },

  toggle(id: string, enabled: boolean): AutomationRow | null {
    const db = getDb()
    db.update(schema.automations)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(schema.automations.id, id))
      .run()
    notifyWrite()
    return this.get(id)
  },

  setNextRun(id: string, when: Date | null): void {
    const db = getDb()
    db.update(schema.automations)
      .set({ nextRunAt: when, updatedAt: new Date() })
      .where(eq(schema.automations.id, id))
      .run()
    notifyWrite()
  },

  setLastRun(id: string, when: Date): void {
    const db = getDb()
    db.update(schema.automations)
      .set({ lastRunAt: when, updatedAt: new Date() })
      .where(eq(schema.automations.id, id))
      .run()
    notifyWrite()
  },

  delete(id: string): void {
    const db = getDb()
    db.delete(schema.automations).where(eq(schema.automations.id, id)).run()
    // FK ON DELETE CASCADE handles per-kind rows.
    notifyWrite()
  },
}
