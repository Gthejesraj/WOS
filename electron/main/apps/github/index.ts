import type { AppModule } from '../types'
import { getAuthenticatedUser } from './api'
import { buildGitHubTools } from './tools'

export const githubApp: AppModule = {
  manifest: {
    id: 'github',
    name: 'GitHub',
    description: 'Manage repositories, issues, pull requests, and code from your WOS agent.',
    icon: 'github',
    scopes: ['repo', 'issues', 'pull_requests', 'notifications', 'code_search'],
    docsUrl: 'https://github.com/settings/tokens/new?scopes=repo,notifications&description=WOS+Integration',
    authFields: [
      {
        key: 'token',
        label: 'Personal Access Token',
        placeholder: 'ghp_… or github_pat_…',
        required: true,
        secret: true,
        helper: 'Create a token at github.com/settings/tokens → "Generate new token (classic)" with repo + notifications scopes, or use a fine-grained PAT.',
      },
    ],
  },
  async test(creds) {
    if (!creds.token) return { ok: false, error: 'Personal Access Token is required.' }
    try {
      const user = await getAuthenticatedUser(creds.token)
      return {
        ok: true,
        identity: {
          login: user.login,
          name: user.name,
          email: user.email,
        },
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  },
  buildTools(creds) {
    return buildGitHubTools(creds as { token: string })
  },
}
