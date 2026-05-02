import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertCircle, Calendar, CheckCircle2, ChevronRight, Clock,
  ExternalLink, Globe, Loader2, Pause, Play, Plus, Sparkles,
  RefreshCw, Settings as SettingsIcon, Trash2, Webhook, XCircle, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../../lib/utils'

type AutomationKind = 'schedule' | 'hook' | 'webhook'

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

type Section = 'all' | 'schedule' | 'hook' | 'webhook'

const KIND_META: Record<AutomationKind, { label: string; icon: React.FC<{ className?: string }>; color: string }> = {
  schedule: { label: 'Schedule', icon: Calendar, color: 'text-blue-400' },
  hook: { label: 'Event hook', icon: Zap, color: 'text-amber-400' },
  webhook: { label: 'Webhook', icon: Webhook, color: 'text-emerald-400' },
}

interface ParsedAutomationSpec {
  name: string
  kind: 'schedule' | 'hook' | 'webhook'
  summary: string[]
  prompt: string
  schedule?: { mode: string; at?: string; every?: string; cron?: string; tz?: string }
  hook?: { event: string }
  webhook?: Record<string, unknown>
  delivery?: { kind: string }
  requiredApps?: string[]
}

interface MissingApp { appId: string; name: string }

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
      parseDescription: (description: string) => Promise<{ ok: boolean; spec?: ParsedAutomationSpec; missingApps?: MissingApp[]; error?: string }>
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
    case 'schedule': {
      const mode = String(c.mode ?? '?')
      if (mode === 'at') return `once at ${String(c.at ?? '?')}`
      if (mode === 'every') return `every ${String(c.every ?? '?')}`
      if (mode === 'cron') return `${String(c.cron ?? '?')}${c.tz ? ` · ${c.tz}` : ''}`
      return mode
    }
    case 'hook': return `on ${c.event ?? '?'}`
    case 'webhook': return c.slug ? `/hook/${c.slug}` : '(slug pending)'
    default: return ''
  }
}

