import cron from 'node-cron'
import { registry, type AutomationRow } from './registry'
import { runAutomation } from './runner'
import { broadcastAutomationError } from './delivery'

interface CronConfig {
  expr: string // standard cron expression (5 or 6 fields)
  tz?: string
  /** Alias for `tz` — accepted for backward compatibility. */
  timezone?: string
}

const tasks = new Map<string, ReturnType<typeof cron.schedule>>

/** Validate a cron expression. */
export function isValidCron(expr: string): boolean {
  return cron.validate(expr)
}

function configOf(a: AutomationRow): CronConfig | null {
  const cfg = a.config as Partial<CronConfig>
  if (!cfg.expr || !isValidCron(cfg.expr)) return null
  return { expr: cfg.expr, tz: cfg.tz ?? cfg.timezone }
}

function schedule(a: AutomationRow): void {
  const cfg = configOf(a)
  if (!cfg) return
  const task = cron.schedule(
    cfg.expr,
    () => {
      runAutomation(a, { trigger: { kind: 'cron', expr: cfg.expr, firedAt: new Date().toISOString() } })
        .then(r => {
          if (r.error) broadcastAutomationError(a, r.error, r.runId)
        })
        .catch(err => broadcastAutomationError(a, err instanceof Error ? err.message : String(err)))
    },
    { timezone: cfg.tz },
  )
  tasks.set(a.id, task)
}

function unschedule(id: string): void {
  const t = tasks.get(id)
  if (t) {
    try { t.stop() } catch { /* ignore */ }
    tasks.delete(id)
  }
}

export const cronService = {
  start(): void {
    for (const a of registry.list({ kind: 'cron', enabled: true })) schedule(a)
  },
  stop(): void {
    for (const id of Array.from(tasks.keys())) unschedule(id)
  },
  /** Reload a single automation's schedule (call after upsert/toggle/delete). */
  reload(id: string): void {
    unschedule(id)
    const a = registry.get(id)
    if (a && a.kind === 'cron' && a.enabled) schedule(a)
  },
  /** Reload everything from DB. */
  reloadAll(): void {
    this.stop()
    this.start()
  },
}
