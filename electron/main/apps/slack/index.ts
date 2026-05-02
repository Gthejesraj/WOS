import type { AppModule } from '../types'
import { authTest, slackCall } from './api'
import { buildSlackTools } from './tools'

export const slackApp: AppModule = {
  manifest: {
    id: 'slack',
    name: 'Slack',
    description: 'Send messages, search history, upload files, and manage channels from your WOS agent.',
    icon: 'slack',
    scopes: [
      'chat:write',
      'channels:read',
      'channels:history',
      'groups:read',
      'groups:history',
      'im:read',
      'im:history',
      'mpim:read',
      'mpim:history',
      'users:read',
      'files:write',
      'search:read (user token only)',
    ],
    docsUrl: 'https://api.slack.com/apps',
    authFields: [
      {
        key: 'botToken',
        label: 'Bot User OAuth Token',
        placeholder: 'xoxb-…',
        required: true,
        secret: true,
        helper: 'Install your Slack app to a workspace and copy the Bot User OAuth Token from “OAuth & Permissions”. Starts with xoxb-.',
      },
      {
        key: 'userToken',
        label: 'User OAuth Token (optional)',
        placeholder: 'xoxp-…',
        required: false,
        secret: true,
        helper: 'Required only for search.messages. Copy the User OAuth Token from the same “OAuth & Permissions” page. Starts with xoxp-.',
      },
      {
        key: 'signingSecret',
        label: 'Signing Secret (optional)',
        placeholder: '…',
        required: false,
        secret: true,
        helper: 'Only needed if you later want WOS to validate incoming Slack events. Found under “Basic Information → App Credentials”.',
      },
    ],
  },
  async test(creds) {
    const token = creds.botToken || creds.userToken
    if (!token) return { ok: false, error: 'Provide a bot token (xoxb-) or user token (xoxp-).' }
    try {
      const id = await authTest(token)
      return {
        ok: true,
        identity: {
          team: id.team,
          teamId: id.team_id,
          user: id.user,
          userId: id.user_id,
          botId: id.bot_id ?? null,
        },
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  },
  buildTools(creds) {
    return buildSlackTools(creds as { botToken?: string; userToken?: string; signingSecret?: string })
  },
  async snapshot(creds) {
    const token = (creds.botToken || creds.userToken) as string
    const [chansRes, usersRes] = await Promise.allSettled([
      slackCall<{ channels: Array<{ id: string; name: string; is_member: boolean; num_members: number }> }>(
        'conversations.list', token, { limit: 200, exclude_archived: true },
      ),
      slackCall<{ members: Array<{ id: string; name: string; real_name: string; is_bot: boolean; deleted: boolean }> }>(
        'users.list', token, { limit: 200 },
      ),
    ])
    const channels = chansRes.status === 'fulfilled'
      ? chansRes.value.channels
          .sort((a, b) => b.num_members - a.num_members)
          .map(c => ({ id: c.id, name: c.name, is_member: c.is_member, num_members: c.num_members }))
      : []
    const users = usersRes.status === 'fulfilled'
      ? usersRes.value.members
          .filter(m => !m.is_bot && !m.deleted)
          .map(m => ({ id: m.id, name: m.name, real_name: m.real_name }))
      : []
    return { channels, users }
  },
  projectResourceTypes() {
    return [
      {
        kind: 'slack:channel',
        label: 'Slack channel',
        description: 'Pin a channel — recent messages and mentions surface in Activity.',
        multiSelect: true,
        pickerComponentId: 'snapshot-list',
        snapshotScope: 'channels',
        refreshIntervalSec: 600,
        refSchema: {
          hint: 'Pick a channel from your workspace, or paste a channel id / share link.',
          fields: [
            { name: 'id', label: 'Channel id', type: 'text', required: true, placeholder: 'C0123ABCDEF' },
            { name: 'name', label: 'Display name', type: 'text', placeholder: '#engineering' },
          ],
          pasteParsers: [
            { regex: '/archives/(?<id>[A-Z0-9]+)', groupToField: { id: 'id' } },
            { regex: '^(?<id>[CDG][A-Z0-9]+)$', groupToField: { id: 'id' } },
          ],
        },
        refExamples: ['C0123ABCDEF', 'https://acme.slack.com/archives/C0123ABCDEF'],
        async fetcher(creds, ref) {
          const token = creds.botToken ?? creds.token
          if (!token) return []
          const channelId = extractRefId(ref)
          if (!channelId) return []
          try {
            const res = await slackCall<{
              messages?: Array<{ ts: string; user?: string; text?: string; bot_id?: string }>
              channel?: { name?: string }
            }>('conversations.history', token, { channel: channelId, limit: 20 })
            const teamUrl = (creds.teamUrl ?? '').replace(/\/$/, '')
            return (res.messages ?? []).map(m => ({
              id: m.ts,
              ts: Number(m.ts) * 1000,
              actor: m.user ?? m.bot_id ?? null,
              title: (m.text ?? '').slice(0, 200) || '(no text)',
              url: teamUrl ? `${teamUrl}/archives/${channelId}/p${m.ts.replace('.', '')}` : null,
            }))
          } catch (err) {
            console.error('[slack/fetcher] channel history failed', err)
            return []
          }
        },
      },
      {
        kind: 'slack:user',
        label: 'Slack person',
        description: 'Track DMs and @mentions involving this person.',
        multiSelect: true,
        pickerComponentId: 'snapshot-list',
        snapshotScope: 'users',
        refreshIntervalSec: 900,
        refSchema: {
          hint: 'Pick a teammate, or paste their Slack user id (starts with U).',
          fields: [
            { name: 'id', label: 'User id', type: 'text', required: true, placeholder: 'U01ABCDEFGH' },
            { name: 'name', label: 'Handle', type: 'text', placeholder: '@yashwanth' },
          ],
        },
        refExamples: ['U01ABCDEFGH'],
        async fetcher(creds, ref) {
          const token = creds.botToken ?? creds.token
          if (!token) return []
          const userId = extractRefId(ref)
          if (!userId) return []
          try {
            const open = await slackCall<{ channel?: { id: string } }>('conversations.open', token, { users: userId })
            const dmId = open.channel?.id
            if (!dmId) return []
            const res = await slackCall<{ messages?: Array<{ ts: string; user?: string; text?: string }> }>(
              'conversations.history', token, { channel: dmId, limit: 15 },
            )
            return (res.messages ?? []).map(m => ({
              id: `${dmId}-${m.ts}`,
              ts: Number(m.ts) * 1000,
              actor: m.user ?? null,
              title: (m.text ?? '').slice(0, 200) || '(dm)',
              url: null,
            }))
          } catch (err) {
            console.error('[slack/fetcher] dm history failed', err)
            return []
          }
        },
      },
    ]
  },
}

function extractRefId(ref: unknown): string | null {
  if (!ref) return null
  if (typeof ref === 'string') return ref
  if (typeof ref === 'object') {
    const r = ref as Record<string, unknown>
    if (typeof r.id === 'string') return r.id
    if (typeof r.channel === 'string') return r.channel
    if (typeof r.user === 'string') return r.user
  }
  return null
}
