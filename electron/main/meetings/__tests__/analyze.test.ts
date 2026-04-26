import { describe, expect, it } from 'vitest'
import { asResult, clampTranscript, SAVE_NOTES_TOOL_FOR_TESTS } from '../analyze'

describe('clampTranscript', () => {
  it('returns the transcript unchanged when under the budget', () => {
    const t = 'a'.repeat(100)
    expect(clampTranscript(t, 1000)).toBe(t)
  })

  it('keeps the head and tail and inserts a marker', () => {
    const head = 'H'.repeat(70)
    const tail = 'T'.repeat(40)
    const middle = 'M'.repeat(2000)
    const t = head + middle + tail
    const out = clampTranscript(t, 100)
    expect(out).toMatch(/transcript truncated/)
    expect(out.startsWith('H')).toBe(true)
    expect(out.endsWith('T')).toBe(true)
  })
})

describe('asResult', () => {
  it('coerces missing fields into empty defaults', () => {
    const out = asResult({})
    expect(out.summary).toBe('')
    expect(out.actionItems).toEqual([])
    expect(out.decisions).toEqual([])
    expect(out.openQuestions).toEqual([])
    expect(out.topics).toEqual([])
    expect(out.qa).toEqual([])
  })

  it('passes through valid arrays', () => {
    const out = asResult({
      summary: 'Hello',
      actionItems: [{ task: 'do x' }],
      decisions: [{ decision: 'd1' }],
      openQuestions: ['q1'],
    })
    expect(out.summary).toBe('Hello')
    expect(out.actionItems).toHaveLength(1)
    expect(out.decisions[0].decision).toBe('d1')
    expect(out.openQuestions).toEqual(['q1'])
  })

  it('drops non-array values silently', () => {
    const out = asResult({ actionItems: 'not an array', summary: 42 })
    expect(out.actionItems).toEqual([])
    expect(out.summary).toBe('')
  })
})

describe('SAVE_NOTES_TOOL schema', () => {
  it('uses an alphanumeric tool name accepted by both providers', () => {
    expect(SAVE_NOTES_TOOL_FOR_TESTS.name).toMatch(/^[a-zA-Z0-9_-]+$/)
  })

  it('declares the four required structured fields', () => {
    const required = (SAVE_NOTES_TOOL_FOR_TESTS.inputSchema as { required?: string[] }).required ?? []
    for (const k of ['summary', 'actionItems', 'decisions', 'openQuestions']) {
      expect(required).toContain(k)
    }
  })
})
