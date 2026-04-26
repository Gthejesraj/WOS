import type { Tool } from '../../tools'
import { slackCall } from './api'

type SlackCreds = { botToken?: string; userToken?: string; signingSecret?: string }

/**
 * Pick the best token for a given op:
 *  - `search.messages` requires a user token;
 *  - most other ops work with a bot token.
 */
function token(creds: SlackCreds, prefer: 'bot' | 'user' = 'bot'): string {
  if (prefer === 'user') return creds.userToken || creds.botToken || ''
  return creds.botToken || creds.userToken || ''
}

function required(t: string, which: 'bot' | 'user') {
  if (!t) throw new Error(`Slack ${which} token is not configured`)
  return t
}

function truncate(obj: unknown, maxChars = 8000): string {
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)
  return s.length > maxChars ? s.slice(0, maxChars) + `\n…(truncated, ${s.length - maxChars} more chars)` : s
}

export function buildSlackTools(creds: SlackCreds): Tool[] {
  return [
    {
      name: 'SlackSendMessage',
      description: 'Send a message to a Slack channel, DM, or thread. Use channel ID or `#channel-name`.',
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Channel ID (preferred) or #channel-name or user ID for DMs.' },
          text: { type: 'string', description: 'Message text (mrkdwn supported).' },
          thread_ts: { type: 'string', description: 'Optional parent message ts to reply in thread.' },
        },
        required: ['channel', 'text'],
      },
      async execute(input) {
        const { channel, text, thread_ts } = input as { channel: string; text: string; thread_ts?: string }
        const res = await slackCall<{ ts: string; channel: string }>('chat.postMessage', required(token(creds, 'bot'), 'bot'), {
          channel, text, thread_ts,
        })
        return { output: `Sent message to ${res.channel} (ts=${res.ts}).` }
      },
    },
    {
      name: 'SlackListChannels',
      description: 'List Slack channels (public + private + DMs) the bot can see.',
      inputSchema: {
        type: 'object',
        properties: {
          types: { type: 'string', description: 'Comma-separated: public_channel,private_channel,mpim,im', default: 'public_channel,private_channel' },
          limit: { type: 'number', default: 100 },
        },
      },
      async execute(input) {
        const { types = 'public_channel,private_channel', limit = 100 } = input as { types?: string; limit?: number }
        const res = await slackCall<{ channels: Array<{ id: string; name: string; is_private: boolean; num_members?: number }> }>(
          'conversations.list',
          required(token(creds, 'bot'), 'bot'),
          { types, limit },
          { isForm: true },
        )
        const lines = res.channels.map(c => `- ${c.id}  #${c.name}${c.is_private ? ' (private)' : ''}${c.num_members ? ` [${c.num_members} members]` : ''}`)
        return { output: lines.join('\n') || '(no channels)' }
      },
    },
    {
      name: 'SlackSearchMessages',
      description: 'Search Slack messages (requires user token). Slack search query syntax supported.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          count: { type: 'number', default: 20 },
        },
        required: ['query'],
      },
      async execute(input) {
        const { query, count = 20 } = input as { query: string; count?: number }
        const t = required(token(creds, 'user'), 'user')
        const res = await slackCall<{ messages: { matches: Array<{ text: string; user?: string; ts: string; channel: { id: string; name?: string } }>; total: number } }>(
          'search.messages', t, { query, count }, { isForm: true },
        )
        const out = res.messages.matches.map(m => `[${m.channel.name ?? m.channel.id} ${m.ts}] ${m.user ?? '?'}: ${m.text}`)
        return { output: truncate(out.join('\n') + `\n\nTotal: ${res.messages.total}`) }
      },
    },
    {
      name: 'SlackGetChannelHistory',
      description: 'Fetch recent messages from a channel.',
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string' },
          limit: { type: 'number', default: 50 },
          oldest: { type: 'string', description: 'Optional unix ts (inclusive).' },
        },
        required: ['channel'],
      },
      async execute(input) {
        const { channel, limit = 50, oldest } = input as { channel: string; limit?: number; oldest?: string }
        const res = await slackCall<{ messages: Array<{ ts: string; user?: string; text: string }> }>(
          'conversations.history', required(token(creds, 'bot'), 'bot'), { channel, limit, oldest }, { isForm: true },
        )
        const lines = res.messages.map(m => `[${m.ts}] ${m.user ?? '?'}: ${m.text}`)
        return { output: truncate(lines.join('\n')) }
      },
    },
    {
      name: 'SlackGetUserInfo',
      description: 'Look up a Slack user by ID.',
      inputSchema: {
        type: 'object',
        properties: { user: { type: 'string' } },
        required: ['user'],
      },
      async execute(input) {
        const { user } = input as { user: string }
        const res = await slackCall<{ user: { id: string; name: string; real_name?: string; profile?: Record<string, unknown> } }>(
          'users.info', required(token(creds, 'bot'), 'bot'), { user }, { isForm: true },
        )
        return { output: truncate(res.user) }
      },
    },
    {
      name: 'SlackUploadFile',
      description: 'Upload a text snippet as a file into a channel (uses files.upload v2 external URL flow if needed; for simple text, uses legacy upload).',
      inputSchema: {
        type: 'object',
        properties: {
          channels: { type: 'string', description: 'Comma-separated channel IDs.' },
          content: { type: 'string', description: 'File content (text).' },
          filename: { type: 'string' },
          title: { type: 'string' },
          initial_comment: { type: 'string' },
        },
        required: ['channels', 'content', 'filename'],
      },
      async execute(input) {
        const { channels, content, filename, title, initial_comment } = input as {
          channels: string; content: string; filename: string; title?: string; initial_comment?: string
        }
        const res = await slackCall<{ file: { id: string; name: string; permalink: string } }>(
          'files.upload', required(token(creds, 'bot'), 'bot'), { channels, content, filename, title, initial_comment }, { isForm: true },
        )
        return { output: `Uploaded ${res.file.name} → ${res.file.permalink}` }
      },
    },
    {
      name: 'SlackCreateChannel',
      description: 'Create a new public or private channel.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          is_private: { type: 'boolean', default: false },
        },
        required: ['name'],
      },
      async execute(input) {
        const { name, is_private = false } = input as { name: string; is_private?: boolean }
        const res = await slackCall<{ channel: { id: string; name: string } }>(
          'conversations.create', required(token(creds, 'bot'), 'bot'), { name, is_private },
        )
        return { output: `Created ${res.channel.name} (${res.channel.id})` }
      },
    },
    {
      name: 'SlackReactToMessage',
      description: 'Add an emoji reaction to a message.',
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string' },
          timestamp: { type: 'string' },
          name: { type: 'string', description: 'Emoji name without colons (e.g. "thumbsup").' },
        },
        required: ['channel', 'timestamp', 'name'],
      },
      async execute(input) {
        const { channel, timestamp, name } = input as { channel: string; timestamp: string; name: string }
        await slackCall('reactions.add', required(token(creds, 'bot'), 'bot'), { channel, timestamp, name })
        return { output: `Reacted with :${name}:` }
      },
    },
    {
      name: 'SlackUpdateMessage',
      description: 'Edit a previously sent message by ts.',
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string' },
          ts: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['channel', 'ts', 'text'],
      },
      async execute(input) {
        const { channel, ts, text } = input as { channel: string; ts: string; text: string }
        await slackCall('chat.update', required(token(creds, 'bot'), 'bot'), { channel, ts, text })
        return { output: 'Updated message.' }
      },
    },
    {
      name: 'SlackDeleteMessage',
      description: 'Delete a message.',
      inputSchema: {
        type: 'object',
        properties: { channel: { type: 'string' }, ts: { type: 'string' } },
        required: ['channel', 'ts'],
      },
      async execute(input) {
        const { channel, ts } = input as { channel: string; ts: string }
        await slackCall('chat.delete', required(token(creds, 'bot'), 'bot'), { channel, ts })
        return { output: 'Deleted message.' }
      },
    },
    {
      name: 'SlackStartThread',
      description: 'Reply to a message to start/continue a thread.',
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string' },
          thread_ts: { type: 'string', description: 'Parent message ts.' },
          text: { type: 'string' },
        },
        required: ['channel', 'thread_ts', 'text'],
      },
      async execute(input) {
        const { channel, thread_ts, text } = input as { channel: string; thread_ts: string; text: string }
        const res = await slackCall<{ ts: string }>('chat.postMessage', required(token(creds, 'bot'), 'bot'), {
          channel, text, thread_ts,
        })
        return { output: `Replied in thread (ts=${res.ts}).` }
      },
    },
  ]
}
