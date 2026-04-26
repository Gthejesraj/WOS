import type { AppModule } from '../types'
import { authTest } from './api'
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
}
