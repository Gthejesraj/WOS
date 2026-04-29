import type { Tool } from '../../tools'
import type { AgentDef } from './index'

/**
 * Curated tool set for the meeting subagent. Allowlist by exact name + a
 * few prefixes for app-provided meeting-adjacent tools. Anything not on
 * the list is hidden from this agent.
 */
const MEETING_TOOL_ALLOW_EXACT = new Set<string>([
  'webFetch',
  'webSearch',
  'fileRead',
  'glob',
  'grep',
  'askUser',
  'read_skill',
  'read_rule',
])

const MEETING_TOOL_ALLOW_PREFIX = ['meeting_', 'google_', 'slack_']

export const meetingAgent: AgentDef = {
  key: 'meeting',
  toolFilter(allTools: Tool[]): Tool[] {
    return allTools.filter(t => {
      if (MEETING_TOOL_ALLOW_EXACT.has(t.name)) return true
      return MEETING_TOOL_ALLOW_PREFIX.some(p => t.name.startsWith(p))
    })
  },
}
