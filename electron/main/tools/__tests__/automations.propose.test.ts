/**
 * Unit tests for automation_propose tool behavior.
 *
 * We import only the tool definitions directly and test them in isolation.
 * Heavy runtime dependencies (registry, automationsRuntime, etc.) are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock external dependencies before importing automations.ts
vi.mock('../../apps/manager', () => ({
  listConnections: () => [],
  listAvailableApps: () => [],
}))
vi.mock('../../mcp/manager', () => ({
  listServers: () => [],
  listTools: async () => [],
}))
vi.mock('../../automations/registry', () => ({
  registry: {
    upsert: vi.fn(spec => ({ id: 'test-id', ...spec, createdAt: new Date(), updatedAt: new Date(), lastRunAt: null, nextRunAt: null, owner: null })),
    get: vi.fn(),
    list: vi.fn(() => []),
    delete: vi.fn(),
    toggle: vi.fn(),
  },
}))
vi.mock('../../automations', () => ({
  automationsRuntime: { reload: vi.fn() },
}))
vi.mock('../../automations/cron', () => ({
  isValidCron: (expr: string) => /^[\d\s\*\/\-,]+$/.test(expr),
}))
vi.mock('../../automations/webhooks', () => ({
  ensureWebhook: vi.fn(row => ({ slug: 'test-slug', secret: 'test-secret', row })),
}))

import { automationTools } from '../automations'
import type { ToolContext } from '../index'

const noopCtx = {} as ToolContext

function findTool(name: string) {
  const t = automationTools.find(x => x.name === name)
  if (!t) throw new Error(`Tool not found: ${name}`)
  return t
}

describe('automation_propose', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ok:false when kind is missing', async () => {
    const tool = findTool('automation_propose')
    const result = await tool.execute({ name: 'test' }, noopCtx)
    const out = result.output as { ok: boolean; error: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/kind/i)
  })

  it('returns ok:false when cron expression is invalid', async () => {
    const tool = findTool('automation_propose')
    const result = await tool.execute({
      kind: 'cron',
      name: 'My Cron',
      prompt: 'Do something',
      toolsAllow: ['webSearch'],
      config: { expr: 'not-a-cron' },
    }, noopCtx)
    const out = result.output as { ok: boolean; error: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/cron/i)
  })

  it('returns proposalId, preview, and spec on valid cron spec', async () => {
    const tool = findTool('automation_propose')
    const result = await tool.execute({
      kind: 'cron',
      name: 'Daily Digest',
      prompt: 'Send a digest',
      toolsAllow: ['webSearch'],
      config: { expr: '0 9 * * 1', timezone: 'America/New_York' },
    }, noopCtx)
    const out = result.output as { ok: boolean; proposalId: string; preview: string; spec: { config: Record<string, unknown> }; warnings: string[] }
    expect(out.ok).toBe(true)
    expect(out.proposalId).toMatch(/.+/)
    expect(out.preview).toContain('Daily Digest')
    expect(out.preview).toContain('cron')
    expect(out.preview).toContain('0 9 * * 1')
    // timezone must be normalized to tz (canonical field the runtime reads)
    expect(out.spec.config.tz).toBe('America/New_York')
    expect(out.spec.config.timezone).toBeUndefined()
    expect(Array.isArray(out.warnings)).toBe(true)
    expect(out.spec).toBeDefined()
  })

  it('warns when toolsAllow is empty for executable automation', async () => {
    const tool = findTool('automation_propose')
    const result = await tool.execute({
      kind: 'heartbeat',
      name: 'Silent Heartbeat',
      prompt: 'tick',
      toolsAllow: [],
      config: { intervalSec: 60 },
    }, noopCtx)
    const out = result.output as { ok: boolean; warnings: string[] }
    expect(out.ok).toBe(true)
    expect(out.warnings.length).toBeGreaterThan(0)
    expect(out.warnings[0]).toMatch(/toolsAllow/i)
  })

  it('does NOT warn about empty toolsAllow for standing_order', async () => {
    const tool = findTool('automation_propose')
    const result = await tool.execute({
      kind: 'standing_order',
      name: 'My Rule',
      toolsAllow: [],
      config: { rule: 'Always be polite.' },
    }, noopCtx)
    const out = result.output as { ok: boolean; warnings: string[] }
    expect(out.ok).toBe(true)
    expect(out.warnings).toHaveLength(0)
  })

  it('stores the proposal so automation_save can retrieve it by proposalId', async () => {
    const proposeTool = findTool('automation_propose')
    const saveTool = findTool('automation_save')
    const proposeResult = await proposeTool.execute({
      kind: 'hook',
      name: 'Meeting Saved Hook',
      prompt: 'Process meeting',
      toolsAllow: ['webSearch'],
      config: { event: 'meeting:saved' },
    }, noopCtx)
    const proposeOut = proposeResult.output as { ok: boolean; proposalId: string }
    expect(proposeOut.ok).toBe(true)

    const saveResult = await saveTool.execute({ proposalId: proposeOut.proposalId }, noopCtx)
    const saveOut = saveResult.output as { ok: boolean; automation: unknown }
    expect(saveOut.ok).toBe(true)
    expect(saveOut.automation).toBeDefined()
  })

  it('automation_save returns error for unknown proposalId', async () => {
    const saveTool = findTool('automation_save')
    const result = await saveTool.execute({ proposalId: 'nonexistent-id-xyz' }, noopCtx)
    const out = result.output as { ok: boolean; error: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/not found/i)
  })
})

describe('automation_dryRun (deprecated stub)', () => {
  it('returns deprecated message without throwing', async () => {
    const tool = findTool('automation_dryRun')
    const result = await tool.execute({
      kind: 'cron',
      name: 'old',
      prompt: 'do it',
      toolsAllow: [],
      config: { expr: '* * * * *' },
    }, noopCtx)
    const out = result.output as { deprecated: boolean; message: string }
    expect(out.deprecated).toBe(true)
    expect(out.message).toMatch(/deprecated/i)
    expect(out.message).toMatch(/automation_propose/i)
  })
})

describe('automation_update (no dryRun gate)', () => {
  it('allows behavior-field changes without requiring dryRun', async () => {
    const { registry } = await import('../../automations/registry')
    const mockGet = registry.get as ReturnType<typeof vi.fn>
    mockGet.mockReturnValue({
      id: 'abc123',
      kind: 'cron',
      name: 'Old Name',
      prompt: 'old prompt',
      toolsAllow: ['webSearch'],
      config: { expr: '0 9 * * 1', timezone: 'UTC' },
      resultDelivery: 'silent',
      resultTarget: null,
      enabled: true,
      description: null,
    })

    const tool = findTool('automation_update')
    const result = await tool.execute({
      id: 'abc123',
      prompt: 'brand new prompt',
    }, noopCtx)
    const out = result.output as { ok: boolean }
    expect(out.ok).toBe(true)
  })
})