export const AutomationsView: React.FC = () => {
  const [section, setSection] = useState<Section>('all')
  const [items, setItems] = useState<Automation[]>([])
  const [selected, setSelected] = useState<Automation | null>(null)
  const [runs, setRuns] = useState<AuditRun[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)

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
    if (section === 'all') return items
    return items.filter(i => i.kind === section)
  }, [items, section])

  const counts = useMemo(() => ({
    all: items.length,
    schedule: items.filter(i => i.kind === 'schedule').length,
    hook: items.filter(i => i.kind === 'hook').length,
    webhook: items.filter(i => i.kind === 'webhook').length,
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

  const handleNew = () => setWizardOpen(true)

  const handleWizardCreate = async (spec: ParsedAutomationSpec) => {
    try {
      const validDelivery = new Set(['silent', 'notify', 'chat', 'external'])
      const deliveryKind = spec.delivery?.kind ?? 'silent'
      const input: Record<string, unknown> = {
        name: spec.name,
        kind: spec.kind,
        prompt: spec.prompt,
        enabled: true,
        toolsAllow: [],
        config: spec.schedule ?? spec.hook ?? spec.webhook ?? {},
        resultDelivery: validDelivery.has(deliveryKind) ? deliveryKind : 'silent',
      }
      await window.wos.automations.upsert(input)
      setWizardOpen(false)
      await refresh()
      toast.success(`Automation "${spec.name}" created`)
    } catch (err) {
      toast.error(`Failed to create: ${(err as Error).message}`)
    }
  }

  return (
    <div className="flex h-full w-full bg-zinc-950 text-zinc-100">
      {wizardOpen && (
        <AutomationWizardModal
          onClose={() => setWizardOpen(false)}
          onCreate={handleWizardCreate}
        />
      )}
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
            { id: 'all' as const, label: 'All', count: counts.all },
            { id: 'schedule' as const, label: 'Schedules', count: counts.schedule },
            { id: 'hook' as const, label: 'Hooks', count: counts.hook },
            { id: 'webhook' as const, label: 'Webhooks', count: counts.webhook },
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
          <button
            onClick={e => { e.stopPropagation(); onRun() }}
            disabled={busy}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            title="Run now"
          >
            <Zap className="h-3.5 w-3.5" />
          </button>
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
              <span className="text-xs text-zinc-500 italic">All available tools (unrestricted)</span>
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

interface ToolCallRecord { tool: string; args?: unknown; result?: unknown; error?: string }

const RunRow: React.FC<{ r: AuditRun }> = ({ r }) => {
  const [open, setOpen] = useState(false)

  const toolCallRecords: ToolCallRecord[] = useMemo(() => {
    if (!Array.isArray(r.toolCalls)) return []
    return r.toolCalls as ToolCallRecord[]
  }, [r.toolCalls])

  const deniedTools = useMemo(() =>
    toolCallRecords.filter(tc =>
      tc.error?.toLowerCase().includes('denied') ||
      tc.error?.toLowerCase().includes('permission') ||
      tc.error?.toLowerCase().includes('blocked')
    ), [toolCallRecords])

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
        {deniedTools.length > 0 && (
          <span className="rounded bg-rose-950/60 px-1.5 py-0.5 text-[10px] text-rose-300">
            {deniedTools.length} tool{deniedTools.length > 1 ? 's' : ''} denied
          </span>
        )}
        <span className="text-zinc-500">{formatRelative(r.startedAt)}</span>
        <span className="ml-auto text-zinc-600">{new Date(r.startedAt).toLocaleString()}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-zinc-900 bg-zinc-950 px-3 py-2 text-[11px]">
          {r.error && <pre className="whitespace-pre-wrap rounded bg-rose-950/40 p-2 text-rose-300">{r.error}</pre>}
          {deniedTools.length > 0 && (
            <div className="rounded bg-rose-950/30 p-2 text-rose-300">
              <div className="mb-1 font-semibold">Denied tools:</div>
              {deniedTools.map((tc, i) => (
                <div key={i} className="font-mono">{tc.tool}{tc.error ? ` — ${tc.error}` : ''}</div>
              ))}
              <div className="mt-1 text-zinc-400">Ensure the required apps are connected in Settings.</div>
            </div>
          )}
          {r.output && <pre className="whitespace-pre-wrap rounded bg-zinc-900/60 p-2 text-zinc-300">{r.output}</pre>}
        </div>
      )}
    </li>
  )
}

const EmptyState: React.FC<{ section: Section; onNew: () => void }> = ({ section, onNew }) => {
  const copy =
    section === 'schedule' ? { title: 'No schedules', sub: 'One-shot reminders, intervals, and cron jobs live here.' }
    : section === 'hook' ? { title: 'No event hooks', sub: 'Run an automation when a WOS event fires (meeting saved, session started, …).' }
    : section === 'webhook' ? { title: 'No webhooks', sub: 'Trigger automations from external services via inbound HTTPS POST.' }
    : { title: 'No automations yet', sub: 'Schedules, event hooks, and webhooks live here.' }
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
      Create automations from the "+ New" button or by describing what you want in chat.
    </p>
  </div>
)

const AutomationWizardModal: React.FC<{
  onClose: () => void
  onCreate: (spec: ParsedAutomationSpec) => Promise<void>
}> = ({ onClose, onCreate }) => {
  const [description, setDescription] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<ParsedAutomationSpec | null>(null)
  const [missingApps, setMissingApps] = useState<MissingApp[]>([])
  const [creating, setCreating] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { textareaRef.current?.focus() }, [])

  const handleGenerate = async () => {
    if (!description.trim()) return
    setParsing(true)
    setParseError(null)
    setParsed(null)
    setMissingApps([])
    try {
      const result = await window.wos.automations.parseDescription(description.trim())
      if (result.ok && result.spec) {
        setParsed(result.spec)
        setMissingApps(result.missingApps ?? [])
      } else {
        setParseError(result.error ?? 'Failed to parse description')
      }
    } catch (err) {
      setParseError((err as Error).message)
    } finally {
      setParsing(false)
    }
  }

  const handleCreate = async () => {
    if (!parsed) return
    setCreating(true)
    try {
      await onCreate(parsed)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Create Automation</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              What should WOS do?
            </label>
            <textarea
              ref={textareaRef}
              value={description}
              onChange={e => { setDescription(e.target.value); setParsed(null); setParseError(null) }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate() }}
              placeholder="e.g. Post a daily summary of #all-agent-testing to Slack every morning at 9am"
              rows={3}
              className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-zinc-600">Tip: ⌘↵ to generate</p>
          </div>

          <button
            onClick={handleGenerate}
            disabled={!description.trim() || parsing}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {parsing
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing…</>
              : <><Sparkles className="h-3.5 w-3.5" /> Generate</>}
          </button>

          {parseError && (
            <div className="rounded-lg bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
              {parseError}
            </div>
          )}

          {parsed && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-300">{parsed.name}</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 capitalize">
                  {parsed.kind}
                </span>
              </div>

              {parsed.summary.length > 0 && (
                <ul className="space-y-1">
                  {parsed.summary.map((line, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-zinc-400">
                      <span className="mt-0.5 shrink-0 text-violet-400">•</span>
                      {line}
                    </li>
                  ))}
                </ul>
              )}

              {missingApps.length > 0 && (
                <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    Required apps not connected
                  </div>
                  {missingApps.map(app => (
                    <div key={app.appId} className="text-xs text-amber-400">
                      {app.name} — connect it in Settings &gt; Apps before creating this automation
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!parsed || missingApps.length > 0 || creating}
            className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Create automation
          </button>
        </footer>
      </div>
    </div>
  )
}

export default AutomationsView
