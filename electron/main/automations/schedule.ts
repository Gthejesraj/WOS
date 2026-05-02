/**
 * Unified schedule service. Replaces the old cron + heartbeat services.
 *
 * config.mode dispatches to one of three flavours:
 *   - 'at'    → one-shot setTimeout. Optional config.deleteAfterRun (default true).
 *   - 'every' → recurring interval. config.every is a duration like '30s' | '5m' | '2h'.
 *   - 'cron'  → standard cron expression. config.cron + optional config.tz (IANA).
 *
 * Examples:
 *   { mode: 'at',    at: '2026-04-15T18:00:00Z' }
 *   { mode: 'every', every: '15m' }
 *   { mode: 'cron',  cron: '0 9 * * *', tz: 'America/Los_Angeles' }
 */

import cron from 'node-cron'
import { registry, type AutomationRow } from './registry'
import { runAutomation } from './runner'
import { broadcastAutomationError } from './delivery'

interface ScheduleConfig {
  mode: 'at' | 'every' | 'cron'
  at?: string
  every?: string
  cron?: string
  tz?: string
  deleteAfterRun?: boolean
  jitterSec?: number
}

const cronTasks = new Map<string, ReturnType<typeof cron.schedule>>()
const timers = new Map<string, NodeJS.Timeout>()
const stopped = new Set<string>()

/** Validate a cron expression. */
export function isValidCron(expr: string): boolean {
  return cron.validate(expr)
}

/** Parse a duration string like '30s', '5m', '2h', '1d'. Returns ms or null. */
export function parseDurationMs(input: string): number | null {
  if (typeof input !== 'string') return null
  const m = input.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i)
  if (!m) {
    const asNum = Number(input)
    if (Number.isFinite(asNum) && asNum > 0) return asNum * 1000
    return null
  }
  const n = Number(m[1])
  const unit = m[2].toLowerCase()
  const factor = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000
  return Math.round(n * factor)
}

/**
 * Resolve `at` value to a future timestamp.
 * Accepts ISO 8601 ("2026-04-15T18:00:00Z") or a relative duration ("20m", "2h", "45s").
 * Returns ms-since-epoch or null on parse failure.
 */
export function resolveAt(input: string): number | null {
  if (typeof input !== 'string' || !input.trim()) return null
  const trimmed = input.trim()
  // Relative duration?
  if (/^\d+(?:\.\d+)?\s*(ms|s|m|h|d)$/i.test(trimmed)) {
    const ms = parseDurationMs(trimmed)
    return ms == null ? null : Date.now() + ms
  }
  const t = Date.parse(trimmed)
  return Number.isFinite(t) ? t : null
}

function configOf(a: AutomationRow): ScheduleConfig | null {
  const cfg = (a.config ?? {}) as Partial<ScheduleConfig>
  if (cfg.mode !== 'at' && cfg.mode !== 'every' && cfg.mode !== 'cron') return null
  return cfg as ScheduleConfig
}

function runOnce(a: AutomationRow, trigger: Record<string, unknown>): void {
  void runAutomation(a, { trigger })
    .then(r => { if (r.error) broadcastAutomationError(a, r.error, r.runId) })
    .catch(err => broadcastAutomationError(a, err instanceof Error ? err.message : String(err)))
}

function scheduleAt(a: AutomationRow, cfg: ScheduleConfig): void {
  if (!cfg.at) return
  const when = resolveAt(cfg.at)
  if (when == null) return
  const delay = Math.max(0, when - Date.now())
  const t = setTimeout(() => {
    timers.delete(a.id)
    if (stopped.has(a.id)) return
    const fresh = registry.get(a.id)
    if (!fresh || !fresh.enabled) return
    runOnce(fresh, { kind: 'schedule', mode: 'at', firedAt: new Date().toISOString() })
    // One-shot: delete row after firing unless explicitly preserved.
    const deleteAfter = cfg.deleteAfterRun !== false
    if (deleteAfter) {
      try { registry.delete(a.id) } catch { /* ignore */ }
    } else {
      try { registry.toggle(a.id, false) } catch { /* ignore */ }
    }
  }, delay)
  timers.set(a.id, t)
  registry.setNextRun(a.id, new Date(when))
}

function scheduleEvery(a: AutomationRow, cfg: ScheduleConfig): void {
  const ms = cfg.every ? parseDurationMs(cfg.every) : null
  if (ms == null || ms < 5_000) return

  const tick = async () => {
    if (stopped.has(a.id)) return
    const fresh = registry.get(a.id)
    if (!fresh || !fresh.enabled) return

    const r = await runAutomation(fresh, { trigger: { kind: 'schedule', mode: 'every', firedAt: new Date().toISOString() } })
    if (r.error) broadcastAutomationError(fresh, r.error, r.runId)

    // Re-check stop flag after async run — unschedule() may have fired.
    if (stopped.has(a.id)) return
    const jitter = (cfg.jitterSec ?? 0) * 1000
    const delay = ms + (jitter > 0 ? Math.floor(Math.random() * jitter) : 0)
    const next = setTimeout(tick, delay)
    timers.set(a.id, next)
    registry.setNextRun(a.id, new Date(Date.now() + delay))
  }

  stopped.delete(a.id)
  const jitter = (cfg.jitterSec ?? 0) * 1000
  const initial = ms + (jitter > 0 ? Math.floor(Math.random() * jitter) : 0)
  const t = setTimeout(tick, initial)
  timers.set(a.id, t)
  registry.setNextRun(a.id, new Date(Date.now() + initial))
}

function scheduleCron(a: AutomationRow, cfg: ScheduleConfig): void {
  if (!cfg.cron || !isValidCron(cfg.cron)) return
  const task = cron.schedule(
    cfg.cron,
    () => runOnce(a, { kind: 'schedule', mode: 'cron', expr: cfg.cron, firedAt: new Date().toISOString() }),
    { timezone: cfg.tz },
  )
  cronTasks.set(a.id, task)
}

function schedule(a: AutomationRow): void {
  const cfg = configOf(a)
  if (!cfg) return
  stopped.delete(a.id)
  if (cfg.mode === 'at') scheduleAt(a, cfg)
  else if (cfg.mode === 'every') scheduleEvery(a, cfg)
  else if (cfg.mode === 'cron') scheduleCron(a, cfg)
}

function unschedule(id: string): void {
  stopped.add(id)
  const c = cronTasks.get(id)
  if (c) {
    try { c.stop() } catch { /* ignore */ }
    cronTasks.delete(id)
  }
  const t = timers.get(id)
  if (t) {
    clearTimeout(t)
    timers.delete(id)
  }
}

export const scheduleService = {
  start(): void {
    for (const a of registry.list({ kind: 'schedule', enabled: true })) schedule(a)
  },
  stop(): void {
    for (const id of Array.from(cronTasks.keys())) unschedule(id)
    for (const id of Array.from(timers.keys())) unschedule(id)
  },
  /** Reload a single automation's schedule (call after upsert/toggle/delete). */
  reload(id: string): void {
    unschedule(id)
    const a = registry.get(id)
    if (a && a.kind === 'schedule' && a.enabled) schedule(a)
  },
  reloadAll(): void {
    this.stop()
    this.start()
  },
}
