/**
 * Quick-link computation for project resources.
 *
 * Each connected app has its own deep-link scheme. Rather than scattering
 * per-kind URL formatting across the renderer, we compute open-links
 * server-side from `(kind, ref, creds.metadata)` and ship the array to the
 * UI which renders them as a uniform pill row.
 *
 * Apps without specific link schemes fall back to whatever `url` field is
 * already in the ref payload.
 */
import { getConnection } from '../apps/manager'
import type { ProjectResourceRow } from './types'

export interface ResourceLink {
  label: string
  url: string
  icon?: string
}

export function getOpenLinks(resource: ProjectResourceRow): ResourceLink[] {
  const ref = (typeof resource.ref === 'object' && resource.ref) ? resource.ref as Record<string, unknown> : {}

  switch (resource.kind) {
    case 'slack:channel': {
      const id = pickStr(ref, 'id', 'channel') ?? ''
      const slack = getConnection('slack')
      const teamUrl = pickConnStr(slack, 'teamUrl', 'team_url') ?? ''
      const teamId = pickConnStr(slack, 'teamId', 'team_id') ?? ''
      const out: ResourceLink[] = []
      if (id && teamUrl) out.push({ label: 'Open in Slack', url: `${teamUrl.replace(/\/$/, '')}/archives/${id}` })
      if (id && teamId) out.push({ label: 'Deep link', url: `slack://channel?team=${teamId}&id=${id}` })
      return out
    }
    case 'slack:user': {
      const id = pickStr(ref, 'id', 'user') ?? ''
      const slack = getConnection('slack')
      const teamUrl = pickConnStr(slack, 'teamUrl', 'team_url') ?? ''
      if (id && teamUrl) return [{ label: 'Open profile', url: `${teamUrl.replace(/\/$/, '')}/team/${id}` }]
      return []
    }
    case 'github:repo': {
      const owner = pickStr(ref, 'owner') ?? ''
      const repo = pickStr(ref, 'repo', 'name') ?? ''
      if (!owner || !repo) return []
      const base = `https://github.com/${owner}/${repo}`
      return [
        { label: 'Repository', url: base },
        { label: 'Pull requests', url: `${base}/pulls` },
        { label: 'Issues', url: `${base}/issues` },
        { label: 'Actions', url: `${base}/actions` },
      ]
    }
    case 'jira:project': {
      const key = pickStr(ref, 'key', 'id') ?? ''
      const jira = getConnection('jira')
      const baseUrl = (pickConnStr(jira, 'baseUrl', 'base_url', 'siteUrl') ?? '').replace(/\/$/, '')
      if (!key || !baseUrl) return []
      return [
        { label: 'Board', url: `${baseUrl}/jira/software/projects/${key}/boards` },
        { label: 'Backlog', url: `${baseUrl}/jira/software/projects/${key}/backlog` },
        { label: 'Issues', url: `${baseUrl}/jira/issues/?jql=project%20%3D%20${encodeURIComponent(key)}` },
      ]
    }
    case 'jira:epic': {
      const jira = getConnection('jira')
      const baseUrl = (pickConnStr(jira, 'baseUrl', 'base_url', 'siteUrl') ?? '').replace(/\/$/, '')
      const epic = pickStr(ref, 'epic', 'key') ?? ''
      const jql = pickStr(ref, 'jql', 'query') ?? ''
      const out: ResourceLink[] = []
      if (epic && baseUrl) out.push({ label: 'Open epic', url: `${baseUrl}/browse/${epic}` })
      if (jql && baseUrl) out.push({ label: 'Search', url: `${baseUrl}/jira/issues/?jql=${encodeURIComponent(jql)}` })
      return out
    }
    case 'google:calendar': {
      const id = pickStr(ref, 'id') ?? 'primary'
      return [{ label: 'Open in Google Calendar', url: `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(id)}` }]
    }
    case 'google:gmail_label': {
      const q = pickStr(ref, 'query', 'jql') ?? ''
      if (!q) return []
      return [{ label: 'Open in Gmail', url: `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(q)}` }]
    }
    case 'google:drive_folder': {
      const id = pickStr(ref, 'id') ?? ''
      if (!id) return []
      return [{ label: 'Open in Drive', url: `https://drive.google.com/drive/folders/${id}` }]
    }
    case 'custom_link': {
      const url = pickStr(ref, 'url') ?? ''
      const label = pickStr(ref, 'label') ?? 'Open link'
      if (!url) return []
      return [{ label, url }]
    }
    default: {
      const url = pickStr(ref, 'url', 'link', 'html_url')
      return url ? [{ label: 'Open', url }] : []
    }
  }
}

function pickStr(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return null
}

function pickConnStr(
  conn: { creds: Record<string, string>; metadata: Record<string, unknown> | null } | null,
  ...keys: string[]
): string | null {
  if (!conn) return null
  for (const k of keys) {
    const c = conn.creds?.[k]
    if (typeof c === 'string' && c.trim()) return c
    const m = conn.metadata?.[k]
    if (typeof m === 'string' && m.trim()) return m
  }
  return null
}
