import type { AppModule } from '../types'
import { getMyself } from './api'
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
}
