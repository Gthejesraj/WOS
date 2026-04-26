import { getProvider } from '../providers'
import { executeTools } from '../tools'
import type { ConversationMessage } from '../providers/types'
import { canUseTool, PermissionStore } from './permissions'
import type { AgentMode } from './permissions'

export type AgentEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'tool_preparing'; toolName: string; toolId: string }
  | { type: 'tool_arg_delta'; toolId: string; delta: string }
  | { type: 'tool_stdout_delta'; toolId: string; delta: string }
  | { type: 'tool_stderr_delta'; toolId: string; delta: string }
  | { type: 'tool_use_start'; toolName: string; toolId: string; input: unknown }
  | { type: 'tool_result'; toolId: string; result: unknown; error?: string }
  | { type: 'subagent_start'; agentId: string; prompt: string }
  | { type: 'subagent_event'; agentId: string; event: AgentEvent }
  | { type: 'subagent_end'; agentId: string; result: string }
  | { type: 'permission_request'; toolName: string; toolId: string; args: unknown }
  | { type: 'permission_decided'; toolId: string; decision: 'allowed' | 'denied' }
  | { type: 'ask_user'; question: string; questionId: string; choices?: string[] }
  | { type: 'plan_ready' }
  | { type: 'turn_start' }
  | { type: 'turn_complete'; usage: { inputTokens: number; outputTokens: number }; reason?: 'end_turn' | 'tool_use' | 'aborted' | 'error' }
  | { type: 'error'; message: string; retryable: boolean }
  | { type: 'compact_started' }
  | { type: 'compact_complete'; summary: string }

export interface QueryOptions {
  model: string
  messages: ConversationMessage[]
  userMessage: string
  workspacePath: string | null
  mode: AgentMode
  reasoningEffort?: 'low' | 'medium' | 'high' | 'max'
  signal?: AbortSignal
  permissionStore: PermissionStore
  onPermissionRequest: (toolName: string, toolId: string, args: unknown) => Promise<'allow' | 'allow-session' | 'deny'>
  onAskUser: (question: string, questionId: string, choices?: string[]) => Promise<string>
  maxDepth?: number
  /** Priority stack (applied in order: override REPLACES base; others append). */
  systemPromptOverride?: string
  systemPromptCustom?: string
  systemPromptAppend?: string
  apiKeyOverride?: string
  /** Direct callback for side-channel events (tool_stdout_delta, etc.) that
   * tools emit during execute() — these are pushed out-of-band with yielded events. */
  onEvent?: (event: AgentEvent) => void
}

const SYSTEM_PROMPT = `You are WOS, an AI agent assistant. You have access to tools to help accomplish tasks.
When using tools, be precise and thorough. Always explain what you are doing.
If you need clarification, use the AskUser tool.`

function buildPlanModePrompt(base: string): string {
  return base + `

## Planning Mode
You are in PLAN MODE. Think through the request and produce a detailed numbered plan
describing every action you will take (which files to read, edit, create, or delete,
and which tools you will invoke in what order).

When your plan is ready, call the \`ExitPlanMode\` tool with the full plan text as the
\`plan\` argument. This will present the plan to the user for approval. Do NOT call
any other write/edit/bash tools before \`ExitPlanMode\` — only read-only exploration
is allowed (Read, Glob, Grep).`
}

function buildYoloModePrompt(base: string): string {
  return base + `

## Autonomous Mode
You are in YOLO (fully autonomous) mode. Execute all tasks without asking for permission.
Make decisions autonomously and proceed efficiently.`
}

