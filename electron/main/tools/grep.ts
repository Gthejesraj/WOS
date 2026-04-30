import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { validatePath } from './index'
import type { Tool, ToolContext, ToolResult } from './index'
import path from 'node:path'

const execAsync = promisify(exec)

interface GrepInput {
  pattern: string
  path?: string
  include?: string
}

async function grepFallback(
  pattern: string,
  root: string,
  include: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  const includeFlag = include ? ` --include="${include}"` : ''
  const cmd = `grep -rn "${pattern}" "${root}"${includeFlag} 2>/dev/null || true`

  try {
    const { stdout } = await execAsync(cmd, { signal, timeout: 15000 })
    return stdout || '(no matches)'
  } catch {
    return '(no matches)'
  }
}

export const grepTool: Tool = {
  name: 'Grep',
  description: 'Search for a pattern in files using regex. Returns matching lines with file paths and line numbers.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search' },
      path: { type: 'string', description: 'Directory to search (defaults to workspace)' },
      include: { type: 'string', description: 'File glob filter (e.g. *.ts)' },
    },
    required: ['pattern'],
  },
  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { pattern, path: searchPath, include } = input as GrepInput
    const root = searchPath ?? ctx.workspacePath ?? process.cwd()

    if (searchPath) validatePath(searchPath, ctx.workspacePath)

    const result = await grepFallback(pattern, root, include, ctx.signal)
    return { output: result }
  },
}
