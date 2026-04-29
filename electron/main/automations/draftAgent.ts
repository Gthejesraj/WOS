/**
 * Conversational drafting helper for the Automations tab.
 *
 * One LLM call per user message. The model either asks ONE clarifying
 * question or produces a finished draft inside a `<DRAFT>...</DRAFT>` block.
 * No conversation row is ever persisted — the wizard owns all state in the
 * renderer until the user explicitly clicks "Save".
 */

import { getProvider } from '../providers'
import { getDb, schema } from '../db'
import { eq } from 'drizzle-orm'
import type { ConversationMessage } from '../providers/types'

export type DraftKind = 'scheduled' | 'hook' | 'standing-order'

export type DraftMessage = { role: 'user' | 'assistant'; content: string }

export type ScheduledDraft = {
  kind: 'scheduled'
  name: string
  cronExpr?: string | null
  runAt?: number | null
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

export type DraftTurnResult = {
  ok: true
  reply: string
  draft: Draft | null
} | {
  ok: false
  error: string
}

const HOOK_EVENTS = [
  'message:received', 'conversation:new', 'conversation:reset',
  'app:connected', 'app:disconnected',
  'agent:bootstrap', 'agent:error',
  'session:compact:before', 'session:compact:after',
]

function getDefaultModel(): string {
  const db = getDb()
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, 'defaultModel')).get()
  if (!row?.value) return ''
  try {
    const v = JSON.parse(String(row.value))
    return typeof v === 'string' ? v : ''
  } catch {
    return String(row.value).replace(/^"|"$/g, '')
  }
}

function listInstalledAppsHint(): string {
  try {
    const db = getDb()
    const rows = db.select({ appId: schema.appConnections.appId, enabled: schema.appConnections.enabled })
      .from(schema.appConnections).all()
    const names = rows.filter(r => r.enabled).map(r => r.appId)
    if (names.length === 0) return ''
    return `Apps the user has connected: ${names.join(', ')}.`
  } catch {
    return ''
  }
}

function listConversationsHint(): string {
  try {
    const db = getDb()
    const rows = db.select({ id: schema.conversations.id, title: schema.conversations.title })
      .from(schema.conversations)
      .limit(20)
      .all()
    if (rows.length === 0) return ''
    return `Recent conversation ids the user might want to deliver into: ${rows.slice(0, 10).map(r => `"${r.id}" (${r.title ?? 'Untitled'})`).join('; ')}.`
  } catch {
    return ''
  }
}

function buildSystemPrompt(kind: DraftKind): string {
  const today = new Date().toISOString()
  const apps = listInstalledAppsHint()
  const convs = listConversationsHint()
  const base = `You are the WOS Automation Drafter. Your job is to help the user create a *single* automation through a short, friendly back-and-forth.

Current time: ${today}.
${apps}
${convs}

RULES:
- Ask **one** focused clarifying question at a time. Keep it short.
- If a user reference is ambiguous (e.g. "Slack" but no channel; "send report" but no destination), ASK before drafting.
- When you have enough information to fill every required field, output a final assistant message that ends with a single \`<DRAFT>...</DRAFT>\` block containing valid JSON only.
- The JSON inside <DRAFT> must match the schema for the kind below — no extra keys, no markdown, no comments.
- Before the <DRAFT> block, write 1–2 short sentences summarising what will happen so the user can confirm.
- Never invent values — if you don't know, ask.
- Never include <DRAFT> in messages where you are still asking a question.
- Output plain prose for questions (no JSON, no code fences).

`
  if (kind === 'scheduled') {
    return base + `## Schema for kind = "scheduled"
{
  "kind": "scheduled",
  "name": string,                 // short title
  "cronExpr": string | null,      // 5-field cron, e.g. "0 9 * * 1-5"  (set OR runAt)
  "runAt": number | null,         // unix ms for one-shot         (set OR cronExpr)
  "tz": "local",
  "target": string,               // "new" for a fresh conversation, or an existing conversation id
  "prompt": string,               // exact prompt the agent will run when the job fires
  "enabled": true,
  "deleteAfterRun": boolean       // true for one-shot reminders
}

REQUIRED CLARIFICATIONS for scheduled:
- Schedule (recurring cron OR one-shot date/time).
- A clear, executable prompt — what should WOS actually DO when the job fires? If the user mentions an external service (Slack, Jira, Gmail…) but no specific resource (channel, project, query), ask which one.
- Where to deliver: "new" conversation, or an existing one?
`
  }
  if (kind === 'hook') {
    return base + `## Schema for kind = "hook"
{
  "kind": "hook",
  "name": string,
  "event": one of [${HOOK_EVENTS.map(e => `"${e}"`).join(', ')}],
  "type": "prompt" | "skill" | "tool",
  "config": {
    // for "prompt": { "prompt": string }
    // for "skill":  { "ref": string }     // skill name
    // for "tool":   { "ref": string, "input"?: object }
  },
  "enabled": true
}

REQUIRED CLARIFICATIONS for hook:
- Which event should trigger it? (must be one of the allowed events)
- What action to take (prompt text, or skill name, or tool name)?
`
  }
  return base + `## Schema for kind = "standing-order"
{
  "kind": "standing-order",
  "name": string,
  "body": string,                 // markdown rule the agent should always follow
  "scope": "global" | "<conversation-id>" | "<workspace-id>",
  "enabled": true
}

REQUIRED CLARIFICATIONS for standing-order:
- The exact rule body.
- Scope: global, or limited to a specific workspace/conversation?
`
}

function extractDraft(text: string): { reply: string; draft: Draft | null } {
  const m = text.match(/<DRAFT>\s*([\s\S]*?)\s*<\/DRAFT>/i)
  if (!m) return { reply: text.trim(), draft: null }
  const json = m[1]
  let parsed: unknown
  try { parsed = JSON.parse(json) } catch { return { reply: text.trim(), draft: null } }
  const reply = (text.slice(0, m.index ?? 0).trim() + '\n\n' + text.slice((m.index ?? 0) + m[0].length).trim()).trim()
  if (!parsed || typeof parsed !== 'object') return { reply, draft: null }
  const draft = parsed as Record<string, unknown>
  if (draft.kind === 'scheduled' || draft.kind === 'hook' || draft.kind === 'standing-order') {
    return { reply, draft: draft as unknown as Draft }
  }
  return { reply, draft: null }
}

export async function draftTurn(
  kind: DraftKind,
  messages: DraftMessage[],
): Promise<DraftTurnResult> {
  if (!messages || messages.length === 0) return { ok: false, error: 'messages is empty' }

  const model = getDefaultModel()
  if (!model) return { ok: false, error: 'No default AI model is selected. Please choose one in Settings.' }

  const provider = getProvider(model)

  const systemPrompt = buildSystemPrompt(kind)
  const history: ConversationMessage[] = messages.map(m => ({ role: m.role, content: m.content }))

  let text = ''
  try {
    for await (const ev of provider.stream({
      model,
      messages: history,
      tools: [],
      systemPrompt,
    })) {
      if (ev.type === 'text_delta') text += ev.content
      else if (ev.type === 'message_stop') break
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  const { reply, draft } = extractDraft(text)
  return { ok: true, reply: reply || '(no response)', draft }
}
