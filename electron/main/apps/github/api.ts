const GITHUB_BASE = 'https://api.github.com'

async function githubFetch<T = unknown>(
  path: string,
  token: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${GITHUB_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? '2') * 1000
    await new Promise(r => setTimeout(r, Math.min(retryAfter, 10_000)))
    const retried = await fetch(`${GITHUB_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
    if (retried.status === 429) throw new Error('GitHub rate limit reached. Please wait a minute before trying again.')
    if (!retried.ok) {
      const text = await retried.text().catch(() => '')
      let msg = text
      try { msg = (JSON.parse(text) as { message?: string }).message ?? text } catch { /* ignore */ }
      throw new Error(`GitHub API error (${retried.status}): ${msg}`)
    }
    if (retried.status === 204) return {} as T
    return retried.json() as Promise<T>
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error('Invalid token. Regenerate your GitHub Personal Access Token at github.com/settings/tokens.')
    if (res.status === 403) throw new Error('Access denied. Make sure the token has the required scopes (repo, notifications).')
    const text = await res.text().catch(() => '')
    let msg = text
    try { msg = (JSON.parse(text) as { message?: string }).message ?? text } catch { /* ignore */ }
    throw new Error(`GitHub API error (${res.status}): ${msg}`)
  }
  if (res.status === 204) return {} as T
  return res.json() as Promise<T>
}

export async function getAuthenticatedUser(token: string) {
  return githubFetch<{ login: string; name: string; email: string; avatar_url: string }>(
    '/user', token,
  )
}

export async function listRepos(token: string, params: { visibility?: string; sort?: string; per_page?: number; page?: number }) {
  const q = new URLSearchParams()
  if (params.visibility) q.set('visibility', params.visibility)
  if (params.sort) q.set('sort', params.sort)
  q.set('per_page', String(params.per_page ?? 30))
  q.set('page', String(params.page ?? 1))
  return githubFetch<unknown[]>(`/user/repos?${q}`, token)
}

export async function getRepo(token: string, owner: string, repo: string) {
  return githubFetch<unknown>(`/repos/${owner}/${repo}`, token)
}

export async function createRepo(token: string, body: { name: string; private?: boolean; description?: string; auto_init?: boolean }) {
  return githubFetch<unknown>('/user/repos', token, { method: 'POST', body })
}

export async function listBranches(token: string, owner: string, repo: string) {
  return githubFetch<unknown[]>(`/repos/${owner}/${repo}/branches`, token)
}

export async function createBranch(token: string, owner: string, repo: string, branchName: string, fromSha: string) {
  return githubFetch<unknown>(`/repos/${owner}/${repo}/git/refs`, token, {
    method: 'POST',
    body: { ref: `refs/heads/${branchName}`, sha: fromSha },
  })
}

export async function listIssues(token: string, owner: string, repo: string, params: { state?: string; labels?: string; assignee?: string; per_page?: number; page?: number }) {
  const q = new URLSearchParams()
  if (params.state) q.set('state', params.state)
  if (params.labels) q.set('labels', params.labels)
  if (params.assignee) q.set('assignee', params.assignee)
  q.set('per_page', String(params.per_page ?? 30))
  q.set('page', String(params.page ?? 1))
  return githubFetch<unknown[]>(`/repos/${owner}/${repo}/issues?${q}`, token)
}

export async function getIssue(token: string, owner: string, repo: string, number: number) {
  const [issue, comments] = await Promise.all([
    githubFetch<unknown>(`/repos/${owner}/${repo}/issues/${number}`, token),
    githubFetch<unknown[]>(`/repos/${owner}/${repo}/issues/${number}/comments`, token),
  ])
  return { issue, comments }
}

export async function createIssue(token: string, owner: string, repo: string, body: { title: string; body?: string; labels?: string[]; assignees?: string[] }) {
  return githubFetch<unknown>(`/repos/${owner}/${repo}/issues`, token, { method: 'POST', body })
}

export async function updateIssue(token: string, owner: string, repo: string, number: number, body: { title?: string; body?: string; state?: string; labels?: string[] }) {
  return githubFetch<unknown>(`/repos/${owner}/${repo}/issues/${number}`, token, { method: 'PATCH', body })
}

export async function addIssueComment(token: string, owner: string, repo: string, number: number, comment: string) {
  return githubFetch<unknown>(`/repos/${owner}/${repo}/issues/${number}/comments`, token, { method: 'POST', body: { body: comment } })
}

export async function listPRs(token: string, owner: string, repo: string, params: { state?: string; per_page?: number; page?: number }) {
  const q = new URLSearchParams()
  if (params.state) q.set('state', params.state)
  q.set('per_page', String(params.per_page ?? 30))
  q.set('page', String(params.page ?? 1))
  return githubFetch<unknown[]>(`/repos/${owner}/${repo}/pulls?${q}`, token)
}

export async function getPR(token: string, owner: string, repo: string, number: number) {
  const [pr, reviews] = await Promise.all([
    githubFetch<unknown>(`/repos/${owner}/${repo}/pulls/${number}`, token),
    githubFetch<unknown[]>(`/repos/${owner}/${repo}/pulls/${number}/reviews`, token),
  ])
  return { pr, reviews }
}

export async function createPR(token: string, owner: string, repo: string, body: { title: string; head: string; base: string; body?: string; draft?: boolean }) {
  return githubFetch<unknown>(`/repos/${owner}/${repo}/pulls`, token, { method: 'POST', body })
}

export async function getFileContent(token: string, owner: string, repo: string, path: string, ref?: string) {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  const data = await githubFetch<{ content?: string; encoding?: string; name: string; path: string; size: number }>(
    `/repos/${owner}/${repo}/contents/${path}${q}`, token,
  )
  if (data.content && data.encoding === 'base64') {
    data.content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8')
  }
  return data
}

export async function searchCode(token: string, query: string, per_page = 10) {
  const q = new URLSearchParams({ q: query, per_page: String(per_page) })
  return githubFetch<{ items: unknown[] }>(`/search/code?${q}`, token)
}

export async function listNotifications(token: string, all = false) {
  const q = all ? '?all=true' : ''
  return githubFetch<unknown[]>(`/notifications${q}`, token)
}

export async function markNotificationsRead(token: string) {
  return githubFetch<unknown>('/notifications', token, { method: 'PUT', body: {} })
}
