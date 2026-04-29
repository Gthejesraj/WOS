function basicAuth(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
}

async function jiraFetch<T = unknown>(
  baseUrl: string,
  path: string,
  email: string,
  token: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: basicAuth(email, token),
      Accept: 'application/json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    if (res.status === 401) throw new Error('Invalid credentials. Check your Atlassian email and API token at id.atlassian.com/manage-profile/security/api-tokens.')
    if (res.status === 403) throw new Error('Access denied. Make sure your Atlassian account has access to this Jira workspace.')
    if (res.status === 404) throw new Error('Jira workspace not found. Check your Base URL (e.g. https://yourorg.atlassian.net).')
    if (res.status === 429) throw new Error('Jira rate limit reached. Try again in a minute.')
    const text = await res.text().catch(() => '')
    let msg = text
    try {
      const parsed = JSON.parse(text) as { message?: string; errorMessages?: string[] }
      msg = parsed.message ?? parsed.errorMessages?.[0] ?? text
    } catch { /* ignore */ }
    throw new Error(`Jira API error (${res.status}): ${msg}`)
  }
  return res.json() as Promise<T>
}

export async function getMyself(baseUrl: string, email: string, token: string) {
  return jiraFetch<{ accountId: string; displayName: string; emailAddress: string }>(
    baseUrl, '/rest/api/3/myself', email, token,
  )
}

// Atlassian CHANGE-2046 (April 2026): /rest/api/3/project/search was deprecated in favour
// of token-paginated endpoints. The successor /rest/api/3/projects/paginated is not yet
// rolled out everywhere, so we keep calling /project/search but accept either response shape.
export async function listProjects(baseUrl: string, email: string, token: string) {
  return jiraFetch<{ values: unknown[] }>(baseUrl, '/rest/api/3/project/search?maxResults=50', email, token)
}

const ISSUE_FIELDS = ['summary', 'status', 'assignee', 'priority', 'issuetype', 'created', 'updated', 'description', 'comment']

// Atlassian CHANGE-2046 (April 2026): the legacy POST /rest/api/3/search endpoint is gone
// (returns 410 Gone). We now hit /rest/api/3/search/jql, which uses token-based pagination
// and dropped the `total` field from responses. Callers that previously relied on `total`
// receive `issues.length` as a best-effort fallback.
export async function searchIssues(baseUrl: string, email: string, token: string, jql: string, maxResults = 50) {
  const data = await searchIssuesPage(baseUrl, email, token, jql, { maxResults })
  return { issues: data.issues, total: data.issues.length, nextPageToken: data.nextPageToken, isLast: data.isLast }
}

export async function searchIssuesPage(
  baseUrl: string,
  email: string,
  token: string,
  jql: string,
  opts: { maxResults?: number; nextPageToken?: string; fields?: string[] } = {},
) {
  const body: Record<string, unknown> = {
    jql,
    maxResults: opts.maxResults ?? 50,
    fields: opts.fields ?? ISSUE_FIELDS,
  }
  if (opts.nextPageToken) body.nextPageToken = opts.nextPageToken
  return jiraFetch<{ issues: unknown[]; nextPageToken?: string; isLast?: boolean }>(
    baseUrl, '/rest/api/3/search/jql', email, token, { method: 'POST', body },
  )
}

export async function getIssue(baseUrl: string, email: string, token: string, issueKey: string) {
  return jiraFetch<unknown>(baseUrl, `/rest/api/3/issue/${issueKey}?expand=names,renderedFields`, email, token)
}

export async function createIssue(
  baseUrl: string, email: string, token: string,
  fields: { project: { key: string }; issuetype: { name: string }; summary: string; description?: unknown; priority?: { name: string } },
) {
  return jiraFetch<{ id: string; key: string }>(baseUrl, '/rest/api/3/issue', email, token, {
    method: 'POST',
    body: { fields },
  })
}

export async function updateIssue(baseUrl: string, email: string, token: string, issueKey: string, fields: Record<string, unknown>) {
  return jiraFetch<unknown>(baseUrl, `/rest/api/3/issue/${issueKey}`, email, token, {
    method: 'PUT',
    body: { fields },
  })
}

export async function addComment(baseUrl: string, email: string, token: string, issueKey: string, body: string) {
  return jiraFetch<unknown>(baseUrl, `/rest/api/3/issue/${issueKey}/comment`, email, token, {
    method: 'POST',
    body: {
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }],
      },
    },
  })
}

export async function assignIssue(baseUrl: string, email: string, token: string, issueKey: string, accountId: string) {
  return jiraFetch<unknown>(baseUrl, `/rest/api/3/issue/${issueKey}/assignee`, email, token, {
    method: 'PUT',
    body: { accountId },
  })
}

export async function getTransitions(baseUrl: string, email: string, token: string, issueKey: string) {
  return jiraFetch<{ transitions: Array<{ id: string; name: string }> }>(
    baseUrl, `/rest/api/3/issue/${issueKey}/transitions`, email, token,
  )
}

export async function transitionIssue(baseUrl: string, email: string, token: string, issueKey: string, transitionId: string) {
  return jiraFetch<unknown>(baseUrl, `/rest/api/3/issue/${issueKey}/transitions`, email, token, {
    method: 'POST',
    body: { transition: { id: transitionId } },
  })
}

export async function getBoards(baseUrl: string, email: string, token: string) {
  return jiraFetch<{ values: unknown[] }>(baseUrl, '/rest/agile/1.0/board?maxResults=50', email, token)
}

export async function getSprints(baseUrl: string, email: string, token: string, boardId: number, state?: string) {
  const q = state ? `?state=${state}` : ''
  return jiraFetch<{ values: unknown[] }>(baseUrl, `/rest/agile/1.0/board/${boardId}/sprint${q}`, email, token)
}
