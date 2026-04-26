import { describe, expect, it } from 'vitest'
import { meetingTools } from '../meetings'

const VALID = /^[a-zA-Z0-9_-]+$/

describe('meeting tool naming', () => {
  it('every meeting tool name conforms to the OpenAI/Anthropic regex', () => {
    for (const t of meetingTools) {
      expect(t.name, `tool '${t.name}' must match ${VALID}`).toMatch(VALID)
    }
  })

  it('exposes the six-tool surface the agent expects', () => {
    const names = meetingTools.map(t => t.name).sort()
    expect(names).toEqual(
      [
        'meeting_join',
        'meeting_leave',
        'meeting_status',
        'meeting_list',
        'meeting_search',
        'meeting_summarize',
      ].sort()
    )
  })

  it('every tool exposes a JSON-schema describable input shape', () => {
    for (const t of meetingTools) {
      expect(t.inputSchema).toBeTypeOf('object')
      expect((t.inputSchema as { type?: string }).type).toBe('object')
    }
  })

  it('every tool has a non-empty description (so the model knows when to call it)', () => {
    for (const t of meetingTools) {
      expect(t.description.length, `'${t.name}' has empty description`).toBeGreaterThan(10)
    }
  })

  it('produces no duplicate tool names', () => {
    const counts = new Map<string, number>()
    for (const t of meetingTools) counts.set(t.name, (counts.get(t.name) ?? 0) + 1)
    const dupes = [...counts.entries()].filter(([, c]) => c > 1)
    expect(dupes).toEqual([])
  })
})
