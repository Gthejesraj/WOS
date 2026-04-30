import { registry, type AutomationRow } from './registry'
import { runAutomation } from './runner'
import { broadcastAutomationError } from './delivery'
import { getDb, schema, notifyWrite } from '../db'
import { eq } from 'drizzle-orm'

interface HeartbeatConfig {
  intervalSec: number
  jitterSec?: number
}

const timers = new Map<string, NodeJS.Timeout>()
const stopped = new Set<string>()

function configOf(a: AutomationRow): HeartbeatConfig | null {
  const cfg = a.config as Partial<HeartbeatConfig>
  if (!cfg.intervalSec || cfg.intervalSec < 5) return null
  return { intervalSec: cfg.intervalSec, jitterSec: cfg.jitterSec }
}

function nextDelayMs(cfg: HeartbeatConfig): number {
  const base = cfg.intervalSec * 1000
  const jitter = (cfg.jitterSec ?? 0) * 1000
  return base + (jitter > 0 ? Math.floor(Math.random() * jitter) : 0)
}

function schedule(a: AutomationRow): void {
  const cfg = configOf(a)
  if (!cfg) return

  const tick = async () => {
    if (stopped.has(a.id)) { timers.delete(a.id); return }
    const fresh = registry.get(a.id)
    if (!fresh || !fresh.enabled) {
      timers.delete(a.id)
      return
    }
    try {
      const db = getDb()
      db.insert(schema.automationHeartbeats).values({
        automationId: a.id,
        intervalSec: cfg.intervalSec,
        jitterSec: cfg.jitterSec ?? 0,
        lastTickAt: new Date(),
      } as unknown as typeof schema.automationHeartbeats.$inferInsert).onConflictDoUpdate({
        target: schema.automationHeartbeats.automationId,
        set: { lastTickAt: new Date(), intervalSec: cfg.intervalSec, jitterSec: cfg.jitterSec ?? 0 },
      }).run()
      notifyWrite()
    } catch { /* ignore */ }

    const r = await runAutomation(fresh, { trigger: { kind: 'heartbeat', firedAt: new Date().toISOString() } })
    if (r.error) broadcastAutomationError(fresh, r.error, r.runId)

    // Re-check stop flag after async run — unschedule() may have fired while
    // we were awaiting runAutomation, and we MUST NOT reschedule afterward.
    if (stopped.has(a.id)) { timers.delete(a.id); return }
    const t = setTimeout(tick, nextDelayMs(cfg))
    timers.set(a.id, t)
  }

  stopped.delete(a.id)
  const t = setTimeout(tick, nextDelayMs(cfg))
  timers.set(a.id, t)
}

function unschedule(id: string): void {
  stopped.add(id)
  const t = timers.get(id)
  if (t) clearTimeout(t)
  timers.delete(id)
  // Clean up state row.
  try {
    const db = getDb()
    db.delete(schema.automationHeartbeats).where(eq(schema.automationHeartbeats.automationId, id)).run()
  } catch { /* ignore */ }
}

export const heartbeatService = {
  start(): void {
    for (const a of registry.list({ kind: 'heartbeat', enabled: true })) schedule(a)
  },
  stop(): void {
    for (const id of Array.from(timers.keys())) unschedule(id)
  },
  reload(id: string): void {
    unschedule(id)
    const a = registry.get(id)
    if (a && a.kind === 'heartbeat' && a.enabled) schedule(a)
  },
  reloadAll(): void {
    this.stop()
    this.start()
  },
}
