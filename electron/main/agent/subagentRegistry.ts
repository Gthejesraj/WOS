/**
 * Tracks active subagent runs to enforce depth and breadth limits.
 * Prevents unbounded spawning that could OOM the process.
 */

interface SubagentEntry {
  parentId: string | null
  depth: number
  startedAt: number
}

const registry = new Map<string, SubagentEntry>()
const breadthByParent = new Map<string | null, number>()

export function registerSubagent(agentId: string, parentId: string | null, depth: number): void {
  registry.set(agentId, { parentId, depth, startedAt: Date.now() })
  breadthByParent.set(parentId, (breadthByParent.get(parentId) ?? 0) + 1)
}

export function unregisterSubagent(agentId: string): void {
  const entry = registry.get(agentId)
  if (!entry) return
  registry.delete(agentId)
  const current = breadthByParent.get(entry.parentId) ?? 0
  if (current <= 1) {
    breadthByParent.delete(entry.parentId)
  } else {
    breadthByParent.set(entry.parentId, current - 1)
  }
}

export function getCurrentBreadth(parentId: string | null): number {
  return breadthByParent.get(parentId) ?? 0
}

export function getActiveCount(): number {
  return registry.size
}

export function getStats(): { active: number; byDepth: Record<number, number> } {
  const byDepth: Record<number, number> = {}
  for (const entry of registry.values()) {
    byDepth[entry.depth] = (byDepth[entry.depth] ?? 0) + 1
  }
  return { active: registry.size, byDepth }
}
