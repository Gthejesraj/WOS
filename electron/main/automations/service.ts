/**
 * Shared automations service.
 *
 * DB-level CRUD used by both the IPC handlers (renderer-driven UI) and the
 * automation agent tools (LLM-driven). Keeping a single implementation guarantees
 * that anything the user can do in the Automations tab the automation agent
 * can also do — and vice versa — without drift.
 */

import { randomUUID } from 'crypto'
import { eq, desc } from 'drizzle-orm'
import { getDb, schema, notifyWrite } from '../db'
import { refreshScheduler, runJobNow } from './scheduler'
import { emitHook, type HookEvent } from './hookBus'

type HookContext = Record<string, unknown>

export type ScheduledJobInput = {
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

export type HookInput = {
  id?: string
  name: string
  event: string
  type: 'skill' | 'prompt' | 'tool'
  config: Record<string, unknown>
  enabled?: boolean
}

export type StandingOrderInput = {
  id?: string
  name: string
  body: string
  scope?: string
  triggersJson?: unknown
  approvalsJson?: unknown
  enabled?: boolean
}

// ── Scheduled jobs ──────────────────────────────────────────────────────

export function listScheduled() {
  const db = getDb()
  return db.select().from(schema.scheduledJobs).orderBy(desc(schema.scheduledJobs.createdAt)).all()
}

export function getScheduled(id: string) {
  const db = getDb()
  return db.select().from(schema.scheduledJobs).where(eq(schema.scheduledJobs.id, id)).get() ?? null
}

export function upsertScheduled(job: ScheduledJobInput): { ok: boolean; id?: string; error?: string } {
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
    try { refreshScheduler() } catch { /* ignore */ }
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
  try { refreshScheduler() } catch { /* ignore */ }
  return { ok: true, id }
}

export function deleteScheduled(id: string) {
  const db = getDb()
  db.delete(schema.scheduledJobs).where(eq(schema.scheduledJobs.id, id)).run()
  notifyWrite()
  try { refreshScheduler() } catch { /* ignore */ }
  return { ok: true }
}

export function runScheduledNow(id: string) {
  if (!id) return { ok: false, error: 'id is required' }
  try {
    void runJobNow(id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function listScheduledRuns(jobId?: string) {
  const db = getDb()
  const q = db.select().from(schema.scheduledRuns)
  return jobId
    ? q.where(eq(schema.scheduledRuns.jobId, jobId)).orderBy(desc(schema.scheduledRuns.startedAt)).all()
    : q.orderBy(desc(schema.scheduledRuns.startedAt)).all()
}

// ── Hooks ───────────────────────────────────────────────────────────────

export function listHooks() {
  const db = getDb()
  return db.select().from(schema.hooks).orderBy(desc(schema.hooks.createdAt)).all()
}

export function getHook(id: string) {
  const db = getDb()
  return db.select().from(schema.hooks).where(eq(schema.hooks.id, id)).get() ?? null
}

export function upsertHook(hook: HookInput): { ok: boolean; id?: string; error?: string } {
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
}

export function deleteHook(id: string) {
  const db = getDb()
  db.delete(schema.hooks).where(eq(schema.hooks.id, id)).run()
  notifyWrite()
  return { ok: true }
}

export function listHookRuns(hookId?: string) {
  const db = getDb()
  const q = db.select().from(schema.hookRuns)
  return hookId
    ? q.where(eq(schema.hookRuns.hookId, hookId)).orderBy(desc(schema.hookRuns.firedAt)).all()
    : q.orderBy(desc(schema.hookRuns.firedAt)).all()
}

export async function emitHookEvent(event: HookEvent, ctx: HookContext = {}) {
  await emitHook(event, ctx)
  return { ok: true }
}

// ── Standing orders ─────────────────────────────────────────────────────

export function listStandingOrders() {
  const db = getDb()
  return db.select().from(schema.standingOrders).orderBy(desc(schema.standingOrders.createdAt)).all()
}

export function getStandingOrder(id: string) {
  const db = getDb()
  return db.select().from(schema.standingOrders).where(eq(schema.standingOrders.id, id)).get() ?? null
}

export function upsertStandingOrder(order: StandingOrderInput): { ok: boolean; id?: string; error?: string } {
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
}

export function deleteStandingOrder(id: string) {
  const db = getDb()
  db.delete(schema.standingOrders).where(eq(schema.standingOrders.id, id)).run()
  notifyWrite()
  return { ok: true }
}

// ── Tasks ledger ────────────────────────────────────────────────────────

export function listTasks(filter: { status?: string; type?: string } = {}) {
  const db = getDb()
  let q = db.select().from(schema.tasks).$dynamic()
  if (filter?.status) q = q.where(eq(schema.tasks.status, filter.status))
  if (filter?.type) q = q.where(eq(schema.tasks.type, filter.type))
  return q.orderBy(desc(schema.tasks.createdAt)).all()
}

export function getTaskSteps(taskId: string) {
  const db = getDb()
  return db.select().from(schema.taskSteps).where(eq(schema.taskSteps.taskId, taskId)).orderBy(schema.taskSteps.idx).all()
}
