import type { Tool, ToolResult } from '../../tools'
import * as api from './api'

interface JiraCreds { baseUrl: string; email: string; token: string }

function wrapToolErrors(tools: Tool[]): Tool[] {
  return tools.map(t => ({
    ...t,
    execute: async (input: unknown, ctx: Parameters<Tool['execute']>[1]): Promise<ToolResult> => {
      try {
        return await t.execute(input, ctx)
      } catch (err) {
        return { output: '', error: err instanceof Error ? err.message : String(err) }
      }
    },
  }))
}

export function buildJiraTools(creds: JiraCreds): Tool[] {
  if (!creds.baseUrl || !creds.email || !creds.token) return []
  const { baseUrl, email, token } = creds
  const rawTools: Tool[] = [
    {
      name: 'JiraListProjects',
      description: 'List all accessible Jira projects.',
      readOnly: true,
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        const data = await api.listProjects(baseUrl, email, token)
        return { output: JSON.stringify(data.values, null, 2) }
      },
    },
    {
      name: 'JiraSearchIssues',
      description: 'Search Jira issues using JQL (Jira Query Language). Returns at most max_results issues plus an optional next_page_token. To page through more results, call again with the returned next_page_token. (Atlassian CHANGE-2046, April 2026: pagination is token-based; offsets are no longer supported and the `total` field is no longer returned by Jira.)',
      readOnly: true,
      inputSchema: {
        type: 'object',
        required: ['jql'],
        properties: {
          jql: { type: 'string', description: 'JQL query, e.g. "project=ENG AND status=Open ORDER BY created DESC"' },
          max_results: { type: 'number', description: 'Max issues to return per page (default: 50)' },
          next_page_token: { type: 'string', description: 'Opaque pagination token returned by a prior call. Omit on the first call.' },
        },
      },
      async execute(input) {
        const { jql, max_results, next_page_token } = input as { jql: string; max_results?: number; next_page_token?: string }
        const data = await api.searchIssuesPage(baseUrl, email, token, jql, {
          maxResults: max_results,
          nextPageToken: next_page_token,
        })
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'JiraGetIssue',
      description: 'Get details of a specific Jira issue including comments.',
      readOnly: true,
      inputSchema: {
        type: 'object',
        required: ['issue_key'],
        properties: {
          issue_key: { type: 'string', description: 'Issue key, e.g. ENG-123' },
        },
      },
      async execute(input) {
        const { issue_key } = input as { issue_key: string }
        const data = await api.getIssue(baseUrl, email, token, issue_key)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'JiraCreateIssue',
      description: 'Create a new Jira issue.',
      inputSchema: {
        type: 'object',
        required: ['project_key', 'issue_type', 'summary'],
        properties: {
          project_key: { type: 'string', description: 'Project key, e.g. ENG' },
          issue_type: { type: 'string', description: 'Issue type, e.g. Bug, Story, Task, Epic' },
          summary: { type: 'string', description: 'Issue title/summary' },
          description: { type: 'string', description: 'Issue description (plain text)' },
          priority: { type: 'string', description: 'Priority: Highest, High, Medium, Low, Lowest' },
        },
      },
      async execute(input) {
        const { project_key, issue_type, summary, description, priority } = input as { project_key: string; issue_type: string; summary: string; description?: string; priority?: string }
        const fields: Parameters<typeof api.createIssue>[3] = {
          project: { key: project_key },
          issuetype: { name: issue_type },
          summary,
        }
        if (description) {
          fields.description = {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }],
          }
        }
        if (priority) fields.priority = { name: priority }
        const data = await api.createIssue(baseUrl, email, token, fields)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'JiraUpdateIssue',
      description: 'Update fields on a Jira issue (summary, priority, etc.).',
      inputSchema: {
        type: 'object',
        required: ['issue_key'],
        properties: {
          issue_key: { type: 'string' },
          summary: { type: 'string' },
          priority: { type: 'string' },
        },
      },
      async execute(input) {
        const { issue_key, ...rest } = input as { issue_key: string; summary?: string; priority?: string }
        const fields: Record<string, unknown> = {}
        if (rest.summary) fields.summary = rest.summary
        if (rest.priority) fields.priority = { name: rest.priority }
        await api.updateIssue(baseUrl, email, token, issue_key, fields)
        return { output: `Issue ${issue_key} updated.` }
      },
    },
    {
      name: 'JiraAddComment',
      description: 'Add a comment to a Jira issue.',
      inputSchema: {
        type: 'object',
        required: ['issue_key', 'comment'],
        properties: {
          issue_key: { type: 'string' },
          comment: { type: 'string', description: 'Comment text' },
        },
      },
      async execute(input) {
        const { issue_key, comment } = input as { issue_key: string; comment: string }
        const data = await api.addComment(baseUrl, email, token, issue_key, comment)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'JiraAssignIssue',
      description: 'Assign a Jira issue to a user by their account ID.',
      inputSchema: {
        type: 'object',
        required: ['issue_key', 'account_id'],
        properties: {
          issue_key: { type: 'string' },
          account_id: { type: 'string', description: 'Atlassian account ID of the assignee' },
        },
      },
      async execute(input) {
        const { issue_key, account_id } = input as { issue_key: string; account_id: string }
        await api.assignIssue(baseUrl, email, token, issue_key, account_id)
        return { output: `Issue ${issue_key} assigned to account ${account_id}.` }
      },
    },
    {
      name: 'JiraTransitionIssue',
      description: 'Move a Jira issue to a different status (e.g. "In Progress", "Done").',
      inputSchema: {
        type: 'object',
        required: ['issue_key', 'status_name'],
        properties: {
          issue_key: { type: 'string' },
          status_name: { type: 'string', description: 'Target status name (e.g. "In Progress", "Done")' },
        },
      },
      async execute(input) {
        const { issue_key, status_name } = input as { issue_key: string; status_name: string }
        const { transitions } = await api.getTransitions(baseUrl, email, token, issue_key)
        const t = transitions.find(tr => tr.name.toLowerCase() === status_name.toLowerCase())
        if (!t) {
          const available = transitions.map(tr => tr.name).join(', ')
          return { output: `Transition "${status_name}" not found. Available: ${available}` }
        }
        await api.transitionIssue(baseUrl, email, token, issue_key, t.id)
        return { output: `Issue ${issue_key} transitioned to "${t.name}".` }
      },
    },
    {
      name: 'JiraGetBoards',
      description: 'List Jira boards (Scrum/Kanban).',
      readOnly: true,
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        const data = await api.getBoards(baseUrl, email, token)
        return { output: JSON.stringify(data.values, null, 2) }
      },
    },
    {
      name: 'JiraListSprints',
      description: 'List sprints for a Jira board.',
      readOnly: true,
      inputSchema: {
        type: 'object',
        required: ['board_id'],
        properties: {
          board_id: { type: 'number', description: 'Board ID' },
          state: { type: 'string', enum: ['active', 'future', 'closed'], description: 'Sprint state filter' },
        },
      },
      async execute(input) {
        const { board_id, state } = input as { board_id: number; state?: string }
        const data = await api.getSprints(baseUrl, email, token, board_id, state)
        return { output: JSON.stringify(data.values, null, 2) }
      },
    },
  ]
  return wrapToolErrors(rawTools)
}
