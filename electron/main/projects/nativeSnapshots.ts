/**
 * Native (WOS-local) snapshot rows for the resource picker.
 *
 * These power the picker for `pickerComponentId: 'native-*'` types: meetings,
 * workspace files, MCP resources, saved conversations, notes, custom links.
 *
 * Each function returns an array of rows shaped like
 *   { id, title, subtitle?, meta?, ref }
 * where `ref` is the JSON value the picker will pass to `addResource`.
 *
 * Heavy/long lists (workspaces files) are bounded; the picker filters in-memory.
 */
import { queryRaw } from '../db'

export interface NativeSnapshotItem {
  id: string
  title: string
  subtitle?: string
  meta?: string
  ref: unknown
}

export interface NativeSnapshotResult {
  items: NativeSnapshotItem[]
  /** Truthy when truncated and there's more data than returned. */
  truncated: boolean
}

const LIMIT = 200

function listMeetings(): NativeSnapshotItem[] {
  try {
    const rows = queryRaw<{ id: string; title: string | null; started_at: number; ended_at: number | null }>(
      `SELECT id, title, started_at, ended_at FROM meetings ORDER BY started_at DESC LIMIT ?`,
      [LIMIT],
    )
    return rows.map(r => ({
      id: r.id,
      title: r.title?.trim() || `Meeting ${new Date(r.started_at).toLocaleString()}`,
      subtitle: new Date(r.started_at).toLocaleString(),
      meta: r.ended_at ? `${Math.round((r.ended_at - r.started_at) / 60000)}m` : 'live',
      ref: { id: r.id },
    }))
  } catch {
    return []
  }
}

function listConversations(): NativeSnapshotItem[] {
  try {
    const rows = queryRaw<{ id: string; title: string | null; updated_at: number }>(
      `SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC LIMIT ?`,
      [LIMIT],
    )
    return rows.map(r => ({
      id: r.id,
      title: r.title?.trim() || 'Untitled chat',
      subtitle: new Date(r.updated_at).toLocaleString(),
      ref: { conversationId: r.id },
    }))
  } catch {
    return []
  }
}

function listMcpResources(): NativeSnapshotItem[] {
  try {
    const rows = queryRaw<{ id: string; name: string; status: string | null }>(
      `SELECT id, name, status FROM mcp_servers ORDER BY name LIMIT ?`,
      [LIMIT],
    )
    return rows.map(r => ({
      id: r.id,
      title: r.name,
      subtitle: r.status ?? 'unknown',
      ref: { serverId: r.id },
    }))
  } catch {
    return []
  }
}

function listWorkspaceFiles(): NativeSnapshotItem[] {
  // Workspaces themselves rather than walking trees — picking a workspace is
  // the realistic entry point; the user can paste a relPath in the form.
  try {
    const rows = queryRaw<{ id: string; name: string; root_path: string }>(
      `SELECT id, name, root_path FROM workspaces ORDER BY name LIMIT ?`,
      [LIMIT],
    )
    return rows.map(r => ({
      id: r.id,
      title: r.name,
      subtitle: r.root_path,
      meta: 'workspace',
      ref: { workspaceId: r.id, relPath: '' },
    }))
  } catch {
    return []
  }
}

export function getNativeSnapshot(scope: string): NativeSnapshotResult {
  switch (scope) {
    case 'meetings':       return { items: listMeetings(), truncated: false }
    case 'conversations':  return { items: listConversations(), truncated: false }
    case 'mcpResources':   return { items: listMcpResources(), truncated: false }
    case 'workspaceFiles': return { items: listWorkspaceFiles(), truncated: false }
    default:               return { items: [], truncated: false }
  }
}
