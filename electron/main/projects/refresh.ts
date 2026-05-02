/**
 * Smart-cadence refresh loop for project resources.
 *
 * Walks every active project resource on a 60s sweep. For each resource that
 * has gone past its per-kind `refreshIntervalSec`, looks up the owning app
 * module's `fetcher`, calls it with the connection creds + the resource ref,
 * and normalises the returned payload into rows in `project_activity` via
 * `recordActivity` (dedupe-keyed).
 *
 * Webhooks (when configured) call `refreshResource` directly to bypass
 * polling.
 */

import { listProjects, listResources, markResourceFetched, recordActivity, findResourceById } from './manager'
import type { ProjectResourceRow } from './types'
import { findEntryByKind } from './resources'
import { findFetcherFor, getConnection } from '../apps/manager'

const TICK_MS = 60_000
let timer: NodeJS.Timeout | null = null

export function startProjectRefreshLoop(): void {
  if (timer) return
  timer = setInterval(() => {
    try {
      tick()
    } catch (err) {
      console.error('[projects/refresh] tick failed', err)
    }
  }, TICK_MS)
  if (typeof timer.unref === 'function') timer.unref()
}

export function stopProjectRefreshLoop(): void {
  if (timer) { clearInterval(timer); timer = null }
}

function tick(): void {
  const now = Date.now()
  const projects = listProjects().filter(p => p.status === 'active')
  for (const project of projects) {
    const resources = listResources(project.id)
    for (const r of resources) {
      const entry = findEntryByKind(r.kind)
      const intervalSec = r.refreshIntervalSec ?? entry?.refreshIntervalSec ?? 0
      if (!intervalSec) continue
      const dueAt = (r.lastFetchedAt ?? 0) + intervalSec * 1000
      if (dueAt > now) continue
      void refreshResource(r.id).catch(err =>
        console.error('[projects/refresh] resource fetch failed', r.id, err)
      )
    }
  }
}

/**
 * Refresh a single resource. Hook for webhooks + manual triggers + the tick
 * sweep. Resolves the catalogue entry, looks up the owning app's fetcher,
 * invokes it, and normalises any returned events into project activity.
 */
export async function refreshResource(resourceId: string): Promise<void> {
  const resource = findResourceById(resourceId)
  if (!resource) return

  const entry = findEntryByKind(resource.kind)
  if (!entry || entry.isNative) {
    markResourceFetched(resourceId)
    return
  }

  const fetcher = findFetcherFor(entry.appId, resource.kind)
  if (!fetcher) {
    markResourceFetched(resourceId)
    return
  }

  const conn = getConnection(entry.appId)
  if (!conn || !conn.enabled) {
    markResourceFetched(resourceId)
    return
  }

  let payload: unknown
  try {
    payload = await fetcher(conn.creds, resource.ref)
  } catch (err) {
    console.error('[projects/refresh] fetcher threw', entry.appId, resource.kind, err)
    markResourceFetched(resourceId)
    return
  }

  try {
    normalizeIntoActivity(resource, entry.appId, payload)
  } catch (err) {
    console.error('[projects/refresh] normalize failed', entry.appId, resource.kind, err)
  }

  markResourceFetched(resourceId)
}

interface NormalizedEvent {
  ts: number
  actor?: string | null
  title: string
  url?: string | null
  dedupeKey: string
  payload?: unknown
}

/**
 * Best-effort normaliser. We accept anything an app fetcher returns and try
 * to extract a list of events. Apps are encouraged to return either an array
 * of `{ id|key, ts|timestamp, actor|user, title|text, url, ... }` shapes or
 * `{ events: [...] }`. Anything we can't normalise is skipped silently — the
 * fetcher contract is intentionally loose so that small apps don't have to
 * implement a heavy schema.
 */
function normalizeIntoActivity(
  resource: ProjectResourceRow,
  sourceApp: string,
  payload: unknown
): void {
  const events = extractEvents(payload)
  if (!events.length) return
  for (const ev of events) {
    recordActivity({
      projectId: resource.projectId,
      sourceApp,
      sourceKind: resource.kind,
      ts: ev.ts,
      actor: ev.actor ?? null,
      title: ev.title,
      url: ev.url ?? null,
      payload: ev.payload,
      dedupeKey: `${sourceApp}:${resource.kind}:${resource.id}:${ev.dedupeKey}`,
    })
  }
}

function extractEvents(payload: unknown): NormalizedEvent[] {
  if (payload == null) return []
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { events?: unknown[] }).events)
      ? (payload as { events: unknown[] }).events
      : Array.isArray((payload as { items?: unknown[] }).items)
        ? (payload as { items: unknown[] }).items
        : []
  const out: NormalizedEvent[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const tsRaw = r.ts ?? r.timestamp ?? r.created_at ?? r.createdAt ?? r.updated_at ?? r.updatedAt
    const ts = typeof tsRaw === 'number'
      ? (tsRaw < 1e12 ? tsRaw * 1000 : tsRaw)
      : typeof tsRaw === 'string'
        ? Date.parse(tsRaw) || Date.now()
        : Date.now()
    const title = typeof r.title === 'string' ? r.title
      : typeof r.text === 'string' ? r.text
      : typeof r.summary === 'string' ? r.summary
      : typeof r.subject === 'string' ? r.subject
      : typeof r.name === 'string' ? r.name
      : null
    if (!title) continue
    const actor = typeof r.actor === 'string' ? r.actor
      : typeof r.user === 'string' ? r.user
      : typeof r.author === 'string' ? r.author
      : typeof r.from === 'string' ? r.from
      : null
    const url = typeof r.url === 'string' ? r.url
      : typeof r.link === 'string' ? r.link
      : typeof r.html_url === 'string' ? r.html_url
      : null
    const dedupeKey = typeof r.id === 'string' ? r.id
      : typeof r.key === 'string' ? r.key
      : typeof r.guid === 'string' ? r.guid
      : `${ts}:${title.slice(0, 64)}`
    out.push({ ts, actor, title, url, dedupeKey, payload: r })
  }
  return out
}

// Exported for unit tests. Internal helper otherwise.
export const __test = { extractEvents }
