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
  systemPrompt: `\n## Asking the user\nANY clarifying question, confirmation, choice, or request for missing input MUST go through the \`AskUser\` tool. NEVER ask the user a question in plain prose / assistant text. Pick the most specific \`kind\`: \`picker\` for resource selection (channel/repo/calendar/meeting), \`choice\` for enums, \`confirm\` for yes/no, \`fileDrop\` for file inputs, \`form\` only when multiple fields are truly needed, \`text\` as last resort. Ask AT MOST one focused question per turn.\n\n## Subagent Routing\nWhen the user's request is primarily about meetings, recordings, calendar events, transcripts, action items, or follow-ups derived from a discussion, delegate to the meeting subagent via the Task tool with \`preset: "meeting"\`.\n\nWhen the user wants to CREATE, EDIT, INSPECT, ENABLE/DISABLE, or DELETE an automation — anything involving scheduling, recurring jobs, cron timing, heartbeats, one-shot reminders, lifecycle hooks, webhooks, event triggers ("when X happens, do Y"), standing orders / persistent rules, multi-step task flows, or the tasks ledger — delegate to the automation author subagent via the Task tool with \`preset: "automation_author"\`. Pass the full user prompt forward.\n\nOtherwise handle the request yourself. If the user explicitly addresses you ("WOS, ...") or asks about non-meeting, non-automation topics, do NOT delegate.`,
  toolFilter: (allTools) => allTools,
}
