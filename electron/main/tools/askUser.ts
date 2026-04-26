import { randomUUID } from 'crypto'
import type { Tool, ToolContext, ToolResult } from './index'

interface AskUserInput {
  question: string
  choices?: string[]
}

export const askUserTool: Tool = {
  name: 'AskUser',
  description: 'Pause execution and ask the user a question. The agent waits for the user\'s response before continuing.',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask the user' },
      choices: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional quick-reply choices',
      },
    },
    required: ['question'],
  },
  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { question, choices } = input as AskUserInput
    const answer = await ctx.onAskUser(question, randomUUID(), choices)
    return { output: answer }
  },
}
