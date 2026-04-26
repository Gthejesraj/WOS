import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { initDatabase, getDb, schema } from '../../db'
import { resolveAgent, DEFAULT_MEETING_SYSTEM_PROMPT } from '../settings'

const userData = (app as unknown as { getPath: (name: string) => string }).getPath('userData')

beforeAll(async () => {
  fs.mkdirSync(userData, { recursive: true })
  const dbPath = path.join(userData, 'wos.db')
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath)
  await initDatabase()
})

afterAll(() => {
  const dbPath = path.join(userData, 'wos.db')
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath)
})

describe('resolveAgent', () => {
  it('returns the meeting agent with seeded defaults', async () => {
    const agent = await resolveAgent('meeting')
    expect(agent.agentKey).toBe('meeting')
    expect(agent.inheritFrom).toBe('wos')
    expect(agent.config.liveSource).toBe('captions')
    expect(agent.config.autoSummarize).toBe(true)
    expect(agent.systemPrompt).toBe(DEFAULT_MEETING_SYSTEM_PROMPT)
  })

  it('inherits parent (wos) model when meeting row has none', async () => {
    const db = getDb()
    db.update(schema.agentSettings)
      .set({ model: 'gpt-4o-mini' })
      .where(((await import('drizzle-orm')).eq)(schema.agentSettings.agentKey, 'wos'))
      .run()
    const agent = await resolveAgent('meeting')
    expect(agent.model).toBe('gpt-4o-mini')
  })

  it('detects an inheritance cycle and throws', async () => {
    const db = getDb()
    const now = new Date()
    db.insert(schema.agentSettings)
      .values({
        agentKey: 'cycle-a',
        inheritFrom: 'cycle-b',
        model: null,
        mode: null,
        systemPrompt: null,
        configJson: {},
        createdAt: now,
        updatedAt: now,
      })
      .run()
    db.insert(schema.agentSettings)
      .values({
        agentKey: 'cycle-b',
        inheritFrom: 'cycle-a',
        model: null,
        mode: null,
        systemPrompt: null,
        configJson: {},
        createdAt: now,
        updatedAt: now,
      })
      .run()
    await expect(resolveAgent('cycle-a')).rejects.toThrow(/cycle/i)
  })
})
