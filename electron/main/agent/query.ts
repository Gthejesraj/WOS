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
  | { type: 'ask_user'; question: string; questionId: string; choices?: string[]; extras?: import('../../../src/types').AskUserExtras }
  | { type: 'ask_user_answered'; questionId: string; answer: string }
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
  onAskUser: (question: string, questionId: string, choices?: string[], extras?: import('../../../src/types').AskUserExtras) => Promise<string>
  maxDepth?: number
  /** Priority stack (applied in order: override REPLACES base; others append). */
  systemPromptOverride?: string
  systemPromptCustom?: string
  systemPromptAppend?: string
  apiKeyOverride?: string
  /** Direct callback for side-channel events (tool_stdout_delta, etc.) that
   * tools emit during execute() — these are pushed out-of-band with yielded events. */
  onEvent?: (event: AgentEvent) => void
  /** Identifies which agent definition is running. Drives tool curation
   * (e.g. "meeting" sees a curated subset) and system-prompt augmentation.
   * Defaults to "wos". */
  agentKey?: string
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
    agentKey,
  } = options
  const { getAgentDef } = await import('./agentDefs')
  const agentDef = getAgentDef(agentKey ?? 'wos')

  // effectiveMode may change mid-run when the user approves a plan in yolo/default mode.
  let effectiveMode: AgentMode = mode

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
    if (agentDef?.systemPrompt) systemPrompt += `\n${agentDef.systemPrompt}`
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
    const allToolsRaw = getAllTools()
    const allTools = agentDef ? agentDef.toolFilter(allToolsRaw) : allToolsRaw
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
    let accumulatedText = ''
    let planExitRequested: { id: string; plan: string } | null = null

    for await (const event of stream) {
      if (signal?.aborted) return

      switch (event.type) {
        case 'text_delta': {
          // In plan mode, stream text normally; plan finalisation is triggered
          // by the agent calling ExitPlanMode rather than by a text sentinel.
          yield { type: 'text_delta', content: event.content }
          hasText = true
          accumulatedText += event.content
          break
        }

        case 'thinking_delta':
          yield { type: 'reasoning_delta', content: event.content }
          break

        case 'tool_preparing':
          yield { type: 'tool_preparing', toolName: event.name, toolId: event.id }
          break

        case 'tool_arg_delta':
          yield { type: 'tool_arg_delta', toolId: event.id, delta: event.delta }
          break

        case 'tool_use_start':
          // ExitPlanMode is intercepted — we pause for user approval instead of running it.
          if (event.name === 'ExitPlanMode' && mode === 'plan' && !planApproved) {
            const input = (event.input ?? {}) as { plan?: string }
            planExitRequested = { id: event.id, plan: input.plan ?? '' }
            break
          }
          // EnterPlanMode: acknowledge with a synthetic result so the model continues.
          if (event.name === 'EnterPlanMode') {
            yield { type: 'tool_use_start', toolName: event.name, toolId: event.id, input: event.input }
            if (mode === 'plan' && !planApproved) {
              yield { type: 'tool_result', toolId: event.id, result: 'already_in_plan_mode' }
            } else {
              planApproved = false
              yield { type: 'tool_result', toolId: event.id, result: 'entered_plan_mode' }
              yield { type: 'plan_ready' }
            }
            break
          }
          // All other tools (including read-only tools used during plan-mode research)
          // are yielded and tracked for execution so the multi-turn loop stays correct.
          yield { type: 'tool_use_start', toolName: event.name, toolId: event.id, input: event.input }
          pendingToolCalls.push({ id: event.id, name: event.name, input: event.input })
          break

        case 'message_stop': {
          // In plan mode: if the model ended the turn with text but never called
          // ExitPlanMode, synthesise a plan-exit so the approval UI fires anyway.
          if (
            mode === 'plan' && !planApproved && hasText &&
            !planExitRequested && pendingToolCalls.length === 0
          ) {
            planExitRequested = {
              id: `synthetic-plan-${Date.now()}`,
              plan: accumulatedText.trim(),
            }
            break
          }
          if ((event.stopReason === 'end_turn' || pendingToolCalls.length === 0) && !planExitRequested) {
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

    // Plan-mode approval gate: if the agent called ExitPlanMode (or wrote a text
    // plan without calling the tool), pause and ask the user what to do.
    if (planExitRequested) {
      const exit = planExitRequested
      // Detect synthetic exits (model wrote text but did not call ExitPlanMode tool).
      const isSynthetic = exit.id.startsWith('synthetic-plan-')
      yield { type: 'plan_ready' }
      // Embed the plan markdown so the renderer can show it in the approval block.
      // Format: `__plan_approval__\n\n<plan markdown>`
      const planQuestion = `__plan_approval__\n\n${exit.plan ?? ''}`
      const decision = await onAskUser(
        planQuestion,
        exit.id,
        ['approve_default', 'approve_yolo', 'save', 'suggest']
      )
      // Decision values:
      //   approve | approve_default → run with default permissions
      //   approve_yolo              → run with yolo permissions (auto-approve all tools)
      //   save                      → save plan to workspace and end the run
      //   suggest:<feedback>        → reject with feedback, agent revises
      if (decision === 'approve' || decision === 'approve_default' || decision === 'approve_yolo') {
        planApproved = true
        if (decision === 'approve_yolo') effectiveMode = 'yolo'
        else if (decision === 'approve_default') effectiveMode = 'default'
        // Rebuild system prompt for the approved execution mode (strip plan-mode instructions)
        if (!systemPromptOverride) {
          systemPrompt = SYSTEM_PROMPT
          if (effectiveMode === 'yolo') systemPrompt = buildYoloModePrompt(systemPrompt)
          if (workspacePath) systemPrompt += `\n\n## Workspace\nCurrent workspace: ${workspacePath}`
          if (rulesSection) systemPrompt += `\n\n${rulesSection}`
          if (skillsSection) systemPrompt += `\n\n${skillsSection}`
          if (systemPromptCustom) systemPrompt += `\n\n## Custom Instructions\n${systemPromptCustom}`
          if (agentDef?.systemPrompt) systemPrompt += `\n${agentDef.systemPrompt}`
          if (systemPromptAppend) systemPrompt += `\n\n${systemPromptAppend}`
        }
        if (isSynthetic) {
          // The model wrote text — just inject a user turn to proceed.
          history.push({ role: 'user', content: 'Plan approved. Please proceed to execute the plan.' })
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
              { type: 'tool_result', tool_use_id: exit.id, content: 'Plan approved. Proceed to execute.' },
            ],
          })
        }
        continue
      } else if (decision.startsWith('save')) {
        // User chose to save plan and exit. The renderer is responsible for the
        // actual file write (it has workspace context via IPC); we just end here.
        if (!isSynthetic) {
          history.push({
            role: 'assistant',
            content: [
              { type: 'tool_use', id: exit.id, name: 'ExitPlanMode', input: { plan: exit.plan } },
            ],
          })
          history.push({
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: exit.id, content: 'Plan saved by user. Ending run.' },
            ],
          })
        }
        yield { type: 'turn_complete', usage: { inputTokens: 0, outputTokens: 0 }, reason: 'end_turn' }
        return
      } else {
        // suggest:<feedback>  OR  reject (legacy)
        const feedback = decision.startsWith('suggest:')
          ? decision.slice('suggest:'.length).trim()
          : ''
        const rejectMsg = feedback
          ? `Plan rejected. User feedback: ${feedback}\n\nPlease revise the plan and propose a new one.`
          : 'Plan rejected. Please revise and propose a new plan.'
        if (isSynthetic) {
          history.push({ role: 'user', content: rejectMsg })
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
              { type: 'tool_result', tool_use_id: exit.id, content: rejectMsg },
            ],
          })
        }
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

      const permission = await canUseTool(call.name, effectiveMode, permissionStore, call.input)

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
