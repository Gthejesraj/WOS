import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  AreaChart, Area, BarChart, Bar, Legend,
} from 'recharts'
import type { ProjectActivityRow, ProjectMetricSample } from '../../../../../store/projectsStore'

const COLORS = ['#fbbf24', '#60a5fa', '#34d399', '#f472b6', '#c084fc', '#fb923c', '#22d3ee']

function ChartCard({ title, subtitle, children, height = 200 }: { title: string; subtitle?: string; children: React.ReactNode; height?: number }) {
  return (
    <div className="rounded-md p-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[12px] font-medium" style={{ color: 'var(--foreground)' }}>{title}</div>
        {subtitle && <div className="text-[10px]" style={{ color: 'var(--zinc-500)' }}>{subtitle}</div>}
      </div>
      <div style={{ width: '100%', height }}>{children}</div>
    </div>
  )
}

function EmptyChart({ msg }: { msg: string }) {
  return (
    <div className="h-full flex items-center justify-center text-[11px]" style={{ color: 'var(--zinc-500)' }}>
      {msg}
    </div>
  )
}

const tooltipStyle = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 11,
  color: 'var(--foreground)',
}

// ── Health Over Time ─────────────────────────────────────────────────────
export function HealthOverTime({ projectId }: { projectId: string }) {
  const [series, setSeries] = useState<ProjectMetricSample[]>([])
  useEffect(() => {
    let cancel = false
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000
    void window.wos.projects.listMetric(projectId, 'health_score', { since, limit: 200 })
      .then((rows) => { if (!cancel) setSeries((rows as ProjectMetricSample[]) ?? []) })
      .catch(() => { if (!cancel) setSeries([]) })
    return () => { cancel = true }
  }, [projectId])
  const data = useMemo(() => series.map(s => ({
    ts: new Date(s.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    score: s.value,
  })), [series])
  return (
    <ChartCard title="Health over time" subtitle={`${data.length} samples`}>
      {data.length < 2 ? <EmptyChart msg="Not enough data yet — health updates with each refresh." /> : (
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="healthGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS[0]} stopOpacity={0.5} />
                <stop offset="100%" stopColor={COLORS[0]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="ts" tick={{ fill: 'var(--zinc-500)', fontSize: 10 }} />
            <YAxis domain={[0, 100]} tick={{ fill: 'var(--zinc-500)', fontSize: 10 }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="score" stroke={COLORS[0]} fill="url(#healthGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}

// ── Activity Sparklines (multi-series by app) ────────────────────────────
export function ActivitySparklines({ activity }: { activity: ProjectActivityRow[] }) {
  const data = useMemo(() => {
    const buckets = new Map<string, Record<string, number>>()
    const apps = new Set<string>()
    const now = Date.now()
    const start = now - 30 * 24 * 60 * 60 * 1000
    for (let d = start; d <= now; d += 86_400_000) {
      const key = new Date(d).toISOString().slice(5, 10)
      buckets.set(key, { day: key } as unknown as Record<string, number>)
    }
    for (const a of activity) {
      if (a.ts < start) continue
      const key = new Date(a.ts).toISOString().slice(5, 10)
      const bucket = buckets.get(key)
      if (!bucket) continue
      apps.add(a.sourceApp)
      bucket[a.sourceApp] = (bucket[a.sourceApp] ?? 0) + 1
    }
    return { rows: Array.from(buckets.values()), apps: Array.from(apps) }
  }, [activity])
  return (
    <ChartCard title="Activity by source" subtitle="last 30 days">
      {activity.length === 0 ? <EmptyChart msg="No activity yet." /> : (
        <ResponsiveContainer>
          <LineChart data={data.rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="day" tick={{ fill: 'var(--zinc-500)', fontSize: 10 }} />
            <YAxis tick={{ fill: 'var(--zinc-500)', fontSize: 10 }} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {data.apps.map((app, i) => (
              <Line key={app} type="monotone" dataKey={app} stroke={COLORS[i % COLORS.length]} strokeWidth={1.5} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}

// ── Contributor Leaderboard ──────────────────────────────────────────────
export function ContributorLeaderboard({ activity }: { activity: ProjectActivityRow[] }) {
  const data = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of activity) {
      const actor = a.actor?.trim()
      if (!actor) continue
      counts.set(actor, (counts.get(actor) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([actor, count]) => ({ actor: actor.length > 18 ? actor.slice(0, 18) + '…' : actor, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  }, [activity])
  return (
    <ChartCard title="Top contributors" subtitle={`${data.length} of last ${activity.length}`}>
      {data.length === 0 ? <EmptyChart msg="No actor data yet." /> : (
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fill: 'var(--zinc-500)', fontSize: 10 }} allowDecimals={false} />
            <YAxis type="category" dataKey="actor" tick={{ fill: 'var(--zinc-400)', fontSize: 10 }} width={120} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="count" fill={COLORS[1]} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}

// ── Ticket Aging Histogram ───────────────────────────────────────────────
export function TicketAgingHistogram({ activity }: { activity: ProjectActivityRow[] }) {
  const data = useMemo(() => {
    const open = activity.filter(a => /pr_open|jira_open|issue_open/i.test(a.sourceKind))
    const now = Date.now()
    const buckets = [
      { label: '0-1d', min: 0, max: 1 },
      { label: '2-3d', min: 2, max: 3 },
      { label: '4-7d', min: 4, max: 7 },
      { label: '8-14d', min: 8, max: 14 },
      { label: '15-30d', min: 15, max: 30 },
      { label: '30d+', min: 31, max: Infinity },
    ].map(b => ({ ...b, count: 0 }))
    for (const a of open) {
      const days = Math.floor((now - a.ts) / 86_400_000)
      const b = buckets.find(x => days >= x.min && days <= x.max)
      if (b) b.count += 1
    }
    return buckets.map(({ label, count }) => ({ label, count }))
  }, [activity])
  const total = data.reduce((s, b) => s + b.count, 0)
  return (
    <ChartCard title="Open ticket age" subtitle={`${total} open`}>
      {total === 0 ? <EmptyChart msg="No open tickets/PRs detected." /> : (
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: 'var(--zinc-500)', fontSize: 10 }} />
            <YAxis tick={{ fill: 'var(--zinc-500)', fontSize: 10 }} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="count" fill={COLORS[2]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}

