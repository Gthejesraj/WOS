import type { Tool } from '../../tools'
import type { AgentDef } from './index'

export const DEFAULT_PROJECTS_SYSTEM_PROMPT = `You are the WOS Projects subagent. The main WOS agent delegates project-scoped questions to you.

Your job:
- Answer questions about a specific project using its activity feed, summaries, resources, risks, decisions, and metrics.
- When project context is needed, call the wos_projects_* read tools (list, get, activity, summary, listResources, listRisks, listDecisions). Prefer the freshest data; regenerate the summary only if it is missing or older than ~6 hours.
- You may call upstream app tools (Slack, GitHub, Jira, Google) ONLY against resources linked to the active project. Never write to upstream systems unless the user explicitly asks.
- Return a concise structured response: a short executive summary, then bullet citations referencing source app + title + timestamp.
- If multiple projects could match the user's mention, ask the main agent (or user) for disambiguation via AskUser.
- Do not fabricate. If you don't have the data, say so and suggest a refresh.`

const PROJECTS_TOOL_ALLOW_EXACT = new Set<string>([
  'webFetch',
  'webSearch',
  'fileRead',
  'glob',
  'grep',
  'AskUser',
  'read_skill',
  'read_rule',
])

const PROJECTS_TOOL_ALLOW_PREFIX = [
  'wos_projects_',
  'github_',
  'gmail_',
  'google_',
  'slack_',
  'jira_',
  'drive_',
  'calendar_',
  'meeting_',
]

export const projectsAgent: AgentDef = {
  key: 'projects',
  systemPrompt: DEFAULT_PROJECTS_SYSTEM_PROMPT,
  defaultInheritFrom: 'wos',
  defaultConfig: {
    autoSummarize: true,
    summaryStaleHours: 6,
  },
  toolFilter(allTools: Tool[]): Tool[] {
    return allTools.filter(t => {
      if (PROJECTS_TOOL_ALLOW_EXACT.has(t.name)) return true
      return PROJECTS_TOOL_ALLOW_PREFIX.some(p => t.name.startsWith(p))
    })
  },
}
