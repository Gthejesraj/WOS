export type AgentMode = 'default' | 'plan' | 'yolo'
export type PermissionRule = 'allow' | 'ask' | 'deny'

interface RuleSet {
  /** Default rule per tool name. */
  tools: Record<string, PermissionRule>
  /** For Bash specifically: regex patterns denied outright. */
  bashDenyPatterns: RegExp[]
}

const DEFAULT_RULES: RuleSet = {
  tools: {
    Read: 'allow',
    Glob: 'allow',
    Grep: 'allow',
    WebFetch: 'allow',
    WebSearch: 'allow',
    AskUser: 'allow',
    Task: 'allow',
    TodoWrite: 'allow',
    EnterPlanMode: 'allow',
    ExitPlanMode: 'allow',
    Write: 'ask',
    Edit: 'ask',
    Bash: 'ask',
  },
  bashDenyPatterns: [
    /\brm\s+-rf?\s+\/(?!tmp|var\/tmp)/i,
    /\bmkfs(\.|\s)/i,
    /\bdd\s+if=.*of=\/dev\//i,
    /:\(\)\s*\{\s*:\|:&/, // fork bomb
    /\bshutdown\b|\breboot\b|\bhalt\b/i,
  ],
}

export class PermissionStore {
  private sessionGrants = new Set<string>()
  private rules: RuleSet = DEFAULT_RULES

  addSessionGrant(toolName: string) {
    this.sessionGrants.add(toolName)
  }

  hasSessionGrant(toolName: string): boolean {
    return this.sessionGrants.has(toolName)
  }

  getRule(toolName: string): PermissionRule {
    return this.rules.tools[toolName] ?? 'ask'
  }

  setRule(toolName: string, rule: PermissionRule) {
    this.rules.tools[toolName] = rule
  }

  checkBashDeny(command: string): RegExp | null {
    for (const re of this.rules.bashDenyPatterns) {
      if (re.test(command)) return re
    }
    return null
  }

  clear() {
    this.sessionGrants.clear()
  }
}

export async function canUseTool(
  toolName: string,
  mode: AgentMode,
  permStore: PermissionStore,
  args?: unknown,
): Promise<{ decision: 'auto' | 'request' | 'deny'; reason?: string }> {
  if (toolName === 'Bash' && args && typeof args === 'object') {
    const cmd = String((args as { command?: string }).command ?? '')
    const denyRe = permStore.checkBashDeny(cmd)
    if (denyRe) return { decision: 'deny', reason: `Blocked by rule ${denyRe}` }
  }
  if (mode === 'yolo') return { decision: 'auto' }
  if (mode === 'plan') return { decision: 'auto' }

  const rule = permStore.getRule(toolName)
  if (rule === 'deny') return { decision: 'deny', reason: 'Blocked by rule' }
  if (rule === 'allow') return { decision: 'auto' }
  if (permStore.hasSessionGrant(toolName)) return { decision: 'auto' }
  return { decision: 'request' }
}
