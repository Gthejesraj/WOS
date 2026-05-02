import React, { useEffect, useRef, useState } from 'react'
import { X, ChevronDown, ChevronUp, AlertCircle, Check, RefreshCw } from 'lucide-react'
import { useProjectsStore, type CatalogueEntry } from '../../../store/projectsStore'
import { pickPrimary, pickSubtitle, buildRef, type SnapshotItem } from './project/snapshotHelpers'

const ICONS = ['📁', '🚀', '🎯', '🛠️', '🧪', '📊', '🌐', '⚡', '🔧', '💡', '🅰️', '🅱️']
const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6']

interface SelectedResource {
  ref: unknown
  label: string
  kind: string
}

interface Props {
  onClose: () => void
  onCreated: (id: string) => void
}

export function ProjectCreateModal({ onClose, onCreated }: Props) {
  const { create, catalogue, loadCatalogue } = useProjectsStore()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('📁')
  const [color, setColor] = useState(COLORS[0])
  const [description, setDescription] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [selections, setSelections] = useState<SelectedResource[]>([])
  const [submitting, setSubmitting] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadCatalogue()
    setTimeout(() => nameRef.current?.focus(), 50)
  }, [loadCatalogue])

  const appGroups = (() => {
    const byApp: Record<string, { appName: string; appIcon?: string; connected: boolean; entries: CatalogueEntry[] }> = {}
    for (const c of catalogue) {
      if (!c.snapshotScope && !c.refSchema) continue
      const k = c.appId
      if (!byApp[k]) byApp[k] = { appName: c.appName, appIcon: c.appIcon, connected: c.connected, entries: [] }
      byApp[k].entries.push(c)
      if (c.connected) byApp[k].connected = true
    }
    return byApp
  })()

  function toggleSelection(item: SnapshotItem, entry: CatalogueEntry) {
    const ref = buildRef(item, entry.kind)
    const label = pickPrimary(item, entry.kind)
    setSelections(prev => {
      const existing = prev.findIndex(s => s.kind === entry.kind && s.label === label)
      if (existing >= 0) return prev.filter((_, i) => i !== existing)
      if (!entry.multiSelect) {
        return [...prev.filter(s => s.kind !== entry.kind), { ref, label, kind: entry.kind }]
      }
      return [...prev, { ref, label, kind: entry.kind }]
    })
  }

  function removeByKindLabel(kind: string, label: string) {
    setSelections(prev => prev.filter(s => !(s.kind === kind && s.label === label)))
  }

  async function submit() {
    if (!name.trim() || submitting) return
    setSubmitting(true)
    try {
      const project = await create({
        name: name.trim(),
        icon,
        color,
        description: description.trim() || null,
        ownerEmail: ownerEmail.trim() || null,
      })
      if (!project) { setSubmitting(false); return }

      for (const sel of selections) {
        await window.wos.projects.addResource(project.id, {
          kind: sel.kind,
          ref: sel.ref,
          label: sel.label,
        }).catch(err => console.error('[create-modal] addResource failed', err))
      }

      onCreated(project.id)
    } catch (e) {
      console.error('[create-modal] submit failed', e)
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={e => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        className="rounded-lg w-full flex flex-col"
        style={{ maxWidth: 600, maxHeight: '88vh', background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="text-[13px] font-medium" style={{ color: 'var(--foreground)' }}>New project</span>
          <button onClick={onClose} className="p-1 rounded wos-hover-sm">
            <X size={14} style={{ color: 'var(--zinc-500)' }} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          {/* Name */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: 'var(--zinc-400)' }}>Project name *</span>
            <input
              ref={nameRef}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Atlas Mobile"
              className="w-full px-2 py-1.5 rounded-md text-[12px] outline-none"
              style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
            />
          </label>

          {/* Icon + Color */}
          <div className="flex gap-4">
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-[11px] font-medium" style={{ color: 'var(--zinc-400)' }}>Icon</span>
              <div className="flex flex-wrap gap-1">
                {ICONS.map(ic => (
                  <button
                    key={ic}
                    onClick={() => setIcon(ic)}
                    className="w-8 h-8 rounded-md text-[15px] flex items-center justify-center"
                    style={{ background: icon === ic ? 'var(--amber)' : 'var(--input)', border: '1px solid var(--border-strong)' }}
                  >{ic}</button>
                ))}
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium" style={{ color: 'var(--zinc-400)' }}>Color</span>
              <div className="flex flex-wrap gap-1.5">
                {COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className="w-6 h-6 rounded-full"
                    style={{ background: c, border: color === c ? '2px solid var(--foreground)' : '1px solid var(--border-strong)' }}
                  />
                ))}
              </div>
            </label>
          </div>

          {/* Description + Owner */}
          <div className="flex gap-3">
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-[11px] font-medium" style={{ color: 'var(--zinc-400)' }}>Description</span>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                placeholder="What's this project about?"
                className="w-full px-2 py-1.5 rounded-md text-[12px] outline-none resize-none"
                style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ width: 200 }}>
              <span className="text-[11px] font-medium" style={{ color: 'var(--zinc-400)' }}>Owner email</span>
              <input
                value={ownerEmail}
                onChange={e => setOwnerEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full px-2 py-1.5 rounded-md text-[12px] outline-none"
                style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
              />
            </label>
          </div>

          {/* Sources */}
          {Object.keys(appGroups).length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--zinc-500)' }}>
                Connect sources
              </span>
              {Object.entries(appGroups).map(([appId, group]) => (
                <AppSourceRow
                  key={appId}
                  group={group}
                  selections={selections}
                  onToggle={toggleSelection}
                  onRemove={removeByKindLabel}
                />
              ))}
            </div>
          )}

          {/* Global selection summary */}
          {selections.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--zinc-500)' }}>
                Selected ({selections.length})
              </span>
              <div className="flex flex-wrap gap-1.5">
                {selections.map(sel => (
                  <span
                    key={sel.kind + ':' + sel.label}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]"
                    style={{ background: 'rgba(245,158,11,0.14)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.3)' }}
                  >
                    {sel.label}
                    <button
                      onClick={() => removeByKindLabel(sel.kind, sel.label)}
                      className="opacity-70 hover:opacity-100 leading-none"
                      style={{ fontSize: 12 }}
                    >×</button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid var(--border)' }}>
          <span className="text-[11px]" style={{ color: 'var(--zinc-500)' }}>
            {selections.length > 0 ? `${selections.length} source${selections.length > 1 ? 's' : ''} selected` : 'No sources — add them later from Edit project'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-1.5 rounded-md text-[12px]"
              style={{ background: 'var(--input)', color: 'var(--foreground)', border: '1px solid var(--border-strong)' }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!name.trim() || submitting}
              className="px-4 py-1.5 rounded-md text-[12px] font-medium disabled:opacity-50"
              style={{ background: 'var(--amber)', color: '#000' }}
            >
              {submitting ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AppSourceRow({ group, selections, onToggle, onRemove }: {
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
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left"
      >
        {group.appIcon
          ? <span className="text-[16px] shrink-0">{group.appIcon}</span>
          : <span className="w-6 h-6 rounded shrink-0 text-[11px] flex items-center justify-center font-medium" style={{ background: 'var(--border)', color: 'var(--zinc-400)' }}>{group.appName[0]}</span>
        }
        <span className="text-[12px] font-medium flex-1" style={{ color: 'var(--foreground)' }}>{group.appName}</span>
        {selectedCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.18)', color: 'var(--amber)' }}>
            {selectedCount} selected
          </span>
        )}
        {!group.connected && (
          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--border)', color: 'var(--zinc-500)' }}>
            not connected
          </span>
        )}
        {expanded ? <ChevronUp size={12} style={{ color: 'var(--zinc-500)' }} /> : <ChevronDown size={12} style={{ color: 'var(--zinc-500)' }} />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 flex flex-col gap-3" style={{ borderTop: '1px solid var(--border)' }}>
          {!group.connected ? (
            <div className="flex items-center gap-2 py-2 text-[11px]" style={{ color: 'var(--zinc-500)' }}>
              <AlertCircle size={12} />
              Connect {group.appName} in the Apps tab to link resources here.
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
          const native = r as { items?: SnapshotItem[] }
          return native?.items ?? []
        })
      : window.wos.projects.appSnapshot(entry.appId, entry.snapshotScope).then((snap: unknown) => {
          const s = snap as { data?: SnapshotItem[] } | null
          return s?.data ?? []
        })

    void p
      .then(data => setItems(data))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [entry.appId, entry.snapshotScope, entry.isNative])

  // Close dropdown on outside click
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
    <div className="flex flex-col gap-1.5">
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

      {/* Selected pills */}
      {selectedForKind.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedForKind.map(sel => (
            <span
              key={sel.label}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
              style={{ background: 'rgba(245,158,11,0.16)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.3)' }}
            >
              {sel.label}
              <button
                onClick={() => onRemove(sel.label)}
                className="opacity-70 hover:opacity-100 leading-none"
                style={{ fontSize: 12 }}
              >×</button>
            </span>
          ))}
        </div>
      )}

      {/* Dropdown trigger */}
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
            style={{ top: '100%', marginTop: 2, background: 'var(--popover)', border: '1px solid var(--border-strong)', boxShadow: '0 4px 16px rgba(0,0,0,0.2)', maxHeight: 220 }}
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
              ) : (
                filtered.map((item, idx) => {
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
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
