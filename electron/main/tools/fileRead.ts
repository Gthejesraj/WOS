import fs from 'fs/promises'
import { validatePath } from './index'
import type { Tool, ToolContext, ToolResult } from './index'

interface FileReadInput {
  file_path: string
  offset?: number
  limit?: number
}

export const fileReadTool: Tool = {
  name: 'Read',
  description: 'Read a file from the filesystem. Optionally specify a line range with offset (1-indexed start line) and limit (number of lines).',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to file' },
      offset: { type: 'number', description: 'Start line (1-indexed)' },
      limit: { type: 'number', description: 'Number of lines to read' },
    },
    required: ['file_path'],
  },
  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { file_path, offset, limit } = input as FileReadInput
    validatePath(file_path, ctx.workspacePath)

    const content = await fs.readFile(file_path, 'utf-8')
    const lines = content.split('\n')
    const start = (offset ?? 1) - 1
    const end = limit !== undefined ? start + limit : lines.length
    const slice = lines.slice(start, end)

    // Add line numbers
    const withLineNums = slice
      .map((line, i) => `${start + i + 1}\t${line}`)
      .join('\n')

    return { output: withLineNums }
  },
}
