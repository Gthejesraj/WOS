/**
 * Agent definitions registry.
 *
 * Each definition declares:
 *   - key: stable identifier ("wos", "meeting", ...)
 *   - systemPrompt: replaces or augments the base prompt for this agent
 *   - toolFilter(allTools): returns the curated subset of tools this agent
 *     should see. The default WOS agent gets everything; specialists like
 *     the meeting agent get a tightly-curated slice.
 *
 * Adding a new specialist agent = drop a new file here + register in `defs`.
 */

import type { Tool } from '../../tools'
import { wosAgent } from './wos'
import { meetingAgent } from './meeting'

export interface AgentDef {
  key: string
  systemPrompt?: string
  /** Default config seeded into this agent's resolved settings. */
  defaultConfig?: Record<string, unknown>
  /** Default parent agent for inheritance when no DB row sets it. */
  defaultInheritFrom?: string | null
  toolFilter(allTools: Tool[]): Tool[]
}

const defs: Record<string, AgentDef> = {
  [wosAgent.key]: wosAgent,
  [meetingAgent.key]: meetingAgent,
}

export function getAgentDef(key: string | undefined | null): AgentDef | undefined {
  if (!key) return undefined
  return defs[key]
}

export function listAgentDefs(): AgentDef[] {
  return Object.values(defs)
}

export { wosAgent, meetingAgent }
