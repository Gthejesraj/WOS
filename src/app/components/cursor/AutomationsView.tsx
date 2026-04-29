import { useEffect, useState } from 'react'
import { Clock, Webhook, Shield, ListChecks, Pause, Play, Trash2, Pencil, Zap } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { useUIStore, type AutomationsTab } from '../../../store/uiStore'
import { NLAuthorBox } from './NLAuthorBox'

type Tab = AutomationsTab

interface ScheduledJob {
  id: string
  name: string
  cronExpr?: string | null
  runAt?: number | null
  target: string
  prompt: string
  enabled: boolean | number
  nextRunAt?: number | null
  lastRunAt?: number | null
}

interface Hook {
  id: string
  name: string
  event: string
  type: string
  enabled: boolean | number
  lastFiredAt?: number | null
}

interface StandingOrder {
  id: string
  name: string
  body: string
  scope: string
  enabled: boolean | number
}

interface Task {
  id: string
  type: string
  status: string
  title: string
  createdAt: number
  updatedAt?: number
  conversationId?: string | null
  parentId?: string | null
}

interface TaskStep {
  id: string
  taskId: string
  idx: number
  status: string
  label: string
  output?: string | null
  error?: string | null
  ts: number
}

const wos = () => (window as any).wos

export function AutomationsView() {
  const tab = useUIStore(s => s.automationsTab)
  const setTab = useUIStore(s => s.setAutomationsTab)

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--background)' }}>
      <div className="max-w-4xl mx-auto w-full px-6 pt-6 pb-0">
        <div className="mb-4">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Automations</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
            Schedule jobs, react to events, set standing orders, and review every detached run.
          </p>
        </div>

        <div className="flex gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
          <TabButton active={tab === 'scheduled'} onClick={() => setTab('scheduled')} icon={<Clock size={13} />}>Scheduled</TabButton>
          <TabButton active={tab === 'hooks'} onClick={() => setTab('hooks')} icon={<Webhook size={13} />}>Hooks</TabButton>
          <TabButton active={tab === 'standing'} onClick={() => setTab('standing')} icon={<Shield size={13} />}>Standing Orders</TabButton>
          <TabButton active={tab === 'tasks'} onClick={() => setTab('tasks')} icon={<ListChecks size={13} />}>Tasks</TabButton>
        </div>
      </div>

      <div className="flex-1 max-w-4xl mx-auto w-full px-6 py-6 overflow-auto flex flex-col gap-4">
        {tab === 'scheduled' && <ScheduledTab />}
        {tab === 'hooks' && <HooksTab />}
        {tab === 'standing' && <StandingTab />}
        {tab === 'tasks' && <TasksTab />}
      </div>
    </div>
  )
}

