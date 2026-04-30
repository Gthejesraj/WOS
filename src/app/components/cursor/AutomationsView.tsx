import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertCircle, Calendar, CheckCircle2, ChevronRight, Clock,
  ExternalLink, FileText, Globe, Heart, Loader2, Pause, Play, Plus,
  RefreshCw, Settings as SettingsIcon, Trash2, Webhook, Workflow, XCircle, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../../lib/utils'

type AutomationKind =
  | 'cron'
  | 'heartbeat'
  | 'hook'
  | 'standing_order'
  | 'task_flow'
  | 'webhook'

type ResultDelivery = 'silent' | 'notify' | 'chat' | 'external'

interface Automation {
  id: string
  kind: AutomationKind
  name: string
  description: string | null
  enabled: boolean
  prompt: string
  toolsAllow: string[]
  config: Record<string, unknown>
  resultDelivery: ResultDelivery
  resultTarget: string | null
  createdAt: string | Date
  updatedAt: string | Date
  lastRunAt: string | Date | null
  nextRunAt: string | Date | null
}

interface AuditRun {
  id: string
  automationId: string
  startedAt: string | Date
  endedAt: string | Date | null
  status: 'running' | 'success' | 'error' | 'cancelled' | 'dryrun'
  output: string | null
  error: string | null
  trigger: unknown
  toolCalls: unknown
}

type Section = 'active' | 'rules' | 'background'

const ACTIVE_KINDS: AutomationKind[] = ['cron', 'hook', 'webhook']
const RULE_KINDS: AutomationKind[] = ['standing_order']
const BG_KINDS: AutomationKind[] = ['heartbeat', 'task_flow']

const KIND_META: Record<AutomationKind, { label: string; icon: React.FC<{ className?: string }>; color: string }> = {
  cron: { label: 'Schedule', icon: Calendar, color: 'text-blue-400' },
  heartbeat: { label: 'Heartbeat', icon: Heart, color: 'text-rose-400' },
  hook: { label: 'Event hook', icon: Zap, color: 'text-amber-400' },
  webhook: { label: 'Webhook', icon: Webhook, color: 'text-emerald-400' },
  standing_order: { label: 'Standing rule', icon: FileText, color: 'text-purple-400' },
  task_flow: { label: 'Task flow', icon: Workflow, color: 'text-cyan-400' },
}

declare global {
  interface WosAPI {
    automations: {
      list: (filter?: { kind?: string; enabled?: boolean }) => Promise<Automation[]>
      get: (id: string) => Promise<Automation | null>
      upsert: (input: unknown) => Promise<Automation>
      toggle: (id: string, enabled: boolean) => Promise<Automation | null>
      delete: (id: string) => Promise<{ ok: boolean }>
      runNow: (id: string, dryRun?: boolean) => Promise<{ ok: boolean; runId?: string; output?: string; error?: string | null }>
      runs: (id?: string, limit?: number) => Promise<AuditRun[]>
      webhookInfo: (id: string) => Promise<{ slug: string; secret: string; localUrl: string; publicUrl: string | null } | null>
      reloadAll: () => Promise<{ ok: boolean }>
      onError: (cb: (e: { id: string; runId: string; error: string }) => void) => () => void
      onResult: (cb: (e: { id: string; runId: string | null; name: string; output: string }) => void) => () => void
      onOpen: (cb: (e: { automationId: string; runId?: string }) => void) => () => void
    }
  }
}

function formatRelative(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const t = new Date(date).getTime()
  const diff = Date.now() - t
  if (diff < 0) {
    const fwd = -diff
    if (fwd < 60_000) return `in ${Math.round(fwd / 1000)}s`
    if (fwd < 3_600_000) return `in ${Math.round(fwd / 60_000)}m`
    if (fwd < 86_400_000) return `in ${Math.round(fwd / 3_600_000)}h`
    return new Date(t).toLocaleString()
  }
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return new Date(t).toLocaleDateString()
}

