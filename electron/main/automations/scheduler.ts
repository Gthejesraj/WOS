import * as cron from 'node-cron'
import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { getDb, schema, notifyWrite } from '../db'
import { agentRunner } from '../agent/runner'

type ScheduledJobRow = typeof schema.scheduledJobs.$inferSelect

const cronTasks = new Map<string, cron.ScheduledTask>()
const onceTimers = new Map<string, NodeJS.Timeout>()

function disposeAll() {
  for (const t of cronTasks.values()) {
    try { t.stop(); (t as unknown as { destroy?: () => void }).destroy?.() } catch { /* ignore */ }
  }
  cronTasks.clear()
  for (const t of onceTimers.values()) clearTimeout(t)
  onceTimers.clear()
}

function defaultModel(): string {
  const db = getDb()
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, 'defaultModel')).get()
  if (!row?.value) return ''
  try {
    const v = JSON.parse(row.value as string)
    return typeof v === 'string' ? v : ''
  } catch {
    return String(row.value).replace(/^"|"$/g, '')
  }
}

function ensureConversationFor(job: ScheduledJobRow): string {
  const db = getDb()
  if (job.target && job.target !== 'new') {
    const conv = db.select().from(schema.conversations).where(eq(schema.conversations.id, job.target)).get()
    if (conv) return conv.id
  }
  const id = randomUUID()
  const now = new Date()
  db.insert(schema.conversations).values({
    id,
    title: `⚡ ${job.name}`,
    workspaceId: null,
    model: defaultModel(),
    mode: 'default',
    createdAt: now,
    updatedAt: now,
  }).run()
  notifyWrite()
  return id
}

async function fireJob(jobId: string, source: 'cron' | 'once' | 'manual') {
  const db = getDb()
  const job = db.select().from(schema.scheduledJobs).where(eq(schema.scheduledJobs.id, jobId)).get()
  if (!job) return
  if (!job.enabled && source !== 'manual') return

  const conversationId = ensureConversationFor(job as ScheduledJobRow)
  const runId = randomUUID()
  const startedAt = new Date()
  db.insert(schema.scheduledRuns).values({
    id: runId,
    jobId: job.id,
    startedAt,
    endedAt: null,
    status: 'running',
    error: null,
    conversationId,
  }).run()

  // Mirror into the tasks ledger so the Tasks tab shows it.
  const taskId = randomUUID()
  db.insert(schema.tasks).values({
    id: taskId,
    parentId: null,
    type: 'scheduled',
    status: 'running',
    title: job.name,
    payload: { jobId: job.id, source } as unknown,
    conversationId,
    createdAt: startedAt,
    updatedAt: startedAt,
  }).run()
  notifyWrite()

  try {
    await agentRunner.run(conversationId, job.prompt, [])
    const endedAt = new Date()
    db.update(schema.scheduledRuns).set({ status: 'success', endedAt }).where(eq(schema.scheduledRuns.id, runId)).run()
    db.update(schema.tasks).set({ status: 'success', updatedAt: endedAt }).where(eq(schema.tasks.id, taskId)).run()
    db.update(schema.scheduledJobs).set({ lastRunAt: endedAt, updatedAt: endedAt }).where(eq(schema.scheduledJobs.id, job.id)).run()
    if (source === 'once' && job.deleteAfterRun) {
      db.delete(schema.scheduledJobs).where(eq(schema.scheduledJobs.id, job.id)).run()
    }
    notifyWrite()
  } catch (err) {
    const endedAt = new Date()
    const msg = err instanceof Error ? err.message : String(err)
    db.update(schema.scheduledRuns).set({ status: 'error', endedAt, error: msg }).where(eq(schema.scheduledRuns.id, runId)).run()
    db.update(schema.tasks).set({ status: 'error', updatedAt: endedAt }).where(eq(schema.tasks.id, taskId)).run()
    db.update(schema.scheduledJobs).set({ lastRunAt: endedAt, updatedAt: endedAt }).where(eq(schema.scheduledJobs.id, job.id)).run()
    notifyWrite()
  }
}

function scheduleOne(job: ScheduledJobRow) {
  if (!job.enabled) return
  if (job.cronExpr && cron.validate(job.cronExpr)) {
    try {
      const task = cron.schedule(
        job.cronExpr,
        () => { void fireJob(job.id, 'cron') },
        ({ timezone: job.tz && job.tz !== 'local' ? job.tz : undefined } as unknown) as Parameters<typeof cron.schedule>[2],
      )
      cronTasks.set(job.id, task)
      try {
        const next = (task as unknown as { getNextRun?: () => Date | null }).getNextRun?.()
        if (next) {
          const db = getDb()
          db.update(schema.scheduledJobs).set({ nextRunAt: next }).where(eq(schema.scheduledJobs.id, job.id)).run()
        }
      } catch { /* best-effort */ }
    } catch (err) {
      console.warn('[scheduler] failed to schedule cron job', job.id, err)
    }
  } else if (job.runAt) {
    const ms = job.runAt.getTime() - Date.now()
    onceTimers.set(job.id, setTimeout(() => { void fireJob(job.id, 'once') }, Math.max(0, ms)))
    const db = getDb()
    db.update(schema.scheduledJobs).set({ nextRunAt: job.runAt }).where(eq(schema.scheduledJobs.id, job.id)).run()
  }
}

export function refreshScheduler() {
  disposeAll()
  const db = getDb()
  const jobs = db.select().from(schema.scheduledJobs).all()
  for (const j of jobs) scheduleOne(j as ScheduledJobRow)
}

export function startScheduler() {
  refreshScheduler()
}

export function stopScheduler() {
  disposeAll()
}

export async function runJobNow(jobId: string) {
  await fireJob(jobId, 'manual')
}
