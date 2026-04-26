import { describe, it, expect } from 'vitest'
import {
  modelSupportsReasoning,
  modelSupportsVision,
  getContextWindow,
  enrichModel,
} from '../electron/main/providers/capabilities'

describe('modelSupportsReasoning', () => {
  it('includes the GPT-5 family (regression: used to miss gpt-5.4)', () => {
    expect(modelSupportsReasoning('gpt-5')).toBe(true)
    expect(modelSupportsReasoning('gpt-5-mini')).toBe(true)
    expect(modelSupportsReasoning('gpt-5.4')).toBe(true)
    expect(modelSupportsReasoning('gpt-5.4-turbo')).toBe(true)
  })
  it('includes OpenAI o-series (o1..o99)', () => {
    expect(modelSupportsReasoning('o1')).toBe(true)
    expect(modelSupportsReasoning('o3')).toBe(true)
    expect(modelSupportsReasoning('o4-mini')).toBe(true)
    expect(modelSupportsReasoning('o10')).toBe(true)
  })
  it('includes Claude 4+ families', () => {
    expect(modelSupportsReasoning('claude-opus-4')).toBe(true)
    expect(modelSupportsReasoning('claude-sonnet-4.5')).toBe(true)
    expect(modelSupportsReasoning('claude-haiku-4')).toBe(true)
  })
  it('includes DeepSeek R-series and explicit reasoning/thinking variants', () => {
    expect(modelSupportsReasoning('deepseek-r1')).toBe(true)
    expect(modelSupportsReasoning('some-thinking-model')).toBe(true)
  })
  it('excludes non-reasoning models', () => {
    expect(modelSupportsReasoning('gpt-4o')).toBe(false)
    expect(modelSupportsReasoning('gpt-4.1')).toBe(false)
    expect(modelSupportsReasoning('claude-3.5-sonnet')).toBe(false)
  })
})

describe('modelSupportsVision', () => {
  it('matches known vision models', () => {
    expect(modelSupportsVision('gpt-4o')).toBe(true)
    expect(modelSupportsVision('gpt-5')).toBe(true)
    expect(modelSupportsVision('claude-opus-4')).toBe(true)
  })
})

describe('getContextWindow', () => {
  it('returns expected sizes', () => {
    expect(getContextWindow('gpt-5')).toBe(400_000)
    expect(getContextWindow('gpt-4.1')).toBe(1_000_000)
    expect(getContextWindow('claude-sonnet-4')).toBe(200_000)
  })
})

describe('enrichModel', () => {
  it('attaches capability flags', () => {
    const m = enrichModel({ id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai' })
    expect(m.supportsReasoning).toBe(true)
    expect(m.supportsVision).toBe(true)
    expect(m.contextWindow).toBe(400_000)
    expect(m.description).toContain('GPT-5')
  })
})
