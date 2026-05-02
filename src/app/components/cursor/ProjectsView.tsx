import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Plus, Pin, Search, Sparkles, Trash2 } from 'lucide-react'
import { useProjectsStore, type ProjectRow } from '../../../store/projectsStore'
import { ProjectDetailView } from './ProjectDetailView'
import { ProjectCreateModal } from './ProjectCreateModal'

const STATUS_LABEL: Record<ProjectRow['status'], string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  shipped: 'Shipped',
  archived: 'Archived',
}

const STATUS_COLOR: Record<ProjectRow['status'], string> = {
  draft: 'var(--zinc-500)',
  active: '#22c55e',
  paused: '#f59e0b',
  shipped: '#3b82f6',
  archived: 'var(--zinc-500)',
}

function relativeTime(ts: number | null): string {
  if (!ts) return 'never'
  const diff = Date.now() - ts
  const m = Math.round(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

function HealthBar({ score }: { score: number }) {
  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex items-center gap-1.5">
      <div className="rounded-full overflow-hidden" style={{ width: 48, height: 4, background: 'var(--border)' }}>
        <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span className="text-[10px]" style={{ color: 'var(--zinc-500)' }}>{score}</span>
    </div>
  )
}

export function ProjectsView() {
  const { projects, loaded, load, selectedId, select, setPinned, remove } = useProjectsStore()
  const [filter, setFilter] = useState<'all' | ProjectRow['status']>('all')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: projects.length }
    for (const p of projects) c[p.status] = (c[p.status] ?? 0) + 1
    return c
  }, [projects])

  const visible = useMemo(() => {
    let list = projects
    if (filter !== 'all') list = list.filter(p => p.status === filter)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q))
    }
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
  }, [projects, filter, query])

  if (selectedId) {
    return <ProjectDetailView projectId={selectedId} onBack={() => select(null)} />
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--background)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <h1 className="text-[18px] font-medium" style={{ color: 'var(--foreground)' }}>Projects</h1>
          <span className="text-[12px]" style={{ color: 'var(--zinc-500)' }}>
            {projects.length} total
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--zinc-500)' }} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search projects…"
              className="pl-7 pr-2 py-1.5 rounded-md text-[12px] outline-none"
              style={{
                background: 'var(--input)',
                border: '1px solid var(--border-strong)',
                color: 'var(--foreground)',
                width: '220px',
              }}
            />
          </div>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium"
            style={{ background: 'var(--amber)', color: '#000' }}
          >
            <Plus size={13} /> New project
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-6 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
        {(['all', 'active', 'paused', 'draft', 'shipped', 'archived'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded-md text-[12px] transition-colors ${filter === f ? 'wos-sidebar-active' : 'wos-hover-sm'}`}
            style={{ color: filter === f ? 'var(--foreground)' : 'var(--zinc-400)' }}
          >
            {f === 'all' ? 'All' : STATUS_LABEL[f]}
            <span className="ml-1.5 text-[11px]" style={{ color: 'var(--zinc-500)' }}>({counts[f] ?? 0})</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {!loaded ? (
          <div className="px-6 py-5 text-[12px]" style={{ color: 'var(--zinc-500)' }}>Loading…</div>
        ) : visible.length === 0 ? (
          <EmptyState onCreate={() => setCreating(true)} />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '38%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '9%' }} />
            </colgroup>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--background)', zIndex: 10 }}>
                {['Name', 'Status', 'Health', 'Issues', 'Last synced', ''].map((h, i) => (
                  <th
                    key={i}
                    className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-wide"
                    style={{ color: 'var(--zinc-500)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((p, i) => (
                <ProjectRow
                  key={p.id}
                  index={i}
                  project={p}
                  onOpen={() => select(p.id)}
                  onPin={() => setPinned(p.id, !p.pinned)}
                  onDelete={() => {
                    if (confirm(`Delete "${p.name}"? This cannot be undone.`)) void remove(p.id)
                  }}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <ProjectCreateModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            select(id)
          }}
        />
      )}
    </div>
  )
}

function ProjectRow({ project, index, onOpen, onPin, onDelete }: {
  project: ProjectRow
  index: number
  onOpen: () => void
  onPin: () => void
  onDelete: () => void
}) {
  const openIssues = (project.metadata as Record<string, unknown> | null)?.openIssues as number | null | undefined
  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: Math.min(index * 0.02, 0.25) }}
      onClick={onOpen}
      className="group cursor-pointer"
      style={{ borderBottom: '1px solid var(--border)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--card)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      {/* Name */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[15px] shrink-0">{project.icon ?? '📁'}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-[12px] font-medium truncate block" style={{ color: 'var(--foreground)' }}>
                {project.name}
              </span>
              {project.pinned && <Pin size={9} style={{ color: 'var(--amber)', flexShrink: 0 }} />}
            </div>
            {project.description && (
              <span className="text-[10px] truncate block" style={{ color: 'var(--zinc-500)' }}>
                {project.description}
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap"
          style={{ background: STATUS_COLOR[project.status] + '22', color: STATUS_COLOR[project.status] }}
        >
          ● {STATUS_LABEL[project.status]}
        </span>
      </td>

      {/* Health */}
      <td className="px-4 py-3">
        {project.healthScore !== null && project.healthScore !== undefined
          ? <HealthBar score={project.healthScore} />
          : <span className="text-[11px]" style={{ color: 'var(--zinc-500)' }}>—</span>
        }
      </td>

      {/* Issues */}
      <td className="px-4 py-3">
        <span className="text-[12px]" style={{ color: openIssues != null ? 'var(--foreground)' : 'var(--zinc-500)' }}>
          {openIssues != null ? openIssues : '—'}
        </span>
      </td>

      {/* Last synced */}
      <td className="px-4 py-3">
        <span className="text-[11px]" style={{ color: 'var(--zinc-500)' }}>
          {relativeTime(project.updatedAt)}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={e => { e.stopPropagation(); onPin() }}
            className="p-1 rounded wos-hover-sm"
            title={project.pinned ? 'Unpin' : 'Pin'}
          >
            <Pin size={11} style={{ color: project.pinned ? 'var(--amber)' : 'var(--zinc-500)' }} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            className="p-1 rounded wos-hover-sm"
            title="Delete"
          >
            <Trash2 size={11} style={{ color: 'var(--zinc-500)' }} />
          </button>
        </div>
      </td>
    </motion.tr>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 py-16">
      <Sparkles size={32} style={{ color: 'var(--zinc-500)' }} />
      <div className="text-[14px] font-medium" style={{ color: 'var(--foreground)' }}>No projects yet</div>
      <p className="text-[12px] max-w-sm" style={{ color: 'var(--zinc-500)' }}>
        Create a project to aggregate Slack channels, GitHub repos, Gmail labels, and more into a live dashboard.
      </p>
      <button
        onClick={onCreate}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium"
        style={{ background: 'var(--amber)', color: '#000' }}
      >
        <Plus size={13} /> Create your first project
      </button>
    </div>
  )
}