function describeConfig(a: Automation): string {
  const c = a.config || {}
  switch (a.kind) {
    case 'cron': return String(c.expr ?? '? schedule') + (c.tz ? ` · ${c.tz}` : '')
    case 'heartbeat': return `every ${c.intervalSec ?? '?'}s`
    case 'hook': return `on ${c.event ?? '?'}`
    case 'webhook': return c.slug ? `/hook/${c.slug}` : '(slug pending)'
    case 'standing_order': return typeof c.rule === 'string' ? (c.rule as string).slice(0, 80) : ''
    case 'task_flow': return `${Array.isArray(c.steps) ? (c.steps as unknown[]).length : 0} steps`
    default: return ''
  }
}

export const AutomationsView: React.FC = () => {
  const [section, setSection] = useState<Section>('active')
  const [items, setItems] = useState<Automation[]>([])
  const [selected, setSelected] = useState<Automation | null>(null)
  const [runs, setRuns] = useState<AuditRun[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const all = await window.wos.automations.list()
      setItems(all)
    } catch (err) {
      toast.error(`Failed to load automations: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const offError = window.wos.automations.onError(e => {
      toast.error(`Automation error: ${e.error}`, { description: `runId: ${e.runId}` })
      refresh()
    })
    const offResult = window.wos.automations.onResult(() => { refresh() })
    const offOpen = window.wos.automations.onOpen(e => {
      // Auto-select the automation referenced by tray/notification click
      window.wos.automations.get(e.automationId).then(a => { if (a) setSelected(a) }).catch(() => {})
    })
    return () => { offError(); offResult(); offOpen() }
  }, [refresh])

  // Refresh runs whenever selection changes
  useEffect(() => {
    if (!selected) { setRuns([]); return }
    window.wos.automations.runs(selected.id, 50)
      .then(setRuns)
      .catch(() => setRuns([]))
  }, [selected])

  const filtered = useMemo(() => {
    const kinds = section === 'active' ? ACTIVE_KINDS : section === 'rules' ? RULE_KINDS : BG_KINDS
    return items.filter(i => kinds.includes(i.kind))
  }, [items, section])

  const counts = useMemo(() => ({
    active: items.filter(i => ACTIVE_KINDS.includes(i.kind)).length,
    rules: items.filter(i => RULE_KINDS.includes(i.kind)).length,
    background: items.filter(i => BG_KINDS.includes(i.kind)).length,
  }), [items])

  const handleToggle = async (a: Automation) => {
    setBusy(a.id)
    try {
      await window.wos.automations.toggle(a.id, !a.enabled)
      await refresh()
      if (selected?.id === a.id) setSelected({ ...a, enabled: !a.enabled })
    } catch (err) {
      toast.error(`Toggle failed: ${(err as Error).message}`)
    } finally { setBusy(null) }
  }

  const handleDelete = async (a: Automation) => {
    if (!confirm(`Delete automation "${a.name}"? This cannot be undone.`)) return
    setBusy(a.id)
    try {
      await window.wos.automations.delete(a.id)
      if (selected?.id === a.id) setSelected(null)
      await refresh()
      toast.success(`Deleted "${a.name}"`)
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`)
    } finally { setBusy(null) }
  }

  const handleRunNow = async (a: Automation, dryRun = false) => {
    setBusy(a.id)
    toast.loading(dryRun ? 'Dry run…' : 'Running automation…', { id: 'run-' + a.id })
    try {
      const r = await window.wos.automations.runNow(a.id, dryRun)
      if (r.ok) {
        toast.success(dryRun ? 'Dry run complete' : 'Run complete', {
          id: 'run-' + a.id,
          description: r.output ? r.output.slice(0, 120) : undefined,
        })
      } else {
        toast.error('Run failed', { id: 'run-' + a.id, description: r.error ?? '' })
      }
      // refresh runs if drawer open
      if (selected?.id === a.id) {
        const list = await window.wos.automations.runs(a.id, 50)
        setRuns(list)
      }
      await refresh()
    } catch (err) {
      toast.error('Run failed', { id: 'run-' + a.id, description: (err as Error).message })
    } finally { setBusy(null) }
  }

  const handleNew = () => {
    toast.info('Open the chat and ask WOS to create an automation', {
      description: "e.g. 'Create an automation that summarizes my Slack DMs every morning at 9am'",
    })
  }

  return (
    <div className="flex h-full w-full bg-zinc-950 text-zinc-100">
      {/* Left: list */}
      <div className="flex w-[420px] flex-col border-r border-zinc-800/80">
        <header className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-zinc-400" />
            <h1 className="text-sm font-semibold tracking-tight">Automations</h1>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={refresh}
              className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              title="Refresh"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
            <button
              onClick={handleNew}
              className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-100 hover:bg-zinc-700"
            >
              <Plus className="h-3.5 w-3.5" /> New
            </button>
          </div>
        </header>

        {/* Section tabs */}
        <nav className="flex gap-1 border-b border-zinc-800/80 px-2 py-2">
          {([
            { id: 'active' as const, label: 'Active', count: counts.active },
            { id: 'rules' as const, label: 'Rules', count: counts.rules },
            { id: 'background' as const, label: 'Background', count: counts.background },
          ]).map(t => (
            <button
              key={t.id}
              onClick={() => setSection(t.id)}
              className={cn(
                'flex-1 rounded px-2 py-1.5 text-xs font-medium transition',
                section === t.id
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200',
              )}
            >
              {t.label} <span className="ml-1 text-[10px] text-zinc-500">{t.count}</span>
            </button>
          ))}
        </nav>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState section={section} onNew={handleNew} />
          ) : (
            <ul>
              {filtered.map(a => (
                <AutomationRow
                  key={a.id}
                  a={a}
                  busy={busy === a.id}
                  selected={selected?.id === a.id}
                  onClick={() => setSelected(a)}
                  onToggle={() => handleToggle(a)}
                  onRun={() => handleRunNow(a)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Right: detail drawer */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <DetailPane
            a={selected}
            runs={runs}
            busy={busy === selected.id}
            onClose={() => setSelected(null)}
            onToggle={() => handleToggle(selected)}
            onDelete={() => handleDelete(selected)}
            onRun={() => handleRunNow(selected)}
            onDryRun={() => handleRunNow(selected, true)}
          />
        ) : (
          <DetailEmptyState />
        )}
      </div>
    </div>
  )
}

const AutomationRow: React.FC<{
  a: Automation
  busy: boolean
  selected: boolean
  onClick: () => void
  onToggle: () => void
  onRun: () => void
}> = ({ a, busy, selected, onClick, onToggle, onRun }) => {
  const meta = KIND_META[a.kind]
  const Icon = meta.icon
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          'group flex w-full items-start gap-3 border-b border-zinc-900/80 px-4 py-3 text-left transition',
          selected ? 'bg-zinc-900' : 'hover:bg-zinc-900/60',
        )}
      >
        <div className={cn('mt-0.5 rounded-md bg-zinc-900 p-1.5', selected && 'bg-zinc-800')}>
          <Icon className={cn('h-4 w-4', meta.color)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-zinc-100">{a.name}</span>
            {!a.enabled && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">paused</span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-zinc-500">
            <span className="text-zinc-400">{meta.label}</span>
            <span className="mx-1 text-zinc-700">·</span>
            <span className="font-mono text-[11px]">{describeConfig(a)}</span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-zinc-600">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> last {formatRelative(a.lastRunAt)}
            </span>
            {a.nextRunAt && (
              <span className="inline-flex items-center gap-1">
                <ChevronRight className="h-3 w-3" /> next {formatRelative(a.nextRunAt)}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            onClick={e => { e.stopPropagation(); onToggle() }}
            disabled={busy}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            title={a.enabled ? 'Pause' : 'Enable'}
          >
            {a.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          {a.kind !== 'standing_order' && (
            <button
              onClick={e => { e.stopPropagation(); onRun() }}
              disabled={busy}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              title="Run now"
            >
              <Zap className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </button>
    </li>
  )
}

const DetailPane: React.FC<{
  a: Automation
  runs: AuditRun[]
  busy: boolean
  onClose: () => void
  onToggle: () => void
  onDelete: () => void
  onRun: () => void
  onDryRun: () => void
}> = ({ a, runs, busy, onClose, onToggle, onDelete, onRun, onDryRun }) => {
  const meta = KIND_META[a.kind]
  const Icon = meta.icon
  const [webhookInfo, setWebhookInfo] = useState<{ slug: string; localUrl: string; publicUrl: string | null } | null>(null)

  useEffect(() => {
    if (a.kind === 'webhook') {
      window.wos.automations.webhookInfo(a.id).then(info => {
        if (info) setWebhookInfo({ slug: info.slug, localUrl: info.localUrl, publicUrl: info.publicUrl })
      }).catch(() => undefined)
    }
  }, [a.id, a.kind])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-zinc-800/80 px-6 py-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-zinc-900 p-2">
            <Icon className={cn('h-5 w-5', meta.color)} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-100">{a.name}</h2>
            <div className="mt-0.5 text-xs text-zinc-500">
              {meta.label} · <span className="font-mono">{describeConfig(a)}</span>
              {!a.enabled && <span className="ml-2 rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-400">paused</span>}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800">
          <XCircle className="h-4 w-4" />
        </button>
      </header>

      {/* Action bar */}
      <div className="flex items-center gap-2 border-b border-zinc-800/80 px-6 py-2.5">
        <button
          onClick={onToggle}
          disabled={busy}
          className="flex items-center gap-1.5 rounded bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-100 hover:bg-zinc-700"
        >
          {a.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {a.enabled ? 'Pause' : 'Enable'}
        </button>
        {a.kind !== 'standing_order' && (
          <>
            <button
              onClick={onRun}
              disabled={busy}
              className="flex items-center gap-1.5 rounded bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-100 hover:bg-zinc-700"
            >
              <Zap className="h-3.5 w-3.5" /> Run now
            </button>
            <button
              onClick={onDryRun}
              disabled={busy}
              className="flex items-center gap-1.5 rounded bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Dry run
            </button>
          </>
        )}
        <div className="flex-1" />
        <button
          onClick={onDelete}
          disabled={busy}
          className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs text-rose-400 hover:bg-rose-900/30"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {a.description && (
          <Section title="Description">
            <p className="text-sm text-zinc-300">{a.description}</p>
          </Section>
        )}

        {webhookInfo && (
          <Section title="Webhook URLs">
            <div className="space-y-2 rounded-md bg-zinc-900/60 p-3 text-xs">
              <Field label="Local" value={webhookInfo.localUrl} />
              <Field label="Public" value={webhookInfo.publicUrl ?? '(tunnel offline)'} />
              <Field label="Slug" value={webhookInfo.slug} />
            </div>
          </Section>
        )}

        <Section title="Prompt">
          <pre className="whitespace-pre-wrap rounded-md bg-zinc-900/60 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
            {a.prompt || '(empty)'}
          </pre>
        </Section>

        <Section title="Config">
          <pre className="whitespace-pre-wrap rounded-md bg-zinc-900/60 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
            {JSON.stringify(a.config, null, 2)}
          </pre>
        </Section>

        <Section title="Tools allowed">
          <div className="flex flex-wrap gap-1">
            {a.toolsAllow.length === 0 ? (
              <span className="text-xs text-zinc-500">No tools (prompt-only)</span>
            ) : (
              a.toolsAllow.map(t => (
                <span key={t} className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
                  {t}
                </span>
              ))
            )}
          </div>
        </Section>

        <Section title="Result delivery">
          <div className="text-xs text-zinc-300">
            <span className="font-mono">{a.resultDelivery}</span>
            {a.resultTarget && <span className="ml-2 text-zinc-500">→ {a.resultTarget}</span>}
          </div>
        </Section>

        <Section title={`Recent runs (${runs.length})`}>
          {runs.length === 0 ? (
            <div className="text-xs text-zinc-500">No runs yet.</div>
          ) : (
            <ul className="divide-y divide-zinc-900 rounded-md bg-zinc-900/40">
              {runs.map(r => <RunRow key={r.id} r={r} />)}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}

const Section: React.FC<React.PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <section className="mb-5">
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
    {children}
  </section>
)

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-baseline gap-2">
    <span className="w-12 shrink-0 text-zinc-500">{label}</span>
    <span className="break-all font-mono text-zinc-200">{value}</span>
  </div>
)

const RunRow: React.FC<{ r: AuditRun }> = ({ r }) => {
  const [open, setOpen] = useState(false)
  const statusColor =
    r.status === 'success' ? 'text-emerald-400'
    : r.status === 'error' ? 'text-rose-400'
    : r.status === 'running' ? 'text-blue-400'
    : r.status === 'dryrun' ? 'text-cyan-400'
    : 'text-zinc-500'
  const StatusIcon =
    r.status === 'success' ? CheckCircle2
    : r.status === 'error' ? AlertCircle
    : r.status === 'running' ? Loader2
    : r.status === 'dryrun' ? CheckCircle2
    : XCircle

  return (
    <li>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-zinc-900/80"
      >
        <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', statusColor, r.status === 'running' && 'animate-spin')} />
        <span className={cn('font-mono', statusColor)}>{r.status}</span>
        <span className="text-zinc-500">{formatRelative(r.startedAt)}</span>
        <span className="ml-auto text-zinc-600">{new Date(r.startedAt).toLocaleString()}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-zinc-900 bg-zinc-950 px-3 py-2 text-[11px]">
          {r.error && <pre className="whitespace-pre-wrap rounded bg-rose-950/40 p-2 text-rose-300">{r.error}</pre>}
          {r.output && <pre className="whitespace-pre-wrap rounded bg-zinc-900/60 p-2 text-zinc-300">{r.output}</pre>}
        </div>
      )}
    </li>
  )
}

const EmptyState: React.FC<{ section: Section; onNew: () => void }> = ({ section, onNew }) => {
  const copy = section === 'active'
    ? { title: 'No active automations', sub: 'Schedules, hooks, and webhooks live here.' }
    : section === 'rules'
    ? { title: 'No standing rules', sub: 'Standing orders are persistent rules injected into your main agent.' }
    : { title: 'No background activity', sub: 'Heartbeats and task flows live here.' }
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <SettingsIcon className="mb-3 h-6 w-6 text-zinc-700" />
      <h3 className="text-sm font-medium text-zinc-300">{copy.title}</h3>
      <p className="mt-1 max-w-xs text-xs text-zinc-500">{copy.sub}</p>
      <button
        onClick={onNew}
        className="mt-4 flex items-center gap-1.5 rounded bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-700"
      >
        <Plus className="h-3.5 w-3.5" /> Create automation
      </button>
    </div>
  )
}

const DetailEmptyState: React.FC = () => (
  <div className="flex h-full flex-col items-center justify-center px-6 text-center">
    <Globe className="mb-3 h-8 w-8 text-zinc-800" />
    <h3 className="text-sm font-medium text-zinc-400">Select an automation</h3>
    <p className="mt-1 max-w-md text-xs text-zinc-600">
      Pick one on the left to see its prompt, configuration, runs, and controls.
      To create a new automation, open chat and tell WOS what you want — the
      Automation Author subagent will guide you through it.
    </p>
    <a
      href="#"
      onClick={e => { e.preventDefault() }}
      className="mt-4 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
    >
      <ExternalLink className="h-3 w-3" /> Tip: try saying "remind me every weekday at 9am to review PRs"
    </a>
  </div>
)

export default AutomationsView
