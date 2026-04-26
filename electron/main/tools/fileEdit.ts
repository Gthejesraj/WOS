import fs from 'fs/promises'
import { validatePath } from './index'
import type { Tool, ToolContext, ToolResult } from './index'

interface FileEditInput {
  file_path: string
  old_string: string
  new_string: string
}

function generateDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')

  const diffLines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    '@@ -1 +1 @@',
  ]

  // Simple line-diff
  for (const line of oldLines) {
    if (!newLines.includes(line)) diffLines.push(`-${line}`)
  }
  for (const line of newLines) {
    if (!oldLines.includes(line)) diffLines.push(`+${line}`)
  }

  return diffLines.join('\n')
}

export const fileEditTool: Tool = {
  name: 'Edit',
  description: 'Edit a file by replacing an exact string. The old_string must appear exactly once in the file.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to file' },
      old_string: { type: 'string', description: 'The exact string to replace (must be unique in file)' },
      new_string: { type: 'string', description: 'The replacement string' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { file_path, old_string, new_string } = input as FileEditInput
    validatePath(file_path, ctx.workspacePath)

    const content = await fs.readFile(file_path, 'utf-8')
    const count = content.split(old_string).length - 1

    if (count === 0) {
      return { output: `Error: String not found in ${file_path}`, error: 'String not found' }
    }
    if (count > 1) {
      return {
        output: `Error: String found ${count} times in ${file_path} — must be unique`,
        error: 'String not unique',
      }
    }

    const updated = content.replace(old_string, new_string)
    await fs.writeFile(file_path, updated, 'utf-8')

    const diff = generateDiff(content, updated, file_path)
    return { output: { message: `Edited ${file_path}`, diff, filePath: file_path } }
  },
}
