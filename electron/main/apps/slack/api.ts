const SLACK_BASE = 'https://slack.com/api'

export async function slackCall<T = unknown>(
  method: string,
  token: string,
  body: Record<string, unknown> = {},
  opts: { isForm?: boolean } = {},
): Promise<T> {
  const url = `${SLACK_BASE}/${method}`
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': opts.isForm
        ? 'application/x-www-form-urlencoded; charset=utf-8'
        : 'application/json; charset=utf-8',
    },
  }
  if (opts.isForm) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || v === null) continue
      params.append(k, typeof v === 'string' ? v : JSON.stringify(v))
    }
    init.body = params.toString()
  } else {
    init.body = JSON.stringify(body)
  }

  const res = await fetch(url, init)
  if (!res.ok) {
    throw new Error(`Slack HTTP ${res.status}: ${await res.text().catch(() => '')}`)
  }
  const json = (await res.json()) as { ok: boolean; error?: string } & T
  if (!json.ok) {
    throw new Error(`Slack API error (${method}): ${json.error ?? 'unknown'}`)
  }
  return json as T
}

export async function authTest(token: string) {
  return slackCall<{
    ok: true
    url: string
    team: string
    user: string
    team_id: string
    user_id: string
    bot_id?: string
  }>('auth.test', token)
}
