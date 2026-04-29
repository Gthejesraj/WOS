import { randomUUID } from 'crypto'
import type { Tool, ToolContext, ToolResult } from './index'
import type { AskUserKind, AskUserExtras, AskUserFormField } from '../../../src/types'

interface AskUserInput {
  question: string
  /** Optional render kind. Defaults to 'choice' if `choices` provided, else 'text'. */
  kind?: AskUserKind
  choices?: string[]
  /** For fileDrop: accepted MIME types or extensions (e.g. ['.txt', '.vtt', 'video/*']). */
  accept?: string[]
  /** For picker: source. */
  source?: 'channel' | 'repo' | 'meeting' | 'calendar'
  /** For picker: allow multi-select. */
  multi?: boolean
  /** For choice: also allow free-text answer. */
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
    '  • picker   — pick from a built-in registry (`source`: channel|repo|meeting|calendar). Returns selected id(s).',
    '  • form     — multi-field form using `fields`. Returns JSON {key:value,…}.',
    '',
    'Use the most specific kind possible — UI is dramatically better than free text for files, confirms, and pickers.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question or prompt shown to the user.' },
      kind: { type: 'string', enum: ['text', 'choice', 'confirm', 'fileDrop', 'picker', 'form'], description: 'Render kind.' },
      choices: { type: 'array', items: { type: 'string' }, description: 'For kind=choice: quick-reply options.' },
      allowFreeform: { type: 'boolean', description: 'For kind=choice: also allow typed answer.' },
      accept: { type: 'array', items: { type: 'string' }, description: 'For kind=fileDrop: accepted file types.' },
      source: { type: 'string', enum: ['channel', 'repo', 'meeting', 'calendar'], description: 'For kind=picker: data source.' },
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
    const answer = await ctx.onAskUser(i.question, randomUUID(), i.choices, extras)
    return { output: answer }
  },
}

