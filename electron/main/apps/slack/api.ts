const SLACK_BASE = 'https://slack.com/api'

const SLACK_ERROR_MESSAGES: Record<string, string> = {
  not_authed: 'Slack token is missing. Please add your Bot Token in Settings → Apps → Slack.',
  invalid_auth: 'Slack token is invalid. Please check your Bot Token in Settings → Apps → Slack.',
  token_expired: 'Slack token has expired. Please reconnect Slack in Settings → Apps → Slack.',
  missing_scope: 'Your Slack app is missing a required permission scope. Check your app\'s OAuth scopes.',
  channel_not_found: 'Channel not found. Make sure the channel ID is correct and the bot is a member.',
  not_in_channel: 'The bot is not in this channel. Invite it with /invite @bot-name first.',
  ratelimited: 'Slack rate limit hit. Please wait a moment and try again.',
}

function humanizeSlackError(method: string, error: string): string {
  return SLACK_ERROR_MESSAGES[error] ?? `Slack API error (${method}): ${error}`
}

export async function slackCall<T = unknown>(
  method: string,
  token: string,
  body: Record<string, unknown> = {},
  opts: { isForm?: boolean } = {},
): Promise<T> {
  const url = `${SLACK_BASE}/${method}`
  const buildInit = (): RequestInit => {
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
    return init
  }

  let res = await fetch(url, buildInit())

  // HTTP 429 — Slack occasionally returns real HTTP 429 for Tier 1 methods
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? '1') * 1000
    await new Promise(r => setTimeout(r, Math.min(retryAfter, 10_000)))
    res = await fetch(url, buildInit())
  }

  if (!res.ok) {
    throw new Error(`Slack HTTP ${res.status}: ${await res.text().catch(() => '')}`)
  }
  const json = (await res.json()) as { ok: boolean; error?: string; headers?: Record<string, string> } & T
  if (!json.ok) {
    // API-level rate limit (ok: false, error: 'ratelimited')
    if (json.error === 'ratelimited') {
      await new Promise(r => setTimeout(r, 2000))
      const res2 = await fetch(url, buildInit())
      if (!res2.ok) throw new Error(`Slack HTTP ${res2.status} on retry`)
      const json2 = (await res2.json()) as { ok: boolean; error?: string } & T
      if (!json2.ok) throw new Error(humanizeSlackError(method, json2.error ?? 'ratelimited'))
      return json2 as T
    }
    throw new Error(humanizeSlackError(method, json.error ?? 'unknown'))
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