export async function* queryLoop(options: QueryOptions): AsyncGenerator<AgentEvent> {
  const {
    model, messages, userMessage, workspacePath, mode, reasoningEffort,
    signal, permissionStore, onPermissionRequest, onAskUser, maxDepth = 0,
    systemPromptOverride, systemPromptCustom, systemPromptAppend, apiKeyOverride, onEvent,
  } = options

  const provider = getProvider(model)

  // Pull rules + skills prompt sections (cheap — just reads from DB).
  let rulesSection = ''
  let skillsSection = ''
  try {
    const { buildRulesPromptSection } = await import('../rules/manager')
    const { buildSkillIndex } = await import('../skills/manager')
    rulesSection = buildRulesPromptSection(null)
    skillsSection = buildSkillIndex()
  } catch (err) {
    // Skills/rules managers may not be initialised during early tests — non-fatal.
    if (process.env.WOS_DEBUG === '1') console.warn('[query] rules/skills load failed', err)
  }

  // Priority stack: override > (base + mode + workspace + rules + skills + custom) > append
  let systemPrompt: string
  if (systemPromptOverride) {
    systemPrompt = systemPromptOverride
  } else {
    systemPrompt = SYSTEM_PROMPT
    if (mode === 'plan') systemPrompt = buildPlanModePrompt(systemPrompt)
    if (mode === 'yolo') systemPrompt = buildYoloModePrompt(systemPrompt)
    if (workspacePath) systemPrompt += `\n\n## Workspace\nCurrent workspace: ${workspacePath}`
    if (rulesSection) systemPrompt += `\n\n${rulesSection}`
    if (skillsSection) systemPrompt += `\n\n${skillsSection}`
    if (systemPromptCustom) systemPrompt += `\n\n## Custom Instructions\n${systemPromptCustom}`
  }
  if (systemPromptAppend) systemPrompt += `\n\n${systemPromptAppend}`

  const history: ConversationMessage[] = [...messages]

  // Add user message to history
  history.push({ role: 'user', content: userMessage })

  let planApproved = false
  let turnStarted = false

  while (true) {
    if (signal?.aborted) return

    const { getAllTools } = await import('../tools')
    const allTools = getAllTools()
    const toolDefs = (maxDepth > 0
      ? allTools.filter(t => t.name !== 'Task') // No recursive subagents
      : allTools
    ).map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }))

    const stream = provider.stream({
      model,
      messages: history,
      tools: toolDefs,
      systemPrompt,
      reasoningEffort,
      apiKeyOverride,
      signal,
    })

    if (!turnStarted) {
      turnStarted = true
      yield { type: 'turn_start' }
    }

    const pendingToolCalls: Array<{ id: string; name: string; input: unknown }> = []
    let hasText = false
    let planExitRequested: { id: string; plan: string } | null = null

    for await (const event of stream) {
      if (signal?.aborted) return

      switch (event.type) {
        case 'text_delta': {
          // In plan mode, stream text normally; plan finalisation is triggered
          // by the agent calling ExitPlanMode rather than by a text sentinel.
          yield { type: 'text_delta', content: event.content }
          hasText = true
          break
        }

        case 'thinking_delta':
          yield { type: 'reasoning_delta', content: event.content }
          break

        case 'tool_preparing':
          if (mode !== 'plan' || planApproved) {
            yield { type: 'tool_preparing', toolName: event.name, toolId: event.id }
          }
          break

        case 'tool_arg_delta':
          if (mode !== 'plan' || planApproved) {
            yield { type: 'tool_arg_delta', toolId: event.id, delta: event.delta }
          }
          break

        case 'tool_use_start':
          if (mode === 'plan' && !planApproved) {
            // In plan mode, only ExitPlanMode and read-only tools are permitted.
            if (event.name === 'ExitPlanMode') {
              const input = (event.input ?? {}) as { plan?: string }
              planExitRequested = { id: event.id, plan: input.plan ?? '' }
              // Do NOT yield tool_use_start to UI — we treat this as a mode transition.
              break
            }
            if (event.name === 'EnterPlanMode') {
              // Already in plan mode — acknowledge with a no-op tool_result.
              yield {
                type: 'tool_use_start',
                toolName: event.name,
                toolId: event.id,
                input: event.input,
              }
              yield { type: 'tool_result', toolId: event.id, result: 'already_in_plan_mode' }
              break
            }
          }
          if (mode !== 'plan' || planApproved) {
            // EnterPlanMode from default/yolo mode: flip mode and acknowledge.
            if (event.name === 'EnterPlanMode') {
              yield {
                type: 'tool_use_start',
                toolName: event.name,
                toolId: event.id,
                input: event.input,
              }
              // Mode switch is one-way within this loop run — just record it.
              // (Full per-message mode transitions require state beyond this loop.)
              planApproved = false
              yield { type: 'tool_result', toolId: event.id, result: 'entered_plan_mode' }
              yield { type: 'plan_ready' }
              break
            }
            yield {
              type: 'tool_use_start',
              toolName: event.name,
              toolId: event.id,
              input: event.input,
            }
            pendingToolCalls.push({ id: event.id, name: event.name, input: event.input })
          }
          break

        case 'message_stop': {
          if (event.stopReason === 'end_turn' || pendingToolCalls.length === 0) {
            yield {
              type: 'turn_complete',
              usage: event.usage,
              reason: event.stopReason === 'end_turn' ? 'end_turn' : 'tool_use',
            }
            return
          }
          break
        }
      }
    }

    // Plan-mode approval gate: if the agent called ExitPlanMode, pause and ask.
    if (planExitRequested) {
      const exit = planExitRequested
      yield { type: 'plan_ready' }
      const decision = await onAskUser('__plan_approval__', exit.id, ['approve', 'reject'])
      if (decision === 'approve') {
        planApproved = true
        // Feed a synthetic tool_result so the model sees the plan was approved.
        history.push({
          role: 'assistant',
          content: [
            { type: 'tool_use', id: exit.id, name: 'ExitPlanMode', input: { plan: exit.plan } },
          ],
        })
        history.push({
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: exit.id, content: 'Plan approved. Proceed to execute.' },
          ],
        })
        continue
      } else {
        history.push({
          role: 'assistant',
          content: [
            { type: 'tool_use', id: exit.id, name: 'ExitPlanMode', input: { plan: exit.plan } },
          ],
        })
        history.push({
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: exit.id, content: 'Plan rejected. Please revise and propose a new plan.' },
          ],
        })
        continue
      }
    }

    if (pendingToolCalls.length === 0) {
      return
    }

    // Check permissions for each tool call
    const toolResults: Array<{
      id: string
      name: string
      output: unknown
      error?: string
    }> = []

    for (const call of pendingToolCalls) {
      if (signal?.aborted) return

      const permission = await canUseTool(call.name, mode, permissionStore, call.input)

      if (permission.decision === 'deny') {
        const msg = permission.reason ?? 'Blocked by policy'
        toolResults.push({ id: call.id, name: call.name, output: null, error: msg })
        yield { type: 'tool_result', toolId: call.id, result: null, error: msg }
        continue
      }

      if (permission.decision === 'request') {
        const decision = await onPermissionRequest(call.name, call.id, call.input)
        if (decision === 'deny') {
          toolResults.push({ id: call.id, name: call.name, output: null, error: 'Permission denied by user' })
          yield {
            type: 'tool_result',
            toolId: call.id,
            result: null,
            error: 'Permission denied by user',
          }
          continue
        }
        if (decision === 'allow-session') {
          permissionStore.addSessionGrant(call.name)
        }
      }

      // Execute tool
      try {
        const result = await executeTools(
          call.name,
          call.input,
          {
            workspacePath,
            signal: signal ?? new AbortController().signal,
            yieldEvent: (e: AgentEvent) => {
              // Side-channel: forward directly to runner-level emit.
              if (onEvent) onEvent(e)
            },
            onPermissionRequest,
            onAskUser,
            toolId: call.id,
            parentMessages: history,
            parentModel: model,
            parentMode: mode,
            parentReasoningEffort: reasoningEffort,
            parentApiKeyOverride: apiKeyOverride,
          }
        )

        toolResults.push({ id: call.id, name: call.name, output: result.output })
        yield {
          type: 'tool_result',
          toolId: call.id,
          result: result.output,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toolResults.push({ id: call.id, name: call.name, output: null, error: msg })
        yield {
          type: 'tool_result',
          toolId: call.id,
          result: null,
          error: msg,
        }
      }
    }

    // Build tool result messages for next iteration
    const assistantContent = pendingToolCalls.map(tc => ({
      type: 'tool_use' as const,
      id: tc.id,
      name: tc.name,
      input: tc.input,
    }))

    history.push({ role: 'assistant', content: assistantContent as never })
    history.push({
      role: 'user',
      content: toolResults.map(r => ({
        type: 'tool_result' as const,
        tool_use_id: r.id,
        content: r.error ? `Error: ${r.error}` : JSON.stringify(r.output),
      })) as never,
    })
  }
}
