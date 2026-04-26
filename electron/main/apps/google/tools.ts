import type { Tool } from '../../tools'
import type { GoogleCreds } from './api'
import * as api from './api'

function parseEmailHeaders(payload: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {}
  const h = (payload.headers ?? []) as Array<{ name: string; value: string }>
  for (const { name, value } of h) headers[name.toLowerCase()] = value
  return headers
}

function extractBody(payload: Record<string, unknown>, depth = 0): string {
  if (depth > 4) return ''
  const data = payload.body as { data?: string } | undefined
  if (data?.data) {
    try { return Buffer.from(data.data, 'base64url').toString('utf-8') } catch { return '' }
  }
  const parts = (payload.parts ?? []) as Array<Record<string, unknown>>
  for (const part of parts) {
    const mimeType = part.mimeType as string | undefined
    if (mimeType === 'text/plain') {
      const text = extractBody(part, depth + 1)
      if (text) return text
    }
  }
  for (const part of parts) {
    const text = extractBody(part, depth + 1)
    if (text) return text
  }
  return ''
}

export function buildGoogleTools(creds: GoogleCreds): Tool[] {
  return [
    /* ─── Gmail ─── */
    {
      name: 'GmailListEmails',
      description: 'List emails from Gmail inbox. Optionally filter by label or search query.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query (e.g. "is:unread from:boss@co.com")' },
          max_results: { type: 'number', description: 'Max emails to return (default: 20)' },
        },
      },
      async execute(input) {
        const { query, max_results } = (input ?? {}) as { query?: string; max_results?: number }
        const data = await api.listMessages(creds, query, max_results)
        const ids = (data.messages ?? []).slice(0, max_results ?? 20)
        const messages = await Promise.all(ids.map(m => api.getMessage(creds, m.id)))
        const result = messages.map(msg => {
          const hdrs = parseEmailHeaders(msg.payload as Record<string, unknown>)
          return {
            id: msg.id,
            from: hdrs.from,
            to: hdrs.to,
            subject: hdrs.subject,
            date: hdrs.date,
            snippet: msg.snippet,
          }
        })
        return { output: JSON.stringify(result, null, 2) }
      },
    },
    {
      name: 'GmailGetEmail',
      description: 'Read the full content of a Gmail email by message ID.',
      inputSchema: {
        type: 'object',
        required: ['message_id'],
        properties: {
          message_id: { type: 'string', description: 'Gmail message ID (from GmailListEmails)' },
        },
      },
      async execute(input) {
        const { message_id } = input as { message_id: string }
        const msg = await api.getMessage(creds, message_id)
        const hdrs = parseEmailHeaders(msg.payload as Record<string, unknown>)
        const body = extractBody(msg.payload as Record<string, unknown>)
        return {
          output: JSON.stringify({
            id: msg.id,
            threadId: msg.threadId,
            from: hdrs.from,
            to: hdrs.to,
            cc: hdrs.cc,
            subject: hdrs.subject,
            date: hdrs.date,
            body: body.slice(0, 8000),
          }, null, 2),
        }
      },
    },
    {
      name: 'GmailSendEmail',
      description: 'Send an email via Gmail.',
      inputSchema: {
        type: 'object',
        required: ['to', 'subject', 'body'],
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          cc: { type: 'string', description: 'CC email address (optional)' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body (plain text)' },
          thread_id: { type: 'string', description: 'Thread ID to reply to (optional)' },
        },
      },
      async execute(input) {
        const { to, subject, body, cc, thread_id } = input as { to: string; subject: string; body: string; cc?: string; thread_id?: string }
        const data = await api.sendMessage(creds, to, subject, body, cc, thread_id)
        return { output: `Email sent. Message ID: ${(data as { id?: string }).id ?? 'unknown'}` }
      },
    },
    {
      name: 'GmailSearchEmails',
      description: 'Search Gmail using Gmail query syntax.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Gmail search query, e.g. "from:alice@co.com after:2024/01/01 subject:invoice"' },
          max_results: { type: 'number', description: 'Max results (default: 10)' },
        },
      },
      async execute(input) {
        const { query, max_results } = input as { query: string; max_results?: number }
        const data = await api.listMessages(creds, query, max_results ?? 10)
        const ids = (data.messages ?? []).slice(0, max_results ?? 10)
        const messages = await Promise.all(ids.map(m => api.getMessage(creds, m.id)))
        const result = messages.map(msg => {
          const hdrs = parseEmailHeaders(msg.payload as Record<string, unknown>)
          return { id: msg.id, from: hdrs.from, subject: hdrs.subject, date: hdrs.date, snippet: msg.snippet }
        })
        return { output: JSON.stringify(result, null, 2) }
      },
    },
    {
      name: 'GmailCreateDraft',
      description: 'Create a Gmail draft without sending.',
      inputSchema: {
        type: 'object',
        required: ['to', 'subject', 'body'],
        properties: {
          to: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string' },
        },
      },
      async execute(input) {
        const { to, subject, body } = input as { to: string; subject: string; body: string }
        const data = await api.createDraft(creds, to, subject, body)
        return { output: JSON.stringify(data, null, 2) }
      },
    },

    /* ─── Calendar ─── */
    {
      name: 'GoogleCalendarListEvents',
      description: 'List upcoming Google Calendar events.',
      inputSchema: {
        type: 'object',
        properties: {
          time_min: { type: 'string', description: 'Start time (ISO 8601). Defaults to now.' },
          time_max: { type: 'string', description: 'End time (ISO 8601).' },
          max_results: { type: 'number', description: 'Max events to return (default: 20).' },
        },
      },
      async execute(input) {
        const { time_min, time_max, max_results } = (input ?? {}) as { time_min?: string; time_max?: string; max_results?: number }
        const data = await api.listCalendarEvents(creds, time_min, time_max, max_results)
        return { output: JSON.stringify(data.items, null, 2) }
      },
    },
    {
      name: 'GoogleCalendarGetEvent',
      description: 'Get details of a specific Google Calendar event.',
      inputSchema: {
        type: 'object',
        required: ['event_id'],
        properties: {
          event_id: { type: 'string', description: 'Calendar event ID' },
        },
      },
      async execute(input) {
        const { event_id } = input as { event_id: string }
        const data = await api.getCalendarEvent(creds, event_id)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GoogleCalendarCreateEvent',
      description: 'Create a Google Calendar event. Can include a Google Meet video conference link.',
      inputSchema: {
        type: 'object',
        required: ['summary', 'start_time', 'end_time'],
        properties: {
          summary: { type: 'string', description: 'Event title' },
          description: { type: 'string', description: 'Event description' },
          start_time: { type: 'string', description: 'Start time in ISO 8601 (e.g. 2025-06-15T14:00:00)' },
          end_time: { type: 'string', description: 'End time in ISO 8601' },
          time_zone: { type: 'string', description: 'Timezone (e.g. America/New_York). Defaults to UTC.' },
          attendees: { type: 'array', items: { type: 'string' }, description: 'Email addresses of attendees' },
          add_meet_link: { type: 'boolean', description: 'Generate a Google Meet link for this event' },
        },
      },
      async execute(input) {
        const { summary, description, start_time, end_time, time_zone, attendees, add_meet_link } = input as {
          summary: string; description?: string; start_time: string; end_time: string
          time_zone?: string; attendees?: string[]; add_meet_link?: boolean
        }
        const tz = time_zone ?? 'UTC'
        const data = await api.createCalendarEvent(creds, {
          summary,
          description,
          start: { dateTime: start_time, timeZone: tz },
          end: { dateTime: end_time, timeZone: tz },
          attendees: attendees?.map(email => ({ email })),
          addMeetLink: add_meet_link,
        })
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GoogleCalendarUpdateEvent',
      description: 'Update an existing Google Calendar event.',
      inputSchema: {
        type: 'object',
        required: ['event_id'],
        properties: {
          event_id: { type: 'string' },
          summary: { type: 'string' },
          description: { type: 'string' },
          start_time: { type: 'string' },
          end_time: { type: 'string' },
          time_zone: { type: 'string' },
        },
      },
      async execute(input) {
        const { event_id, summary, description, start_time, end_time, time_zone } = input as {
          event_id: string; summary?: string; description?: string
          start_time?: string; end_time?: string; time_zone?: string
        }
        const updates: Record<string, unknown> = {}
        if (summary) updates.summary = summary
        if (description) updates.description = description
        const tz = time_zone ?? 'UTC'
        if (start_time) updates.start = { dateTime: start_time, timeZone: tz }
        if (end_time) updates.end = { dateTime: end_time, timeZone: tz }
        const data = await api.updateCalendarEvent(creds, event_id, updates)
        return { output: JSON.stringify(data, null, 2) }
      },
    },

    /* ─── Drive ─── */
    {
      name: 'GoogleDriveListFiles',
      description: 'List files in Google Drive.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Drive query, e.g. "name contains \'report\'" or "mimeType=\'application/pdf\'"' },
          page_size: { type: 'number', description: 'Max files to return (default: 20)' },
        },
      },
      async execute(input) {
        const { query, page_size } = (input ?? {}) as { query?: string; page_size?: number }
        const data = await api.listDriveFiles(creds, query, page_size)
        return { output: JSON.stringify(data.files, null, 2) }
      },
    },
    {
      name: 'GoogleDriveGetFile',
      description: 'Get a Google Drive file\'s metadata and content (for text files).',
      inputSchema: {
        type: 'object',
        required: ['file_id'],
        properties: {
          file_id: { type: 'string', description: 'Google Drive file ID' },
        },
      },
      async execute(input) {
        const { file_id } = input as { file_id: string }
        const data = await api.getDriveFile(creds, file_id)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GoogleDriveUploadFile',
      description: 'Upload text content as a new file to Google Drive.',
      inputSchema: {
        type: 'object',
        required: ['name', 'content'],
        properties: {
          name: { type: 'string', description: 'File name (with extension)' },
          content: { type: 'string', description: 'Text content to upload' },
          mime_type: { type: 'string', description: 'MIME type (default: text/plain)' },
          folder_id: { type: 'string', description: 'Parent folder ID (optional)' },
        },
      },
      async execute(input) {
        const { name, content, mime_type, folder_id } = input as { name: string; content: string; mime_type?: string; folder_id?: string }
        const data = await api.uploadDriveFile(creds, name, content, mime_type, folder_id)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GoogleDriveCreateFolder',
      description: 'Create a new folder in Google Drive.',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Folder name' },
          parent_id: { type: 'string', description: 'Parent folder ID (optional)' },
        },
      },
      async execute(input) {
        const { name, parent_id } = input as { name: string; parent_id?: string }
        const data = await api.createDriveFolder(creds, name, parent_id)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
  ]
}
