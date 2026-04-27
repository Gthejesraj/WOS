export type AgentMode = 'default' | 'plan' | 'yolo'
export type ViewType = 'home' | 'chat' | 'settings' | 'apps' | 'meetings'

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
  | { type: 'ask_user_answered'; questionId: string; answer: string }
  | { type: 'plan_ready' }
  | { type: 'turn_start' }
  | { type: 'turn_complete'; usage: { inputTokens: number; outputTokens: number }; reason?: 'end_turn' | 'tool_use' | 'aborted' | 'error' }
  | { type: 'error'; message: string; retryable: boolean }
  | { type: 'compact_started' }
  | { type: 'compact_complete'; summary: string }

export type MessageBlock =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string; collapsed?: boolean; done?: boolean; interrupted?: boolean }
  | { type: 'tool_use'; toolName: string; toolId: string; input: unknown; partialArgs?: string; status: 'preparing' | 'running' | 'done' | 'error'; result?: unknown; error?: string; stdout?: string; stderr?: string; interrupted?: boolean }
  | { type: 'tool_result'; toolId: string; result: unknown; error?: string }
  | { type: 'subagent'; agentId: string; prompt: string; events: AgentEvent[]; result?: string; collapsed?: boolean; interrupted?: boolean }
  | { type: 'permission_request'; toolName: string; toolId: string; args: unknown; decision?: 'allowed' | 'denied'; interrupted?: boolean }
  | { type: 'ask_user'; question: string; questionId: string; choices?: string[]; answer?: string; interrupted?: boolean }
  | { type: 'diff'; filePath: string; diff: string; collapsed?: boolean }
  | { type: 'error'; message: string; retryable: boolean }
  | { type: 'compact_notice'; summary: string }

export interface DisplayMessage {
  id: string
  role: 'user' | 'assistant'
  blocks: MessageBlock[]
  createdAt: Date
  branchGroupId?: string | null
  branchIndex?: number | null
}

export interface Conversation {
  id: string
  title: string
  workspaceId: string | null
  model: string
  mode: AgentMode
  createdAt: Date
  updatedAt: Date
  tokenCount: number
  contextLimit: number
  isCompacted: boolean
}

export interface Workspace {
  id: string
  path: string
  name: string
  addedAt: Date
  lastAccessedAt: Date | null
}

export interface ModelInfo {
  id: string
  name: string
  provider: 'openai' | 'anthropic'
  contextWindow?: number
  supportsReasoning?: boolean
  supportsVision?: boolean
  description?: string
}

export interface FileAttachment {
  name: string
  content: string
  type: string
}

export interface Settings {
  defaultModel: string
  reasoningEffort: 'low' | 'medium' | 'high' | 'max'
  defaultMode: AgentMode
  theme: 'dark' | 'light' | 'system'
  activeWorkspaceId: string | null
}
