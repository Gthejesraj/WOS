import type { Tool } from './index'
import { getMeeting, listMeetings, searchMeetings } from '../meetings/store'
import { analyzeTranscript } from '../meetings/analyze'

// IMPORTANT: Tool names must match `^[a-zA-Z0-9_-]+$` for OpenAI's Responses API
// (Anthropic enforces the same). Dots in names cause an immediate 400 from
// OpenAI which poisons EVERY chat turn that loads these tools — that's the
// "Invalid 'tools[N].name'" error users hit when sending a chat message after
// the meeting registry was added. Always use underscores here.
export const meetingTools: Tool[] = [
  {
    name: 'meeting_list',
    description: 'List recently saved meetings.',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      return { output: listMeetings() }
    },
  },
  {
    name: 'meeting_search',
    description: 'Search saved meeting transcripts and summaries.',
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
    name: 'meeting_summarize',
    description: 'Analyze or re-summarize a saved meeting by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(input) {
      const meeting = getMeeting((input as { id: string }).id)
      if (!meeting?.transcript) return { output: {}, error: 'Meeting not found or has no transcript.' }
      const result = await analyzeTranscript(meeting.transcript, meeting.title)
      return { output: result }
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
