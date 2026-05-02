import type { AppModule } from '../types'
import { getAuthenticatedUser, listRepos, listIssues, listPRs } from './api'
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
  async snapshot(creds) {
    const repos = await listRepos(creds.token, { sort: 'pushed', per_page: 100 })
    const mapped = (repos as Array<{ full_name: string; description: string | null; default_branch: string }>).map(r => ({
      full_name: r.full_name,
      description: r.description,
      default_branch: r.default_branch,
    }))
    return { repos: mapped }
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
  projectResourceTypes() {
    return [
      {
        kind: 'github:repo',
        label: 'GitHub repository',
        description: 'Track PRs, issues and recent commits for this repo.',
        multiSelect: true,
        pickerComponentId: 'snapshot-list',
        snapshotScope: 'repos',
        refreshIntervalSec: 1200,
        refSchema: {
          hint: 'Pick a repo you have access to, or paste owner/name.',
          fields: [
            { name: 'owner', label: 'Owner / org', type: 'text', required: true, placeholder: 'octocat' },
            { name: 'repo', label: 'Repository', type: 'text', required: true, placeholder: 'hello-world' },
          ],
          pasteParsers: [
            { regex: 'github\\.com/(?<owner>[^/\\s]+)/(?<repo>[^/\\s.]+)', groupToField: { owner: 'owner', repo: 'repo' } },
            { regex: '^(?<owner>[^/\\s]+)/(?<repo>[^/\\s.]+)$', groupToField: { owner: 'owner', repo: 'repo' } },
          ],
        },
        refExamples: ['octocat/hello-world', 'https://github.com/octocat/hello-world'],
        async fetcher(creds, ref) {
          if (!creds.token) return []
          const parsed = parseRepoRef(ref)
          if (!parsed) return []
          const { owner, repo } = parsed
          try {
            const [issues, prs] = await Promise.all([
              listIssues(creds.token, owner, repo, { state: 'all', per_page: 20 }).catch(() => [] as unknown[]),
              listPRs(creds.token, owner, repo, { state: 'all', per_page: 20 }).catch(() => [] as unknown[]),
            ])
            const evIssues = (issues as Array<{
              id: number; number: number; title: string; updated_at: string; html_url: string;
              user?: { login: string }; pull_request?: unknown; node_id?: string;
            }>)
              .filter(i => !i.pull_request)
              .map(i => ({
                id: i.node_id ?? `issue-${i.id}`,
                ts: Date.parse(i.updated_at) || Date.now(),
                actor: i.user?.login ?? null,
                title: `#${i.number} ${i.title}`,
                url: i.html_url,
              }))
            const evPRs = (prs as Array<{
              id: number; number: number; title: string; updated_at: string; html_url: string;
              user?: { login: string }; node_id?: string; state?: string; draft?: boolean;
            }>).map(p => ({
              id: p.node_id ?? `pr-${p.id}`,
              ts: Date.parse(p.updated_at) || Date.now(),
              actor: p.user?.login ?? null,
              title: `PR #${p.number} ${p.title}${p.draft ? ' (draft)' : ''}`,
              url: p.html_url,
            }))
            return [...evIssues, ...evPRs]
          } catch (err) {
            console.error('[github/fetcher] failed', err)
            return []
          }
        },
      },
    ]
  },
}

function parseRepoRef(ref: unknown): { owner: string; repo: string } | null {
  if (!ref) return null
  if (typeof ref === 'string') {
    const m = ref.match(/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/)
    if (m) return { owner: m[1], repo: m[2] }
    return null
  }
  if (typeof ref === 'object') {
    const r = ref as Record<string, unknown>
    if (typeof r.owner === 'string' && typeof r.repo === 'string') return { owner: r.owner, repo: r.repo }
    if (typeof r.full_name === 'string' && r.full_name.includes('/')) {
      const [owner, repo] = r.full_name.split('/')
      return { owner, repo }
    }
    if (typeof r.name === 'string' && r.name.includes('/')) {
      const [owner, repo] = r.name.split('/')
      return { owner, repo }
    }
  }
  return null
}