function ScheduledTab() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<ScheduledJob | null>(null)

  const reload = async () => {
    const list = await wos().automations.listScheduled()
    setJobs(list as ScheduledJob[])
  }
  useEffect(() => { void reload() }, [])

  const onDraft = async (draft: Record<string, unknown>) => {
    const r = await wos().automations.upsertScheduled({
      name: draft.name,
      cronExpr: draft.cronExpr ?? null,
      runAt: draft.runAt ?? null,
      tz: draft.tz ?? 'local',
      target: draft.target ?? 'new',
      prompt: draft.prompt ?? '',
      enabled: draft.enabled ?? true,
      deleteAfterRun: draft.deleteAfterRun ?? false,
    })
    if (!r?.ok) alert(r?.error ?? 'Could not save scheduled job')
    void reload()
  }

  const togglePaused = async (j: ScheduledJob) => {
    await wos().automations.upsertScheduled({
      id: j.id,
      name: j.name,
      cronExpr: j.cronExpr ?? null,
      runAt: j.runAt ?? null,
      tz: 'local',
      target: j.target,
      prompt: j.prompt,
      enabled: !j.enabled,
    })
    void reload()
  }

  const runNow = async (j: ScheduledJob) => {
    setBusyId(j.id)
    try {
      await wos().automations.runScheduledNow(j.id)
    } finally {
      setBusyId(null)
      void reload()
    }
  }

  return (
    <>
      <NLAuthorBox kind="scheduled" onDraft={onDraft} />
      {editing && (
        <EditScheduledModal
          job={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload() }}
        />
      )}
      {jobs.length === 0 ? (
        <EmptyState
          icon={<Clock size={24} />}
          title="No scheduled jobs yet"
          description="Describe a recurring task above (e.g. “Every weekday at 9am, summarise yesterday's Jira activity”) to schedule it."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {jobs.map(j => (
            <Row
              key={j.id}
              title={j.name}
              subtitle={j.cronExpr ?? (j.runAt ? new Date(j.runAt).toLocaleString() : '—')}
              status={j.enabled ? 'enabled' : 'paused'}
              actions={
                <>
                  <IconButton aria-label="Run now" onClick={() => void runNow(j)} disabled={busyId === j.id}>
                    <Zap size={13} />
                  </IconButton>
                  <IconButton aria-label={j.enabled ? 'Pause' : 'Resume'} onClick={() => void togglePaused(j)}>
                    {j.enabled ? <Pause size={13} /> : <Play size={13} />}
                  </IconButton>
                  <IconButton aria-label="Edit" onClick={() => setEditing(j)}><Pencil size={13} /></IconButton>
                  <IconButton aria-label="Delete" onClick={async () => {
                    await wos().automations.deleteScheduled(j.id)
                    void reload()
                  }}>
                    <Trash2 size={13} />
                  </IconButton>
                </>
              }
            />
          ))}
        </div>
      )}
    </>
  )
}

function HooksTab() {
  const [hooks, setHooks] = useState<Hook[]>([])
  const [editing, setEditing] = useState<Hook | null>(null)

  const reload = async () => {
    const list = await wos().automations.listHooks()
    setHooks(list as Hook[])
  }
  useEffect(() => { void reload() }, [])

  const onDraft = async (draft: Record<string, unknown>) => {
    const r = await wos().automations.upsertHook({
      name: draft.name,
      event: draft.event,
      type: draft.type ?? 'prompt',
      config: draft.config ?? {},
      enabled: draft.enabled ?? true,
    })
    if (!r?.ok) alert(r?.error ?? 'Could not save hook')
    void reload()
  }

  return (
    <>
      <NLAuthorBox kind="hook" onDraft={onDraft} />
      {editing && (
        <EditHookModal
          hook={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload() }}
        />
      )}
      {hooks.length === 0 ? (
        <EmptyState
          icon={<Webhook size={24} />}
          title="No hooks configured"
          description="Hooks react to in-process events such as message:received or app:connected. Describe one above to draft it."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {hooks.map(h => (
            <Row
              key={h.id}
              title={h.name}
              subtitle={`${h.event} → ${h.type}`}
              status={h.enabled ? 'enabled' : 'paused'}
              actions={
                <>
                  <IconButton aria-label="Edit" onClick={() => setEditing(h)}><Pencil size={13} /></IconButton>
                  <IconButton aria-label="Delete" onClick={async () => {
                    await wos().automations.deleteHook(h.id)
                    void reload()
                  }}>
                    <Trash2 size={13} />
                  </IconButton>
                </>
              }
            />
          ))}
        </div>
      )}
    </>
  )
}

