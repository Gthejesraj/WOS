import { randomUUID } from 'crypto'
import { eq, and } from 'drizzle-orm'
import { getDb, schema, notifyWrite } from '../db'

export type HookEvent =
  | 'message:received'
  | 'conversation:new'
  | 'conversation:reset'
  | 'app:connected'
  | 'app:disconnected'
  | 'agent:bootstrap'
  | 'agent:error'
  | 'session:compact:before'
  | 'session:compact:after'

const HANDLER_TIMEOUT_MS = 5000

type HookContext = Record<string, unknown>

async function runWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_r, reject) => setTimeout(() => reject(new Error('hook timeout')), ms)),
  ])
}

async function runHook(hook: typeof schema.hooks.$inferSelect, ctx: HookContext) {
  const db = getDb()
  const firedAt = new Date()
  const runId = randomUUID()
  let status: 'success' | 'error' | 'timeout' = 'success'
  let error: string | null = null
  try {
    await runWithTimeout(executeHandler(hook, ctx), HANDLER_TIMEOUT_MS)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    status = msg === 'hook timeout' ? 'timeout' : 'error'
    error = msg
  }
  db.insert(schema.hookRuns).values({
    id: runId,
    hookId: hook.id,
    firedAt,
    status,
    error,
    contextJson: ctx as unknown,
  }).run()
  db.update(schema.hooks).set({ lastFiredAt: firedAt }).where(eq(schema.hooks.id, hook.id)).run()
  notifyWrite()
}

async function executeHandler(hook: typeof schema.hooks.$inferSelect, ctx: HookContext): Promise<void> {
  // Stub handlers — real implementations land alongside the agent runner.
  // For now, log the invocation so users see hook activity in dev.
  const cfg = (hook.config ?? {}) as Record<string, unknown>
  console.log(`[hooks] ${hook.event} → ${hook.type}`, { name: hook.name, cfg, ctx })
}

export async function emitHook(event: HookEvent, ctx: HookContext = {}): Promise<void> {
  try {
    const db = getDb()
    const hooks = db.select().from(schema.hooks).where(and(eq(schema.hooks.event, event), eq(schema.hooks.enabled, true))).all()
    for (const h of hooks) {
      // Fire-and-forget; we never block the originating event.
      void runHook(h as typeof schema.hooks.$inferSelect, ctx).catch((err) => {
        console.warn('[hooks] runHook failed', err)
      })
    }
  } catch (err) {
    console.warn('[hooks] emit failed', event, err)
  }
}
