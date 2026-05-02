import { randomUUID } from 'node:crypto'
import type { Tool, ToolContext, ToolResult } from './index'
import type { AskUserKind, AskUserExtras, AskUserFormField } from '../../../src/types'

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 24 hours

/** Load picker choices from the snapshot cache for the given source. */
async function loadPickerChoices(
  source: 'channel' | 'repo' | 'meeting' | 'calendar',
): Promise<{ choices: Array<{ id: string; label: string; [key: string]: unknown }>; staleAt?: number }> {
  try {
    const { getSnapshot } = await import('../context/snapshotManager')
    const now = Date.now()

    if (source === 'channel') {
      const snap = getSnapshot('slack', 'channels')
      if (!snap) return { choices: [] }
      const staleAt = now - snap.fetchedAt > STALE_THRESHOLD_MS ? snap.fetchedAt : undefined
      const choices = (snap.data as Array<{ id: string; name: string; [key: string]: unknown }>).map(c => ({
        ...c,
        id: c.id,
        label: c.name ?? c.id,
      }))
      return { choices, staleAt }
    }

    if (source === 'repo') {
      const snap = getSnapshot('github', 'repos')
      if (!snap) return { choices: [] }
      const staleAt = now - snap.fetchedAt > STALE_THRESHOLD_MS ? snap.fetchedAt : undefined
      const choices = (snap.data as Array<{ full_name: string; description?: string; [key: string]: unknown }>).map(r => ({
        ...r,
        id: r.full_name,
        label: r.full_name,
      }))
      return { choices, staleAt }
    }

    if (source === 'calendar') {
      const snap = getSnapshot('google', 'calendars')
      if (!snap) return { choices: [] }
      const staleAt = now - snap.fetchedAt > STALE_THRESHOLD_MS ? snap.fetchedAt : undefined
      const choices = (snap.data as Array<{ id: string; summary?: string; primary?: boolean; [key: string]: unknown }>).map(c => ({
        ...c,
        id: c.id,
        label: c.summary ?? c.id,
      }))
      return { choices, staleAt }
    }

    if (source === 'meeting') {
      // No dedicated meetings scope yet — fall back to calendar list with a note.
      const snap = getSnapshot('google', 'calendars')
      if (!snap) return { choices: [] }
      const staleAt = now - snap.fetchedAt > STALE_THRESHOLD_MS ? snap.fetchedAt : undefined
      const choices = (snap.data as Array<{ id: string; summary?: string; primary?: boolean; [key: string]: unknown }>).map(c => ({
        ...c,
        _note: 'meeting scope not available; showing calendars',
        id: c.id,
        label: c.summary ?? c.id,
      }))
      return { choices, staleAt }
    }
  } catch {
    // Snapshot unavailable (e.g. during tests without DB) — return empty.
  }
  return { choices: [] }
}

interface AskUserInput {
  question: string
  /** Optional render kind. Defaults to 'choice' if `choices` provided, else 'text'. */
  kind?: AskUserKind
  choices?: string[]
  /** For fileDrop: accepted MIME types or extensions (e.g. ['.txt', '.vtt', 'video/*']). */
  accept?: string[]
  /** For picker: built-in source (snapshot-backed). Omit when supplying `pickerChoices` directly. */
  source?: 'channel' | 'repo' | 'meeting' | 'calendar'
  /**
   * For picker: inline list of options the agent already fetched (e.g. via
   * `slack_listChannels`, `github_listRepos`, etc.). When provided, this
   * overrides snapshot-based `source` lookups.
   */
  pickerChoices?: Array<{ id: string; label: string; description?: string; [key: string]: unknown }>
  /** For picker: allow multi-select. */
  multi?: boolean
  /** For choice and picker: also allow free-text answer for a custom value. */
  allowFreeform?: boolean
  /** For form: schema. */
  fields?: AskUserFormField[]
}