function StandingTab() {
  const [orders, setOrders] = useState<StandingOrder[]>([])
  const [editing, setEditing] = useState<StandingOrder | null>(null)

  const reload = async () => {
    const list = await wos().automations.listStandingOrders()
    setOrders(list as StandingOrder[])
  }
  useEffect(() => { void reload() }, [])

  const onDraft = async (draft: Record<string, unknown>) => {
    const r = await wos().automations.upsertStandingOrder({
      name: draft.name,
      body: draft.body,
      scope: draft.scope ?? 'global',
      enabled: draft.enabled ?? true,
    })
    if (!r?.ok) alert(r?.error ?? 'Could not save standing order')
    void reload()
  }

  return (
    <>
      <NLAuthorBox kind="standing-order" onDraft={onDraft} />
      {editing && (
        <EditStandingModal
          order={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload() }}
        />
      )}
      {orders.length === 0 ? (
        <EmptyState
          icon={<Shield size={24} />}
          title="No standing orders"
          description="Standing orders are injected into every agent run. Describe one above (e.g. “Always confirm before sending email outside working hours”)."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {orders.map(o => (
            <Row
              key={o.id}
              title={o.name}
              subtitle={o.body.length > 90 ? `${o.body.slice(0, 90)}…` : o.body}
              status={o.enabled ? 'enabled' : 'paused'}
              actions={
                <>
                  <IconButton aria-label="Edit" onClick={() => setEditing(o)}><Pencil size={13} /></IconButton>
                  <IconButton aria-label="Delete" onClick={async () => {
                    await wos().automations.deleteStandingOrder(o.id)
                    void reload()
                  }}>
                    <Trash2 size={13} />
                  </IconButton>
                </>
              }
            />
          ))}
        </div>
      )}
    </>
  )
}

function TasksTab() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [selected, setSelected] = useState<Task | null>(null)

  const reload = async () => {
    const list = await wos().automations.listTasks()
    setTasks(list as Task[])
  }

  useEffect(() => {
    void reload()
    const t = setInterval(() => { void reload() }, 4000)
    return () => clearInterval(t)
  }, [])

  if (selected) {
    return <TaskDetailPanel task={selected} onBack={() => setSelected(null)} />
  }

  const filtered = tasks.filter(t =>
    (statusFilter === 'all' || t.status === statusFilter) &&
    (typeFilter === 'all' || t.type === typeFilter),
  )

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={<ListChecks size={24} />}
        title="No tasks yet"
        description="Every detached run — scheduled jobs, sub-agents, multi-step flows — will appear here with its full timeline."
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs">
        <FilterChip label="All" active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        <FilterChip label="Running" active={statusFilter === 'running'} onClick={() => setStatusFilter('running')} />
        <FilterChip label="Success" active={statusFilter === 'success'} onClick={() => setStatusFilter('success')} />
        <FilterChip label="Error" active={statusFilter === 'error'} onClick={() => setStatusFilter('error')} />
        <div className="w-px h-4" style={{ background: 'var(--border)' }} />
        <FilterChip label="All types" active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} />
        <FilterChip label="Scheduled" active={typeFilter === 'scheduled'} onClick={() => setTypeFilter('scheduled')} />
        <FilterChip label="Sub-agent" active={typeFilter === 'subagent'} onClick={() => setTypeFilter('subagent')} />
        <FilterChip label="Hook" active={typeFilter === 'hook'} onClick={() => setTypeFilter('hook')} />
        <FilterChip label="Flow" active={typeFilter === 'flow'} onClick={() => setTypeFilter('flow')} />
      </div>
      <div className="flex flex-col gap-2">
        {filtered.map(t => (
          <button key={t.id} onClick={() => setSelected(t)} className="text-left">
            <Row
              title={t.title}
              subtitle={`${t.type} · ${new Date(t.createdAt).toLocaleString()}`}
              status={t.status}
            />
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-xs text-center py-6" style={{ color: 'var(--muted-foreground)' }}>
            No tasks match the current filters.
          </div>
        )}
      </div>
    </div>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-1 rounded-full transition-colors"
      style={{
        background: active ? 'var(--surface-raised)' : 'var(--muted)',
        color: active ? 'var(--foreground)' : 'var(--muted-foreground)',
        border: '1px solid ' + (active ? 'var(--border-strong)' : 'var(--border)'),
      }}
    >
      {label}
    </button>
  )
}

