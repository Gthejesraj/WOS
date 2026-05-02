/**
 * Dynamic catalogue of project-resource types.
 *
 * The catalogue is computed from:
 *   1. `projectResourceTypes()` declared by each connected app module (via
 *      apps/manager.ts → listProjectResourceTypes), and
 *   2. WOS-native types (meetings, workspace files, MCP resources, saved
 *      conversations, plain notes/links). These are owned by this module.
 *
 * Nothing is hardcoded by `kind` outside of the native list — new app
 * integrations automatically appear in the picker as soon as they ship a
 * `projectResourceTypes()` capability.
 */

import { listProjectResourceTypes, type ProjectResourceTypeEntry } from '../apps/manager'
import type { ProjectResourceTypeDef } from '../apps/types'

/**
 * Catalogue entry returned to the renderer over IPC. Must remain fully
 * structured-clone safe — i.e. **no functions**. The `fetcher` from the
 * underlying `ProjectResourceTypeDef` is intentionally omitted; server-side
 * code uses `findFetcherFor()` from `apps/manager.ts` to look it up.
 */
export type CatalogueEntry =
  & Omit<ProjectResourceTypeDef, 'fetcher'>
  & {
    appId: string
    appName: string
    appIcon?: string
    isNative: boolean
    /** Whether the underlying app is currently connected. Always true for native types. */
    connected: boolean
  }

const NATIVE_TYPES: Array<Omit<ProjectResourceTypeDef, 'fetcher'>> = [
  {
    kind: 'meeting',
    label: 'Meeting recording',
    description: 'Linked WOS meeting recording or transcript.',
    multiSelect: true,
    pickerComponentId: 'native-meeting',
    snapshotScope: 'meetings',
    refreshIntervalSec: 0,
    refSchema: {
      hint: 'Pick from your local WOS meetings, or paste a meeting id.',
      fields: [
        { name: 'id', label: 'Meeting id', type: 'text', required: true, placeholder: 'mtg_…' },
      ],
    },
  },
  {
    kind: 'workspace:file',
    label: 'Workspace file',
    description: 'A file inside a WOS workspace folder.',
    multiSelect: true,
    pickerComponentId: 'native-workspace-file',
    snapshotScope: 'workspaceFiles',
    refreshIntervalSec: 0,
    refSchema: {
      hint: 'Workspace + relative path.',
      fields: [
        { name: 'workspaceId', label: 'Workspace id', type: 'text', required: true },
        { name: 'relPath', label: 'Relative path', type: 'text', required: true, placeholder: 'src/index.ts' },
      ],
    },
  },
  {
    kind: 'mcp:resource',
    label: 'MCP resource',
    description: 'A resource exposed by a connected MCP server.',
    multiSelect: true,
    pickerComponentId: 'native-mcp',
    snapshotScope: 'mcpResources',
    refreshIntervalSec: 1800,
    refSchema: {
      fields: [
        { name: 'serverId', label: 'MCP server id', type: 'text', required: true },
        { name: 'uri', label: 'Resource URI', type: 'text', required: true },
      ],
    },
  },
  {
    kind: 'conversation',
    label: 'Saved chat',
    description: 'Pin a WOS conversation as part of this project.',
    multiSelect: true,
    pickerComponentId: 'native-conversation',
    snapshotScope: 'conversations',
    refreshIntervalSec: 0,
    refSchema: {
      fields: [
        { name: 'conversationId', label: 'Conversation id', type: 'text', required: true },
      ],
    },
  },
  {
    kind: 'note',
    label: 'Note',
    description: 'A short markdown note kept inside the project.',
    multiSelect: true,
    pickerComponentId: 'native-note',
    refreshIntervalSec: 0,
    refSchema: {
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'body', label: 'Markdown', type: 'textarea' },
      ],
    },
  },
  {
    kind: 'custom_link',
    label: 'Custom link',
    description: 'Any external URL — Confluence, Notion, dashboards, etc.',
    multiSelect: true,
    pickerComponentId: 'native-custom-link',
    refreshIntervalSec: 0,
    refSchema: {
      fields: [
        { name: 'label', label: 'Label', type: 'text', required: true, placeholder: 'Design doc' },
        { name: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://…' },
      ],
    },
  },
]

export const NATIVE_APP_ID = 'native'
export const NATIVE_APP_NAME = 'WOS Native'

export function listCatalogue(opts: { onlyConnected?: boolean } = {}): CatalogueEntry[] {
  // Default: surface ALL kinds (connected + not connected). Renderer uses
  // the per-entry `connected` flag to badge unconnected apps and route to a
  // free-form picker fallback.
  const onlyConnected = opts.onlyConnected ?? false
  const fromApps: CatalogueEntry[] = listProjectResourceTypes({ onlyConnected }).map((e: ProjectResourceTypeEntry) => ({
    ...e,
    isNative: false,
  }))
  const native: CatalogueEntry[] = NATIVE_TYPES.map(t => ({
    ...t,
    appId: NATIVE_APP_ID,
    appName: NATIVE_APP_NAME,
    isNative: true,
    connected: true,
  }))
  return [...native, ...fromApps]
}

export function findEntryByKind(kind: string): CatalogueEntry | undefined {
  return listCatalogue({ onlyConnected: false }).find(e => e.kind === kind)
}
