import type { AppModule } from '../types'
import { getMyself, listProjects, searchIssues } from './api'
import { buildJiraTools } from './tools'

export const jiraApp: AppModule = {
  manifest: {
    id: 'jira',
    name: 'Jira',
    description: 'Browse projects, manage issues, transitions, and sprints from your WOS agent.',
    icon: 'jira',
    scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user'],
    docsUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    authFields: [
      {
        key: 'baseUrl',
        label: 'Jira Base URL',
        placeholder: 'https://yourcompany.atlassian.net',
        required: true,
        helper: 'Your Atlassian workspace URL — typically https://<your-org>.atlassian.net',
      },
      {
        key: 'email',
        label: 'Atlassian Email',
        placeholder: 'you@company.com',
        required: true,
        helper: 'The email address associated with your Atlassian account.',
      },
      {
        key: 'token',
        label: 'API Token',
        placeholder: 'ATATT3xFfGF0…',
        required: true,
        secret: true,
        helper: 'Generate an API token at id.atlassian.com/manage-profile/security/api-tokens.',
      },
    ],
  },
  async test(creds) {
    if (!creds.baseUrl) return { ok: false, error: 'Jira Base URL is required.' }
    if (!creds.email) return { ok: false, error: 'Email is required.' }
    if (!creds.token) return { ok: false, error: 'API Token is required.' }
    try {
      const me = await getMyself(creds.baseUrl, creds.email, creds.token)
      return {
        ok: true,
        identity: {
          accountId: me.accountId,
          displayName: me.displayName,
          email: me.emailAddress,
        },
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  },
  buildTools(creds) {
    return buildJiraTools(creds as { baseUrl: string; email: string; token: string })
  },
  async snapshot(creds) {
    const data = await listProjects(creds.baseUrl, creds.email, creds.token)
    const projects = (data.values as Array<{ key: string; name: string; projectTypeKey: string }>).map(p => ({
      key: p.key,
      name: p.name,
      projectTypeKey: p.projectTypeKey,
    }))
    return { projects }
  },
  projectResourceTypes() {
    return [
      {
        kind: 'jira:project',
        label: 'Jira project',
        description: 'Pull issues, sprints and priority changes from this project.',
        multiSelect: true,
        pickerComponentId: 'snapshot-list',
        snapshotScope: 'projects',
        refreshIntervalSec: 1200,
        refSchema: {
          hint: 'Pick a project, or paste its key.',
          fields: [
            { name: 'key', label: 'Project key', type: 'text', required: true, placeholder: 'ATL' },
            { name: 'name', label: 'Display name', type: 'text', placeholder: 'Atlas Mobile' },
          ],
        },
        refExamples: ['ATL', 'PLAT', 'WEB'],
        async fetcher(creds, ref) {
          if (!creds.baseUrl || !creds.email || !creds.token) return []
          const projectKey = extractProjectKey(ref)
          if (!projectKey) return []
          try {
            const data = await searchIssues(
              creds.baseUrl, creds.email, creds.token,
              `project = "${projectKey}" ORDER BY updated DESC`, 25,
            )
            return mapJiraIssues(data.issues, creds.baseUrl)
          } catch (err) {
            console.error('[jira/fetcher] project failed', err)
            return []
          }
        },
      },
      {
        kind: 'jira:epic',
        label: 'Jira epic / JQL',
        description: 'Free-text JQL or epic key — issues matching the query are tracked.',
        multiSelect: true,
        pickerComponentId: 'jql-input',
        refreshIntervalSec: 1500,
        refSchema: {
          hint: 'Either an epic key or a JQL query.',
          fields: [
            { name: 'jql', label: 'JQL query', type: 'textarea', placeholder: 'project = ATL AND statusCategory != Done' },
            { name: 'epic', label: 'Epic key', type: 'text', placeholder: 'ATL-42' },
          ],
        },
        refExamples: ['project = ATL ORDER BY updated DESC', '"Epic Link" = ATL-42'],
        async fetcher(creds, ref) {
          if (!creds.baseUrl || !creds.email || !creds.token) return []
          const jql = extractJql(ref)
          if (!jql) return []
          try {
            const data = await searchIssues(creds.baseUrl, creds.email, creds.token, jql, 25)
            return mapJiraIssues(data.issues, creds.baseUrl)
          } catch (err) {
            console.error('[jira/fetcher] epic/jql failed', err)
            return []
          }
        },
      },
    ]
  },
}

function extractProjectKey(ref: unknown): string | null {
  if (!ref) return null
  if (typeof ref === 'string') return ref
  if (typeof ref === 'object') {
    const r = ref as Record<string, unknown>
    if (typeof r.key === 'string') return r.key
    if (typeof r.id === 'string') return r.id
  }
  return null
}

function extractJql(ref: unknown): string | null {
  if (!ref) return null
  if (typeof ref === 'string') return ref
  if (typeof ref === 'object') {
    const r = ref as Record<string, unknown>
    if (typeof r.jql === 'string') return r.jql
    if (typeof r.query === 'string') return r.query
    if (typeof r.epic === 'string') return `"Epic Link" = ${r.epic} ORDER BY updated DESC`
    if (typeof r.key === 'string') return `"Epic Link" = ${r.key} ORDER BY updated DESC`
  }
  return null
}

function mapJiraIssues(issues: unknown[], baseUrl: string) {
  const url = baseUrl.replace(/\/$/, '')
  return (issues as Array<{
    id: string; key: string;
    fields: {
      summary?: string; updated?: string; created?: string;
      assignee?: { displayName?: string } | null;
      status?: { name?: string } | null;
      priority?: { name?: string } | null;
    };
  }>).map(i => ({
    id: i.key,
    ts: Date.parse(i.fields?.updated ?? i.fields?.created ?? '') || Date.now(),
    actor: i.fields?.assignee?.displayName ?? null,
    title: `${i.key} ${i.fields?.summary ?? ''}${i.fields?.status?.name ? ` [${i.fields.status.name}]` : ''}`,
    url: `${url}/browse/${i.key}`,
  }))
}