export const askUserTool: Tool = {
  name: 'AskUser',
  description: [
    'Pause execution and ask the user a question. The agent waits for the response before continuing.',
    '',
    'Render kinds (declare with `kind`):',
    '  • text     — free-form text input (default).',
    '  • choice   — pick one of `choices`. Set `allowFreeform:true` to also accept typed input.',
    '  • confirm  — yes/no confirmation. Returns "yes" | "no".',
    '  • fileDrop — drop one or more files inline. `accept` filters file types. Returns JSON [{name,path,size,type}].',
    '  • picker   — pick from a list. Either set `source` (built-in: channel|repo|meeting|calendar, snapshot-backed) OR pass `pickerChoices:[{id,label,description?},…]` you fetched yourself. Set `allowFreeform:true` to accept a typed custom value too. Returns selected id(s).',
    '  • form     — multi-field form using `fields`. Returns JSON {key:value,…}.',
    '',
    'Use the most specific kind possible — UI is dramatically better than free text for files, confirms, and pickers.',
    '',
    'PREFERRED PATTERN for resource selection (Slack channel, GitHub repo, Jira issue, Google Calendar, file path, etc.):',
    '  1. Call the listing tool first (e.g. `slack_listChannels`, `github_listRepos`, `jira_searchIssues`).',
    '  2. Pass the results inline as `pickerChoices` and set `allowFreeform:true` so the user can type a custom value if their option is missing.',
    '  Never ask the user to type a name when you can fetch the list and present a picker.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question or prompt shown to the user.' },
      kind: { type: 'string', enum: ['text', 'choice', 'confirm', 'fileDrop', 'picker', 'form'], description: 'Render kind.' },
      choices: { type: 'array', items: { type: 'string' }, description: 'For kind=choice: quick-reply options.' },
      allowFreeform: { type: 'boolean', description: 'For kind=choice or kind=picker: also allow a typed custom answer.' },
      accept: { type: 'array', items: { type: 'string' }, description: 'For kind=fileDrop: accepted file types.' },
      source: { type: 'string', enum: ['channel', 'repo', 'meeting', 'calendar'], description: 'For kind=picker: built-in snapshot-backed data source. Omit when supplying pickerChoices directly.' },
      pickerChoices: {
        type: 'array',
        description: 'For kind=picker: inline list of options the agent already fetched. Each item: {id, label, description?}. Overrides `source` when provided.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['id', 'label'],
        },
      },
      multi: { type: 'boolean', description: 'For kind=picker: allow multi-select.' },
      fields: {
        type: 'array',
        description: 'For kind=form: schema.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            label: { type: 'string' },
            type: { type: 'string', enum: ['text', 'textarea', 'number', 'boolean'] },
            placeholder: { type: 'string' },
            required: { type: 'boolean' },
          },
          required: ['key', 'label', 'type'],
        },
      },
    },
    required: ['question'],
  },
  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const i = input as AskUserInput
    const kind: AskUserKind = i.kind ?? (i.choices && i.choices.length > 0 ? 'choice' : 'text')
    const extras: AskUserExtras = {
      kind,
      ...(i.accept ? { accept: i.accept } : {}),
      ...(i.source ? { source: i.source } : {}),
      ...(i.multi !== undefined ? { multi: i.multi } : {}),
      ...(i.allowFreeform !== undefined ? { allowFreeform: i.allowFreeform } : {}),
      ...(i.fields ? { fields: i.fields } : {}),
    }

    // For picker kind, prefer inline pickerChoices supplied by the agent.
    // Fall back to the snapshot-backed source loader only when no inline list is given.
    if (kind === 'picker') {
      if (Array.isArray(i.pickerChoices) && i.pickerChoices.length > 0) {
        extras.pickerChoices = i.pickerChoices
      } else if (i.source) {
        const { choices, staleAt } = await loadPickerChoices(i.source)
        if (choices.length > 0) extras.pickerChoices = choices
        if (staleAt !== undefined) extras.staleAt = staleAt
      }
    }

    const answer = await ctx.onAskUser(i.question, randomUUID(), i.choices, extras)
    return { output: answer }
  },
}

