import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const userData = (app as unknown as { getPath: (name: string) => string }).getPath('userData')

vi.mock('../../agent/permissions', () => ({
  PermissionStore: class {},
}))

const queryLoopSpy = vi.fn(async function* (_params: unknown) {
  yield { type: 'text_delta', content: 'ok' } as const
})
vi.mock('../../agent/query', () => ({
  queryLoop: (params: unknown) => queryLoopSpy(params),
}))

beforeAll(async () => {
  fs.mkdirSync(userData, { recursive: true })
  const dbPath = path.join(userData, 'wos.db')
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath)
  const { initDatabase } = await import('../../db')
  await initDatabase()
})

afterAll(() => {
  const dbPath = path.join(userData, 'wos.db')
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath)
})

describe('Task subagent preset wiring', () => {
  it('forwards the meeting agent system prompt to queryLoop', async () => {
    queryLoopSpy.mockClear()
    const { subAgentTool } = await import('../subAgent')
    const events: unknown[] = []
    const ctx = {
      parentModel: 'gpt-4o',
      parentMode: 'default' as const,
      parentReasoningEffort: undefined,
      parentApiKeyOverride: undefined,
      workspacePath: '/tmp/wos-test-ws',
      parentMessages: [],
      signal: new AbortController().signal,
      yieldEvent: async (e: unknown) => { events.push(e) },
      onPermissionRequest: async () => 'allow' as const,
      onAskUser: async () => 'noop',
    }
    const result = await subAgentTool.execute(
      {
        description: 'Summarize standup',
        prompt: 'Please summarize this transcript.',
        preset: 'meeting',
      },
      ctx as never,
    )
    expect(result.output).toContain('ok')
    expect(queryLoopSpy).toHaveBeenCalledTimes(1)
    const args = queryLoopSpy.mock.calls[0][0] as { systemPromptOverride?: string }
    expect(args.systemPromptOverride).toMatch(/WOS Meeting Agent/i)
  })
})