function TaskDetailPanel({ task, onBack }: { task: Task; onBack: () => void }) {
  const [steps, setSteps] = useState<TaskStep[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const s = await wos().automations.getTaskSteps(task.id)
        if (!cancelled) setSteps(s as TaskStep[])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [task.id])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ color: 'var(--muted-foreground)', border: '1px solid var(--border)' }}
        >
          ← Back
        </button>
        <div className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{task.title}</div>
        <StatusBadge status={task.status} />
      </div>
      <div className="rounded-xl p-3" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
        <div className="text-xs grid grid-cols-2 gap-2" style={{ color: 'var(--muted-foreground)' }}>
          <div><span style={{ color: 'var(--foreground)' }}>Type:</span> {task.type}</div>
          <div><span style={{ color: 'var(--foreground)' }}>ID:</span> <span className="font-mono">{task.id.slice(0, 12)}</span></div>
          <div><span style={{ color: 'var(--foreground)' }}>Created:</span> {new Date(task.createdAt).toLocaleString()}</div>
          {task.updatedAt && <div><span style={{ color: 'var(--foreground)' }}>Updated:</span> {new Date(task.updatedAt).toLocaleString()}</div>}
          {task.conversationId && <div className="col-span-2"><span style={{ color: 'var(--foreground)' }}>Conversation:</span> <span className="font-mono">{task.conversationId.slice(0, 12)}</span></div>}
        </div>
      </div>
      <div>
        <div className="text-xs mb-2" style={{ color: 'var(--muted-foreground)' }}>Timeline</div>
        {loading ? (
          <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Loading…</div>
        ) : steps.length === 0 ? (
          <div className="text-xs italic py-3" style={{ color: 'var(--muted-foreground)' }}>
            No steps recorded for this task.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {steps.map(s => (
              <div key={s.id} className="rounded-lg p-3" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
                <div className="flex items-center gap-2">
                  <div className="text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>#{s.idx}</div>
                  <div className="text-sm flex-1 truncate" style={{ color: 'var(--foreground)' }}>{s.label}</div>
                  <StatusBadge status={s.status} />
                </div>
                {s.output && (
                  <pre className="text-xs mt-2 whitespace-pre-wrap" style={{ color: 'var(--muted-foreground)' }}>{s.output}</pre>
                )}
                {s.error && (
                  <pre className="text-xs mt-2 whitespace-pre-wrap" style={{ color: 'var(--destructive)' }}>{s.error}</pre>
                )}
                <div className="text-[10px] mt-1" style={{ color: 'var(--muted-foreground)' }}>{new Date(s.ts).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    enabled: { bg: 'var(--secondary)', fg: 'var(--foreground)', label: 'Enabled' },
    paused: { bg: 'var(--muted)', fg: 'var(--muted-foreground)', label: 'Paused' },
    running: { bg: 'var(--surface-raised)', fg: 'var(--foreground)', label: 'Running' },
    queued: { bg: 'var(--muted)', fg: 'var(--muted-foreground)', label: 'Queued' },
    success: { bg: 'var(--secondary)', fg: 'var(--foreground)', label: 'Success' },
    error: { bg: 'var(--destructive)', fg: 'var(--destructive-foreground)', label: 'Error' },
    cancelled: { bg: 'var(--muted)', fg: 'var(--muted-foreground)', label: 'Cancelled' },
  }
  const v = map[status] ?? { bg: 'var(--muted)', fg: 'var(--muted-foreground)', label: status }
  return (
    <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: v.bg, color: v.fg }}>
      {v.label}
    </span>
  )
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn('px-4 py-2 text-sm transition-colors -mb-px border-b-2 flex items-center gap-2')}
      style={{
        color: active ? 'var(--foreground)' : 'var(--muted-foreground)',
        borderBottomColor: active ? 'var(--amber)' : 'transparent',
      }}
    >
      {icon}
      {children}
    </button>
  )
}

