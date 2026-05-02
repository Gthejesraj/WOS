/**
 * Shared automation runtime helper.
 *
 * Single source of truth for "create / replace an automation" used by both:
 *   - the agent tool `automation_create` (chat-driven)
 *   - the IPC `automations:upsert` handler (UI-driven)
 *
 * Validation, normalisation, persistence, scheduling, and (optionally)
 * destructive-tool consent all happen here atomically.
 */
import { registry, type AutomationInput, type AutomationKind, type AutomationRow, type ResultDelivery } from './registry'
import { automationsRuntime } from './index'
import { ensureWebhook } from './webhooks'
import { consent, DESTRUCTIVE_TOOLS } from './consent'
import { isValidCron, parseDurationMs, resolveAt } from './schedule'
import { getDb, schema } from '../db'
import { eq } from 'drizzle-orm'

export type ScheduleMode = 'at' | 'every' | 'cron'

export interface AutomationCreateSpec {
  id?: string
  name: string
  kind: AutomationKind
  enabled?: boolean
  message: string
  toolsAllow?: string[]
  schedule?: {
    mode: ScheduleMode
    at?: string
    every?: string
    cron?: string
    tz?: string
    deleteAfterRun?: boolean
    jitterSec?: number
  }
  hook?: { event: string }
  webhook?: { slug?: string; secret?: string }
  delivery?: {
    kind?: 'inline' | 'channel' | 'webhook' | 'silent' | 'notify' | 'chat' | 'external'
    channel?: string
    url?: string
  }
  description?: string | null
}

export interface AutomationCreateOptions {
  /** When true (agent-initiated), auto-grant destructive-tool consent. */
  fromAgent?: boolean
}

export interface AutomationCreateOk {
  ok: true
  id: string
  kind: AutomationKind
  enabled: boolean
  summary: string
  webhook?: { slug: string; localUrl: string; publicUrl: string | null }
}

export interface AutomationCreateErr {
  ok: false
  error: { field: string; expected: string; got: string; hint?: string }
}

export type AutomationCreateResult = AutomationCreateOk | AutomationCreateErr

const VALID_KINDS: ReadonlySet<AutomationKind> = new Set(['schedule', 'hook', 'webhook'])

function err(field: string, expected: string, got: unknown, hint?: string): AutomationCreateErr {
  return { ok: false, error: { field, expected, got: typeof got === 'string' ? got : JSON.stringify(got), hint } }
}

/** Look up the user's default timezone from settings, fall back to 'UTC'. */
function defaultTimezone(): string {
  try {
    const db = getDb()
    const row = db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'automations.defaultTimezone'))
      .get()
    if (row?.value) {
      const v = String(row.value).replace(/^"|"$/g, '')
      if (v) return v
    }
  } catch { /* ignore */ }
  return 'UTC'
}

function normaliseDelivery(d?: AutomationCreateSpec['delivery']): { resultDelivery: ResultDelivery; resultTarget: string | null } {
  const k = d?.kind ?? 'inline'
  // 'inline' (the OpenClaw default) maps to 'silent' on disk — the run
  // notification is surfaced inline by the chat UI when the user is present.
  if (k === 'inline' || k === 'silent') return { resultDelivery: 'silent', resultTarget: null }
  if (k === 'channel') return { resultDelivery: 'external', resultTarget: d?.channel ?? null }
  if (k === 'webhook') return { resultDelivery: 'external', resultTarget: d?.url ?? null }
  if (k === 'notify') return { resultDelivery: 'notify', resultTarget: null }
  if (k === 'chat') return { resultDelivery: 'chat', resultTarget: null }
  if (k === 'external') return { resultDelivery: 'external', resultTarget: d?.channel ?? d?.url ?? null }
  return { resultDelivery: 'silent', resultTarget: null }
}

function summarise(row: AutomationRow): string {
  const cfg = row.config as Record<string, unknown>
  if (row.kind === 'schedule') {
    const mode = String(cfg.mode ?? '?')
    if (mode === 'at') return `One-shot at ${String(cfg.at)}`
    if (mode === 'every') return `Every ${String(cfg.every)}`
    if (mode === 'cron') return `Cron ${String(cfg.cron)}${cfg.tz ? ` (${String(cfg.tz)})` : ''}`
  }
  if (row.kind === 'hook') return `On event ${String(cfg.event ?? '?')}`
  if (row.kind === 'webhook') return `Inbound webhook`
  return row.kind
}

/**
 * Create or update an automation. Returns a structured result so the agent
 * model can self-correct on validation errors instead of throwing.
 */
