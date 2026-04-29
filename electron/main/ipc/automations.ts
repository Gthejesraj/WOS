import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { eq, desc } from 'drizzle-orm'
import { getDb, schema, notifyWrite } from '../db'

type ScheduledJobInput = {
  id?: string
  name: string
  cronExpr?: string | null
  runAt?: number | null
  tz?: string
  target: string
  prompt: string
  enabled?: boolean
  deleteAfterRun?: boolean
}

type HookInput = {
  id?: string
  name: string
  event: string
  type: 'skill' | 'prompt' | 'tool'
  config: Record<string, unknown>
  enabled?: boolean
}

type StandingOrderInput = {
  id?: string
  name: string
  body: string
  scope?: string
  triggersJson?: unknown
  approvalsJson?: unknown
  enabled?: boolean
}

export function registerAutomationsHandlers() {
  // ----- Scheduled jobs -----
  ipcMain.handle('automations:scheduled:list', () => {
    const db = getDb()
    return db.select().from(schema.scheduledJobs).orderBy(desc(schema.scheduledJobs.createdAt)).all()
  })

  ipcMain.handle('automations:scheduled:upsert', async (_e, job: ScheduledJobInput) => {
    if (!job?.name || !job?.target || !job?.prompt) {
      return { ok: false, error: 'name, target, and prompt are required' }
    }
    const db = getDb()
    const now = new Date()
    if (job.id) {
      db.update(schema.scheduledJobs).set({
        name: job.name,
        cronExpr: job.cronExpr ?? null,
        runAt: job.runAt ? new Date(job.runAt) : null,
        tz: job.tz ?? 'local',
        target: job.target,
        prompt: job.prompt,
        enabled: job.enabled ?? true,
        deleteAfterRun: job.deleteAfterRun ?? false,
        updatedAt: now,
      }).where(eq(schema.scheduledJobs.id, job.id)).run()
      notifyWrite()
      return { ok: true, id: job.id }
    }
    const id = randomUUID()
    db.insert(schema.scheduledJobs).values({
      id,
      name: job.name,
      cronExpr: job.cronExpr ?? null,
      runAt: job.runAt ? new Date(job.runAt) : null,
      tz: job.tz ?? 'local',
      target: job.target,
      prompt: job.prompt,
      enabled: job.enabled ?? true,
      deleteAfterRun: job.deleteAfterRun ?? false,
      createdAt: now,
      updatedAt: now,
    }).run()
    notifyWrite()
    return { ok: true, id }
  })

  ipcMain.handle('automations:scheduled:delete', async (_e, { id }: { id: string }) => {
    const db = getDb()
    db.delete(schema.scheduledJobs).where(eq(schema.scheduledJobs.id, id)).run()
    notifyWrite()
    return { ok: true }
  })

  ipcMain.handle('automations:scheduled:run-now', async () => {
    // Wired by the scheduler runner in the next workstream.
    return { ok: false, error: 'Scheduler runner not yet implemented' }
  })

  ipcMain.handle('automations:scheduled:runs', (_e, { jobId }: { jobId?: string }) => {
    const db = getDb()
    const q = db.select().from(schema.scheduledRuns)
    const rows = jobId
      ? q.where(eq(schema.scheduledRuns.jobId, jobId)).orderBy(desc(schema.scheduledRuns.startedAt)).all()
      : q.orderBy(desc(schema.scheduledRuns.startedAt)).all()
    return rows
  })

  // ----- Hooks -----
  ipcMain.handle('automations:hooks:list', () => {
    const db = getDb()
    return db.select().from(schema.hooks).orderBy(desc(schema.hooks.createdAt)).all()
  })

  ipcMain.handle('automations:hooks:upsert', async (_e, hook: HookInput) => {
    if (!hook?.name || !hook?.event || !hook?.type) {
      return { ok: false, error: 'name, event, and type are required' }
    }
    const db = getDb()
    const now = new Date()
    if (hook.id) {
      db.update(schema.hooks).set({
        name: hook.name,
        event: hook.event,
        type: hook.type,
        config: hook.config ?? {},
        enabled: hook.enabled ?? true,
        updatedAt: now,
      }).where(eq(schema.hooks.id, hook.id)).run()
      notifyWrite()
      return { ok: true, id: hook.id }
    }
    const id = randomUUID()
    db.insert(schema.hooks).values({
      id,
      name: hook.name,
      event: hook.event,
      type: hook.type,
      config: hook.config ?? {},
      enabled: hook.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    }).run()
    notifyWrite()
    return { ok: true, id }
  })

  ipcMain.handle('automations:hooks:delete', async (_e, { id }: { id: string }) => {
    const db = getDb()
    db.delete(schema.hooks).where(eq(schema.hooks.id, id)).run()
    notifyWrite()
    return { ok: true }
  })

  ipcMain.handle('automations:hooks:runs', (_e, { hookId }: { hookId?: string }) => {
    const db = getDb()
    const q = db.select().from(schema.hookRuns)
    const rows = hookId
      ? q.where(eq(schema.hookRuns.hookId, hookId)).orderBy(desc(schema.hookRuns.firedAt)).all()
      : q.orderBy(desc(schema.hookRuns.firedAt)).all()
    return rows
  })

  // ----- Standing Orders -----
  ipcMain.handle('automations:standing:list', () => {
    const db = getDb()
    return db.select().from(schema.standingOrders).orderBy(desc(schema.standingOrders.createdAt)).all()
  })

  ipcMain.handle('automations:standing:upsert', async (_e, order: StandingOrderInput) => {
    if (!order?.name || !order?.body) {
      return { ok: false, error: 'name and body are required' }
    }
    const db = getDb()
    const now = new Date()
    if (order.id) {
      db.update(schema.standingOrders).set({
        name: order.name,
        body: order.body,
        scope: order.scope ?? 'global',
        triggersJson: order.triggersJson ?? null,
        approvalsJson: order.approvalsJson ?? null,
        enabled: order.enabled ?? true,
        updatedAt: now,
      }).where(eq(schema.standingOrders.id, order.id)).run()
      notifyWrite()
      return { ok: true, id: order.id }
    }
    const id = randomUUID()
    db.insert(schema.standingOrders).values({
      id,
      name: order.name,
      body: order.body,
      scope: order.scope ?? 'global',
      triggersJson: order.triggersJson ?? null,
      approvalsJson: order.approvalsJson ?? null,
      enabled: order.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    }).run()
    notifyWrite()
    return { ok: true, id }
  })

  ipcMain.handle('automations:standing:delete', async (_e, { id }: { id: string }) => {
    const db = getDb()
    db.delete(schema.standingOrders).where(eq(schema.standingOrders.id, id)).run()
    notifyWrite()
    return { ok: true }
  })

  // ----- Tasks ledger -----
  ipcMain.handle('automations:tasks:list', (_e, filter: { status?: string; type?: string }) => {
    const db = getDb()
    let q = db.select().from(schema.tasks).$dynamic()
    if (filter?.status) q = q.where(eq(schema.tasks.status, filter.status))
    if (filter?.type) q = q.where(eq(schema.tasks.type, filter.type))
    return q.orderBy(desc(schema.tasks.createdAt)).all()
  })

  ipcMain.handle('automations:tasks:steps', (_e, { taskId }: { taskId: string }) => {
    const db = getDb()
    return db.select().from(schema.taskSteps).where(eq(schema.taskSteps.taskId, taskId)).orderBy(schema.taskSteps.idx).all()
  })

  // ----- Natural-language authoring -----
  // Wired in workstream 3.7. Returns a structured "not yet implemented" so the UI
  // can show a helpful empty-state confirm card instead of crashing.
  ipcMain.handle('automations:author', async (_e, { kind }: { kind: string; prompt: string }) => {
    return { ok: false, error: `NL authoring for "${kind}" is not yet implemented` }
  })
}
