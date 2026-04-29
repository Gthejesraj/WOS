/**
 * Central hook dispatcher (Claude-Code-style hook matrix).
 *
 * Hooks are opt-in extension points wired around tool execution and app
 * lifecycle. Apps register handlers via `registerHooks()`; the dispatcher
 * runs them in registration order with a permissive contract — any handler
 * may mutate the args/result, return `{ block: true }` to abort, or simply
 * observe.
 *
 * Hooks added here:
 *   - PreToolUse(toolName, args, ctx)   → may mutate args or block
 *   - PostToolUse(toolName, args, result, ctx) → may mutate result, log
 *   - OnConnect(appId, creds, ctx)      → fired after `connectApp` succeeds
 *   - OnDisconnect(appId, ctx)          → fired after `disconnectApp`
 *   - OnError(toolName, error, ctx)     → optional retry/fallback
 *   - Notification(level, message, ctx) → push to UI/tray
 *   - BeforeSubagent(name, args, ctx)   → may mutate args or block
 *
 * Every hook is best-effort: a failure inside one hook never crashes the
 * caller — it logs and continues, with the original args/result preserved.
 */

export interface HookContext {
  /** Optional workspace path from the active agent run. */
  workspacePath?: string | null
  /** Source of the hook ("user", "app:slack", etc.) — set automatically. */
  source?: string
  [key: string]: unknown
}

export type PreToolUseResult = { block?: boolean; reason?: string; args?: unknown } | void
export type PostToolUseResult = { result?: unknown } | void
export type OnErrorResult = { handled?: boolean; result?: unknown } | void
export type BeforeSubagentResult = { block?: boolean; reason?: string; args?: unknown } | void

export interface HookHandlers {
  PreToolUse?: (toolName: string, args: unknown, ctx: HookContext) => PreToolUseResult | Promise<PreToolUseResult>
  PostToolUse?: (toolName: string, args: unknown, result: unknown, ctx: HookContext) => PostToolUseResult | Promise<PostToolUseResult>
  OnConnect?: (appId: string, creds: Record<string, string>, ctx: HookContext) => void | Promise<void>
  OnDisconnect?: (appId: string, ctx: HookContext) => void | Promise<void>
  OnError?: (toolName: string, error: unknown, ctx: HookContext) => OnErrorResult | Promise<OnErrorResult>
  Notification?: (level: 'info' | 'warning' | 'error', message: string, ctx: HookContext) => void | Promise<void>
  BeforeSubagent?: (name: string, args: unknown, ctx: HookContext) => BeforeSubagentResult | Promise<BeforeSubagentResult>
}

interface RegisteredHook {
  source: string
  handlers: HookHandlers
}

const REGISTRY: RegisteredHook[] = []

export function registerHooks(source: string, handlers: HookHandlers): void {
  REGISTRY.push({ source, handlers })
}

export function clearHooks(source?: string): void {
  if (!source) {
    REGISTRY.length = 0
    return
  }
  for (let i = REGISTRY.length - 1; i >= 0; i--) {
    if (REGISTRY[i].source === source) REGISTRY.splice(i, 1)
  }
}

export function listHooks(): Array<{ source: string; events: string[] }> {
  return REGISTRY.map(h => ({
    source: h.source,
    events: Object.keys(h.handlers),
  }))
}

function logHookError(event: string, source: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  console.warn(`[hooks] ${event} handler from "${source}" failed: ${msg}`)
}

export async function runPreToolUse(
  toolName: string,
  args: unknown,
  ctx: HookContext = {},
): Promise<{ block: boolean; reason?: string; args: unknown }> {
  let currentArgs = args
  for (const { source, handlers } of REGISTRY) {
    if (!handlers.PreToolUse) continue
    try {
      const ret = await handlers.PreToolUse(toolName, currentArgs, { ...ctx, source })
      if (!ret) continue
      if (ret.block) return { block: true, reason: ret.reason, args: currentArgs }
      if ('args' in ret && ret.args !== undefined) currentArgs = ret.args
    } catch (err) {
      logHookError('PreToolUse', source, err)
    }
  }
  return { block: false, args: currentArgs }
}

export async function runPostToolUse(
  toolName: string,
  args: unknown,
  result: unknown,
  ctx: HookContext = {},
): Promise<unknown> {
  let currentResult = result
  for (const { source, handlers } of REGISTRY) {
    if (!handlers.PostToolUse) continue
    try {
      const ret = await handlers.PostToolUse(toolName, args, currentResult, { ...ctx, source })
      if (ret && 'result' in ret && ret.result !== undefined) currentResult = ret.result
    } catch (err) {
      logHookError('PostToolUse', source, err)
    }
  }
  return currentResult
}

export async function runOnConnect(appId: string, creds: Record<string, string>, ctx: HookContext = {}): Promise<void> {
  for (const { source, handlers } of REGISTRY) {
    if (!handlers.OnConnect) continue
    try {
      await handlers.OnConnect(appId, creds, { ...ctx, source })
    } catch (err) {
      logHookError('OnConnect', source, err)
    }
  }
}

export async function runOnDisconnect(appId: string, ctx: HookContext = {}): Promise<void> {
  for (const { source, handlers } of REGISTRY) {
    if (!handlers.OnDisconnect) continue
    try {
      await handlers.OnDisconnect(appId, { ...ctx, source })
    } catch (err) {
      logHookError('OnDisconnect', source, err)
    }
  }
}

export async function runOnError(toolName: string, error: unknown, ctx: HookContext = {}): Promise<{ handled: boolean; result?: unknown }> {
  for (const { source, handlers } of REGISTRY) {
    if (!handlers.OnError) continue
    try {
      const ret = await handlers.OnError(toolName, error, { ...ctx, source })
      if (ret?.handled) return { handled: true, result: ret.result }
    } catch (err) {
      logHookError('OnError', source, err)
    }
  }
  return { handled: false }
}

export async function emitNotification(level: 'info' | 'warning' | 'error', message: string, ctx: HookContext = {}): Promise<void> {
  for (const { source, handlers } of REGISTRY) {
    if (!handlers.Notification) continue
    try {
      await handlers.Notification(level, message, { ...ctx, source })
    } catch (err) {
      logHookError('Notification', source, err)
    }
  }
}

export async function runBeforeSubagent(
  name: string,
  args: unknown,
  ctx: HookContext = {},
): Promise<{ block: boolean; reason?: string; args: unknown }> {
  let currentArgs = args
  for (const { source, handlers } of REGISTRY) {
    if (!handlers.BeforeSubagent) continue
    try {
      const ret = await handlers.BeforeSubagent(name, currentArgs, { ...ctx, source })
      if (!ret) continue
      if (ret.block) return { block: true, reason: ret.reason, args: currentArgs }
      if ('args' in ret && ret.args !== undefined) currentArgs = ret.args
    } catch (err) {
      logHookError('BeforeSubagent', source, err)
    }
  }
  return { block: false, args: currentArgs }
}
