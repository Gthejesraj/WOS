import { glob as globFn } from 'glob'
import { validatePath } from './index'
import type { Tool, ToolContext, ToolResult } from './index'

interface GlobInput {
  pattern: string
  path?: string
}

export const globTool: Tool = {
  name: 'Glob',
  description: 'Find files matching a glob pattern. Returns a list of matching file paths.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (e.g. **/*.ts)' },
      path: { type: 'string', description: 'Base directory to search (defaults to workspace)' },
    },
    required: ['pattern'],
  },
  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { pattern, path: basePath } = input as GlobInput
    const root = basePath ?? ctx.workspacePath ?? process.cwd()

    if (basePath) validatePath(basePath, ctx.workspacePath)

    const files = await globFn(pattern, {
      cwd: root,
      absolute: true,
      signal: ctx.signal,
    })

    if (files.length === 0) return { output: '(no matches)' }
    return { output: files.join('\n') }
  },
}
