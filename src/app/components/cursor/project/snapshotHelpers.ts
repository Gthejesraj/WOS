export interface SnapshotItem {
  id?: string
  name?: string
  real_name?: string
  key?: string
  summary?: string
  full_name?: string
  owner?: { login?: string }
  description?: string
  is_member?: boolean
  num_members?: number
  private?: boolean
  archived?: boolean
  primary?: boolean
  [k: string]: unknown
}

export function pickPrimary(item: SnapshotItem, kind: string): string {
  if (kind.startsWith('slack:channel')) return `#${item.name ?? item.id ?? '?'}`
  if (kind.startsWith('slack:user')) return item.real_name || item.name || (item.id as string) || '?'
  if (kind === 'github:repo') return (item.full_name as string) || `${item.owner?.login ?? '?'}/${item.name ?? '?'}`
  if (kind === 'jira:project') return (item.name as string) || (item.key as string) || '?'
  if (kind === 'jira:epic') return (item.summary as string) || (item.key as string) || '?'
  if (kind === 'google:calendar') return (item.summary as string) || (item.id as string) || '?'
  if (kind === 'google:gmail_label') return (item.name as string) || (item.id as string) || '?'
  if (kind === 'google:drive_folder') return (item.name as string) || (item.id as string) || '?'
  if (kind === 'meeting') return (item.title as string) || (item.id as string) || 'Untitled meeting'
  if (kind === 'workspace:file') return (item.relPath as string) || (item.path as string) || '?'
  if (kind === 'mcp:resource') return (item.uri as string) || (item.name as string) || '?'
  if (kind === 'conversation') return (item.title as string) || (item.id as string) || 'Untitled chat'
  return (item.name as string) || (item.id as string) || JSON.stringify(item).slice(0, 40)
}

export function pickSubtitle(item: SnapshotItem, kind: string): string | null {
  if (kind === 'slack:channel') return `${item.num_members ?? 0} members${item.is_member ? '' : ' · not joined'}`
  if (kind === 'slack:user') return `@${item.name ?? ''}`
  if (kind === 'github:repo') {
    const parts: string[] = []
    if (item.private) parts.push('private')
    if (item.archived) parts.push('archived')
    if (typeof item.description === 'string' && item.description) parts.push(item.description)
    return parts.join(' · ') || null
  }
  if (kind === 'jira:project') return (item.key as string) ?? null
  if (kind === 'google:calendar') return item.primary ? 'primary' : ((item.id as string) ?? null)
  if (kind === 'meeting') {
    const ts = (item.started_at as number) ?? (item.startedAt as number)
    return ts ? new Date(ts).toLocaleString() : null
  }
  if (kind === 'workspace:file') return (item.workspace_name as string) || null
  if (kind === 'mcp:resource') return (item.server_name as string) || null
  if (kind === 'conversation') {
    const ts = (item.updated_at as number) ?? (item.updatedAt as number)
    return ts ? new Date(ts).toLocaleString() : null
  }
  return null
}

export function buildRef(item: SnapshotItem, kind: string): unknown {
  if (kind === 'slack:channel' || kind === 'slack:user') return { id: item.id }
  if (kind === 'github:repo') {
    if (item.full_name && typeof item.full_name === 'string') {
      const [owner, repo] = item.full_name.split('/')
      return { owner, repo }
    }
    return { owner: item.owner?.login, repo: item.name }
  }
  if (kind === 'jira:project') return { key: item.key }
  if (kind === 'jira:epic') return { jql: `"Epic Link" = ${item.key}` }
  if (kind === 'google:calendar') return { id: item.id }
  if (kind === 'google:gmail_label') return { label: item.name }
  if (kind === 'google:drive_folder') return { folderId: item.id }
  if (kind === 'meeting') return { id: item.id }
  if (kind === 'workspace:file') return { workspaceId: item.workspace_id, relPath: item.rel_path ?? item.relPath }
  if (kind === 'mcp:resource') return { serverId: item.server_id, uri: item.uri }
  if (kind === 'conversation') return { conversationId: item.id }
  return item
}
