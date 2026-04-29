import { randomUUID } from 'crypto'
import { queryLoop } from '../agent/query'
import { PermissionStore } from '../agent/permissions'
import { getDb, schema } from '../db'
import { eq } from 'drizzle-orm'
import type { Tool, ToolContext, ToolResult } from './index'
import type { ConversationMessage } from '../providers/types'
import { resolveAgent } from '../agent/settings'

interface SubAgentInput {
  description: string
  prompt: string
  /** Preset agent to run, for example "meeting". */
  preset?: string
  presetKey?: string
  /** When true, start from a snapshot of the parent's conversation (for prefix cache reuse). */
  fork?: boolean
}

export const subAgentTool: Tool = {
  name: 'Task',
  description: 'Spawn a subagent to handle a specific task. The subagent has its own context and tools. Use for parallelizable or complex subtasks. Set `fork: true` to inherit parent context for prefix cache reuse (recommended for tightly-coupled subtasks).',
  inputSchema: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'Brief description of what this subagent will do' },
      prompt: { type: 'string', description: 'Detailed instructions for the subagent' },
      preset: { type: 'string', description: 'Optional preset agent key, e.g. "meeting".' },
      presetKey: { type: 'string', description: 'Alias for preset.' },
      fork: { type: 'boolean', description: 'If true, inherit parent conversation context (cache-efficient).' },
    },
    required: ['description', 'prompt'],
  },
  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { description, prompt, fork = true } = input as SubAgentInput
    const preset = (input as SubAgentInput).presetKey ?? (input as SubAgentInput).preset
    const agentId = randomUUID()
    const startedAt = new Date()

    const db = getDb()
    const conversationId = ctx.conversationId
    let taskId: string | null = null
    if (conversationId) {
      try {
        db.insert(schema.subagentRuns).values({
          id: agentId,
          parentMessageId: ctx.toolId ?? null,
          conversationId,
          status: 'running',
          goal: description,
          summary: null,
          tokensIn: 0,
          tokensOut: 0,
          startedAt,
          endedAt: null,
        }).run()
        taskId = randomUUID()
        db.insert(schema.tasks).values({
          id: taskId,
          type: 'subagent',
          status: 'running',
          title: description,
          conversationId,
          createdAt: startedAt,
          updatedAt: startedAt,
        }).run()
      } catch (err) {
        if (process.env.WOS_DEBUG === '1') console.warn('[subAgent] ledger write failed', err)
      }
    }

    const finishLedger = (status: 'success' | 'error' | 'cancelled', summary: string | null) => {
      if (!conversationId) return
      const endedAt = new Date()
      try {
        db.update(schema.subagentRuns)
          .set({ status, summary, endedAt })
          .where(eq(schema.subagentRuns.id, agentId))
          .run()
        if (taskId) {
          db.update(schema.tasks)
            .set({ status, updatedAt: endedAt })
            .where(eq(schema.tasks.id, taskId))
            .run()
        }
      } catch (err) {
        if (process.env.WOS_DEBUG === '1') console.warn('[subAgent] ledger finalize failed', err)
      }
    }

    const { runBeforeSubagent } = await import('../hooks/manager')
    const gate = await runBeforeSubagent(preset ?? 'wos', input, { workspacePath: ctx.workspacePath ?? null })
    if (gate.block) {
      const reason = gate.reason ?? 'blocked by hook'
      await ctx.yieldEvent({ type: 'subagent_start', agentId, prompt: description })
      await ctx.yieldEvent({ type: 'subagent_end', agentId, result: `Blocked: ${reason}` })
      finishLedger('cancelled', `blocked: ${reason}`)
      return { output: `Subagent blocked: ${reason}`, error: reason }
    }

    await ctx.yieldEvent({ type: 'subagent_start', agentId, prompt: description })

    let result = ''
    const permStore = new PermissionStore()
    // Preserve structured content (tool_use/tool_result) when forking.
    const inheritedMessages: ConversationMessage[] = fork && ctx.parentMessages
      ? ctx.parentMessages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string'
            ? m.content
            : (m.content as ConversationMessage['content']),
        }))
      : []

    try {
      // Prefer the parent's model; fall back to DB default only if parent didn't pass one.
      let model = ctx.parentModel
      let mode = ctx.parentMode ?? 'default'
      let systemPromptOverride: string | undefined
      let apiKeyOverride = ctx.parentApiKeyOverride
      if (preset) {
        const agent = await resolveAgent(preset)
        if (agent.model) model = agent.model
        mode = agent.mode
        systemPromptOverride = agent.systemPrompt
        apiKeyOverride = agent.apiKeyOverride
      }
      if (!model) {
        const db = getDb()
        const modelSetting = db
          .select()
          .from(schema.settings)
          .where(eq(schema.settings.key, 'defaultModel'))
          .get()
        model = (modelSetting?.value as string)?.replace(/^"|"$/g, '') || ''
      }

      if (!model || model.trim() === '') {
        throw new Error('No AI model selected. Please go to Settings and choose a model to get started.')
      }

      for await (const event of queryLoop({
        model,
        messages: inheritedMessages,
        userMessage: prompt,
        workspacePath: ctx.workspacePath,
        mode,
        reasoningEffort: ctx.parentReasoningEffort,
        systemPromptOverride,
        apiKeyOverride,
        signal: ctx.signal,
        permissionStore: permStore,
        onPermissionRequest: ctx.onPermissionRequest,
        onAskUser: ctx.onAskUser,
        maxDepth: 1,
        agentKey: preset ?? 'wos',
        // Forward side-channel events (stdout/stderr deltas from Bash, etc.)
        // up to the parent runner so the UI can render live output.
        onEvent: (e) => ctx.yieldEvent({ type: 'subagent_event', agentId, event: e }),
      })) {
        await ctx.yieldEvent({ type: 'subagent_event', agentId, event })
        if (event.type === 'text_delta') result += event.content
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await ctx.yieldEvent({ type: 'subagent_end', agentId, result: `Error: ${msg}` })
      finishLedger('error', msg)
      return { output: `Subagent error: ${msg}`, error: msg }
    }

    await ctx.yieldEvent({ type: 'subagent_end', agentId, result })
    finishLedger('success', result.slice(0, 4000) || null)
    return { output: result || '(subagent completed with no output)' }
  },
}
