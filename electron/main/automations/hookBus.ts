import { randomUUID } from 'crypto'
import { eq, and } from 'drizzle-orm'
import { getDb, schema, notifyWrite } from '../db'
import { agentRunner } from '../agent/runner'

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

function ensureConversationForHook(hook: typeof schema.hooks.$inferSelect, cfg: Record<string, unknown>): string {
  const db = getDb()
  const target = typeof cfg.conversationId === 'string' ? cfg.conversationId : 'new'
  if (target && target !== 'new') {
    const conv = db.select().from(schema.conversations).where(eq(schema.conversations.id, target)).get()
    if (conv) return conv.id
  }
  const id = randomUUID()
  const now = new Date()
  db.insert(schema.conversations).values({
    id,
    title: `🪝 ${hook.name}`,
    workspaceId: null,
    model: defaultModel(),
    mode: 'default',
    createdAt: now,
    updatedAt: now,
  }).run()
  notifyWrite()
  return id
}

function buildPrompt(hook: typeof schema.hooks.$inferSelect, cfg: Record<string, unknown>, ctx: HookContext): string | null {
  const ctxJson = JSON.stringify(ctx ?? {}, null, 2)
  if (hook.type === 'prompt') {
    const p = typeof cfg.prompt === 'string' ? cfg.prompt : ''
    if (!p.trim()) return null
    return `${p}\n\n[hook event=${hook.event}]\nContext:\n\`\`\`json\n${ctxJson}\n\`\`\``
  }
  if (hook.type === 'skill') {
    const ref = typeof cfg.ref === 'string' ? cfg.ref : (typeof cfg.skill === 'string' ? cfg.skill : '')
    if (!ref.trim()) return null
    return `Run skill "${ref}" in response to ${hook.event}.\n\nContext:\n\`\`\`json\n${ctxJson}\n\`\`\``
  }
  if (hook.type === 'tool') {
    const name = typeof cfg.tool === 'string' ? cfg.tool : (typeof cfg.ref === 'string' ? cfg.ref : '')
    if (!name.trim()) return null
    const args = cfg.args ?? {}
    return `Use the \`${name}\` tool with the following arguments to handle ${hook.event}:\n\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\`\n\nEvent context:\n\`\`\`json\n${ctxJson}\n\`\`\``
  }
  return null
}

async function executeHandler(hook: typeof schema.hooks.$inferSelect, ctx: HookContext): Promise<void> {
  const cfg = (hook.config ?? {}) as Record<string, unknown>
  const prompt = buildPrompt(hook, cfg, ctx)
  if (!prompt) {
    console.warn(`[hooks] ${hook.name}: missing prompt/ref/tool config — skipping`)
    return
  }
  // Don't recurse: a hook listening on message:received must not re-trigger
  // itself by running the agent on the same conversation.
  const sourceConversationId = typeof ctx.conversationId === 'string' ? ctx.conversationId : null
  const targetCfg = typeof cfg.conversationId === 'string' ? cfg.conversationId : 'new'
  if (sourceConversationId && targetCfg !== 'new' && targetCfg === sourceConversationId) {
    console.warn(`[hooks] ${hook.name}: skipping to avoid recursion on ${sourceConversationId}`)
    return
  }
  const conversationId = ensureConversationForHook(hook, cfg)
  // Fire-and-forget the agent run: the hook bus only blocks for HANDLER_TIMEOUT_MS,
  // and a real run will far exceed that. We still kick it off here.
  void agentRunner.run(conversationId, prompt, [], undefined).catch((err) => {
    console.warn(`[hooks] ${hook.name} agent run failed`, err)
  })
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
