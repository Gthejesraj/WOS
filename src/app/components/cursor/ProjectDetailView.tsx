import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeft, RefreshCw, Sparkles, Activity, Users, AlertTriangle,
  FileText, Download, Star, Trash2, Edit3, Check, X, Gavel, Clock,
  Search, UserPlus,
} from 'lucide-react'
import {
  useProjectsStore,
  type ProjectActivityRow,
  type ProjectResourceRow,
  type ProjectRow,
  type ProjectPersonRow,
  type ProjectPersonInput,
} from '../../../store/projectsStore'
import { toast } from 'sonner'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import {
  HealthOverTime, ActivitySparklines, ContributorLeaderboard,
  TicketAgingHistogram,
} from './project/charts'
import { ProjectEditPanel } from './ProjectEditPanel'

type Tab = 'overview' | 'activity' | 'people' | 'risks' | 'decisions' | 'notes'

interface Props {
  projectId: string
  onBack: () => void
}

interface DecisionRow { id: string; title: string; body: string | null; decidedAt: number; decidedBy: string | null }
interface RiskRow { id: string; title: string; description: string | null; severity: 'low' | 'medium' | 'high' | 'critical'; status: string; owner: string | null; mitigation: string | null }

const STATUSES: ProjectRow['status'][] = ['draft', 'active', 'paused', 'shipped', 'archived']

