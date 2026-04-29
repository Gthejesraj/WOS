import type { AgentDef } from './index'

/**
 * Default WOS agent definition. Sees every tool the registry composed —
 * built-ins, skills/rules, meetings, app tools, MCP tools.
 *
 * The system prompt here adds a small smart-routing instruction so the
 * agent knows to delegate meeting-specific work to the meeting subagent.
 */
export const wosAgent: AgentDef = {
  key: 'wos',
  systemPrompt: `\n## Subagent Routing\nWhen the user's request is primarily about meetings, recordings, calendar events, transcripts, action items, or follow-ups derived from a discussion, delegate to the meeting subagent via the Task tool with \`preset: "meeting"\`. Pass the full user prompt forward. Otherwise handle the request yourself. If the user explicitly addresses you ("WOS, ...") or asks about non-meeting topics, do NOT delegate.`,
  toolFilter: (allTools) => allTools,
}
