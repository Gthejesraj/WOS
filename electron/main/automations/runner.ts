import { queryLoop } from '../agent/query'
import { PermissionStore } from '../agent/permissions'
import { resolveAgent } from '../agent/settings'
import { getDb, schema } from '../db'
import { eq } from 'drizzle-orm'
import { audit, type RunStatus } from './audit'
import { consent } from './consent'
import { createRunSandbox } from './sandbox'
import { registry, type AutomationRow } from './registry'
import { deliverResult } from './delivery'

/**
 * In-flight automation runs keyed by runId. Allows the runtime to abort all
 * active automations on `stop()` (e.g. master switch off, app quit) so we don't
 * leak HTTP streams or token spend after the user disables the feature.
 */
const inflight = new Map<string, AbortController>()

export function abortAllRuns(): number {
  const n = inflight.size
  for (const c of inflight.values()) {
    try { c.abort() } catch { /* ignore */ }
  }
  inflight.clear()
  return n
}

export function abortRunsForAutomation(automationId: string): number {
  let n = 0
  for (const [runId, c] of inflight.entries()) {
    if (runId.startsWith(`${automationId}:`)) {
      try { c.abort(); n++ } catch { /* ignore */ }
      inflight.delete(runId)
    }
  }
  return n
}

interface RunOptions {
  /** Trigger context (cron tick, hook event, webhook payload, …) */
  trigger?: unknown
  /** When true, skip side-effects: record run as 'dryrun' but still execute prompt. */
  dryRun?: boolean
}

/**
 * Execute a single automation. This is the heart of the automation system:
 *   1. resolve agent settings (model, system prompt, api key)
 *   2. create a sandbox scratch dir
 *   3. start an audit run
 *   4. invoke queryLoop with the automation's prompt + tool allowlist + consent gate
 *   5. capture text output, end the audit row, deliver result
 *
 * Returns the final text output (or error message).
 */
export async function runAutomation(
  automation: AutomationRow,
  opts: RunOptions = {},
): Promise<{ runId: string; output: string; error?: string }> {
  const { trigger, dryRun } = opts
  const scratchDir = createRunSandbox(`auto-${Date.now()}`)
  const runId = audit.startRun(automation.id, trigger ?? null, scratchDir)

  // Resolve model: try automation_author preset → wos default
  const agent = await resolveAgent('automation_author')
  let model = agent.model
  if (!model || !model.trim()) {
    const db = getDb()
    const modelSetting = db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'defaultModel'))
      .get()
    model = (modelSetting?.value as string)?.replace(/^"|"$/g, '') || ''
  }
  if (!model || !model.trim()) {
    audit.endRun(runId, 'error', null, 'No model configured for automations.')
    return { runId, output: '', error: 'No model configured for automations.' }
  }

  const permStore = new PermissionStore()
  const toolCalls: Array<{ tool: string; args: unknown; result: unknown; error?: string }> = []
  let output = ''
  let status: RunStatus = dryRun ? 'dryrun' : 'success'
  let errorMessage: string | undefined

  const runAbort = new AbortController()
  inflight.set(`${automation.id}:${runId}`, runAbort)

  // Build trigger context block prepended to the prompt so the agent knows
  // why it's running.
  const triggerBlock = trigger
    ? `\n\n<trigger>\n${typeof trigger === 'string' ? trigger : JSON.stringify(trigger, null, 2)}\n</trigger>`
    : ''
  const fullPrompt = `${automation.prompt}${triggerBlock}`

  try {
    for await (const event of queryLoop({
      model,
      messages: [],
      userMessage: fullPrompt,
      workspacePath: scratchDir,
      mode: 'default',
      reasoningEffort: 'medium',
      systemPromptOverride: agent.systemPrompt,
      apiKeyOverride: agent.apiKeyOverride,
      signal: runAbort.signal,
      permissionStore: permStore,
      onPermissionRequest: async (toolName) => {
        // Enforce allowlist + consent gates here.
        if (automation.toolsAllow.length && !automation.toolsAllow.includes(toolName)) {
          return 'deny'
        }
        if (consent.isDestructive(toolName) && !consent.has(automation.id, toolName)) {
          return 'deny'
        }
        if (dryRun && consent.isDestructive(toolName)) {
          return 'deny'
        }
        return 'allow-session'
      },
      onAskUser: async () => {
        // Headless runs cannot ask the user. Auto-cancel.
        throw new Error('Automation runs cannot ask the user. Use a Task Flow with requires_human steps instead.')
      },
      agentKey: 'automation_author',
    })) {
      switch (event.type) {
        case 'text_delta':
          output += event.content
          break
        case 'tool_use_start':
          toolCalls.push({ tool: event.toolName, args: event.input, result: null })
          break
        case 'tool_result': {
          const last = toolCalls[toolCalls.length - 1]
          if (last) {
            last.result = event.result
            if (event.error) last.error = event.error
          }
          break
        }
        case 'error':
          errorMessage = event.message
          status = 'error'
          break
        default:
          break
      }
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err)
    status = 'error'
  } finally {
    inflight.delete(`${automation.id}:${runId}`)
  }

  audit.endRun(runId, status, output || null, errorMessage ?? null, toolCalls)
  registry.setLastRun(automation.id, new Date())

  if (status !== 'error' && !dryRun) {
    try {
      await deliverResult(automation, output, runId)
    } catch (err) {
      if (process.env.WOS_DEBUG === '1') console.warn('[automations.runner] delivery failed', err)
    }
  }

  return { runId, output, error: errorMessage }
}
