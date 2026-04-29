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
  skills: [
    {
      id: 'triage-issue',
      description: 'Standard procedure for triaging a new GitHub issue.',
      body: `# Triage a GitHub issue

When the user asks you to triage an issue:

1. Use \`github_get_issue\` to load the issue title, body, labels, and recent comments.
2. Skim the body for: reproducible repro steps, environment, and expected vs actual behavior.
3. If reproducible → suggest the labels \`bug\` + a priority (\`p0\`/\`p1\`/\`p2\`/\`p3\`).
   If feature request → suggest \`enhancement\`.
   If unclear / missing repro → suggest \`needs-info\` and draft a polite comment asking for the missing details.
4. Surface the proposed labels and (if applicable) the draft comment to the user via \`ask_user\` (kind: confirm) before writing.
5. After approval, apply via \`github_update_issue\` / \`github_create_comment\`.
`,
    },
    {
      id: 'review-pr',
      description: 'Walkthrough for reviewing a pull request.',
      body: `# Review a GitHub PR

1. \`github_get_pull_request\` for metadata + \`github_get_pr_files\` for the diff.
2. Read the PR description; if it's missing context, note that as the first review point.
3. Scan the diff for: obvious bugs, missing tests, security issues, style inconsistencies.
4. Group your findings into "Must fix" / "Suggestions" / "Nits".
5. Present a draft review summary to the user via \`ask_user\` (kind: confirm) before posting.
6. Post via \`github_create_pr_review\` once approved.
`,
    },
  ],
  hooks: {
    OnConnect: async (appId) => {
      if (appId === 'github') {
        console.log('[github] connected — skills are now available')
      }
    },
  },
}