function Row({ title, subtitle, status, actions }: {
  title: string
  subtitle?: string
  status?: string
  actions?: React.ReactNode
}) {
  return (
    <div
      className="rounded-xl p-3 flex items-center gap-3 group"
      style={{ border: '1px solid var(--border)', background: 'var(--card)' }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate" style={{ color: 'var(--foreground)' }}>{title}</div>
        {subtitle && (
          <div className="text-xs truncate mt-0.5" style={{ color: 'var(--muted-foreground)' }}>{subtitle}</div>
        )}
      </div>
      {status && <StatusBadge status={status} />}
      {actions && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {actions}
        </div>
      )}
    </div>
  )
}

function IconButton({ children, onClick, disabled, ...rest }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      {...rest}
      className="p-1.5 rounded-md transition-colors disabled:opacity-50"
      style={{ color: 'var(--muted-foreground)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-raised)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 gap-2">
      <div style={{ color: 'var(--muted-foreground)' }}>{icon}</div>
      <div className="text-sm" style={{ color: 'var(--foreground)' }}>{title}</div>
      <div className="text-xs max-w-md" style={{ color: 'var(--muted-foreground)' }}>{description}</div>
    </div>
  )
}

// ── Edit modals ────────────────────────────────────────────────────

function ModalShell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl w-full max-w-lg flex flex-col"
        style={{ background: 'var(--card)', border: '1px solid var(--border)', maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{title}</div>
        </div>
        <div className="px-4 py-3 flex-1 overflow-y-auto flex flex-col gap-3">{children}</div>
        <div className="px-4 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: 'var(--border)' }}>
          {footer}
        </div>
      </div>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{label}</span>
      {children}
    </label>
  )
}

function inputStyle(): React.CSSProperties {
  return {
    background: 'var(--input)',
    color: 'var(--foreground)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm, 6px)',
    padding: '6px 10px',
    fontSize: '13px',
    outline: 'none',
  }
}

function btnPrimary(): React.CSSProperties {
  return {
    background: 'var(--foreground)',
    color: 'var(--background)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm, 6px)',
    padding: '6px 12px',
    fontSize: '13px',
  }
}

function btnSecondary(): React.CSSProperties {
  return {
    background: 'transparent',
    color: 'var(--muted-foreground)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm, 6px)',
    padding: '6px 12px',
    fontSize: '13px',
  }
}

function EditScheduledModal({ job, onClose, onSaved }: { job: ScheduledJob; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(job.name)
  const [cronExpr, setCronExpr] = useState(job.cronExpr ?? '')
  const [runAt, setRunAt] = useState(job.runAt ? new Date(job.runAt).toISOString().slice(0, 16) : '')
  const [target, setTarget] = useState(job.target)
  const [prompt, setPrompt] = useState(job.prompt)
  const [enabled, setEnabled] = useState<boolean>(!!job.enabled)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      const r = await wos().automations.upsertScheduled({
        id: job.id,
        name,
        cronExpr: cronExpr.trim() ? cronExpr.trim() : null,
        runAt: runAt ? new Date(runAt).getTime() : null,
        tz: 'local',
        target,
        prompt,
        enabled,
      })
      if (!r?.ok) {
        alert(r?.error ?? 'Could not save')
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title="Edit scheduled job"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} style={btnSecondary()}>Cancel</button>
          <button onClick={() => void submit()} disabled={saving || !name || !target || !prompt} style={btnPrimary()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <FormField label="Name">
        <input style={inputStyle()} value={name} onChange={e => setName(e.target.value)} />
      </FormField>
      <FormField label="Cron expression (5-field)">
        <input style={inputStyle()} value={cronExpr} placeholder="e.g. 0 9 * * 1-5" onChange={e => setCronExpr(e.target.value)} />
      </FormField>
      <FormField label="One-shot run at (leave empty for cron)">
        <input style={inputStyle()} type="datetime-local" value={runAt} onChange={e => setRunAt(e.target.value)} />
      </FormField>
      <FormField label="Target conversation">
        <input style={inputStyle()} value={target} placeholder='"new" or conversation id' onChange={e => setTarget(e.target.value)} />
      </FormField>
      <FormField label="Prompt">
        <textarea style={{ ...inputStyle(), minHeight: 80, fontFamily: 'inherit' }} value={prompt} onChange={e => setPrompt(e.target.value)} />
      </FormField>
      <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--foreground)' }}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        Enabled
      </label>
    </ModalShell>
  )
}

const HOOK_EVENTS = [
  'message:received',
  'conversation:new',
  'conversation:reset',
  'app:connected',
  'app:disconnected',
  'agent:bootstrap',
  'agent:error',
  'session:compact:before',
  'session:compact:after',
]

function EditHookModal({ hook, onClose, onSaved }: { hook: Hook; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(hook.name)
  const [event, setEvent] = useState(hook.event)
  const [type, setType] = useState<string>(hook.type)
  const [configText, setConfigText] = useState(() => {
    try { return JSON.stringify((hook as unknown as { config?: unknown }).config ?? {}, null, 2) } catch { return '{}' }
  })
  const [enabled, setEnabled] = useState<boolean>(!!hook.enabled)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setErr(null)
    let config: Record<string, unknown>
    try { config = JSON.parse(configText || '{}') as Record<string, unknown> } catch { setErr('Config must be valid JSON'); return }
    setSaving(true)
    try {
      const r = await wos().automations.upsertHook({ id: hook.id, name, event, type, config, enabled })
      if (!r?.ok) { setErr(r?.error ?? 'Could not save'); return }
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <ModalShell
      title="Edit hook"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} style={btnSecondary()}>Cancel</button>
          <button onClick={() => void submit()} disabled={saving || !name} style={btnPrimary()}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <FormField label="Name">
        <input style={inputStyle()} value={name} onChange={e => setName(e.target.value)} />
      </FormField>
      <FormField label="Event">
        <select style={inputStyle()} value={event} onChange={e => setEvent(e.target.value)}>
          {HOOK_EVENTS.map(ev => <option key={ev} value={ev}>{ev}</option>)}
        </select>
      </FormField>
      <FormField label="Type">
        <select style={inputStyle()} value={type} onChange={e => setType(e.target.value)}>
          <option value="prompt">prompt</option>
          <option value="skill">skill</option>
          <option value="tool">tool</option>
        </select>
      </FormField>
      <FormField label="Config (JSON)">
        <textarea style={{ ...inputStyle(), minHeight: 100, fontFamily: 'ui-monospace, monospace' }} value={configText} onChange={e => setConfigText(e.target.value)} />
      </FormField>
      <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--foreground)' }}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        Enabled
      </label>
      {err && <div className="text-xs" style={{ color: 'var(--destructive)' }}>{err}</div>}
    </ModalShell>
  )
}

function EditStandingModal({ order, onClose, onSaved }: { order: StandingOrder; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(order.name)
  const [body, setBody] = useState(order.body)
  const [scope, setScope] = useState(order.scope || 'global')
  const [enabled, setEnabled] = useState<boolean>(!!order.enabled)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      const r = await wos().automations.upsertStandingOrder({ id: order.id, name, body, scope, enabled })
      if (!r?.ok) { alert(r?.error ?? 'Could not save'); return }
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <ModalShell
      title="Edit standing order"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} style={btnSecondary()}>Cancel</button>
          <button onClick={() => void submit()} disabled={saving || !name || !body} style={btnPrimary()}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <FormField label="Name">
        <input style={inputStyle()} value={name} onChange={e => setName(e.target.value)} />
      </FormField>
      <FormField label="Scope">
        <input style={inputStyle()} value={scope} placeholder='"global" or conversation/workspace id' onChange={e => setScope(e.target.value)} />
      </FormField>
      <FormField label="Body (markdown)">
        <textarea style={{ ...inputStyle(), minHeight: 140, fontFamily: 'inherit' }} value={body} onChange={e => setBody(e.target.value)} />
      </FormField>
      <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--foreground)' }}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        Enabled
      </label>
    </ModalShell>
  )
}
