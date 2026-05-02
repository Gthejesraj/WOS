import React, { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, RefreshCw, Trash2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { type CatalogueEntry, type ProjectResourceRow, type ProjectRow } from '../../../store/projectsStore'
import { AddResourceModal } from './project/AddResourceModal'

const ICONS = ['📁', '🚀', '🎯', '🛠️', '🧪', '📊', '🌐', '⚡', '🔧', '💡', '🅰️', '🅱️']
const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6']

interface Props {
  project: ProjectRow
  resources: ProjectResourceRow[]
  catalogue: CatalogueEntry[]
  syncProgress: Record<string, 'pending' | 'done' | 'error'>
  onClose: () => void
  onSaved: (patch: Partial<ProjectRow>) => Promise<void>
  onResourceAdded: () => void
  onResourceRemoved: (id: string) => Promise<void>
  onResourceRefreshed: (id: string) => Promise<void>
}

function relativeTime(ts: number | null): string {
  if (!ts) return 'never'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export function ProjectEditPanel({ project, resources, catalogue, syncProgress, onClose, onSaved, onResourceAdded, onResourceRemoved, onResourceRefreshed }: Props) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [icon, setIcon] = useState(project.icon ?? '📁')
  const [color, setColor] = useState(project.color ?? COLORS[0])
  const [ownerEmail, setOwnerEmail] = useState(project.ownerEmail ?? '')
  const [saving, setSaving] = useState(false)
  const [addingResource, setAddingResource] = useState(false)

  async function save() {
    if (!name.trim()) { toast.error('Name required'); return }
    setSaving(true)
    try {
      await onSaved({ name: name.trim(), description: description.trim() || null, icon: icon.trim() || null, color, ownerEmail: ownerEmail.trim() || null })
      toast.success('Saved')
      onClose()
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.3)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        initial={{ x: 360 }}
        animate={{ x: 0 }}
        exit={{ x: 360 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col"
        style={{
          width: 360,
          background: 'var(--popover)',
          borderLeft: '1px solid var(--border-strong)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.2)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="text-[13px] font-medium" style={{ color: 'var(--foreground)' }}>Edit project</span>
          <button onClick={onClose} className="p-1 rounded wos-hover-sm">
            <X size={14} style={{ color: 'var(--zinc-500)' }} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">

          {/* Name */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: 'var(--zinc-400)' }}>Name</span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              className="w-full px-2 py-1.5 rounded-md text-[12px] outline-none"
              style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
            />
          </label>

          {/* Description */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: 'var(--zinc-400)' }}>Description</span>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full px-2 py-1.5 rounded-md text-[12px] outline-none resize-none"
              style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
            />
          </label>

          {/* Icon */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: 'var(--zinc-400)' }}>Icon</span>
            <div className="flex flex-wrap gap-1">
              {ICONS.map(ic => (
                <button
                  key={ic}
                  onClick={() => setIcon(ic)}
                  className="w-8 h-8 rounded-md text-[15px] flex items-center justify-center"
                  style={{
                    background: icon === ic ? 'var(--amber)' : 'var(--input)',
                    border: '1px solid var(--border-strong)',
                  }}
                >{ic}</button>
              ))}
            </div>
          </label>

          {/* Color + Owner row */}
          <div className="flex gap-3">
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

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: 'var(--zinc-400)' }}>Owner email</span>
            <input
              value={ownerEmail}
              onChange={e => setOwnerEmail(e.target.value)}
              placeholder="owner@company.com"
              className="w-full px-2 py-1.5 rounded-md text-[12px] outline-none"
              style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
            />
          </label>

          {/* Sources section */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--zinc-500)' }}>
                Sources
              </span>
              <button
                onClick={() => setAddingResource(true)}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] wos-hover-sm"
                style={{ color: 'var(--zinc-400)' }}
              >
                <Plus size={11} /> Add source
              </button>
            </div>

            {resources.length === 0 ? (
              <div className="text-[11px] py-2" style={{ color: 'var(--zinc-500)' }}>
                No sources linked yet. Add Slack channels, GitHub repos, Gmail labels, and more.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {resources.map(r => {
                  const progress = syncProgress[r.id]
                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md"
                      style={{ background: 'var(--input)', border: '1px solid var(--border)' }}
                    >
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0"
                        style={{ background: 'var(--background)', color: 'var(--zinc-500)' }}
                      >
                        {r.kind.split(':')[1] ?? r.kind}
                      </span>
                      <span className="text-[11px] flex-1 truncate" style={{ color: 'var(--foreground)' }}>{r.label}</span>
                      {r.lastFetchedAt && (
                        <span className="text-[9px] shrink-0" style={{ color: 'var(--zinc-500)' }}>
                          {relativeTime(r.lastFetchedAt)}
                        </span>
                      )}
                      <button
                        onClick={() => void onResourceRefreshed(r.id)}
                        className="p-1 rounded wos-hover-sm shrink-0"
                        title="Refresh"
                      >
                        <RefreshCw
                          size={11}
                          style={{ color: 'var(--zinc-400)' }}
                          className={progress === 'pending' ? 'animate-spin' : ''}
                        />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Remove "${r.label}"?`)) void onResourceRemoved(r.id)
                        }}
                        className="p-1 rounded wos-hover-sm shrink-0"
                        title="Remove"
                      >
                        <Trash2 size={11} style={{ color: progress === 'error' ? '#ef4444' : 'var(--zinc-400)' }} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-[12px]"
            style={{ background: 'var(--input)', color: 'var(--foreground)', border: '1px solid var(--border-strong)' }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-1.5 rounded-md text-[12px] font-medium disabled:opacity-50"
            style={{ background: 'var(--amber)', color: '#000' }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {addingResource && (
          <AddResourceModal
            catalogue={catalogue}
            projectId={project.id}
            onClose={() => setAddingResource(false)}
            onAdded={() => { setAddingResource(false); onResourceAdded() }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
