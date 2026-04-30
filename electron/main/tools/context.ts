/**
 * Context tools — query the app context snapshot cache.
 *
 * These tools allow the agent to quickly introspect connected-app resources
 * (channels, repos, etc.) without making live API calls.
 */
import type { Tool } from '.'
import { getSnapshot, getAllSnapshots, refreshSnapshot } from '../context/snapshotManager'
import { listConnections } from '../apps/manager'

export const CONTEXT_TOOLS: Tool[] = [
  {
    name: 'ListConnectedApps',
    description: 'List all currently connected and enabled apps, including their app IDs and the snapshot scopes available.',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const connections = listConnections().filter(c => c.enabled)
      const snapshots = getAllSnapshots()
      const scopesByApp: Record<string, string[]> = {}
      for (const s of snapshots) {
        scopesByApp[s.appId] = [...(scopesByApp[s.appId] ?? []), s.scope]
      }
      const result = connections.map(c => ({
        appId: c.appId,
        snapshotScopes: scopesByApp[c.appId] ?? [],
      }))
      return { output: JSON.stringify(result, null, 2) }
    },
  },

  {
    name: 'GetAppContext',
    description:
      'Return the cached resource snapshot for a connected app and scope (e.g. appId="slack", scope="channels"). ' +
      'Use ListConnectedApps first to discover available appId + scope combinations. ' +
      'The snapshot is populated on connect and may be a few hours old.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      required: ['appId', 'scope'],
      properties: {
        appId: { type: 'string', description: 'App ID, e.g. "slack", "github", "jira", "google"' },
        scope: { type: 'string', description: 'Snapshot scope, e.g. "channels", "repos", "projects", "calendars"' },
      },
    },
    async execute(input) {
      const { appId, scope } = input as { appId: string; scope: string }
      const snap = getSnapshot(appId, scope)
      if (!snap) {
        return { output: `No snapshot found for ${appId}/${scope}. The app may not be connected or the snapshot has not been built yet.` }
      }
      const age = Math.round((Date.now() - snap.fetchedAt) / 60_000)
      return {
        output: JSON.stringify({
          appId: snap.appId,
          scope: snap.scope,
          fetchedAtMinutesAgo: age,
          count: snap.data.length,
          items: snap.data,
        }, null, 2),
      }
    },
  },

  {
    name: 'ListAllAppContexts',
    description: 'Return a summary of every cached app resource snapshot (item counts only, no full data). Useful for a quick overview of connected apps.',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const snapshots = getAllSnapshots()
      const result = snapshots.map(s => ({
        appId: s.appId,
        scope: s.scope,
        count: s.data.length,
        fetchedAtMinutesAgo: Math.round((Date.now() - s.fetchedAt) / 60_000),
      }))
      return { output: JSON.stringify(result, null, 2) }
    },
  },

  {
    name: 'SearchAppContext',
    description:
      'Search within a cached app resource snapshot for items matching a keyword. ' +
      'Case-insensitive substring search across the JSON string representation of each item.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      required: ['appId', 'scope', 'query'],
      properties: {
        appId: { type: 'string', description: 'App ID, e.g. "slack", "github"' },
        scope: { type: 'string', description: 'Snapshot scope, e.g. "channels", "repos"' },
        query: { type: 'string', description: 'Keyword to search for (case-insensitive substring)' },
        limit: { type: 'number', description: 'Max results to return (default: 20)' },
      },
    },
    async execute(input) {
      const { appId, scope, query, limit = 20 } = input as { appId: string; scope: string; query: string; limit?: number }
      const snap = getSnapshot(appId, scope)
      if (!snap) {
        return { output: `No snapshot found for ${appId}/${scope}.` }
      }
      const lower = query.toLowerCase()
      const matches = snap.data.filter(item => JSON.stringify(item).toLowerCase().includes(lower))
      return {
        output: JSON.stringify({
          appId: snap.appId,
          scope: snap.scope,
          query,
          totalMatches: matches.length,
          items: matches.slice(0, limit),
        }, null, 2),
      }
    },
  },

  {
    name: 'RefreshAppContext',
    description:
      'Force-refresh the cached resource snapshot for a connected app (and optionally a specific scope). ' +
      'Use when you need the most up-to-date resources immediately rather than waiting for the scheduled refresh.',
    readOnly: false,
    inputSchema: {
      type: 'object',
      required: ['appId'],
      properties: {
        appId: { type: 'string', description: 'App ID to refresh, e.g. "slack", "github", "jira", "google"' },
        scope: { type: 'string', description: 'Optional scope to refresh (e.g. "channels", "repos"). Omit to refresh all scopes for the app.' },
      },
    },
    async execute(input) {
      const { appId, scope } = input as { appId: string; scope?: string }
      await refreshSnapshot(appId, scope)
      const snaps = scope ? [getSnapshot(appId, scope)].filter(Boolean) : getAllSnapshots(appId)
      const summary = snaps.map(s => ({
        appId: s!.appId,
        scope: s!.scope,
        count: s!.data.length,
        fetchedAtMinutesAgo: Math.round((Date.now() - s!.fetchedAt) / 60_000),
      }))
      return {
        output: JSON.stringify({ refreshed: true, appId, scope: scope ?? 'all', snapshots: summary }, null, 2),
      }
    },
  },
]
