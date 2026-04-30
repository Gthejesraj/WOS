import type { Tool } from './index'
import { listConnections, listAvailableApps } from '../apps/manager'
import { listServers as listMcpServers, listTools as listMcpTools } from '../mcp/manager'
import { registry, type AutomationKind, type ResultDelivery } from '../automations/registry'
import { automationsRuntime } from '../automations'
import { isValidCron } from '../automations/cron'
import { ensureWebhook } from '../automations/webhooks'

interface SpecInput {
  id?: string
  kind: AutomationKind
  name: string
  description?: string
  prompt: string
  toolsAllow: string[]
  config: Record<string, unknown>
  resultDelivery?: ResultDelivery
  resultTarget?: string | null
}

/**
 * Stable hash of an automation spec.
 * Still used internally by automation_propose to generate proposalIds.
 */
function hashSpec(s: Partial<SpecInput>): string {
  const tools = Array.isArray(s.toolsAllow) ? [...s.toolsAllow].sort() : []
  const cfg = s.config ?? {}
  const cfgKeys = Object.keys(cfg).sort()
  const cfgCanon: Record<string, unknown> = {}
  for (const k of cfgKeys) cfgCanon[k] = (cfg as Record<string, unknown>)[k]
  const obj = {
    kind: s.kind ?? '',
    name: (s.name ?? '').trim(),
    prompt: (s.prompt ?? '').trim(),
    toolsAllow: tools,
    config: cfgCanon,
  }
  // Lightweight stable hash without pulling in crypto for renderer parity.
  const json = JSON.stringify(obj)
  let h1 = 0x811c9dc5
  for (let i = 0; i < json.length; i++) {
    h1 ^= json.charCodeAt(i)
    h1 = Math.imul(h1, 0x01000193)
  }
  return ('00000000' + (h1 >>> 0).toString(16)).slice(-8) + ':' + json.length
}

/** LRU-bounded proposal store (max 50 entries). Proposals are ephemeral — no DB. */
const PROPOSAL_MAX = 50
interface Proposal {
  spec: SpecInput
  preview: string
  warnings: string[]
  createdAt: number
}
const proposalStore = new Map<string, Proposal>()

function storeProposal(id: string, proposal: Proposal): void {
  proposalStore.set(id, proposal)
  // Evict oldest entry when over capacity
  if (proposalStore.size > PROPOSAL_MAX) {
    const oldestKey = proposalStore.keys().next().value
    if (oldestKey !== undefined) proposalStore.delete(oldestKey)
  }
}

function buildPreview(s: SpecInput): string {
  const lines: string[] = [
    `Name:    ${s.name}`,
    `Kind:    ${s.kind}`,
  ]
  if (s.description) lines.push(`Desc:    ${s.description}`)
  if (s.prompt) lines.push(`Prompt:  ${s.prompt.slice(0, 200)}${s.prompt.length > 200 ? '…' : ''}`)
  if (Array.isArray(s.toolsAllow) && s.toolsAllow.length) {
    lines.push(`Tools:   ${s.toolsAllow.join(', ')}`)
  }
  const cfg = (s.config ?? {}) as Record<string, unknown>
  // Kind-specific config summary
  switch (s.kind) {
    case 'cron': {
      const tz = (cfg.tz ?? cfg.timezone) as string | undefined
      if (cfg.expr) lines.push(`Schedule: ${cfg.expr}${tz ? ` (${tz})` : ''}`)
      break
    }
    case 'heartbeat':
      if (cfg.intervalSec) lines.push(`Interval: every ${cfg.intervalSec}s`)
      break
    case 'hook':
      if (cfg.event) lines.push(`Event:   ${cfg.event}`)
      break
    case 'webhook':
      lines.push('Trigger: inbound HTTPS webhook (slug + secret auto-generated on save)')
      break
    case 'standing_order':
      if (cfg.rule) lines.push(`Rule:    ${String(cfg.rule).slice(0, 200)}`)
      break
    case 'task_flow':
      if (Array.isArray(cfg.steps)) lines.push(`Steps:   ${cfg.steps.length}`)
      break
  }
  if (s.resultDelivery && s.resultDelivery !== 'silent') {
    lines.push(`Delivery: ${s.resultDelivery}${s.resultTarget ? ` → ${s.resultTarget}` : ''}`)
  }
  return lines.join('\n')
}

/**
 * Normalize a spec in-place:
 *  - canonicalize cron `config.timezone` → `config.tz`
 *  - drop empty top-level fields the runtime ignores
 */
function normalizeSpec(s: Partial<SpecInput>): void {
  if (!s || !s.config) return
  const cfg = s.config as Record<string, unknown>
  if (s.kind === 'cron') {
    if (cfg.timezone && !cfg.tz) {
      cfg.tz = cfg.timezone
    }
    if (cfg.timezone) delete cfg.timezone
  }
}

