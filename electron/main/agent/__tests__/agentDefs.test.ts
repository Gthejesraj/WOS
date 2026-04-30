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
      'askUser', 'AskUser', 'read_skill', 'read_rule', 'glob', 'grep',
    ].map(fakeTool)
    const got = def.toolFilter(all).map(t => t.name).sort()
    expect(got).toContain('meeting_list')
    expect(got).toContain('webFetch')
    expect(got).toContain('AskUser')
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

  it('meeting agent exposes the full meeting tool superset', () => {
    const def = getAgentDef('meeting')!
    const all = [
      'meeting_list', 'meeting_search', 'meeting_get', 'meeting_summarize',
      'meeting_extract_actions', 'meeting_rename', 'meeting_delete',
      'fileRead', 'fileWrite', 'bash',
    ].map(fakeTool)
    const got = def.toolFilter(all).map(t => t.name)
    for (const name of [
      'meeting_list', 'meeting_search', 'meeting_get', 'meeting_summarize',
      'meeting_extract_actions', 'meeting_rename', 'meeting_delete',
    ]) {
      expect(got, `meeting agent should expose ${name}`).toContain(name)
    }
  })

  it('wos agent system prompt advertises Task delegation for meeting work', () => {
    const def = getAgentDef('wos')!
    expect(def.systemPrompt ?? '').toMatch(/meeting subagent|preset.*meeting/i)
    expect(def.systemPrompt ?? '').toMatch(/Task tool/)
  })
})
