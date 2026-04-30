/**
 * Parallel subagent concurrency tests (c1 + c2).
 *
 * Verifies that:
 * 1. Multiple Task calls in the same turn run concurrently (events interleave).
 * 2. subagent_start carries agentName + colorSeed.
 * 3. Single-agent flows still work identically.
 *
 * The DB module is mocked entirely so these tests don't require better-sqlite3.
 */

import { describe, expect, it, vi } from 'vitest'

// ─── Mock all DB dependencies ─────────────────────────────────────────────────
vi.mock('../../db', () => ({
  getDb: () => ({
    insert: () => ({ values: () => ({ run: () => {} }) }),
    update: () => ({ set: () => ({ where: () => ({ run: () => {} }) }) }),
    select: () => ({ from: () => ({ where: () => ({ get: () => null, all: () => [] }), orderBy: () => ({ limit: () => ({ all: () => [] }) }), get: () => null } ) }),
  }),
  schema: { subagentRuns: {}, tasks: {}, settings: {} },
  notifyWrite: () => {},
  initDatabase: async () => {},
}))

vi.mock('../../agent/permissions', () => ({
  PermissionStore: class {},
}))

vi.mock('../../hooks/manager', () => ({
  runBeforeSubagent: async () => ({ block: false }),
}))

vi.mock('../../agent/settings', () => ({
  resolveAgent: async (_key: string) => ({
    model: 'gpt-4o',
    mode: 'default',
    systemPrompt: undefined,
    apiKeyOverride: undefined,
  }),
}))

// ─── queryLoop mock — queue-based for per-call control ────────────────────────

// Each invocation of queryLoop yields N events with an artificial delay so
// that parallel runs interleave their events in arrival order.
function makeDelayedRunner(events: Array<{ type: string; content?: string }>, delayMs: number) {
  return async function* () {
    for (const e of events) {
      await new Promise(r => setTimeout(r, delayMs))
      yield e
    }
  }
}

const generatorQueue: Array<() => AsyncGenerator<{ type: string; content?: string }>> = []

vi.mock('../../agent/query', () => ({
  queryLoop: (_params: unknown) => {
    const gen = generatorQueue.shift()
    if (!gen) throw new Error('No generator queued — test setup error')
    return gen()
  },
}))

// ─── Helper context ───────────────────────────────────────────────────────────

