import { describe, expect, it } from 'vitest'
import { getAgentDef } from '../agentDefs'
import type { Tool } from '../../tools'

const fakeTool = (name: string): Tool => ({
  name,
  description: `tool ${name}`,
  inputSchema: { type: 'object' },
  execute: async () => ({ output: '' }),
})

describe('agentDefs', () => {
  it('wos agent passes through every tool', () => {
    const def = getAgentDef('wos')!
    const all = ['fileRead', 'bash', 'meeting_list', 'slack_post', 'github_pr'].map(fakeTool)
    expect(def.toolFilter(all).map(t => t.name)).toEqual(all.map(t => t.name))
  })

  it('meeting agent curates to meeting/google/slack + a small core', () => {
    const def = getAgentDef('meeting')!
    const all = [
      'fileRead', 'fileWrite', 'bash', 'Task', 'webFetch', 'webSearch',
      'meeting_list', 'meeting_search', 'meeting_summarize',
      'google_calendar_list', 'slack_send', 'github_create_issue', 'mcp_random',
      'askUser', 'read_skill', 'read_rule', 'glob', 'grep',
    ].map(fakeTool)
    const got = def.toolFilter(all).map(t => t.name).sort()
    expect(got).toContain('meeting_list')
    expect(got).toContain('webFetch')
    expect(got).toContain('askUser')
    expect(got).toContain('google_calendar_list')
    expect(got).toContain('slack_send')
    expect(got).not.toContain('bash')
    expect(got).not.toContain('Task')
    expect(got).not.toContain('fileWrite')
    expect(got).not.toContain('github_create_issue')
    expect(got).not.toContain('mcp_random')
  })

  it('returns undefined for unknown agent keys', () => {
    expect(getAgentDef('does-not-exist')).toBeUndefined()
    expect(getAgentDef(null)).toBeUndefined()
  })
})
