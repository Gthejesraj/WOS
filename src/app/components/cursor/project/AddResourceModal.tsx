import React, { useEffect, useMemo, useRef, useState } from 'react'
import { X, ChevronDown, ChevronUp, AlertCircle, Check, RefreshCw, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { CatalogueEntry } from '../../../../store/projectsStore'
import { pickPrimary, pickSubtitle, buildRef, type SnapshotItem } from './snapshotHelpers'

interface SelectedResource {
  kind: string
  label: string
  ref: unknown
}

interface Props {
  catalogue: CatalogueEntry[]
  projectId: string
  onClose: () => void
  onAdded: () => void
}

export function AddResourceModal({ catalogue, projectId, onClose, onAdded }: Props) {
  const [selections, setSelections] = useState<SelectedResource[]>([])
  const [submitting, setSubmitting] = useState(false)

  // Group catalogue entries by app, keeping only those with snapshot or refSchema
  const appGroups = useMemo(() => {
    const byApp: Record<string, { appName: string; appIcon?: string; connected: boolean; entries: CatalogueEntry[] }> = {}
    for (const c of catalogue) {
      if (!c.snapshotScope && !c.refSchema) continue
      if (!byApp[c.appId]) byApp[c.appId] = { appName: c.appName, appIcon: c.appIcon, connected: c.connected, entries: [] }
      byApp[c.appId].entries.push(c)
      if (c.connected) byApp[c.appId].connected = true
    }
    return byApp
  }, [catalogue])

  function toggleSelection(item: SnapshotItem, entry: CatalogueEntry) {
    const ref = buildRef(item, entry.kind)
    const label = pickPrimary(item, entry.kind)
    setSelections(prev => {
      const idx = prev.findIndex(s => s.kind === entry.kind && s.label === label)
      if (idx >= 0) return prev.filter((_, i) => i !== idx)
      if (!entry.multiSelect) {
        return [...prev.filter(s => s.kind !== entry.kind), { ref, label, kind: entry.kind }]
      }
      return [...prev, { ref, label, kind: entry.kind }]
    })
  }

  function removeByKindLabel(kind: string, label: string) {
    setSelections(prev => prev.filter(s => !(s.kind === kind && s.label === label)))
  }

  async function addAll() {
    if (selections.length === 0) return
    setSubmitting(true)
    let added = 0
    let failed = 0
    for (const sel of selections) {
      try {
        await window.wos.projects.addResource(projectId, {
          kind: sel.kind,
          ref: sel.ref,
          label: sel.label,
        })
        added++
      } catch {
        failed++
      }
    }
    setSubmitting(false)
    if (failed > 0) toast.error(`${failed} source${failed > 1 ? 's' : ''} failed to add`)
    if (added > 0) {
      toast.success(`Added ${added} source${added > 1 ? 's' : ''}`)
      onAdded()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full rounded-lg flex flex-col"
        style={{ maxWidth: 520, maxHeight: '80vh', background: 'var(--popover)', border: '1px solid var(--border-strong)' }}
      >
        {/* Header */}
        <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 className="text-[13px] font-medium" style={{ color: 'var(--foreground)' }}>Add sources</h2>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--zinc-500)' }}>
              Select channels, repos, labels and more from your connected apps
            </p>
          </div>
          <button onClick={onClose} className="p-1 wos-hover-sm rounded">
            <X size={13} style={{ color: 'var(--zinc-400)' }} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
          {catalogue.length === 0 ? (
            <div className="text-[12px] py-6 text-center" style={{ color: 'var(--zinc-500)' }}>
              No connected apps yet. Connect an app from the Apps tab first.
            </div>
          ) : Object.keys(appGroups).length === 0 ? (
            <div className="text-[12px] py-6 text-center" style={{ color: 'var(--zinc-500)' }}>
              No apps with project resources available.
            </div>
          ) : (
            Object.entries(appGroups).map(([appId, group]) => (
              <AppSourceSection
                key={appId}
                group={group}
                selections={selections}
                onToggle={toggleSelection}
                onRemove={removeByKindLabel}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex flex-wrap gap-1 flex-1 mr-3 min-w-0">
            {selections.length === 0 ? (
              <span className="text-[11px]" style={{ color: 'var(--zinc-500)' }}>Nothing selected yet</span>
            ) : (
              selections.map(sel => (
                <span
                  key={sel.kind + ':' + sel.label}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] shrink-0"
                  style={{ background: 'rgba(245,158,11,0.14)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.3)' }}
                >
                  {sel.label}
                  <button onClick={() => removeByKindLabel(sel.kind, sel.label)} className="opacity-70 hover:opacity-100" style={{ fontSize: 11 }}>×</button>
                </span>
              ))
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-[12px]"
              style={{ background: 'var(--input)', color: 'var(--foreground)', border: '1px solid var(--border-strong)' }}
            >
              Cancel
            </button>
            <button
              onClick={addAll}
              disabled={selections.length === 0 || submitting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium disabled:opacity-50"
              style={{ background: 'var(--amber)', color: '#000' }}
            >
              <Plus size={11} />
              {submitting ? 'Adding…' : `Add${selections.length > 0 ? ` ${selections.length}` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AppSourceSection({ group, selections, onToggle, onRemove }: {
  group: { appName: string; appIcon?: string; connected: boolean; entries: CatalogueEntry[] }
  selections: SelectedResource[]
  onToggle: (item: SnapshotItem, entry: CatalogueEntry) => void
  onRemove: (kind: string, label: string) => void
}) {
  const [expanded, setExpanded] = useState(group.connected)
  const selectedCount = selections.filter(s => group.entries.some(e => e.kind === s.kind)).length

  return (
    <div
      className="rounded-md"
      style={{ background: 'var(--input)', border: '1px solid var(--border)', overflow: 'visible' }}
    >
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
      >
        {group.appIcon
          ? <span className="text-[18px] shrink-0">{group.appIcon}</span>
          : (
            <span
              className="w-7 h-7 rounded shrink-0 text-[12px] flex items-center justify-center font-bold"
              style={{ background: 'var(--border)', color: 'var(--zinc-300)' }}
            >
              {group.appName[0]?.toUpperCase()}
            </span>
          )
        }
        <div className="flex-1 min-w-0">
          <span className="text-[12px] font-medium block" style={{ color: 'var(--foreground)' }}>{group.appName}</span>
          {!group.connected && (
            <span className="text-[10px]" style={{ color: 'var(--zinc-500)' }}>Not connected — connect in Apps tab</span>
          )}
        </div>
        {selectedCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(245,158,11,0.18)', color: 'var(--amber)' }}>
            {selectedCount}
          </span>
        )}
        {expanded ? <ChevronUp size={12} style={{ color: 'var(--zinc-500)' }} /> : <ChevronDown size={12} style={{ color: 'var(--zinc-500)' }} />}
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 px-3 pb-3" style={{ borderTop: '1px solid var(--border)' }}>
          {!group.connected ? (
            <div className="flex items-start gap-2 py-2 text-[11px]" style={{ color: 'var(--zinc-500)' }}>
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span>Connect {group.appName} in the Apps tab to browse and add resources here.</span>
            </div>
          ) : (
            group.entries.map(entry => (
              <InlineEntryPicker
                key={entry.kind}
                entry={entry}
                selections={selections}
                onToggle={onToggle}
                onRemove={(label) => onRemove(entry.kind, label)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function InlineEntryPicker({ entry, selections, onToggle, onRemove }: {
  entry: CatalogueEntry
  selections: SelectedResource[]
  onToggle: (item: SnapshotItem, entry: CatalogueEntry) => void
  onRemove: (label: string) => void
}) {
  const [items, setItems] = useState<SnapshotItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!entry.snapshotScope) return
    setLoading(true)
    setError(null)

    const p = entry.isNative
      ? window.wos.projects.nativeSnapshot(entry.snapshotScope).then((r: unknown) => {
          return (r as { items?: SnapshotItem[] })?.items ?? []
        })
      : window.wos.projects.appSnapshot(entry.appId, entry.snapshotScope).then((snap: unknown) => {
          return (snap as { data?: SnapshotItem[] } | null)?.data ?? []
        })

    void p
      .then(data => setItems(data))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [entry.appId, entry.snapshotScope, entry.isNative])

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selectedForKind = selections.filter(s => s.kind === entry.kind)
  const filtered = search.trim()
    ? items.filter(it => pickPrimary(it, entry.kind).toLowerCase().includes(search.toLowerCase()))
    : items

  if (!entry.snapshotScope) return null

  return (
    <div className="flex flex-col gap-1.5 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--zinc-500)' }}>
          {entry.label}
        </span>
        {loading && <RefreshCw size={10} className="animate-spin" style={{ color: 'var(--zinc-500)' }} />}
      </div>

      {error && (
        <div className="text-[10px] px-2 py-1 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          {error}
        </div>
      )}

      {/* Selected chips */}
      {selectedForKind.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedForKind.map(sel => (
            <span
              key={sel.label}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
              style={{ background: 'rgba(245,158,11,0.16)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.3)' }}
            >
              {sel.label}
              <button onClick={() => onRemove(sel.label)} className="opacity-70 hover:opacity-100 leading-none" style={{ fontSize: 12 }}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* Dropdown picker */}
      <div className="relative" ref={dropRef}>
        <button
          onClick={() => setOpen(v => !v)}
          disabled={loading}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] w-full text-left disabled:opacity-50"
          style={{ background: 'var(--background)', border: '1px solid var(--border-strong)', color: 'var(--zinc-400)' }}
        >
          {loading ? 'Loading…' : items.length === 0 ? `No ${entry.label.toLowerCase()} found` : `Add ${entry.label}…`}
          <ChevronDown size={11} className="ml-auto shrink-0" />
        </button>

        {open && (
          <div
            className="absolute left-0 right-0 z-30 rounded-md flex flex-col overflow-hidden"
            style={{ top: '100%', marginTop: 2, background: 'var(--popover)', border: '1px solid var(--border-strong)', boxShadow: '0 4px 16px rgba(0,0,0,0.25)', maxHeight: 220 }}
          >
            <div className="px-2 py-1.5 flex items-center gap-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${entry.label.toLowerCase()}…`}
                className="flex-1 bg-transparent text-[11px] outline-none"
                style={{ color: 'var(--foreground)' }}
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ color: 'var(--zinc-500)' }}>
                  <X size={10} />
                </button>
              )}
            </div>
            <div className="overflow-y-auto flex-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-[11px]" style={{ color: 'var(--zinc-500)' }}>
                  {items.length === 0 ? 'No items available.' : 'No results.'}
                </div>
              ) : filtered.map((item, idx) => {
                const primary = pickPrimary(item, entry.kind)
                const sub = pickSubtitle(item, entry.kind)
                const isSelected = selectedForKind.some(s => s.label === primary)
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      onToggle(item, entry)
                      if (!entry.multiSelect) setOpen(false)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
                    style={{ background: isSelected ? 'rgba(245,158,11,0.1)' : 'transparent', color: 'var(--foreground)' }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--card)' }}
                    onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded flex items-center justify-center shrink-0"
                      style={{ background: isSelected ? 'var(--amber)' : 'transparent', border: `1px solid ${isSelected ? 'var(--amber)' : 'var(--border-strong)'}` }}
                    >
                      {isSelected && <Check size={9} color="#000" />}
                    </span>
                    <span className="text-[12px] flex-1 truncate">{primary}</span>
                    {sub && <span className="text-[10px] shrink-0" style={{ color: 'var(--zinc-500)' }}>{sub}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