export function createAutomation(
  spec: AutomationCreateSpec,
  opts: AutomationCreateOptions = {},
): AutomationCreateResult {
  if (!spec || typeof spec !== 'object') return err('spec', 'object', spec)
  if (!spec.name || typeof spec.name !== 'string') return err('name', 'non-empty string', spec.name)
  if (!spec.message || typeof spec.message !== 'string') return err('message', 'non-empty string', spec.message, 'The prompt the agent will execute when this automation fires.')
  if (!VALID_KINDS.has(spec.kind)) return err('kind', "'schedule' | 'hook' | 'webhook'", spec.kind)

  let config: Record<string, unknown> = {}

  if (spec.kind === 'schedule') {
    const s = spec.schedule
    if (!s || typeof s !== 'object') return err('schedule', 'object', s, "Required when kind='schedule'.")
    if (s.mode !== 'at' && s.mode !== 'every' && s.mode !== 'cron') return err('schedule.mode', "'at' | 'every' | 'cron'", s.mode)
    if (s.mode === 'at') {
      if (!s.at || typeof s.at !== 'string') return err('schedule.at', 'string (ISO 8601 or relative like "20m")', s.at)
      const when = resolveAt(s.at)
      if (when == null) return err('schedule.at', 'ISO 8601 timestamp or relative duration (20m, 2h, 45s)', s.at)
      config = { mode: 'at', at: new Date(when).toISOString(), deleteAfterRun: s.deleteAfterRun !== false }
    } else if (s.mode === 'every') {
      if (!s.every || typeof s.every !== 'string') return err('schedule.every', 'duration string (e.g. "30m", "2h")', s.every)
      const ms = parseDurationMs(s.every)
      if (ms == null) return err('schedule.every', 'duration string (e.g. "30m", "2h")', s.every)
      if (ms < 5_000) return err('schedule.every', 'at least 5s', s.every, 'Minimum interval is 5 seconds.')
      config = { mode: 'every', every: s.every, jitterSec: typeof s.jitterSec === 'number' ? s.jitterSec : undefined }
    } else {
      if (!s.cron || typeof s.cron !== 'string') return err('schedule.cron', 'cron expression', s.cron)
      if (!isValidCron(s.cron)) return err('schedule.cron', 'valid 5- or 6-field cron expression', s.cron)
      const tz = s.tz && typeof s.tz === 'string' ? s.tz : defaultTimezone()
      config = { mode: 'cron', cron: s.cron, tz }
    }
  } else if (spec.kind === 'hook') {
    if (!spec.hook || typeof spec.hook.event !== 'string' || !spec.hook.event) {
      return err('hook.event', 'non-empty string event name', spec.hook?.event, "e.g. 'meeting:saved', 'session:new'")
    }
    config = { event: spec.hook.event }
  } else if (spec.kind === 'webhook') {
    config = {}
    if (spec.webhook?.slug) config.slug = String(spec.webhook.slug)
    if (spec.webhook?.secret) config.secret = String(spec.webhook.secret)
  }

  const { resultDelivery, resultTarget } = normaliseDelivery(spec.delivery)

  const input: AutomationInput = {
    id: spec.id,
    kind: spec.kind,
    name: spec.name,
    description: spec.description ?? null,
    enabled: spec.enabled !== false,
    prompt: spec.message,
    toolsAllow: Array.isArray(spec.toolsAllow) ? spec.toolsAllow : [],
    config,
    resultDelivery,
    resultTarget,
  }

  const row = registry.upsert(input)

  // Auto-grant destructive-tool consent for chat-driven creation. The user
  // asking the agent to make the automation IS the consent.
  if (opts.fromAgent) {
    for (const tool of DESTRUCTIVE_TOOLS) {
      if (!consent.has(row.id, tool)) {
        try { consent.grant(row.id, tool, 'always') } catch { /* duplicate / non-fatal */ }
      }
    }
  }

  let webhookInfo: AutomationCreateOk['webhook']
  if (row.kind === 'webhook') {
    const w = ensureWebhook(row)
    webhookInfo = { slug: w.slug, localUrl: w.localUrl, publicUrl: w.publicUrl }
  }

  // Fan-out to scheduling / hook / webhook services.
  try { automationsRuntime.reload(row.id) } catch { /* non-fatal — UI still sees the row */ }

  return {
    ok: true,
    id: row.id,
    kind: row.kind,
    enabled: row.enabled,
    summary: summarise(row),
    webhook: webhookInfo,
  }
}
