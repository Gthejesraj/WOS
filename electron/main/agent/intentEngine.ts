import { getProvider } from '../providers'

export interface ClarificationRequest {
  field: string
  question: string
  suggestions?: string[]
}

export interface IntentAnalysis {
  appsNeeded: string[]
  actionType: string
  toolFilter: string[]
  confidence: number
  shouldAskFirst: boolean
  missingInfo: ClarificationRequest[]
}

const INTENT_SYSTEM = `You are an intent classifier for an AI agent. Given a user message and a list of available tool groups, return JSON identifying which tools are needed and whether any information is missing.

Output ONLY valid JSON with this shape:
{
  "appsNeeded": ["slack", "github"],       // tool group prefixes needed
  "actionType": "create|read|update|search|send|analyze|other",
  "toolFilter": ["SlackSendMessage", ...], // exact tool names to include (empty = all)
  "confidence": 0.92,
  "shouldAskFirst": false,                 // true if critical info is missing
  "missingInfo": [
    { "field": "channel", "question": "Which Slack channel?", "suggestions": ["#general"] }
  ]
}

Rules:
- Include core builtin tools always (Bash, FileRead, FileWrite, WebFetch, WebSearch, Task, AskUser, etc.)
- Only add app-specific tools when clearly needed
- Set confidence < 0.5 when the request is ambiguous or general
- Keep toolFilter empty (meaning: include all) when confidence < 0.5`

/** Run intent classification against a fast model (haiku by default). */
export async function analyzeIntent(
  userMessage: string,
  availableToolGroups: string[],
  model: string,
  apiKeyOverride?: string,
  signal?: AbortSignal,
): Promise<IntentAnalysis> {
  const fallback: IntentAnalysis = {
    appsNeeded: [],
    actionType: 'other',
    toolFilter: [],
    confidence: 0,
    shouldAskFirst: false,
    missingInfo: [],
  }

  // Don't run intent analysis for very short messages or when no dynamic tools exist
  if (userMessage.trim().length < 10 || availableToolGroups.length === 0) {
    return fallback
  }

  const userContent = `Available tool groups: ${availableToolGroups.join(', ')}

User message: "${userMessage}"

Classify the intent and return JSON only.`

  try {
    const provider = getProvider(model)
    const abortSignal = signal ?? new AbortController().signal
    let raw = ''

    const stream = provider.stream({
      model,
      messages: [{ role: 'user', content: userContent }],
      tools: [],
      systemPrompt: INTENT_SYSTEM,
      apiKeyOverride,
      signal: abortSignal,
      maxTokens: 512,
    } as Parameters<typeof provider.stream>[0])

    for await (const event of stream) {
      if (event.type === 'text_delta') raw += event.content
      if (event.type === 'message_stop') break
    }

    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return fallback

    const parsed = JSON.parse(jsonMatch[0]) as Partial<IntentAnalysis>
    return {
      appsNeeded: Array.isArray(parsed.appsNeeded) ? parsed.appsNeeded : [],
      actionType: typeof parsed.actionType === 'string' ? parsed.actionType : 'other',
      toolFilter: Array.isArray(parsed.toolFilter) ? parsed.toolFilter : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      shouldAskFirst: !!parsed.shouldAskFirst,
      missingInfo: Array.isArray(parsed.missingInfo) ? parsed.missingInfo : [],
    }
  } catch {
    return fallback
  }
}

/**
 * Extract dynamic tool group names from the full tool list.
 * Returns prefixes like ['slack', 'github', 'mcp_linear', 'plugin_linear-integration'] etc.
 * Plugin tools use the form <pluginId>__<toolName> — double underscore, no 'mcp__' prefix.
 * MCP tools use the form mcp__<serverId>__<toolName>.
 */
export function extractToolGroups(toolNames: string[]): string[] {
  const groups = new Set<string>()
  for (const name of toolNames) {
    if (name.startsWith('Slack')) groups.add('slack')
    else if (name.startsWith('GitHub')) groups.add('github')
    else if (name.startsWith('Google')) groups.add('google')
    else if (name.startsWith('Jira')) groups.add('jira')
    else if (name.startsWith('mcp__')) {
      const parts = name.split('__')
      if (parts[1]) groups.add(`mcp_${parts[1]}`)
    } else if (name.includes('__') && !name.startsWith('mcp__')) {
      // Plugin tool: <pluginId>__<toolName>
      const pluginId = name.split('__')[0]
      if (pluginId) groups.add(`plugin_${pluginId}`)
    }
  }
  return [...groups]
}

/**
 * Check if a user message matches any plugin trigger keywords.
 * Returns the list of plugin IDs whose triggers matched.
 * This supplements the LLM-based intent analysis for fast keyword routing.
 */
export function matchPluginTriggers(
  message: string,
  triggerMap: Map<string, string>,
): string[] {
  const lower = message.toLowerCase()
  const matched = new Set<string>()
  for (const [trigger, pluginId] of triggerMap) {
    if (lower.includes(trigger)) matched.add(pluginId)
  }
  return [...matched]
}