export function ProjectDetailView({ projectId, onBack }: Props) {
  const {
    projects, catalogue, loadCatalogue, update, remove, setStatus, setPinned,
    peopleByProject, loadPeople, addPerson, updatePerson, removePerson,
  } = useProjectsStore()
  const project = projects.find(p => p.id === projectId)
  const [tab, setTab] = useState<Tab>('overview')
  const [activity, setActivity] = useState<ProjectActivityRow[]>([])
  const [resources, setResources] = useState<ProjectResourceRow[]>([])
  const [summary, setSummary] = useState<string | null>(null)
  const [risks, setRisks] = useState<RiskRow[]>([])
  const [decisions, setDecisions] = useState<DecisionRow[]>([])
  const [generating, setGenerating] = useState(false)
  const [healthSignals, setHealthSignals] = useState<Array<{ label: string; weight: number; positive: boolean; detail?: string }>>([])
  const [editing, setEditing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<Record<string, 'pending' | 'done' | 'error'>>({})

  const refresh = async () => {
    try {
      const [a, r, s, ri, d, h] = await Promise.all([
        window.wos.projects.activity(projectId, { limit: 200 }) as Promise<ProjectActivityRow[]>,
        window.wos.projects.listResources(projectId) as Promise<ProjectResourceRow[]>,
        window.wos.projects.getSummary(projectId, 'status') as Promise<{ body: string } | null>,
        window.wos.projects.listRisks(projectId) as Promise<RiskRow[]>,
        window.wos.projects.listDecisions(projectId) as Promise<DecisionRow[]>,
        window.wos.projects.computeHealth(projectId),
      ])
      setActivity(a ?? [])
      setResources(r ?? [])
      setSummary(s?.body ?? project?.summary ?? null)
      setRisks(ri ?? [])
      setDecisions(d ?? [])
      setHealthSignals(h?.signals ?? [])
    } catch (err) {
      console.error('[project-detail] refresh failed', err)
    }
  }

  useEffect(() => { void refresh() }, [projectId])
  useEffect(() => { void loadPeople(projectId) }, [projectId, loadPeople])
  useEffect(() => { if (catalogue.length === 0) void loadCatalogue() }, [catalogue.length, loadCatalogue])

  async function regenerateSummary() {
    setGenerating(true)
    try {
      const r = await window.wos.projects.generateSummary(projectId, 'status')
      if (r?.ok) {
        setSummary(r.summary ?? null)
        toast.success('Summary regenerated')
      } else {
        toast.error(`Summary failed: ${r?.error ?? 'unknown'}`)
      }
    } finally {
      setGenerating(false)
    }
  }

  async function fullSync() {
    setRefreshing(true)
    const pm: Record<string, 'pending' | 'done' | 'error'> = {}
    for (const r of resources) pm[r.id] = 'pending'
    setSyncProgress({ ...pm })

    for (const r of resources) {
      try {
        await window.wos.projects.refreshResource(r.id)
        setSyncProgress(prev => ({ ...prev, [r.id]: 'done' }))
      } catch {
        setSyncProgress(prev => ({ ...prev, [r.id]: 'error' }))
      }
    }

    // Auto-populate people from connected sources
    try {
      const { autoPopulatePeople, populatePeopleFromActivity } = await import('./project/syncPeople')
      await autoPopulatePeople(projectId, resources)
      const freshActivity = await window.wos.projects.activity(projectId, { limit: 200 }) as ProjectActivityRow[]
      const freshPeople = await window.wos.projects.listPeople(projectId) as ProjectPersonRow[]
      await populatePeopleFromActivity(projectId, freshActivity, freshPeople)
    } catch (e) {
      console.error('[fullSync] people sync failed', e)
    }

    // Auto-generate AI summary
    try {
      const r = await window.wos.projects.generateSummary(projectId, 'status')
      if (r?.summary) setSummary(r.summary)
    } catch { /* non-fatal */ }

    await refresh()
    await loadPeople(projectId)
    setRefreshing(false)
    setSyncProgress({})
    toast.success('Sync complete')
  }

  const lastRefreshedAt = useMemo(() => {
    let max = 0
    for (const r of resources) {
      if (typeof r.lastFetchedAt === 'number' && r.lastFetchedAt > max) max = r.lastFetchedAt
    }
    return max || null
  }, [resources])

  async function exportProject(kind: 'json' | 'markdown' | 'html') {
    try {
      const slug = project?.slug ?? project?.id ?? 'project'
      const ext = kind === 'json' ? 'json' : kind === 'markdown' ? 'md' : 'html'
      const mime = kind === 'json' ? 'application/json' : kind === 'markdown' ? 'text/markdown' : 'text/html'
      const body =
        kind === 'json' ? await window.wos.projects.exportJson(projectId)
        : kind === 'markdown' ? await window.wos.projects.exportMarkdown(projectId)
        : await window.wos.projects.exportHtml(projectId)
      const blob = new Blob([body], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${kind.toUpperCase()}`)
    } catch (err) {
      console.error('[project-detail] export failed', err)
      toast.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete project "${project?.name}"? This cannot be undone.`)) return
    await remove(projectId)
    onBack()
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <div className="text-[12px]" style={{ color: 'var(--zinc-500)' }}>Project not found</div>
        <button onClick={onBack} className="text-[12px] underline" style={{ color: 'var(--amber)' }}>Back</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--background)', position: 'relative' }}>
      <Hero
        project={project}
        onBack={onBack}
        onSync={fullSync}
        onExport={exportProject}
        onTogglePin={() => setPinned(projectId, !project.pinned)}
        onSetStatus={s => setStatus(projectId, s)}
        onEdit={() => setEditing(true)}
        onDelete={handleDelete}
        healthSignals={healthSignals}
        refreshing={refreshing}
        syncProgress={syncProgress}
        resources={resources}
        lastRefreshedAt={lastRefreshedAt}
      />
      <TabBar
        tab={tab}
        setTab={setTab}
        counts={{
          activity: activity.length,
          people: (peopleByProject[projectId] ?? []).length,
          risks: risks.length,
          decisions: decisions.length,
        }}
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === 'overview' && (
          <OverviewTab
            project={project}
            summary={summary}
            onRegenerate={regenerateSummary}
            generating={generating}
            resources={resources}
            activity={activity}
            risks={risks}
            decisions={decisions}
            people={peopleByProject[projectId] ?? []}
          />
        )}
        {tab === 'activity' && <ActivityTab activity={activity} />}
        {tab === 'people' && (
          <PeopleTab
            projectId={projectId}
            people={peopleByProject[projectId] ?? []}
            onAdd={async input => { await addPerson(projectId, input) }}
            onUpdate={async (personId, patch) => { await updatePerson(projectId, personId, patch) }}
            onRemove={async personId => { await removePerson(projectId, personId) }}
            legacyPeople={Array.isArray((project.metadata as Record<string, unknown> | undefined)?.people) ? ((project.metadata as { people: unknown[] }).people as unknown[]) : []}
            resources={resources}
          />
        )}
        {tab === 'risks' && <RisksTab projectId={projectId} risks={risks} onChange={refresh} />}
        {tab === 'decisions' && <DecisionsTab projectId={projectId} decisions={decisions} onChange={refresh} />}
        {tab === 'notes' && <NotesTab project={project} onSave={async notes => {
          const meta = { ...(project.metadata ?? {}), notes }
          await update(projectId, { metadata: meta })
        }} />}
      </div>

      <AnimatePresence>
        {editing && (
          <ProjectEditPanel
            project={project}
            resources={resources}
            catalogue={catalogue}
            syncProgress={syncProgress}
            onClose={() => setEditing(false)}
            onSaved={async patch => { await update(projectId, patch) }}
            onResourceAdded={async () => { await refresh() }}
            onResourceRemoved={async id => { await window.wos.projects.removeResource(id); await refresh() }}
            onResourceRefreshed={async id => { await window.wos.projects.refreshResource(id); await refresh() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function Hero({
  project, onBack, onSync, onExport, onTogglePin, onSetStatus, onEdit, onDelete,
  healthSignals, refreshing, syncProgress, resources, lastRefreshedAt,
}: {
  project: ProjectRow
  onBack: () => void
  onSync: () => void
  onExport: (kind: 'json' | 'markdown' | 'html') => void
  onTogglePin: () => void
  onSetStatus: (s: ProjectRow['status']) => void
  onEdit: () => void
  onDelete: () => void
  healthSignals: Array<{ label: string; weight: number; positive: boolean; detail?: string }>
  refreshing: boolean
  syncProgress: Record<string, 'pending' | 'done' | 'error'>
  resources: ProjectResourceRow[]
  lastRefreshedAt: number | null
}) {
  const [exportOpen, setExportOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const reduce = useReducedMotion()
  const doneCount = Object.values(syncProgress).filter(s => s === 'done').length
  const totalCount = resources.length
  return (
    <div
      className="px-6 py-4"
      style={{
        borderBottom: '1px solid var(--border)',
        background: project.color ? `linear-gradient(135deg, ${project.color}10, transparent)` : undefined,
        position: 'relative',
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <button onClick={onBack} className="p-1 rounded wos-hover-sm" title="Back">
          <ArrowLeft size={13} style={{ color: 'var(--zinc-400)' }} />
        </button>
        <span className="text-[11px]" style={{ color: 'var(--zinc-500)' }}>Projects /</span>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="text-[32px]">{project.icon ?? '📁'}</span>
          <div className="min-w-0">
            <h1 className="text-[18px] font-medium truncate" style={{ color: 'var(--foreground)' }}>{project.name}</h1>
            <p className="text-[12px] truncate" style={{ color: 'var(--zinc-400)' }}>{project.description ?? 'No description'}</p>
            <div className="flex items-center gap-3 mt-2 text-[11px]" style={{ color: 'var(--zinc-500)' }}>
              <div className="relative">
                <button
                  onClick={() => setStatusOpen(v => !v)}
                  className="capitalize wos-hover-sm px-1.5 py-0.5 rounded"
                  style={{ color: 'var(--foreground)' }}
                  title="Change status"
                >
                  ● {project.status}
                </button>
                {statusOpen && (
                  <div
                    className="absolute left-0 mt-1 z-10 rounded-md py-1 text-[12px] min-w-[120px]"
                    style={{ background: 'var(--popover)', border: '1px solid var(--border-strong)' }}
                    onMouseLeave={() => setStatusOpen(false)}
                  >
                    {STATUSES.map(s => (
                      <button
                        key={s}
                        onClick={() => { setStatusOpen(false); onSetStatus(s) }}
                        className="w-full text-left px-3 py-1 capitalize wos-hover-sm"
                        style={{ color: 'var(--foreground)' }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {project.ownerEmail && <span>👤 {project.ownerEmail}</span>}
              {project.healthScore !== null && <span>Health: {project.healthScore}/100</span>}
              {project.riskLevel && <span>Risk: {project.riskLevel}</span>}
              {lastRefreshedAt && (
                <span className="flex items-center gap-1" title={new Date(lastRefreshedAt).toLocaleString()}>
                  <Clock size={10} /> {relativeTime(lastRefreshedAt)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <IconBtn onClick={onTogglePin} title={project.pinned ? 'Unpin' : 'Pin'} active={project.pinned}>
            <Star size={12} fill={project.pinned ? 'currentColor' : 'none'} />
          </IconBtn>
          <IconBtn onClick={onEdit} title="Edit project"><Edit3 size={12} /></IconBtn>
          <IconBtn
            onClick={onSync}
            title={lastRefreshedAt ? `Sync all sources · last ${relativeTime(lastRefreshedAt)}` : 'Sync all sources'}
            disabled={refreshing}
          >
            <motion.span
              animate={refreshing && !reduce ? { rotate: 360 } : { rotate: 0 }}
              transition={refreshing && !reduce ? { duration: 0.9, repeat: Infinity, ease: 'linear' } : { duration: 0.2 }}
              style={{ display: 'inline-flex' }}
            >
              <RefreshCw size={12} />
            </motion.span>
          </IconBtn>
          <div className="relative">
            <IconBtn onClick={() => setExportOpen(v => !v)} title="Export project"><Download size={12} /></IconBtn>
            {exportOpen && (
              <div
                className="absolute right-0 mt-1 z-10 rounded-md py-1 text-[12px] min-w-[160px]"
                style={{ background: 'var(--popover)', border: '1px solid var(--border-strong)' }}
                onMouseLeave={() => setExportOpen(false)}
              >
                {(['json', 'markdown', 'html'] as const).map(k => (
                  <button
                    key={k}
                    onClick={() => { setExportOpen(false); onExport(k) }}
                    className="w-full text-left px-3 py-1.5 wos-hover-sm"
                    style={{ color: 'var(--foreground)' }}
                  >
                    {k === 'json' ? 'JSON brief' : k === 'markdown' ? 'Markdown brief' : 'HTML status page'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <IconBtn onClick={onDelete} title="Delete project" danger><Trash2 size={12} /></IconBtn>
        </div>
      </div>
      {healthSignals.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {healthSignals.slice(0, 8).map((s, i) => (
            <span
              key={i}
              className="text-[10px] px-1.5 py-0.5 rounded"
              title={s.detail ?? ''}
              style={{
                background: s.positive ? '#22c55e22' : '#ef444422',
                color: s.positive ? '#22c55e' : '#ef4444',
              }}
            >
              {s.positive ? '↑' : '↓'} {s.label}
            </span>
          ))}
        </div>
      )}
      {refreshing && totalCount > 0 && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'var(--border)' }}>
          <div style={{
            height: '100%',
            background: 'var(--amber)',
            width: `${(doneCount / totalCount) * 100}%`,
            transition: 'width 0.3s ease',
          }} />
        </div>
      )}
    </div>
  )
}

function IconBtn({ children, onClick, title, active, danger, disabled }: {
  children: React.ReactNode; onClick: () => void; title: string; active?: boolean; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="p-1.5 rounded-md wos-hover-sm"
      style={{
        background: active ? 'var(--amber)' : 'var(--input)',
        border: '1px solid var(--border-strong)',
        color: active ? '#000' : danger ? '#ef4444' : 'var(--foreground)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function TabBar({
  tab, setTab, counts,
}: {
  tab: Tab
  setTab: (t: Tab) => void
  counts: Record<string, number>
}) {
  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'overview',   label: 'Overview',   icon: <Sparkles size={11} /> },
    { id: 'activity',   label: 'Activity',   icon: <Activity size={11} />,      count: counts.activity },
    { id: 'people',     label: 'People',     icon: <Users size={11} />,          count: counts.people },
    { id: 'risks',      label: 'Risks',      icon: <AlertTriangle size={11} />,  count: counts.risks },
    { id: 'decisions',  label: 'Decisions',  icon: <Gavel size={11} />,          count: counts.decisions },
    { id: 'notes',      label: 'Notes',      icon: <FileText size={11} /> },
  ]
  return (
    <div className="flex items-center gap-1 px-6 py-2 overflow-x-auto" style={{ borderBottom: '1px solid var(--border)' }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] shrink-0 ${tab === t.id ? 'wos-sidebar-active' : 'wos-hover-sm'}`}
          style={{ color: tab === t.id ? 'var(--foreground)' : 'var(--zinc-400)' }}
        >
          {t.icon} {t.label}
          {typeof t.count === 'number' && t.count > 0 && (
            <span className="text-[10px] px-1 rounded" style={{ background: 'var(--input)', color: 'var(--zinc-500)' }}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

function OverviewTab({
  project, summary, onRegenerate, generating, resources, activity, risks, decisions, people,
}: {
  project: ProjectRow
  summary: string | null
  onRegenerate: () => void
  generating: boolean
  resources: ProjectResourceRow[]
  activity: ProjectActivityRow[]
  risks: RiskRow[]
  decisions: DecisionRow[]
  people: ProjectPersonRow[]
}) {
  const openPRs = activity.filter(a => /pr_open/i.test(a.sourceKind)).length
  const openIssues = activity.filter(a => /issue_open|jira_open/i.test(a.sourceKind)).length
  const gmailCount = activity.filter(a => a.sourceApp === 'google' && /gmail/i.test(a.sourceKind)).length
  const slackActivity = activity.filter(a => a.sourceApp === 'slack').slice(0, 3)
  const gmailActivity = activity.filter(a => a.sourceApp === 'google' && /gmail/i.test(a.sourceKind)).slice(0, 3)
  const hasSlack = resources.some(r => r.kind.startsWith('slack:'))
  const hasGmail = resources.some(r => r.kind.startsWith('google:gmail'))

  return (
    <div className="flex flex-col gap-4 min-w-0 overflow-x-hidden">
      {/* AI Summary Bar */}
      <div className="rounded-lg px-4 py-3 flex items-start gap-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <Sparkles size={14} style={{ color: 'var(--amber)', marginTop: 2, flexShrink: 0 }} />
        <div className="flex-1 text-[12px] leading-relaxed" style={{ color: 'var(--foreground)' }}>
          {summary
            ? <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-invert prose-sm max-w-none text-[12px] leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{summary}</ReactMarkdown>
            : <span style={{ color: 'var(--zinc-500)' }}>No summary yet — click Sync to auto-generate one from project activity.</span>
          }
        </div>
        <button
          onClick={onRegenerate}
          disabled={generating}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] shrink-0 disabled:opacity-50"
          style={{ color: 'var(--amber)' }}
        >
          <RefreshCw size={10} className={generating ? 'animate-spin' : ''} />
          {generating ? 'Generating…' : 'Regenerate'}
        </button>
      </div>

      {/* Two-column bento */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,60%) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        {/* Left: Live feed */}
        <div className="rounded-lg overflow-hidden" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-[12px] font-medium" style={{ color: 'var(--foreground)' }}>Live feed</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--input)', color: 'var(--zinc-500)' }}>{activity.length}</span>
          </div>
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {activity.length === 0 ? (
              <div className="px-3 py-4 text-[12px]" style={{ color: 'var(--zinc-500)' }}>No activity yet. Sync to fetch data from connected sources.</div>
            ) : (
              <FeedItems activity={activity.slice(0, 40)} />
            )}
          </div>
        </div>

        {/* Right: Stats + People + App cards */}
        <div className="flex flex-col gap-3 min-w-0">
          {/* Stats mini cards */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Open PRs', value: openPRs },
              { label: 'Issues', value: openIssues },
              { label: 'Emails', value: gmailCount },
            ].map(s => (
              <div key={s.label} className="rounded-md p-2 text-center" style={{ background: 'var(--input)', border: '1px solid var(--border)' }}>
                <div className="text-[18px] font-medium" style={{ color: 'var(--foreground)' }}>{s.value}</div>
                <div className="text-[9px] uppercase tracking-wide" style={{ color: 'var(--zinc-500)' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* People avatars */}
          <div className="rounded-md p-2.5" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <div className="text-[11px] font-medium mb-2" style={{ color: 'var(--foreground)' }}>People</div>
            {people.length === 0 ? (
              <div className="text-[10px]" style={{ color: 'var(--zinc-500)' }}>No people yet — sync to auto-populate.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {people.slice(0, 8).map(p => (
                  <div
                    key={p.id}
                    title={`${p.name}${p.role ? ` · ${p.role}` : ''}${p.email ? ` · ${p.email}` : ''}`}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-medium"
                    style={{ background: 'var(--background)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
                  >
                    {p.avatarUrl
                      // eslint-disable-next-line jsx-a11y/alt-text
                      ? <img src={p.avatarUrl} className="w-full h-full rounded-full object-cover" />
                      : (p.name || p.email || '?').slice(0, 2).toUpperCase()
                    }
                  </div>
                ))}
                {people.length > 8 && (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px]"
                    style={{ background: 'var(--input)', color: 'var(--zinc-500)' }}>
                    +{people.length - 8}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Slack card */}
          <div className="rounded-md p-2.5" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <div className="text-[11px] font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>Slack</div>
            {!hasSlack ? (
              <div className="text-[10px]" style={{ color: 'var(--zinc-500)' }}>Not linked — add a Slack channel in Edit.</div>
            ) : slackActivity.length === 0 ? (
              <div className="text-[10px]" style={{ color: 'var(--zinc-500)' }}>No Slack activity yet.</div>
            ) : slackActivity.map(a => (
              <button
                key={a.id}
                onClick={() => a.url && window.wos.shell.openExternal(a.url).catch(() => null)}
                className="w-full text-left flex items-center gap-2 py-1"
                style={{ cursor: a.url ? 'pointer' : 'default' }}
              >
                <span className="text-[9px] px-1 rounded shrink-0" style={{ background: '#4A154B22', color: '#4A154B' }}>#slack</span>
                <span className="text-[11px] truncate flex-1" style={{ color: 'var(--foreground)' }}>{a.title}</span>
                <span className="text-[9px] shrink-0" style={{ color: 'var(--zinc-500)' }}>{new Date(a.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </button>
            ))}
          </div>

          {/* Gmail card */}
          <div className="rounded-md p-2.5" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <div className="text-[11px] font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>Gmail</div>
            {!hasGmail ? (
              <div className="text-[10px]" style={{ color: 'var(--zinc-500)' }}>Not linked — add a Gmail label in Edit.</div>
            ) : gmailActivity.length === 0 ? (
              <div className="text-[10px]" style={{ color: 'var(--zinc-500)' }}>No Gmail activity yet.</div>
            ) : gmailActivity.map(a => (
              <button
                key={a.id}
                onClick={() => a.url && window.wos.shell.openExternal(a.url).catch(() => null)}
                className="w-full text-left flex items-center gap-2 py-1"
                style={{ cursor: a.url ? 'pointer' : 'default' }}
              >
                <span className="text-[9px] px-1 rounded shrink-0" style={{ background: '#ea433522', color: '#ea4335' }}>mail</span>
                <span className="text-[11px] truncate flex-1" style={{ color: 'var(--foreground)' }}>{a.title}</span>
                <span className="text-[9px] shrink-0" style={{ color: 'var(--zinc-500)' }}>{a.actor ?? ''}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid gap-3 min-w-0" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))' }}>
        <HealthOverTime projectId={project.id} />
        <ActivitySparklines activity={activity} />
        <ContributorLeaderboard activity={activity} />
        <TicketAgingHistogram activity={activity} />
      </div>
    </div>
  )
}

function FeedItems({ activity }: { activity: ProjectActivityRow[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, ProjectActivityRow[]>()
    for (const a of activity) {
      const d = new Date(a.ts)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const arr = map.get(key) ?? []
      arr.push(a)
      map.set(key, arr)
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [activity])

  const APP_COLOR: Record<string, string> = {
    slack: '#4A154B', github: '#6e40c9', gmail: '#ea4335',
    jira: '#0052cc', linear: '#5e6ad2', native: '#f59e0b', google: '#ea4335',
  }

  function dayLabel(key: string): string {
    const today = new Date()
    const yToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const yest = new Date(today.getTime() - 86400000)
    const yYest = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`
    if (key === yToday) return 'Today'
    if (key === yYest) return 'Yesterday'
    return new Date(key + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  return (
    <>
      {groups.map(([day, rows]) => (
        <div key={day}>
          <div className="sticky top-0 px-3 py-1 text-[9px] uppercase tracking-wide" style={{ background: 'var(--card)', color: 'var(--zinc-500)', borderBottom: '1px solid var(--border)' }}>
            {dayLabel(day)} · {rows.length}
          </div>
          {rows.map(a => {
            const color = APP_COLOR[a.sourceApp.toLowerCase()] ?? '#71717a'
            return (
              <button
                key={a.id}
                onClick={() => a.url && window.wos.shell.openExternal(a.url).catch(() => null)}
                className="w-full text-left flex items-center gap-0 group"
                style={{ cursor: a.url ? 'pointer' : 'default' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--input)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <div style={{ width: 2, alignSelf: 'stretch', background: color, flexShrink: 0 }} />
                <div className="flex items-center gap-2 px-2.5 py-1.5 flex-1 min-w-0">
                  <span className="text-[9px] px-1 py-0.5 rounded shrink-0" style={{ background: color + '22', color }}>
                    {a.sourceApp}
                  </span>
                  <span className="text-[11px] truncate flex-1" style={{ color: 'var(--foreground)' }}>{a.title}</span>
                  <span className="text-[9px] shrink-0" style={{ color: 'var(--zinc-500)' }}>
                    {new Date(a.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      ))}
    </>
  )
}

function ActivityTab({ activity }: { activity: ProjectActivityRow[] }) {
  if (activity.length === 0) {
    return <div className="text-[12px]" style={{ color: 'var(--zinc-500)' }}>No activity recorded yet. Activity is normalised from connected apps and webhooks.</div>
  }

  const groups = useMemo(() => {
    const map = new Map<string, ProjectActivityRow[]>()
    for (const a of activity) {
      const d = new Date(a.ts)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const arr = map.get(key) ?? []
      arr.push(a)
      map.set(key, arr)
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [activity])

  function dayLabel(key: string): string {
    const today = new Date()
    const yToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const yest = new Date(today.getTime() - 86400000)
    const yYest = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`
    if (key === yToday) return 'Today'
    if (key === yYest) return 'Yesterday'
    const d = new Date(key + 'T00:00:00')
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  }

  function appColor(app: string): string {
    const palette: Record<string, string> = {
      slack: '#4A154B', github: '#6e40c9', gmail: '#ea4335',
      jira: '#0052cc', linear: '#5e6ad2', notion: '#aaa',
      gcal: '#1a73e8', native: '#f59e0b',
    }
    return palette[app.toLowerCase()] ?? '#71717a'
  }

  function open(url: string | null) {
    if (!url) return
    window.wos.shell.openExternal(url).catch(() => null)
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([day, rows]) => (
        <div key={day} className="flex flex-col gap-1.5">
          <div
            className="sticky top-0 z-10 px-2 py-1 text-[10px] uppercase tracking-wide"
            style={{ background: 'var(--background)', color: 'var(--zinc-500)', borderBottom: '1px solid var(--border)' }}
          >
            {dayLabel(day)} <span style={{ color: 'var(--zinc-600)' }}>· {rows.length}</span>
          </div>
          {rows.map(a => (
            <button
              key={a.id}
              onClick={() => open(a.url)}
              className="text-left rounded-md p-2.5 flex items-start gap-2.5 wos-hover-sm group"
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                cursor: a.url ? 'pointer' : 'default',
              }}
              disabled={!a.url}
            >
              <span
                className="text-[9px] shrink-0 mt-0.5 px-1.5 py-0.5 rounded font-medium"
                style={{ background: appColor(a.sourceApp) + '22', color: appColor(a.sourceApp) }}
              >
                {a.sourceApp}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] truncate" style={{ color: 'var(--foreground)' }}>{a.title}</div>
                <div className="text-[10px] mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--zinc-500)' }}>
                  <span className="px-1 py-px rounded" style={{ background: 'var(--input)' }}>{a.sourceKind}</span>
                  {a.actor && <span>· {a.actor}</span>}
                  <span>· {new Date(a.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
              {a.url && (
                <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--amber)' }}>open ↗</span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}


function PeopleCombobox({ label, icon, loading, items, getKey, getName, getSubtitle, getAvatar, onSelect, adding, placeholder }: {
  label: string
  icon: string
  loading: boolean
  items: unknown[]
  getKey: (item: unknown) => string
  getName: (item: unknown) => string
  getSubtitle: (item: unknown) => string | null
  getAvatar: (item: unknown) => string | null
  onSelect: (item: unknown) => void
  adding: string | null
  placeholder: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = query.trim()
    ? items.filter(it => getName(it).toLowerCase().includes(query.toLowerCase()) || (getSubtitle(it) || '').toLowerCase().includes(query.toLowerCase()))
    : items.slice(0, 10)

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  return (
    <div className="mb-3 last:mb-0" ref={containerRef}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[14px]">{icon}</span>
        <span className="text-[11px] font-medium" style={{ color: 'var(--foreground)' }}>{label}</span>
        {loading && <RefreshCw size={9} className="animate-spin ml-1" style={{ color: 'var(--zinc-500)' }} />}
      </div>
      <div style={{ position: 'relative' }}>
        <div
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md"
          style={{ background: 'var(--background)', border: `1px solid ${open ? 'var(--amber)' : 'var(--border-strong)'}`, transition: 'border-color 0.15s' }}
        >
          <Search size={11} style={{ color: 'var(--zinc-500)' }} />
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            autoComplete="off"
            className="flex-1 bg-transparent text-[12px] outline-none"
            style={{ color: 'var(--foreground)' }}
          />
          {query && (
            <button onClick={() => { setQuery(''); setOpen(false) }} style={{ color: 'var(--zinc-500)' }}>
              <X size={10} />
            </button>
          )}
        </div>

        {open && (
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
              background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              zIndex: 50, overflow: 'hidden',
            }}
          >
            {items.length === 0 && !loading && (
              <div className="px-3 py-2.5 text-[11px]" style={{ color: 'var(--zinc-500)' }}>
                Not connected or no data yet.
              </div>
            )}
            {filtered.length === 0 && items.length > 0 && (
              <div className="px-3 py-2.5 text-[11px]" style={{ color: 'var(--zinc-500)' }}>No matches for "{query}"</div>
            )}
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {filtered.map(it => {
                const key = getKey(it)
                const name = getName(it)
                const sub = getSubtitle(it)
                const avatar = getAvatar(it)
                const isAdding = adding === key
                return (
                  <button
                    key={key}
                    disabled={isAdding}
                    onPointerDown={e => e.preventDefault()}
                    onClick={() => { onSelect(it); setQuery(''); setOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left wos-hover transition-colors disabled:opacity-50"
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    {avatar
                      ? <img src={avatar} className="w-6 h-6 rounded-full shrink-0 object-cover" alt="" />
                      : <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold" style={{ background: 'var(--border)', color: 'var(--zinc-300)' }}>{name[0]?.toUpperCase()}</div>
                    }
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium truncate" style={{ color: 'var(--foreground)' }}>{name}</div>
                      {sub && <div className="text-[10px] truncate" style={{ color: 'var(--zinc-500)' }}>{sub}</div>}
                    </div>
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] shrink-0" style={{ background: 'var(--amber)', color: '#000' }}>
                      {isAdding ? <RefreshCw size={9} className="animate-spin" /> : <><UserPlus size={9} /> Add</>}
                    </div>
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

type GmailContact = { name: string; email: string; photoUrl: string | null }
type SlackUser = { id: string; real_name?: string; name?: string; profile?: { email?: string; image_48?: string } }

function GmailSearchCombobox({ onAdd, adding }: {
  onAdd: (c: GmailContact) => Promise<void>
  adding: string | null
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GmailContact[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!query.trim()) { setResults([]); setSearching(false); return }
    setSearching(true)
    timerRef.current = setTimeout(async () => {
      try {
        const res = await window.wos.projects.searchGmailContacts(query.trim())
        setResults(res ?? [])
      } catch { setResults([]) }
      setSearching(false)
    }, 300)
  }, [query])

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  return (
    <div ref={containerRef}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[14px]">📧</span>
        <span className="text-[11px] font-medium" style={{ color: 'var(--foreground)' }}>Gmail contacts</span>
        {searching && <RefreshCw size={9} className="animate-spin ml-1" style={{ color: 'var(--zinc-500)' }} />}
      </div>
      <div style={{ position: 'relative' }}>
        <div
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md"
          style={{ background: 'var(--background)', border: `1px solid ${open ? 'var(--amber)' : 'var(--border-strong)'}`, transition: 'border-color 0.15s' }}
        >
          <Search size={11} style={{ color: 'var(--zinc-500)' }} />
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder="Type a name or email to search…"
            autoComplete="off"
            className="flex-1 bg-transparent text-[12px] outline-none"
            style={{ color: 'var(--foreground)' }}
          />
          {query && (
            <button onClick={() => { setQuery(''); setResults([]); setOpen(false) }} style={{ color: 'var(--zinc-500)' }}>
              <X size={10} />
            </button>
          )}
        </div>

        {open && (query.trim() || results.length > 0) && (
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
              background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              zIndex: 50, overflow: 'hidden',
            }}
          >
            {searching && (
              <div className="flex items-center gap-2 px-3 py-2.5 text-[11px]" style={{ color: 'var(--zinc-500)' }}>
                <RefreshCw size={10} className="animate-spin" /> Searching Gmail contacts…
              </div>
            )}
            {!searching && query.trim() && results.length === 0 && (
              <div className="px-3 py-2.5 text-[11px]" style={{ color: 'var(--zinc-500)' }}>
                No contacts found for "{query}"
              </div>
            )}
            {!searching && results.map(c => {
              const key = `google:${c.email}`
              const isAdding = adding === key
              return (
                <button
                  key={key}
                  disabled={isAdding}
                  onPointerDown={e => e.preventDefault()}
                  onClick={() => { void onAdd(c); setQuery(''); setResults([]); setOpen(false) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left wos-hover transition-colors disabled:opacity-50"
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  {c.photoUrl
                    ? <img src={c.photoUrl} className="w-6 h-6 rounded-full shrink-0 object-cover" alt="" />
                    : <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold" style={{ background: 'var(--border)', color: 'var(--zinc-300)' }}>{(c.name || c.email)[0]?.toUpperCase()}</div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium truncate" style={{ color: 'var(--foreground)' }}>{c.name || c.email}</div>
                    {c.name && <div className="text-[10px] truncate" style={{ color: 'var(--zinc-500)' }}>{c.email}</div>}
                  </div>
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] shrink-0" style={{ background: 'var(--amber)', color: '#000' }}>
                    {isAdding ? <RefreshCw size={9} className="animate-spin" /> : <><UserPlus size={9} /> Add</>}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function PeopleFromApps({ resources, onAdd }: {
  resources: ProjectResourceRow[]
  onAdd: (input: ProjectPersonInput) => Promise<void>
}) {
  const hasSlack = resources.some(r => r.kind.startsWith('slack:'))
  const hasGoogle = resources.some(r => r.kind.startsWith('google:'))
  const [slackUsers, setSlackUsers] = useState<SlackUser[]>([])
  const [adding, setAdding] = useState<string | null>(null)
  const [loadingSlack, setLoadingSlack] = useState(false)

  useEffect(() => {
    if (!hasSlack) return
    setLoadingSlack(true)
    window.wos.projects.appSnapshot('slack', 'users')
      .then((snap: unknown) => {
        const raw = Array.isArray(snap) ? snap : ((snap as { data?: unknown[] })?.data ?? [])
        setSlackUsers((raw as SlackUser[]).filter(u => u.id && u.id !== 'USLACKBOT'))
      })
      .catch(() => {})
      .finally(() => setLoadingSlack(false))
  }, [hasSlack])

  async function addSlackUser(u: unknown) {
    const su = u as SlackUser
    const key = `slack:${su.id}`
    setAdding(key)
    try {
      await onAdd({ name: su.real_name || su.name || su.id, email: su.profile?.email, sourceApp: 'slack', externalId: key, avatarUrl: su.profile?.image_48 })
      toast.success(`Added ${su.real_name || su.name}`)
    } catch { toast.error('Failed to add') }
    setAdding(null)
  }

  async function addGoogleContact(c: GmailContact) {
    const key = `google:${c.email}`
    setAdding(key)
    try {
      await onAdd({ name: c.name || c.email, email: c.email, sourceApp: 'google', externalId: `google:${c.email}`, avatarUrl: c.photoUrl ?? undefined })
      toast.success(`Added ${c.name || c.email}`)
    } catch { toast.error('Failed to add') }
    setAdding(null)
  }

  if (!hasSlack && !hasGoogle) return null

  return (
    <Card title="Add from connected apps">
      {hasSlack && (
        <div className="mb-3">
          <PeopleCombobox
            label="Slack"
            icon="💬"
            loading={loadingSlack}
            items={slackUsers}
            placeholder="Search Slack users…"
            getKey={u => `slack:${(u as SlackUser).id}`}
            getName={u => { const su = u as SlackUser; return su.real_name || su.name || su.id }}
            getSubtitle={u => (u as SlackUser).profile?.email ?? null}
            getAvatar={u => (u as SlackUser).profile?.image_48 ?? null}
            onSelect={addSlackUser}
            adding={adding}
          />
        </div>
      )}
      {hasGoogle && (
        <GmailSearchCombobox onAdd={addGoogleContact} adding={adding} />
      )}
    </Card>
  )
}

function PeopleTab({
  projectId, people, onAdd, onUpdate, onRemove, legacyPeople, resources,
}: {
  projectId: string
  people: ProjectPersonRow[]
  onAdd: (input: ProjectPersonInput) => Promise<void>
  onUpdate: (personId: string, patch: Partial<ProjectPersonInput>) => Promise<void>
  onRemove: (personId: string) => Promise<void>
  legacyPeople: unknown[]
  resources: ProjectResourceRow[]
}) {
  void projectId
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [notes, setNotes] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<ProjectPersonInput>>({})

  async function submitAdd() {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    setAdding(true)
    try {
      await onAdd({
        name: name.trim(),
        email: email.trim() || undefined,
        role: role.trim() || undefined,
        notes: notes.trim() || undefined,
      })
      setName(''); setEmail(''); setRole(''); setNotes('')
      toast.success('Person added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add person')
    } finally {
      setAdding(false)
    }
  }

  async function saveEdit(id: string) {
    try {
      await onUpdate(id, editDraft)
      setEditingId(null)
      setEditDraft({})
      toast.success('Updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title={`People (${people.length})`}>
        {people.length === 0 ? (
          <div className="text-[12px]" style={{ color: 'var(--zinc-500)' }}>
            No people added yet. Add stakeholders, owners, contributors, or anyone relevant to this project below.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {people.map(p => {
              const isEditing = editingId === p.id
              return (
                <div
                  key={p.id}
                  className="flex items-start gap-3 px-3 py-2 rounded-md"
                  style={{ background: 'var(--input)', border: '1px solid var(--border)' }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-medium shrink-0"
                    style={{ background: 'var(--background)', color: 'var(--foreground)', border: '1px solid var(--border-strong)' }}
                  >
                    {p.avatarUrl ? (
                      // eslint-disable-next-line jsx-a11y/alt-text
                      <img src={p.avatarUrl} className="w-full h-full rounded-full object-cover" />
                    ) : (
                      (p.name || p.email || '?').slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          defaultValue={p.name}
                          placeholder="Name"
                          onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))}
                          className="px-2 py-1 rounded text-[12px]"
                          style={{ background: 'var(--background)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
                        />
                        <input
                          defaultValue={p.email ?? ''}
                          placeholder="Email"
                          onChange={e => setEditDraft(d => ({ ...d, email: e.target.value }))}
                          className="px-2 py-1 rounded text-[12px]"
                          style={{ background: 'var(--background)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
                        />
                        <input
                          defaultValue={p.role ?? ''}
                          placeholder="Role (e.g. PM, Eng Lead)"
                          onChange={e => setEditDraft(d => ({ ...d, role: e.target.value }))}
                          className="px-2 py-1 rounded text-[12px]"
                          style={{ background: 'var(--background)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
                        />
                        <input
                          defaultValue={p.notes ?? ''}
                          placeholder="Notes"
                          onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))}
                          className="px-2 py-1 rounded text-[12px]"
                          style={{ background: 'var(--background)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
                        />
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-medium" style={{ color: 'var(--foreground)' }}>{p.name}</span>
                          {p.role && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: 'rgba(245, 158, 11, 0.16)', color: 'var(--amber)' }}
                            >
                              {p.role}
                            </span>
                          )}
                          {p.sourceApp && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--background)', color: 'var(--zinc-500)' }}
                            >
                              {p.sourceApp}
                            </span>
                          )}
                        </div>
                        {p.email && (
                          <div className="text-[11px]" style={{ color: 'var(--zinc-400)' }}>{p.email}</div>
                        )}
                        {p.notes && (
                          <div className="text-[11px] mt-0.5" style={{ color: 'var(--zinc-500)' }}>{p.notes}</div>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isEditing ? (
                      <>
                        <IconBtn onClick={() => saveEdit(p.id)} title="Save"><Check size={12} /></IconBtn>
                        <IconBtn onClick={() => { setEditingId(null); setEditDraft({}) }} title="Cancel"><X size={12} /></IconBtn>
                      </>
                    ) : (
                      <>
                        {p.email && (
                          <IconBtn
                            onClick={() => { void window.wos.shell.openExternal(`mailto:${p.email}`) }}
                            title="Send email"
                          >
                            <FileText size={12} />
                          </IconBtn>
                        )}
                        <IconBtn onClick={() => { setEditingId(p.id); setEditDraft({}) }} title="Edit"><Edit3 size={12} /></IconBtn>
                        <IconBtn
                          danger
                          onClick={async () => {
                            if (!confirm(`Remove ${p.name}?`)) return
                            await onRemove(p.id)
                          }}
                          title="Remove"
                        >
                          <Trash2 size={12} />
                        </IconBtn>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <PeopleFromApps resources={resources} onAdd={onAdd} />

      <Card title="Add person">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Name *"
            className="px-2 py-1.5 rounded-md text-[12px]"
            style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
          />
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email"
            className="px-2 py-1.5 rounded-md text-[12px]"
            style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
          />
          <input
            value={role}
            onChange={e => setRole(e.target.value)}
            placeholder="Role (e.g. PM, Eng Lead, Stakeholder)"
            className="px-2 py-1.5 rounded-md text-[12px]"
            style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
          />
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Notes"
            className="px-2 py-1.5 rounded-md text-[12px]"
            style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
          />
        </div>
        <div className="mt-2 flex justify-end">
          <button
            onClick={submitAdd}
            disabled={adding || !name.trim()}
            className="px-3 py-1.5 rounded-md text-[12px] font-medium"
            style={{
              background: !name.trim() || adding ? 'var(--input)' : 'var(--amber)',
              color: !name.trim() || adding ? 'var(--zinc-500)' : '#000',
              cursor: !name.trim() || adding ? 'not-allowed' : 'pointer',
            }}
          >
            {adding ? 'Adding…' : '+ Add person'}
          </button>
        </div>
      </Card>

      {legacyPeople.length > 0 && (
        <Card title="Imported from project metadata">
          <div className="text-[11px] mb-2" style={{ color: 'var(--zinc-500)' }}>
            These were captured during project creation. Re-add any you want as full entries above.
          </div>
          <div className="flex flex-wrap gap-1.5">
            {legacyPeople.map((entry, idx) => (
              <span
                key={idx}
                className="px-2 py-0.5 rounded text-[11px]"
                style={{ background: 'var(--input)', color: 'var(--zinc-400)' }}
              >
                {typeof entry === 'string' ? entry : JSON.stringify(entry)}
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function RisksTab({ projectId, risks, onChange }: { projectId: string; risks: RiskRow[]; onChange: () => void }) {
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState<RiskRow['severity']>('medium')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<RiskRow>>({})

  async function saveEdit(id: string) {
    await window.wos.projects.updateRisk(id, editDraft)
    setEditingId(null)
    setEditDraft({})
    onChange()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md p-3 flex items-center gap-2" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="New risk title"
          className="flex-1 px-2 py-1.5 rounded-md text-[12px] outline-none"
          style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
        />
        <select
          value={severity}
          onChange={e => setSeverity(e.target.value as RiskRow['severity'])}
          className="px-2 py-1.5 rounded-md text-[12px] outline-none"
          style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
        >
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="critical">critical</option>
        </select>
        <button
          onClick={async () => {
            if (!title.trim()) return
            await window.wos.projects.addRisk(projectId, { title: title.trim(), severity, status: 'open', description: null, owner: null, mitigation: null })
            setTitle('')
            onChange()
          }}
          className="px-3 py-1.5 rounded-md text-[12px] font-medium"
          style={{ background: 'var(--amber)', color: '#000' }}
        >
          Add
        </button>
      </div>
      {risks.length === 0 ? (
        <div className="text-[12px] py-4 text-center" style={{ color: 'var(--zinc-500)' }}>No risks tracked.</div>
      ) : risks.map(r => (
        <div key={r.id} className="rounded-md p-3 flex flex-col gap-2" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          {editingId === r.id ? (
            <div className="flex flex-col gap-2">
              <input
                defaultValue={r.title}
                onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                className="px-2 py-1.5 rounded-md text-[12px] outline-none"
                style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
              />
              <div className="flex gap-2">
                <select
                  defaultValue={r.severity}
                  onChange={e => setEditDraft(d => ({ ...d, severity: e.target.value as RiskRow['severity'] }))}
                  className="px-2 py-1.5 rounded-md text-[12px] outline-none"
                  style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
                >
                  <option value="low">low</option><option value="medium">medium</option>
                  <option value="high">high</option><option value="critical">critical</option>
                </select>
                <select
                  defaultValue={r.status}
                  onChange={e => setEditDraft(d => ({ ...d, status: e.target.value }))}
                  className="px-2 py-1.5 rounded-md text-[12px] outline-none"
                  style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
                >
                  <option value="open">open</option><option value="mitigating">mitigating</option>
                  <option value="resolved">resolved</option><option value="accepted">accepted</option>
                </select>
                <input
                  defaultValue={r.owner ?? ''}
                  onChange={e => setEditDraft(d => ({ ...d, owner: e.target.value || null }))}
                  placeholder="Owner (optional)"
                  className="flex-1 px-2 py-1.5 rounded-md text-[12px] outline-none"
                  style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setEditingId(null); setEditDraft({}) }}
                  className="px-3 py-1 rounded text-[11px]"
                  style={{ background: 'var(--input)', color: 'var(--foreground)' }}>Cancel</button>
                <button onClick={() => saveEdit(r.id)}
                  className="px-3 py-1 rounded text-[11px] font-medium"
                  style={{ background: 'var(--amber)', color: '#000' }}>Save</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[12px]" style={{ color: 'var(--foreground)' }}>{r.title}</span>
                <span className="text-[10px]" style={{ color: 'var(--zinc-500)' }}>severity: {r.severity} · status: {r.status}{r.owner ? ` · ${r.owner}` : ''}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => { setEditingId(r.id); setEditDraft({}) }}
                  className="p-1 rounded wos-hover-sm" title="Edit">
                  <Edit3 size={11} style={{ color: 'var(--zinc-500)' }} />
                </button>
                <button onClick={async () => { await window.wos.projects.removeRisk(r.id); onChange() }}
                  className="text-[11px] px-2 py-0.5 rounded wos-hover-sm"
                  style={{ color: 'var(--zinc-500)' }}>Remove</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function DecisionsTab({ projectId, decisions, onChange }: { projectId: string; decisions: DecisionRow[]; onChange: () => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [decidedBy, setDecidedBy] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<DecisionRow>>({})

  async function saveEdit(id: string) {
    await window.wos.projects.updateDecision(id, { title: editDraft.title, body: editDraft.body, decidedBy: editDraft.decidedBy })
    setEditingId(null)
    setEditDraft({})
    onChange()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md p-3 flex flex-col gap-2" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Decision title (e.g. 'Adopt Postgres for v2')"
          className="px-2 py-1.5 rounded-md text-[12px] outline-none"
          style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
        />
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Context and rationale (optional)"
          rows={3}
          className="px-2 py-1.5 rounded-md text-[12px] outline-none resize-none"
          style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
        />
        <div className="flex items-center gap-2">
          <input
            value={decidedBy}
            onChange={e => setDecidedBy(e.target.value)}
            placeholder="Decided by (optional)"
            className="flex-1 px-2 py-1.5 rounded-md text-[12px] outline-none"
            style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
          />
          <button
            onClick={async () => {
              if (!title.trim()) return
              await window.wos.projects.addDecision(projectId, { title: title.trim(), body: body.trim() || null, decidedBy: decidedBy.trim() || null })
              setTitle(''); setBody(''); setDecidedBy('')
              onChange()
            }}
            className="px-3 py-1.5 rounded-md text-[12px] font-medium"
            style={{ background: 'var(--amber)', color: '#000' }}
          >
            Log decision
          </button>
        </div>
      </div>
      {decisions.length === 0 ? (
        <div className="text-[12px] py-4 text-center" style={{ color: 'var(--zinc-500)' }}>No decisions logged.</div>
      ) : decisions.map(d => (
        <div key={d.id} className="rounded-md p-3 flex flex-col gap-2" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          {editingId === d.id ? (
            <div className="flex flex-col gap-2">
              <input
                defaultValue={d.title}
                onChange={e => setEditDraft(x => ({ ...x, title: e.target.value }))}
                className="px-2 py-1.5 rounded-md text-[12px] outline-none"
                style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
              />
              <textarea
                defaultValue={d.body ?? ''}
                onChange={e => setEditDraft(x => ({ ...x, body: e.target.value || null }))}
                rows={3}
                className="px-2 py-1.5 rounded-md text-[12px] outline-none resize-none"
                style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
              />
              <input
                defaultValue={d.decidedBy ?? ''}
                onChange={e => setEditDraft(x => ({ ...x, decidedBy: e.target.value || null }))}
                placeholder="Decided by"
                className="px-2 py-1.5 rounded-md text-[12px] outline-none"
                style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setEditingId(null); setEditDraft({}) }}
                  className="px-3 py-1 rounded text-[11px]"
                  style={{ background: 'var(--input)', color: 'var(--foreground)' }}>Cancel</button>
                <button onClick={() => saveEdit(d.id)}
                  className="px-3 py-1 rounded text-[11px] font-medium"
                  style={{ background: 'var(--amber)', color: '#000' }}>Save</button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[12px] font-medium" style={{ color: 'var(--foreground)' }}>{d.title}</span>
                {d.body && <span className="text-[11px] whitespace-pre-wrap mt-1" style={{ color: 'var(--zinc-400)' }}>{d.body}</span>}
                <span className="text-[10px] mt-1" style={{ color: 'var(--zinc-500)' }}>
                  {new Date(d.decidedAt).toLocaleString()}{d.decidedBy ? ` · ${d.decidedBy}` : ''}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setEditingId(d.id); setEditDraft({}) }}
                  className="p-1 rounded wos-hover-sm" title="Edit">
                  <Edit3 size={11} style={{ color: 'var(--zinc-500)' }} />
                </button>
                <button onClick={async () => { await window.wos.projects.removeDecision(d.id); onChange() }}
                  className="text-[11px] px-2 py-0.5 rounded wos-hover-sm"
                  style={{ color: 'var(--zinc-500)' }}>Remove</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function NotesTab({ project, onSave }: { project: ProjectRow; onSave: (notes: string) => Promise<void> }) {
  const initial = useMemo(() => {
    const meta = project.metadata as Record<string, unknown> | null
    return typeof meta?.notes === 'string' ? meta.notes : ''
  }, [project.metadata])
  const [notes, setNotes] = useState(initial)
  const [saving, setSaving] = useState<'idle' | 'pending' | 'saved'>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setNotes(initial) }, [initial])

  function handleChange(v: string) {
    setNotes(v)
    setSaving('pending')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      await onSave(v)
      setSaving('saved')
      setTimeout(() => setSaving('idle'), 1200)
    }, 600)
  }

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center justify-between">
        <div className="text-[11px]" style={{ color: 'var(--zinc-500)' }}>
          Free-form notes. Stored on the project (not synced anywhere).
        </div>
        <span className="text-[10px]" style={{ color: 'var(--zinc-500)' }}>
          {saving === 'pending' ? 'Saving…' : saving === 'saved' ? '✓ Saved' : ' '}
        </span>
      </div>
      <textarea
        value={notes}
        onChange={e => handleChange(e.target.value)}
        placeholder="Anything you want to remember about this project — links, sketch ideas, todo lists, meeting prep notes…"
        className="flex-1 min-h-[300px] px-3 py-2 rounded-md text-[13px] outline-none resize-y leading-relaxed"
        style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
      />
    </div>
  )
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-4 flex flex-col gap-2" style={{ background: 'var(--card)', border: '1px solid var(--border)', minHeight: '140px' }}>
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-medium" style={{ color: 'var(--foreground)' }}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

// ─── helpers ───────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