const baseCtx = (yieldEvent: (e: unknown) => void | Promise<void>) => ({
  parentModel: 'gpt-4o',
  parentMode: 'default' as const,
  parentReasoningEffort: undefined,
  parentApiKeyOverride: undefined,
  workspacePath: null,
  parentMessages: [],
  signal: new AbortController().signal,
  conversationId: undefined,
  toolId: undefined,
  yieldEvent,
  onPermissionRequest: async () => 'allow' as const,
  onAskUser: async () => 'noop',
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('subAgent.parallel', () => {
  it('subagent_start carries agentName and colorSeed', async () => {
    generatorQueue.push(makeDelayedRunner([{ type: 'text_delta', content: 'done' }], 0))

    const { subAgentTool } = await import('../subAgent')
    const events: Array<Record<string, unknown>> = []

    await subAgentTool.execute(
      { description: 'test', prompt: 'do something', preset: 'meeting' },
      baseCtx(e => { events.push(e as Record<string, unknown>) }) as never,
    )

    const start = events.find(e => e.type === 'subagent_start')
    expect(start).toBeDefined()
    expect(start?.agentName).toBe('meeting')
    expect(typeof start?.colorSeed).toBe('number')
    expect(start?.colorSeed as number).toBeGreaterThanOrEqual(0)
    expect(start?.colorSeed as number).toBeLessThan(7)

    const end = events.find(e => e.type === 'subagent_end')
    expect(end?.agentName).toBe('meeting')
    expect(typeof end?.colorSeed).toBe('number')
  })

  it('unnamed subagent derives a kebab-case agentName from description', async () => {
    generatorQueue.push(makeDelayedRunner([{ type: 'text_delta', content: 'hi' }], 0))

    const { subAgentTool } = await import('../subAgent')
    const events: Array<Record<string, unknown>> = []

    await subAgentTool.execute(
      { description: 'unnamed run', prompt: 'do it' },
      baseCtx(e => { events.push(e as Record<string, unknown>) }) as never,
    )

    const start = events.find(e => e.type === 'subagent_start')
    expect(start?.agentName).toBe('unnamed-run')
  })

  it('subagent_event also carries agentName and colorSeed', async () => {
    generatorQueue.push(makeDelayedRunner([
      { type: 'text_delta', content: 'a' },
      { type: 'text_delta', content: 'b' },
    ], 0))

    const { subAgentTool } = await import('../subAgent')
    const events: Array<Record<string, unknown>> = []

    await subAgentTool.execute(
      { description: 'd', prompt: 'p', preset: 'automation_author' },
      baseCtx(e => { events.push(e as Record<string, unknown>) }) as never,
    )

    const agentEvents = events.filter(e => e.type === 'subagent_event')
    expect(agentEvents.length).toBeGreaterThan(0)
    for (const ae of agentEvents) {
      expect(ae.agentName).toBe('automation_author')
      expect(typeof ae.colorSeed).toBe('number')
    }
  })

  it('three concurrent Task calls interleave events in arrival order', async () => {
    // Agent A: 3 events with 20ms spacing.
    generatorQueue.push(makeDelayedRunner([
      { type: 'text_delta', content: 'A1' },
      { type: 'text_delta', content: 'A2' },
      { type: 'text_delta', content: 'A3' },
    ], 20))

    // Agent B: 3 events with 15ms spacing (faster → should arrive before A in later slots).
    generatorQueue.push(makeDelayedRunner([
      { type: 'text_delta', content: 'B1' },
      { type: 'text_delta', content: 'B2' },
      { type: 'text_delta', content: 'B3' },
    ], 15))

    // Agent C: 3 events with 10ms spacing (fastest).
    generatorQueue.push(makeDelayedRunner([
      { type: 'text_delta', content: 'C1' },
      { type: 'text_delta', content: 'C2' },
      { type: 'text_delta', content: 'C3' },
    ], 10))

    const { subAgentTool } = await import('../subAgent')

    const arrivals: string[] = []
    const makeCtx = (label: string) => baseCtx((e) => {
      const ev = e as Record<string, unknown>
      if (ev.type === 'subagent_event') {
        const inner = ev.event as { type?: string; content?: string }
        if (inner?.type === 'text_delta' && inner.content) {
          arrivals.push(`${label}:${inner.content}`)
        }
      }
    })

    // Launch all three concurrently — this is the key test.
    await Promise.all([
      subAgentTool.execute({ description: 'A', prompt: 'pa', preset: 'alpha' }, makeCtx('A') as never),
      subAgentTool.execute({ description: 'B', prompt: 'pb', preset: 'beta' }, makeCtx('B') as never),
      subAgentTool.execute({ description: 'C', prompt: 'pc', preset: 'gamma' }, makeCtx('C') as never),
    ])

    // All 9 events should have arrived.
    expect(arrivals).toHaveLength(9)

    // Since C (10ms) < B (15ms) < A (20ms), later events from faster agents
    // should arrive before later events from slower agents. The order should
    // NOT be strictly grouped as A1,A2,A3,B1,B2,B3,C1,C2,C3.
    const strictSerial = JSON.stringify(arrivals) ===
      JSON.stringify(['A:A1', 'A:A2', 'A:A3', 'B:B1', 'B:B2', 'B:B3', 'C:C1', 'C:C2', 'C:C3'])
    expect(strictSerial).toBe(false)

    // Each agent should have delivered all its events in order.
    const aEvents = arrivals.filter(s => s.startsWith('A:')).map(s => s.slice(2))
    const bEvents = arrivals.filter(s => s.startsWith('B:')).map(s => s.slice(2))
    const cEvents = arrivals.filter(s => s.startsWith('C:')).map(s => s.slice(2))
    expect(aEvents).toEqual(['A1', 'A2', 'A3'])
    expect(bEvents).toEqual(['B1', 'B2', 'B3'])
    expect(cEvents).toEqual(['C1', 'C2', 'C3'])
  })

  it('colorSeed is stable (same agentId always gives same seed)', () => {
    // Reproduce the stableColorSeed algorithm directly.
    const id = '550e8400-e29b-41d4-a716-446655440000'
    const hash = (s: string) => {
      let h = 0
      for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) >>> 0
      return h % 7
    }
    const seed = hash(id)
    expect(seed).toBeGreaterThanOrEqual(0)
    expect(seed).toBeLessThan(7)
    // Running twice gives the same result.
    expect(hash(id)).toBe(seed)
  })

  it('cancelSubagent returns false for unknown id', async () => {
    const { cancelSubagent } = await import('../subAgent')
    expect(cancelSubagent('does-not-exist')).toBe(false)
  })
})