function validateSpec(s: Partial<SpecInput>): string | null {
  if (!s) return 'Spec is required.'
  if (!s.kind) return 'kind is required. Use one of: cron | heartbeat | hook | webhook | standing_order | task_flow | tasks_ledger.'
  if (!s.name || !s.name.trim()) return 'name is required (a short human label).'
  if (s.kind !== 'standing_order' && (!s.prompt || !s.prompt.trim())) {
    return `prompt is required for kind="${s.kind}". Put the natural-language instruction the worker should run here.`
  }
  if (!Array.isArray(s.toolsAllow)) return 'toolsAllow must be an array of tool names. Use [] only when no tools are needed.'
  normalizeSpec(s)
  const cfg = (s.config ?? {}) as Record<string, unknown>
  switch (s.kind) {
    case 'cron': {
      const expr = cfg.expr as string | undefined
      if (!expr) {
        return 'cron requires config.expr (5- or 6-field cron expression). Example: config: { expr: "0 9 * * *", tz: "UTC" }'
      }
      if (!isValidCron(expr)) {
        return `Invalid cron expression "${expr}". Must be a 5- or 6-field expression like "0 9 * * *" (every day at 9:00). Optional config.tz IANA zone (e.g. "America/Los_Angeles").`
      }
      break
    }
    case 'heartbeat': {
      const sec = Number(cfg.intervalSec ?? 0)
      if (!Number.isFinite(sec) || sec < 5) {
        return 'heartbeat requires config.intervalSec (integer seconds, minimum 5). Example: config: { intervalSec: 60 }'
      }
      break
    }
    case 'hook': {
      if (!cfg.event || typeof cfg.event !== 'string') {
        return 'hook requires config.event (string event name). Example: config: { event: "meeting:saved" }'
      }
      break
    }
    case 'webhook':
      // slug + secret are minted on save; no config required
      break
    case 'task_flow': {
      const steps = cfg.steps as unknown
      if (!Array.isArray(steps) || steps.length === 0) {
        return 'task_flow requires config.steps (non-empty array). Example: config: { steps: [{ name: "fetch", prompt: "…" }] }'
      }
      break
    }
    case 'standing_order': {
      const rule = cfg.rule as string | undefined
      if (!rule || !rule.trim()) {
        return 'standing_order requires config.rule (plain-English instruction). Example: config: { rule: "Always confirm before deleting." }'
      }
      break
    }
  }
  return null
}

const PROPOSE_DESCRIPTION = [
  'Validate an automation spec, generate a human-readable preview, and store it as a proposal.',
  'Returns { ok, proposalId, preview, spec, warnings } or { ok:false, error }.',
  'On user confirmation, call automation_save({ proposalId }) — do NOT re-call propose with the same input.',
  '',
  'Required fields per kind:',
  '  • cron           → config: { expr: "0 9 * * *", tz?: "UTC" }   // 5- or 6-field cron + optional IANA tz',
  '  • heartbeat      → config: { intervalSec: 300 }                // seconds, min 5',
  '  • hook           → config: { event: "meeting:saved" }          // WOS event name',
  '  • webhook        → config: {}                                  // slug+secret minted on save',
  '  • standing_order → config: { rule: "..." }                     // plain-English rule (no prompt needed)',
  '  • task_flow      → config: { steps: [{ name, prompt, requires_human? }] }',
  '',
  'Common fields: { kind, name, description?, prompt, toolsAllow: string[], resultDelivery?: silent|notify|chat|external, resultTarget? }.',
  'Pick toolsAllow names exactly as returned by automation_listTools — do not invent tool names.',
].join('\n')

