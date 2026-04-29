import type { Tool } from './index'
import {
  getMeeting,
  listMeetings,
  searchMeetings,
  deleteMeetings,
  renameMeeting,
} from '../meetings/store'
import { analyzeTranscript } from '../meetings/analyze'

// IMPORTANT: Tool names must match `^[a-zA-Z0-9_-]+$` for OpenAI's Responses API
// (Anthropic enforces the same). Dots in names cause an immediate 400 from
// OpenAI which poisons EVERY chat turn that loads these tools — that's the
// "Invalid 'tools[N].name'" error users hit when sending a chat message after
// the meeting registry was added. Always use underscores here.
export const meetingTools: Tool[] = [
  {
    name: 'meeting_list',
    description: 'List recently saved meetings (most recent first).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max number of meetings to return (default 100).' },
      },
    },
    async execute(input) {
      const limit = (input as { limit?: number } | undefined)?.limit
      const all = listMeetings()
      return { output: typeof limit === 'number' ? all.slice(0, limit) : all }
    },
  },
  {
    name: 'meeting_search',
    description: 'Search saved meeting transcripts and summaries by free-text query.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    async execute(input) {
      return { output: searchMeetings((input as { query: string }).query) }
    },
  },
  {
    name: 'meeting_get',
    description: 'Fetch full meeting record by id (includes transcript, summary, action items).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(input) {
      const m = getMeeting((input as { id: string }).id)
      if (!m) return { output: {}, error: 'Meeting not found.' }
      return { output: m }
    },
  },
  {
    name: 'meeting_summarize',
    description: 'Analyze or re-summarize a saved meeting by id. Returns summary + action items + decisions.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(input, ctx) {
      const meeting = getMeeting((input as { id: string }).id)
      if (!meeting?.transcript) return { output: {}, error: 'Meeting not found or has no transcript.' }
      const result = await analyzeTranscript(meeting.transcript, meeting.title, ctx.signal)
      return { output: result }
    },
  },
  {
    name: 'meeting_extract_actions',
    description: 'Extract just the action items from a saved meeting (uses summarize under the hood).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(input, ctx) {
      const meeting = getMeeting((input as { id: string }).id)
      if (!meeting?.transcript) return { output: {}, error: 'Meeting not found or has no transcript.' }
      const result = await analyzeTranscript(meeting.transcript, meeting.title, ctx.signal)
      return { output: { actionItems: result.actionItems, decisions: result.decisions } }
    },
  },
  {
    name: 'meeting_rename',
    description: 'Rename a saved meeting.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
      },
      required: ['id', 'title'],
    },
    async execute(input) {
      const { id, title } = input as { id: string; title: string }
      renameMeeting(id, title)
      return { output: { id, title, ok: true } }
    },
  },
  {
    name: 'meeting_delete',
    description: 'Delete one or more saved meetings by id.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['ids'],
    },
    async execute(input) {
      const { ids } = input as { ids: string[] }
      deleteMeetings(ids)
      return { output: { deleted: ids.length } }
    },
  },
]

// Defensive guard: validate tool names at module load to fail fast in tests.
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]+$/
for (const t of meetingTools) {
  if (!TOOL_NAME_RE.test(t.name)) {
    throw new Error(`Invalid meeting tool name '${t.name}': must match ${TOOL_NAME_RE}`)
  }
}
