import { useEffect, useState } from 'react'
import { Clock, Webhook, Shield, ListChecks, Pause, Play, Trash2, Pencil, Zap } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { NLAuthorBox } from './NLAuthorBox'

type Tab = 'scheduled' | 'hooks' | 'standing' | 'tasks'

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
}

const wos = () => (window as any).wos

export function AutomationsView() {
  const [tab, setTab] = useState<Tab>('scheduled')

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
                  <IconButton aria-label="Edit"><Pencil size={13} /></IconButton>
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
                <IconButton aria-label="Delete" onClick={async () => {
                  await wos().automations.deleteHook(h.id)
                  void reload()
                }}>
                  <Trash2 size={13} />
                </IconButton>
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
                <IconButton aria-label="Delete" onClick={async () => {
                  await wos().automations.deleteStandingOrder(o.id)
                  void reload()
                }}>
                  <Trash2 size={13} />
                </IconButton>
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

  useEffect(() => {
    void (async () => {
      const list = await wos().automations.listTasks()
      setTasks(list as Task[])
    })()
  }, [])

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
    <div className="flex flex-col gap-2">
      {tasks.map(t => (
        <Row
          key={t.id}
          title={t.title}
          subtitle={`${t.type} · ${new Date(t.createdAt).toLocaleString()}`}
          status={t.status}
        />
      ))}
    </div>
  )
}

// --- shared UI primitives, matching AppsView idiom ---

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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    enabled: { bg: 'var(--secondary)', fg: 'var(--foreground)', label: 'Enabled' },
    paused: { bg: 'var(--muted)', fg: 'var(--muted-foreground)', label: 'Paused' },
    running: { bg: 'var(--muted)', fg: 'var(--accent-foreground)', label: 'Running' },
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

function IconButton({ children, onClick, disabled, ...rest }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      {...rest}
      className="p-1.5 rounded-md transition-colors disabled:opacity-50"
      style={{ color: 'var(--muted-foreground)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)' }}
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