export const automationTools: Tool[] = [
  {
    name: 'automation_listConnectedApps',
    description: 'List apps the user has connected (Slack, GitHub, Google, …). Use to discover what tools the automation can call.',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const conns = listConnections()
      const all = listAvailableApps()
      const byId = new Map(all.map(a => [a.id, a]))
      return {
        output: conns.map(c => ({
          appId: c.appId,
          name: byId.get(c.appId)?.name ?? c.appId,
          enabled: c.enabled,
        })),
      }
    },
  },
  {
    name: 'automation_listMcpServers',
    description: 'List configured MCP servers and (optionally) their tools.',
    inputSchema: {
      type: 'object',
      properties: {
        includeTools: { type: 'boolean', description: 'When true, include each server\'s exposed tool names.' },
      },
    },
    async execute(input) {
      const includeTools = (input as { includeTools?: boolean } | undefined)?.includeTools
      const servers = listMcpServers()
      if (!includeTools) {
        return { output: servers.map(s => ({ id: s.id, name: s.name, enabled: s.enabled })) }
      }
      const out: Array<{ id: string; name: string; enabled: boolean; tools: string[] }> = []
      for (const s of servers) {
        let toolNames: string[] = []
        try {
          const t = await listMcpTools(s.id)
          toolNames = t.map(x => x.name)
        } catch { /* offline / not connected */ }
        out.push({ id: s.id, name: s.name, enabled: s.enabled, tools: toolNames })
      }
      return { output: out }
    },
  },
  {
    name: 'automation_listTools',
    description: 'List all tools currently available to the WOS agent (built-ins + connected apps + MCP). Use to pick the smallest toolsAllow set.',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const { getAllTools } = await import('./index')
      const tools = getAllTools()
      return {
        output: tools.map(t => ({ name: t.name, description: t.description })),
      }
    },
  },
  {
    name: 'automation_proposeSpec',
    description:
      'Validate a proposed automation spec WITHOUT storing a proposal. Returns { ok, spec, error? }. ' +
      'Use this only for quick syntax checks — for the full propose→save flow use automation_propose.\n' +
      PROPOSE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['cron', 'heartbeat', 'hook', 'standing_order', 'task_flow', 'webhook'] },
        name: { type: 'string' },
        description: { type: 'string' },
        prompt: { type: 'string' },
        toolsAllow: { type: 'array', items: { type: 'string' } },
        config: {
          type: 'object',
          description: 'Kind-specific config. cron: { expr, tz? }. heartbeat: { intervalSec }. hook: { event }. webhook: {}. standing_order: { rule }. task_flow: { steps }.',
        },
        resultDelivery: { type: 'string', enum: ['silent', 'notify', 'chat', 'external'] },
        resultTarget: { type: 'string' },
      },
      required: ['kind', 'name'],
    },
    async execute(input) {
      const s = input as SpecInput
      const err = validateSpec(s)
      if (err) return { output: { ok: false, error: err, spec: s } }
      return { output: { ok: true, spec: s } }
    },
  },
  {
    name: 'automation_propose',
    description: PROPOSE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['cron', 'heartbeat', 'hook', 'standing_order', 'task_flow', 'webhook'] },
        name: { type: 'string' },
        description: { type: 'string' },
        prompt: { type: 'string', description: 'Natural-language instruction the worker runs. Required for all kinds except standing_order.' },
        toolsAllow: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tool names the worker may call. Pick from automation_listTools. [] is valid only for standing_order.',
        },
        config: {
          type: 'object',
          description: 'Kind-specific config. cron: { expr: "0 9 * * *", tz?: "UTC" }. heartbeat: { intervalSec: 300 }. hook: { event: "meeting:saved" }. webhook: {}. standing_order: { rule }. task_flow: { steps }.',
        },
        resultDelivery: { type: 'string', enum: ['silent', 'notify', 'chat', 'external'] },
        resultTarget: { type: 'string' },
      },
      required: ['kind', 'name'],
    },
    async execute(input) {
      const s = input as SpecInput
      const err = validateSpec(s)
      if (err) return { output: { ok: false, error: err } }
      const warnings: string[] = []
      // Warn if toolsAllow is empty for executable automations
      if (s.kind !== 'standing_order' && (!Array.isArray(s.toolsAllow) || s.toolsAllow.length === 0)) {
        warnings.push('toolsAllow is empty — the automation will run without any tools.')
      }
      const proposalId = hashSpec(s) + '-' + Date.now().toString(36)
      const preview = buildPreview(s)
      storeProposal(proposalId, { spec: s, preview, warnings, createdAt: Date.now() })
      return { output: { ok: true, proposalId, preview, spec: s, warnings } }
    },
  },
  {
    name: 'automation_dryRun',
    description: '[DEPRECATED] Use automation_propose instead. This tool is kept as a stub so in-flight prompts referencing it do not crash.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        name: { type: 'string' },
        prompt: { type: 'string' },
        toolsAllow: { type: 'array', items: { type: 'string' } },
        config: { type: 'object' },
      },
      required: ['kind', 'name', 'prompt'],
    },
    async execute(_input) {
      return {
        output: {
          deprecated: true,
          message: 'automation_dryRun is deprecated. Use automation_propose to generate a preview, then automation_save to persist.',
        },
      }
    },
  },
  {
    name: 'automation_save',
    description:
      'Persist a NEW automation. Accepts either { proposalId } (from automation_propose) or a full spec directly. ' +
      'The runtime is reloaded so cron/heartbeat/etc. start scheduling immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: { type: 'string', description: 'ID returned by automation_propose — use this path after user confirmation.' },
        kind: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        prompt: { type: 'string' },
        toolsAllow: { type: 'array', items: { type: 'string' } },
        config: { type: 'object' },
        resultDelivery: { type: 'string' },
        resultTarget: { type: 'string' },
        enabled: { type: 'boolean' },
      },
    },
    async execute(input) {
      const raw = input as ({ proposalId: string } | SpecInput) & { enabled?: boolean }
      let s: SpecInput
      if ('proposalId' in raw && raw.proposalId) {
        const proposal = proposalStore.get(raw.proposalId)
        if (!proposal) {
          return { output: { ok: false, error: `Proposal ${raw.proposalId} not found. Call automation_propose again to generate a new one.` } }
        }
        s = proposal.spec
      } else {
        s = raw as SpecInput & { enabled?: boolean }
      }
      const err = validateSpec(s)
      if (err) return { output: { ok: false, error: err } }
      const row = registry.upsert({
        kind: s.kind,
        name: s.name,
        description: s.description ?? null,
        prompt: s.prompt ?? '',
        toolsAllow: s.toolsAllow ?? [],
        config: s.config ?? {},
        resultDelivery: s.resultDelivery ?? 'silent',
        resultTarget: s.resultTarget ?? null,
        enabled: (raw as { enabled?: boolean }).enabled ?? true,
      })
      if ('proposalId' in raw && raw.proposalId) {
        proposalStore.delete(raw.proposalId)
      }
      if (row.kind === 'webhook') {
        const w = ensureWebhook(row)
        return { output: { ok: true, automation: row, webhook: w } }
      }
      automationsRuntime.reload(row.id)
      return { output: { ok: true, automation: row } }
    },
  },
  {
    name: 'automation_update',
    description: 'Update an existing automation by id. Pass only the fields to change. For major behavior changes (prompt/toolsAllow/config), consider calling automation_propose first to get user confirmation, but it is not required.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        prompt: { type: 'string' },
        toolsAllow: { type: 'array', items: { type: 'string' } },
        config: { type: 'object' },
        resultDelivery: { type: 'string' },
        resultTarget: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['id'],
    },
    async execute(input) {
      const s = input as Partial<SpecInput> & { id: string; enabled?: boolean }
      const existing = registry.get(s.id)
      if (!existing) return { output: { ok: false, error: `Automation ${s.id} not found.` } }
      const merged: SpecInput = {
        kind: existing.kind,
        name: s.name ?? existing.name,
        description: s.description ?? existing.description ?? undefined,
        prompt: s.prompt ?? existing.prompt,
        toolsAllow: s.toolsAllow ?? existing.toolsAllow,
        config: s.config ?? existing.config,
        resultDelivery: s.resultDelivery ?? existing.resultDelivery,
        resultTarget: s.resultTarget ?? existing.resultTarget,
      }
      const err = validateSpec(merged)
      if (err) return { output: { ok: false, error: err } }
      const row = registry.upsert({
        id: existing.id,
        kind: merged.kind,
        name: merged.name,
        description: merged.description ?? null,
        prompt: merged.prompt,
        toolsAllow: merged.toolsAllow,
        config: merged.config,
        resultDelivery: merged.resultDelivery,
        resultTarget: merged.resultTarget,
        enabled: s.enabled ?? existing.enabled,
      })
      automationsRuntime.reload(row.id)
      return { output: { ok: true, automation: row } }
    },
  },
  {
    name: 'automation_delete',
    description: 'Delete an automation by id. Stops any active scheduling/listening for it.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(input) {
      const id = (input as { id: string }).id
      const existing = registry.get(id)
      if (!existing) return { output: { ok: false, error: `Automation ${id} not found.` } }
      registry.delete(id)
      automationsRuntime.reload(id)
      return { output: { ok: true, id } }
    },
  },
  {
    name: 'automation_toggle',
    description: 'Enable or disable an automation by id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['id', 'enabled'],
    },
    async execute(input) {
      const { id, enabled } = input as { id: string; enabled: boolean }
      const row = registry.toggle(id, enabled)
      if (!row) return { output: { ok: false, error: `Automation ${id} not found.` } }
      automationsRuntime.reload(id)
      return { output: { ok: true, automation: row } }
    },
  },
  {
    name: 'automation_list',
    description: 'List existing automations. Optionally filter by kind or enabled state.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        enabled: { type: 'boolean' },
      },
    },
    async execute(input) {
      const { kind, enabled } = (input as { kind?: AutomationKind; enabled?: boolean } | undefined) ?? {}
      const rows = registry.list({ kind, enabled })
      return { output: rows }
    },
  },
  {
    name: 'automation_get',
    description: 'Fetch a single automation by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(input) {
      const id = (input as { id: string }).id
      const row = registry.get(id)
      if (!row) return { output: '', error: `Automation ${id} not found.` }
      return { output: row }
    },
  },
]
