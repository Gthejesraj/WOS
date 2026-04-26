import fs from 'fs/promises'
import path from 'path'
import { validatePath } from './index'
import type { Tool, ToolContext, ToolResult } from './index'

interface FileWriteInput {
  file_path: string
  content: string
}

export const fileWriteTool: Tool = {
  name: 'Write',
  description: 'Write content to a file. Creates parent directories if needed. Overwrites existing file.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to file' },
      content: { type: 'string', description: 'File content to write' },
    },
    required: ['file_path', 'content'],
  },
  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { file_path, content } = input as FileWriteInput
    validatePath(file_path, ctx.workspacePath)
    await fs.mkdir(path.dirname(file_path), { recursive: true })
    await fs.writeFile(file_path, content, 'utf-8')
    return { output: `Written ${content.split('\n').length} lines to ${file_path}` }
  },
}
