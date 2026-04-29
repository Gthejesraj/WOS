/**
 * Automation tools — the surface the automation subagent uses to run
 * the same CRUD the user runs from the Automations tab.
 *
 * Tool names use the `automation_*` prefix so the agentDef tool-filter
 * can allowlist them with one prefix match.
 */

import type { Tool } from './index'
import * as svc from '../automations/service'
import type { HookEvent } from '../automations/hookBus'

const ALLOWED_HOOK_EVENTS: HookEvent[] = [
  'message:received',
  'conversation:new',
  'conversation:reset',
  'app:connected',
  'app:disconnected',
  'agent:bootstrap',
  'agent:error',
  'session:compact:before',
  'session:compact:after',
]

function toBool(v: unknown, dflt: boolean) {
  if (v === undefined || v === null) return dflt
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v.toLowerCase() !== 'false' && v !== '0' && v !== ''
  return dflt
}

export const automationTools: Tool[] = [
  // ── Scheduled jobs ────────────────────────────────────────────────
  {
    name: 'automation_listScheduled',
    description: 'List every scheduled automation job (cron + one-shot). Returns the full job rows.',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      return { output: svc.listScheduled() }
    },
  },
  {
    name: 'automation_getScheduled',
    description: 'Get one scheduled job by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(input) {
      const { id } = (input ?? {}) as { id: string }
      const row = svc.getScheduled(id)
      if (!row) return { output: '', error: `No scheduled job with id ${id}` }
      return { output: row }
    },
  },
  {
    name: 'automation_upsertScheduled',
    description: 'Create or update a scheduled job. Pass `id` to update; omit for create. Provide either `cronExpr` (5-field POSIX cron) or `runAt` (epoch ms) — never both. `target` is "new" (start a new conversation) or a conversation id. The `prompt` is what the agent will be asked to do at the scheduled time.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        cronExpr: { type: 'string', description: '5-field POSIX cron expression, e.g. "0 9 * * 1-5".' },
        runAt: { type: 'number', description: 'Epoch ms for a one-shot run.' },
        tz: { type: 'string', description: 'IANA timezone, default "local".' },
        target: { type: 'string', description: '"new" or an existing conversation id.' },
        prompt: { type: 'string' },
        enabled: { type: 'boolean' },
        deleteAfterRun: { type: 'boolean' },
      },
      required: ['name', 'target', 'prompt'],
    },
    async execute(input) {
      const i = (input ?? {}) as svc.ScheduledJobInput
      return { output: svc.upsertScheduled({
        ...i,
        enabled: toBool(i.enabled, true),
        deleteAfterRun: toBool(i.deleteAfterRun, false),
      }) }
    },
  },
  {
    name: 'automation_deleteScheduled',
    description: 'Delete a scheduled job by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(input) {
      const { id } = (input ?? {}) as { id: string }
      return { output: svc.deleteScheduled(id) }
    },
  },
  {
    name: 'automation_runScheduledNow',
    description: 'Fire a scheduled job immediately, regardless of its cron schedule.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(input) {
      const { id } = (input ?? {}) as { id: string }
      return { output: svc.runScheduledNow(id) }
    },
  },
  {
    name: 'automation_listScheduledRuns',
    description: 'List recent runs of a scheduled job (or all runs if no jobId is given).',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
    },
    async execute(input) {
      const { jobId } = (input ?? {}) as { jobId?: string }
      return { output: svc.listScheduledRuns(jobId) }
    },
  },

  // ── Hooks ─────────────────────────────────────────────────────────
  {
    name: 'automation_listHooks',
    description: 'List every event hook.',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      return { output: svc.listHooks() }
    },
  },
  {
    name: 'automation_getHook',
    description: 'Get one hook by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(input) {
      const { id } = (input ?? {}) as { id: string }
      const row = svc.getHook(id)
      if (!row) return { output: '', error: `No hook with id ${id}` }
      return { output: row }
    },
  },
  {
    name: 'automation_upsertHook',
    description: `Create or update a hook. Allowed events: ${ALLOWED_HOOK_EVENTS.join(', ')}. Type is "skill", "prompt", or "tool" — the config object holds type-specific fields (e.g. { skill: 'name' } or { prompt: '...' }).`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        event: { type: 'string', enum: ALLOWED_HOOK_EVENTS as unknown as string[] },
        type: { type: 'string', enum: ['skill', 'prompt', 'tool'] },
        config: { type: 'object', additionalProperties: true },
        enabled: { type: 'boolean' },
      },
      required: ['name', 'event', 'type'],
    },
    async execute(input) {
      const i = (input ?? {}) as svc.HookInput
      if (!ALLOWED_HOOK_EVENTS.includes(i.event as HookEvent)) {
        return { output: '', error: `Unsupported event "${i.event}". Allowed: ${ALLOWED_HOOK_EVENTS.join(', ')}` }
      }
      return { output: svc.upsertHook({
        ...i,
        config: i.config ?? {},
        enabled: toBool(i.enabled, true),
      }) }
    },
  },
  {
    name: 'automation_deleteHook',
    description: 'Delete a hook by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(input) {
      const { id } = (input ?? {}) as { id: string }
      return { output: svc.deleteHook(id) }
    },
  },
  {
    name: 'automation_listHookRuns',
    description: 'List recent firings of a hook (or all firings if no hookId is given).',
    inputSchema: {
      type: 'object',
      properties: { hookId: { type: 'string' } },
    },
    async execute(input) {
      const { hookId } = (input ?? {}) as { hookId?: string }
      return { output: svc.listHookRuns(hookId) }
    },
  },
  {
    name: 'automation_emitHook',
    description: 'Emit a hook event manually (for testing or programmatic triggers).',
    inputSchema: {
      type: 'object',
      properties: {
        event: { type: 'string', enum: ALLOWED_HOOK_EVENTS as unknown as string[] },
        ctx: { type: 'object', additionalProperties: true, description: 'Context object passed to handlers.' },
      },
      required: ['event'],
    },
    async execute(input) {
      const { event, ctx } = (input ?? {}) as { event: HookEvent; ctx?: Record<string, unknown> }
      if (!ALLOWED_HOOK_EVENTS.includes(event)) {
        return { output: '', error: `Unsupported event "${event}".` }
      }
      return { output: await svc.emitHookEvent(event, ctx ?? {}) }
    },
  },

  // ── Standing orders ──────────────────────────────────────────────
  {
    name: 'automation_listStandingOrders',
    description: 'List every standing order. Standing orders are markdown blocks injected into every agent run\'s system prompt.',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      return { output: svc.listStandingOrders() }
    },
  },
  {
    name: 'automation_getStandingOrder',
    description: 'Get one standing order by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(input) {
      const { id } = (input ?? {}) as { id: string }
      const row = svc.getStandingOrder(id)
      if (!row) return { output: '', error: `No standing order with id ${id}` }
      return { output: row }
    },
  },
  {
    name: 'automation_upsertStandingOrder',
    description: 'Create or update a standing order. `body` is the markdown injected into the system prompt. `scope` is "global", a workspace id, or a conversation id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        body: { type: 'string' },
        scope: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['name', 'body'],
    },
    async execute(input) {
      const i = (input ?? {}) as svc.StandingOrderInput
      return { output: svc.upsertStandingOrder({
        ...i,
        enabled: toBool(i.enabled, true),
      }) }
    },
  },
  {
    name: 'automation_deleteStandingOrder',
    description: 'Delete a standing order by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(input) {
      const { id } = (input ?? {}) as { id: string }
      return { output: svc.deleteStandingOrder(id) }
    },
  },

  // ── Tasks ledger ─────────────────────────────────────────────────
  {
    name: 'automation_listTasks',
    description: 'List recent automation tasks. Filter by status ("queued" | "running" | "success" | "error" | "cancelled") and/or type ("scheduled" | "subagent" | "hook" | "flow").',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        type: { type: 'string' },
      },
    },
    async execute(input) {
      const filter = (input ?? {}) as { status?: string; type?: string }
      return { output: svc.listTasks(filter) }
    },
  },
  {
    name: 'automation_getTaskSteps',
    description: 'Return the ordered timeline (steps) for a given task id.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
    async execute(input) {
      const { taskId } = (input ?? {}) as { taskId: string }
      return { output: svc.getTaskSteps(taskId) }
    },
  },
]
