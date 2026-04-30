import { spawn } from 'node:child_process'
import type { Tool, ToolContext, ToolResult } from './index'

interface BashInput {
  command: string
  timeout?: number
}

export const bashTool: Tool = {
  name: 'Bash',
  description: 'Execute a bash command. Always requires permission in Default mode. Use for running scripts, installing packages, git operations, etc.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The bash command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000)' },
    },
    required: ['command'],
  },
  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { command, timeout = 30000 } = input as BashInput

    return new Promise<ToolResult>((resolve) => {
      const child = spawn(command, {
        cwd: ctx.workspacePath ?? process.cwd(),
        shell: '/bin/bash',
      })

      let stdout = ''
      let stderr = ''
      const MAX = 10 * 1024 * 1024

      const timer = setTimeout(() => {
        try { child.kill('SIGTERM') } catch { /* noop */ }
      }, timeout)

      const onAbort = () => {
        try { child.kill('SIGTERM') } catch { /* noop */ }
      }
      ctx.signal.addEventListener('abort', onAbort, { once: true })

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        if (stdout.length < MAX) stdout += text
        void ctx.yieldEvent({ type: 'tool_stdout_delta', toolId: ctx.toolId ?? '', delta: text } as never)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        if (stderr.length < MAX) stderr += text
        void ctx.yieldEvent({ type: 'tool_stderr_delta', toolId: ctx.toolId ?? '', delta: text } as never)
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        ctx.signal.removeEventListener('abort', onAbort)
        resolve({
          output: [stdout && `STDOUT:\n${stdout}`, stderr && `STDERR:\n${stderr}`, `Error: ${err.message}`]
            .filter(Boolean).join('\n'),
          error: err.message,
        })
      })

      child.on('close', (code, signal) => {
        clearTimeout(timer)
        ctx.signal.removeEventListener('abort', onAbort)
        let out = stdout
        if (stderr && stderr.trim()) out += `\nSTDERR:\n${stderr}`
        if (signal) {
          resolve({ output: out || '(no output)', error: `Killed by signal ${signal}` })
        } else if (code !== 0) {
          resolve({ output: out || '(no output)', error: `Exit code ${code}` })
        } else {
          resolve({ output: out || '(no output)' })
        }
      })
    })
  },
}
