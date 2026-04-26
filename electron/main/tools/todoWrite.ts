import type { Tool, ToolContext, ToolResult } from './index'

export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

interface TodoWriteInput {
  todos: TodoItem[]
}

/**
 * TodoWrite lets the agent maintain a visible task list. The full list is
 * replaced on each call (Claude Code / Friday semantics). The renderer shows
 * this inline as a compact card plus an expandable right-side panel.
 */
export const todoWriteTool: Tool = {
  name: 'TodoWrite',
  description:
    'Maintain a structured, visible task list for the current conversation. ' +
    'Call this whenever the plan changes: provide the full updated list each time. ' +
    'Exactly one todo should have status="in_progress" at any moment. ' +
    'Use short imperative strings (e.g. "Read package.json", "Fix type error in foo.ts").',
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['id', 'content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  async execute(input: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const { todos } = (input ?? {}) as TodoWriteInput
    if (!Array.isArray(todos)) return { output: '', error: 'todos must be an array' }
    const inProgress = todos.filter(t => t.status === 'in_progress').length
    const done = todos.filter(t => t.status === 'completed').length
    return {
      output: {
        todos,
        summary: `${done}/${todos.length} completed, ${inProgress} in progress`,
      },
    }
  },
}
