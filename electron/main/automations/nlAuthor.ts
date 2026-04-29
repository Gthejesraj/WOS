// Natural-language authoring for automations.
// Lightweight heuristic-first parser; falls back to "free text" payloads when
// the prompt doesn't match a known shape. Real LLM-backed structured output is
// a future enhancement, but this keeps the UI useful immediately.

export type ScheduledDraft = {
  kind: 'scheduled'
  name: string
  cronExpr?: string
  runAt?: number
  tz: string
  target: string
  prompt: string
  enabled: boolean
  deleteAfterRun: boolean
}

export type HookDraft = {
  kind: 'hook'
  name: string
  event: string
  type: 'skill' | 'prompt' | 'tool'
  config: Record<string, unknown>
  enabled: boolean
}

export type StandingOrderDraft = {
  kind: 'standing-order'
  name: string
  body: string
  scope: string
  enabled: boolean
}

export type Draft = ScheduledDraft | HookDraft | StandingOrderDraft

const DAY_TO_CRON: Record<string, string> = {
  sunday: '0', monday: '1', tuesday: '2', wednesday: '3',
  thursday: '4', friday: '5', saturday: '6',
}

function parseTime(text: string): { hour: number; minute: number } | null {
  // 9am, 9:30am, 14:00, 9 a.m.
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = m[2] ? parseInt(m[2], 10) : 0
  const ampm = m[3]?.toLowerCase()
  if (ampm?.startsWith('p') && h < 12) h += 12
  if (ampm?.startsWith('a') && h === 12) h = 0
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return { hour: h, minute: min }
}

function deriveCron(prompt: string): string | undefined {
  const lower = prompt.toLowerCase()
  const time = parseTime(lower)
  if (lower.includes('every minute')) return '* * * * *'
  if (lower.includes('every hour') || lower.includes('hourly')) return '0 * * * *'
  if (lower.includes('every day') || lower.includes('daily') || lower.includes('each day')) {
    return time ? `${time.minute} ${time.hour} * * *` : '0 9 * * *'
  }
  if (lower.includes('weekly') || lower.includes('every week')) {
    return time ? `${time.minute} ${time.hour} * * 1` : '0 9 * * 1'
  }
  for (const [day, n] of Object.entries(DAY_TO_CRON)) {
    if (lower.includes(day)) return time ? `${time.minute} ${time.hour} * * ${n}` : `0 9 * * ${n}`
  }
  return undefined
}

function deriveOnce(prompt: string): number | undefined {
  // "in 5 minutes", "in 2 hours"
  const m = prompt.toLowerCase().match(/in\s+(\d+)\s*(minute|minutes|hour|hours|day|days)/)
  if (!m) return undefined
  const n = parseInt(m[1], 10)
  const unit = m[2]
  const ms = unit.startsWith('minute') ? n * 60_000 : unit.startsWith('hour') ? n * 3_600_000 : n * 86_400_000
  return Date.now() + ms
}

function shortName(prompt: string, fallback: string): string {
  const cleaned = prompt.trim().split(/[\n.!?]/)[0].slice(0, 60)
  return cleaned || fallback
}

function authorScheduled(prompt: string): ScheduledDraft {
  const cronExpr = deriveCron(prompt)
  const runAt = !cronExpr ? deriveOnce(prompt) : undefined
  return {
    kind: 'scheduled',
    name: shortName(prompt, 'Scheduled task'),
    cronExpr,
    runAt,
    tz: 'local',
    target: 'new',
    prompt,
    enabled: true,
    deleteAfterRun: !!runAt,
  }
}

const KNOWN_EVENTS = [
  'message:received', 'conversation:new', 'conversation:reset',
  'app:connected', 'app:disconnected',
  'agent:bootstrap', 'agent:error',
  'session:compact:before', 'session:compact:after',
]

function authorHook(prompt: string): HookDraft {
  const lower = prompt.toLowerCase()
  const event = KNOWN_EVENTS.find((e) => lower.includes(e.split(':')[1])) ?? 'message:received'
  const type: HookDraft['type'] = lower.includes('skill ') ? 'skill' : lower.includes('tool ') ? 'tool' : 'prompt'
  return {
    kind: 'hook',
    name: shortName(prompt, 'Hook'),
    event,
    type,
    config: type === 'prompt' ? { prompt } : { ref: prompt },
    enabled: true,
  }
}

function authorStandingOrder(prompt: string): StandingOrderDraft {
  return {
    kind: 'standing-order',
    name: shortName(prompt, 'Standing order'),
    body: prompt.trim(),
    scope: 'global',
    enabled: true,
  }
}

export async function authorAutomation(kind: string, prompt: string): Promise<Draft> {
  if (!prompt || !prompt.trim()) throw new Error('prompt is required')
  switch (kind) {
    case 'scheduled': return authorScheduled(prompt)
    case 'hook': return authorHook(prompt)
    case 'standing-order': return authorStandingOrder(prompt)
    default: throw new Error(`unknown kind: ${kind}`)
  }
}
