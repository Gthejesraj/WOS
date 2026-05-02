/**
 * Snapshot-driven resource picker.
 *
 * Reads the catalogue entry's `snapshotScope` to fetch a list of selectable
 * items from the live snapshot (or `wos:nativeSnapshot`), with refresh button
 * and a "Use a custom value…" fallback driven entirely by `entry.refSchema`.
 *
 * Per-kind rendering is *generic*: we read common fields (name, id, key,
 * summary, real_name, etc.) so any new app participates without code changes.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Search, RefreshCw, Plus, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import type { CatalogueEntry, ResourceRefField } from '../../../../store/projectsStore'

interface PickedItem {
  ref: unknown
  label: string
  refreshIntervalSec?: number
}

interface PickerProps {
  entry: CatalogueEntry
  projectId: string
  onAdded: () => void
  onClose: () => void
}

interface SnapshotItem {
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

function pickPrimary(item: SnapshotItem, kind: string): string {
  if (kind.startsWith('slack:channel')) return `#${item.name ?? item.id ?? '?'}`
  if (kind.startsWith('slack:user')) return item.real_name || item.name || (item.id as string) || '?'
  if (kind === 'github:repo') return (item.full_name as string) || `${item.owner?.login ?? '?'}/${item.name ?? '?'}`
  if (kind === 'jira:project') return (item.name as string) || (item.key as string) || '?'
  if (kind === 'jira:epic') return (item.summary as string) || (item.key as string) || '?'
  if (kind === 'google:calendar') return (item.summary as string) || (item.id as string) || '?'
  if (kind === 'google:gmail_label') return (item.name as string) || (item.id as string) || '?'
  if (kind === 'google:drive_folder') return (item.name as string) || (item.id as string) || '?'
  // native
  if (kind === 'meeting') return (item.title as string) || (item.id as string) || 'Untitled meeting'
  if (kind === 'workspace:file') return (item.relPath as string) || (item.path as string) || '?'
  if (kind === 'mcp:resource') return (item.uri as string) || (item.name as string) || '?'
  if (kind === 'conversation') return (item.title as string) || (item.id as string) || 'Untitled chat'
  return (item.name as string) || (item.id as string) || JSON.stringify(item).slice(0, 40)
}

function pickSubtitle(item: SnapshotItem, kind: string): string | null {
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

function buildRef(item: SnapshotItem, kind: string): unknown {
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

export function ResourcePicker({ entry, projectId, onAdded, onClose }: PickerProps) {
  const [items, setItems] = useState<SnapshotItem[]>([])
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [showCustom, setShowCustom] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const wos = (window as unknown as { wos: { projects: {
    appSnapshot: (a: string, s: string) => Promise<{ data: SnapshotItem[]; fetchedAt: number; stale: boolean } | null>
    appSnapshotRefresh: (a: string, s?: string) => Promise<{ data: SnapshotItem[]; fetchedAt: number } | null | { ok: boolean }>
    nativeSnapshot: (s: string) => Promise<{ items: SnapshotItem[]; truncated: boolean }>
    addResource: (p: string, i: unknown) => Promise<unknown>
  } } }).wos

  const load = useCallback(async () => {
    if (!entry.snapshotScope) {
      setItems([])
      return
    }
    setLoading(true)
    try {
      if (entry.isNative) {
        const r = await wos.projects.nativeSnapshot(entry.snapshotScope)
        setItems(r.items)
        setFetchedAt(Date.now())
      } else {
        const snap = await wos.projects.appSnapshot(entry.appId, entry.snapshotScope)
        if (snap) {
          setItems(Array.isArray(snap.data) ? snap.data : [])
          setFetchedAt(snap.fetchedAt)
        } else {
          setItems([])
          setFetchedAt(null)
        }
      }
    } finally {
      setLoading(false)
    }
  }, [entry, wos])

  useEffect(() => { void load() }, [load])

  const refresh = useCallback(async () => {
    if (entry.isNative || !entry.snapshotScope) {
      void load()
      return
    }
    setRefreshing(true)
    try {
      const r = await wos.projects.appSnapshotRefresh(entry.appId, entry.snapshotScope)
      if (r && typeof r === 'object' && 'data' in r) {
        setItems(Array.isArray((r as { data: SnapshotItem[] }).data) ? (r as { data: SnapshotItem[] }).data : [])
        setFetchedAt((r as { fetchedAt: number }).fetchedAt ?? Date.now())
      } else {
        await load()
      }
      toast.success('Refreshed')
    } catch (e) {
      toast.error(`Refresh failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRefreshing(false)
    }
  }, [entry, load, wos])

  const filtered = useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter(it => {
      const primary = pickPrimary(it, entry.kind).toLowerCase()
      const sub = (pickSubtitle(it, entry.kind) ?? '').toLowerCase()
      return primary.includes(q) || sub.includes(q)
    })
  }, [items, search, entry.kind])

  const toggle = (key: string) => {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else {
        if (!entry.multiSelect) next.clear()
        next.add(key)
      }
      return next
    })
  }

  const submitPicked = async () => {
    if (picked.size === 0) return
    setSubmitting(true)
    try {
      const queue: PickedItem[] = []
      for (const k of picked) {
        const item = items.find(it => (it.id ?? JSON.stringify(it)) === k)
        if (!item) continue
        queue.push({
          ref: buildRef(item, entry.kind),
          label: pickPrimary(item, entry.kind),
        })
      }
      for (const q of queue) {
        await wos.projects.addResource(projectId, {
          kind: entry.kind,
          ref: q.ref,
          label: q.label,
        })
      }
      toast.success(`Added ${queue.length} ${entry.label.toLowerCase()}${queue.length === 1 ? '' : 's'}`)
      onAdded()
    } catch (e) {
      toast.error(`Add failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const itemKey = (it: SnapshotItem) => (it.id as string) ?? JSON.stringify(it)
  const fetchedAgo = fetchedAt ? `${Math.max(1, Math.round((Date.now() - fetchedAt) / 60000))}m ago` : 'never'
  const notConnected = !entry.isNative && entry.connected === false

  // Auto-open custom form when not connected (no live snapshot to browse).
  useEffect(() => {
    if (notConnected && !showCustom) setShowCustom(true)
  }, [notConnected, showCustom])

  return (
    <div className="flex flex-col gap-3" style={{ minHeight: 380 }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[16px]">{entry.appIcon ?? '📌'}</span>
          <div>
            <div className="text-[13px] font-medium" style={{ color: 'var(--foreground)' }}>{entry.label}</div>
            <div className="text-[10px]" style={{ color: 'var(--zinc-500)' }}>
              {notConnected
                ? `${entry.appName} · not connected`
                : `${entry.appName} · ${items.length} item${items.length === 1 ? '' : 's'} · refreshed ${fetchedAgo}`}
            </div>
          </div>
        </div>
        {entry.snapshotScope && !entry.isNative && !notConnected && (
          <button
            onClick={refresh}
            disabled={refreshing}
            className="px-2 py-1 rounded-md text-[11px] flex items-center gap-1 disabled:opacity-50"
            style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
            title="Refresh from source"
          >
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        )}
      </div>

      {notConnected && (
        <div
          className="px-3 py-2 rounded-md text-[11px] flex items-start gap-2"
          style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.4)', color: 'var(--foreground)' }}
        >
          <span style={{ fontSize: 14 }}>⚡</span>
          <div className="flex-1">
            <div style={{ fontWeight: 500 }}>Connect {entry.appName} to browse live items</div>
            <div style={{ color: 'var(--zinc-400)', marginTop: 2 }}>
              You can still add a {entry.label.toLowerCase()} by URL or reference below — it will start syncing once {entry.appName} is connected in Apps.
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      {entry.snapshotScope && !notConnected && (
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--zinc-500)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${entry.label.toLowerCase()}…`}
            className="w-full pl-7 pr-2 py-1.5 rounded-md text-[12px] outline-none"
            style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
          />
        </div>
      )}

      {/* List */}
      {entry.snapshotScope && !notConnected && (
        <div
          className="overflow-y-auto rounded-md"
          style={{ maxHeight: 280, border: '1px solid var(--border)' }}
        >
          {loading ? (
            <div className="p-6 text-center text-[12px]" style={{ color: 'var(--zinc-500)' }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-[12px]" style={{ color: 'var(--zinc-500)' }}>
              {items.length === 0 ? 'No items yet — try Refresh.' : 'No results match your search.'}
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {filtered.map((it, idx) => {
                const key = itemKey(it)
                const isPicked = picked.has(key)
                return (
                  <motion.button
                    key={key}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15, delay: Math.min(idx * 0.01, 0.2) }}
                    onClick={() => toggle(key)}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-[var(--input)] transition-colors"
                    style={{
                      borderBottom: idx < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                      background: isPicked ? 'rgba(245, 158, 11, 0.12)' : 'transparent',
                    }}
                  >
                    <span
                      className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                      style={{
                        background: isPicked ? 'var(--amber)' : 'transparent',
                        border: isPicked ? '1px solid var(--amber)' : '1px solid var(--border-strong)',
                      }}
                    >
                      {isPicked && <Check size={10} color="#000" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] truncate" style={{ color: 'var(--foreground)' }}>
                        {pickPrimary(it, entry.kind)}
                      </div>
                      {pickSubtitle(it, entry.kind) && (
                        <div className="text-[10px] truncate" style={{ color: 'var(--zinc-500)' }}>
                          {pickSubtitle(it, entry.kind)}
                        </div>
                      )}
                    </div>
                  </motion.button>
                )
              })}
            </AnimatePresence>
          )}
        </div>
      )}

      {/* Custom-value fallback */}
      <div>
        <button
          onClick={() => setShowCustom(s => !s)}
          className="text-[11px] flex items-center gap-1"
          style={{ color: 'var(--zinc-400)' }}
        >
          {showCustom ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Use a custom value…
        </button>
        <AnimatePresence>
          {showCustom && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <CustomValueForm entry={entry} projectId={projectId} onAdded={onAdded} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-md text-[12px]"
          style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
        >
          Close
        </button>
        {entry.snapshotScope && !notConnected && (
          <button
            onClick={submitPicked}
            disabled={submitting || picked.size === 0}
            className="px-3 py-1.5 rounded-md text-[12px] font-medium flex items-center gap-1 disabled:opacity-50"
            style={{ background: 'var(--amber)', color: '#000' }}
          >
            <Plus size={11} />
            {submitting ? 'Adding…' : `Add ${picked.size || ''}`.trim()}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Custom-value form (driven by entry.refSchema) ─────────────────────────
function CustomValueForm({
  entry, projectId, onAdded,
}: { entry: CatalogueEntry; projectId: string; onAdded: () => void }) {
  const wos = (window as unknown as { wos: { projects: {
    addResource: (p: string, i: unknown) => Promise<unknown>
  } } }).wos
  const fields: ResourceRefField[] = entry.refSchema?.fields ?? [
    { name: 'value', label: 'Reference (JSON or text)', type: 'textarea', required: true },
  ]
  const [values, setValues] = useState<Record<string, string>>({})
  const [label, setLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const set = (k: string, v: string) => setValues(prev => ({ ...prev, [k]: v }))

  const submit = async () => {
    for (const f of fields) {
      if (f.required && !(values[f.name]?.trim())) {
        toast.error(`Missing: ${f.label}`)
        return
      }
    }
    let ref: unknown
    if (fields.length === 1 && fields[0].name === 'value') {
      const raw = (values.value ?? '').trim()
      if (raw.startsWith('{')) {
        try { ref = JSON.parse(raw) } catch { toast.error('Invalid JSON'); return }
      } else {
        ref = raw
      }
    } else {
      const obj: Record<string, string> = {}
      for (const f of fields) obj[f.name] = (values[f.name] ?? '').trim()
      ref = obj
    }
    setSubmitting(true)
    try {
      await wos.projects.addResource(projectId, {
        kind: entry.kind,
        ref,
        label: label.trim() || entry.label,
      })
      toast.success('Resource added')
      onAdded()
    } catch (e) {
      toast.error(`Add failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 mt-2 p-2 rounded-md" style={{ background: 'var(--input)', border: '1px solid var(--border)' }}>
      {entry.refSchema?.hint && (
        <div className="text-[10px]" style={{ color: 'var(--zinc-500)' }}>{entry.refSchema.hint}</div>
      )}
      <div>
        <label className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--zinc-500)' }}>Label</label>
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder={entry.label}
          className="w-full px-2 py-1.5 rounded-md text-[12px] outline-none mt-0.5"
          style={{ background: 'var(--card)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
        />
      </div>
      {fields.map(f => (
        <div key={f.name}>
          <label className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--zinc-500)' }}>
            {f.label}{f.required ? ' *' : ''}
          </label>
          {f.type === 'textarea' ? (
            <textarea
              value={values[f.name] ?? ''}
              onChange={e => set(f.name, e.target.value)}
              placeholder={f.placeholder}
              rows={3}
              className="w-full px-2 py-1.5 rounded-md text-[12px] outline-none resize-none mt-0.5 font-mono"
              style={{ background: 'var(--card)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
            />
          ) : f.type === 'select' && f.options ? (
            <select
              value={values[f.name] ?? ''}
              onChange={e => set(f.name, e.target.value)}
              className="w-full px-2 py-1.5 rounded-md text-[12px] outline-none mt-0.5"
              style={{ background: 'var(--card)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
            >
              <option value="">—</option>
              {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input
              value={values[f.name] ?? ''}
              onChange={e => set(f.name, e.target.value)}
              placeholder={f.placeholder}
              className="w-full px-2 py-1.5 rounded-md text-[12px] outline-none mt-0.5"
              style={{ background: 'var(--card)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
            />
          )}
          {f.hint && <div className="text-[9px] mt-0.5" style={{ color: 'var(--zinc-500)' }}>{f.hint}</div>}
        </div>
      ))}
      <div className="flex justify-end pt-1">
        <button
          onClick={submit}
          disabled={submitting}
          className="px-3 py-1.5 rounded-md text-[12px] font-medium disabled:opacity-50"
          style={{ background: 'var(--amber)', color: '#000' }}
        >
          {submitting ? 'Adding…' : 'Add custom'}
        </button>
      </div>
    </div>
  )
}
