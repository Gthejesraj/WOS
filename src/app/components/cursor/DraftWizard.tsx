import { useEffect, useRef, useState } from 'react'
import { Send, Sparkles, RotateCcw, Check, X } from 'lucide-react'

type Kind = 'scheduled' | 'hook' | 'standing-order'
type ChatMsg = { role: 'user' | 'assistant'; content: string }
type Draft = Record<string, unknown>

const PLACEHOLDERS: Record<Kind, string> = {
  scheduled: 'Every weekday at 9am, summarise yesterday\'s Jira activity into the daily-standup conversation.',
  hook: 'When a new conversation starts, run the workspace-warmup skill.',
  'standing-order': 'Always confirm before sending email or modifying calendar events outside working hours.',
}

const INTRO: Record<Kind, string> = {
  scheduled: "Tell me what you'd like to schedule. I'll ask a quick question or two if anything's unclear, then show you a draft to confirm.",
  hook: "Describe an event-driven action. I'll ask which event to listen for and what to do, then preview the hook.",
  'standing-order': "Describe a rule the agent should always follow. I'll confirm scope, then show you a draft.",
}

interface DraftWizardProps {
  kind: Kind
  onSave: (draft: Draft) => Promise<void> | void
}

export function DraftWizard({ kind, onSave }: DraftWizardProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, draft, busy])

  const reset = () => {
    setMessages([])
    setInput('')
    setError(null)
    setDraft(null)
    setBusy(false)
    setSaving(false)
  }

  const submit = async () => {
    const text = input.trim()
    if (!text || busy || saving) return
    setError(null)
    const next: ChatMsg[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const r = await (window as any).wos.automations.draftTurn(kind, next)
      if (!r?.ok) {
        setError(r?.error ?? 'Could not draft automation.')
        return
      }
      const reply: string = r.reply ?? ''
      setMessages(curr => [...curr, { role: 'assistant', content: reply || (r.draft ? 'Here is your draft.' : '(no response)') }])
      if (r.draft) setDraft(r.draft as Draft)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!draft || saving) return
    setSaving(true)
    try {
      await onSave(draft)
      reset()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="rounded-xl flex flex-col"
      style={{ border: '1px solid var(--border)', background: 'var(--card)' }}
    >
      {/* Header */}
      <div
        className="px-4 py-2.5 flex items-center justify-between"
        style={{ borderBottom: messages.length > 0 || draft ? '1px solid var(--border)' : 'none' }}
      >
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--foreground)' }}>
          <Sparkles size={14} />
          <span className="font-medium">Draft with AI</span>
          {messages.length > 0 && (
            <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              · {messages.length} message{messages.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {messages.length > 0 && (
          <button
            onClick={reset}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors hover:opacity-100"
            style={{ color: 'var(--muted-foreground)', opacity: 0.85 }}
            aria-label="Start over"
          >
            <RotateCcw size={11} /> Start over
          </button>
        )}
      </div>

      {/* Conversation */}
      {messages.length > 0 && (
        <div
          ref={scrollRef}
          className="px-4 py-3 flex flex-col gap-2 max-h-72 overflow-auto"
        >
          {messages.length === 0 && (
            <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              {INTRO[kind]}
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className="flex"
              style={{ justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}
            >
              <div
                className="max-w-[85%] text-sm rounded-lg px-3 py-2 whitespace-pre-wrap"
                style={
                  m.role === 'user'
                    ? { background: 'var(--accent)', color: 'var(--accent-foreground)' }
                    : { background: 'var(--muted)', color: 'var(--foreground)' }
                }
              >
                {m.content}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex">
              <div
                className="text-sm rounded-lg px-3 py-2"
                style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
              >
                Thinking…
              </div>
            </div>
          )}
        </div>
      )}

      {/* Draft preview */}
      {draft && (
        <DraftPreview
          kind={kind}
          draft={draft}
          onChange={setDraft}
          onSave={save}
          saving={saving}
          onDiscard={() => setDraft(null)}
        />
      )}

      {/* Composer */}
      {!draft && (
        <div className="px-3 py-2.5" style={{ borderTop: messages.length > 0 ? '1px solid var(--border)' : 'none' }}>
          {messages.length === 0 && (
            <div className="text-xs mb-2 px-1" style={{ color: 'var(--muted-foreground)' }}>
              {INTRO[kind]}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={messages.length === 0 ? PLACEHOLDERS[kind] : 'Type your reply…'}
              rows={messages.length === 0 ? 2 : 1}
              disabled={busy}
              className="flex-1 resize-none text-sm outline-none rounded-lg px-3 py-2"
              style={{
                background: 'var(--input)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void submit()
                }
              }}
            />
            <button
              onClick={() => void submit()}
              disabled={!input.trim() || busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-colors disabled:opacity-50"
              style={{
                background: 'var(--accent)',
                color: 'var(--accent-foreground)',
                border: '1px solid var(--border)',
              }}
              aria-label="Send"
            >
              <Send size={12} />
              {busy ? 'Drafting…' : 'Send'}
            </button>
          </div>
          <div className="text-[11px] mt-1.5 px-1" style={{ color: 'var(--muted-foreground)' }}>
            ↵ to send · ⇧↵ for new line
          </div>
        </div>
      )}

      {error && (
        <div
          className="text-xs px-4 py-2"
          style={{ background: 'var(--destructive)', color: 'var(--destructive-foreground)' }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

// ---------- Draft preview card ----------

function DraftPreview({
  kind,
  draft,
  onChange,
  onSave,
  saving,
  onDiscard,
}: {
  kind: Kind
  draft: Draft
  onChange: (d: Draft) => void
  onSave: () => void | Promise<void>
  saving: boolean
  onDiscard: () => void
}) {
  const set = (key: string, value: unknown) => onChange({ ...draft, [key]: value })

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
      <span>{label}</span>
      <div style={{ color: 'var(--foreground)' }}>{children}</div>
    </label>
  )

  const inputStyle: React.CSSProperties = {
    background: 'var(--input)',
    color: 'var(--foreground)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 13,
    width: '100%',
  }

  return (
    <div className="px-4 py-3 flex flex-col gap-3" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
        Draft preview
      </div>

      {kind === 'scheduled' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input style={inputStyle} value={String(draft.name ?? '')} onChange={e => set('name', e.target.value)} />
          </Field>
          <Field label="Cron expression">
            <input style={inputStyle} value={String(draft.cronExpr ?? '')} placeholder="0 9 * * 1-5" onChange={e => set('cronExpr', e.target.value || null)} />
          </Field>
          <Field label="Run at (one-shot, ISO)">
            <input
              style={inputStyle}
              value={draft.runAt ? new Date(Number(draft.runAt)).toISOString() : ''}
              placeholder="(leave empty for recurring)"
              onChange={e => {
                const v = e.target.value.trim()
                set('runAt', v ? Date.parse(v) || null : null)
              }}
            />
          </Field>
          <Field label="Target">
            <input style={inputStyle} value={String(draft.target ?? 'new')} onChange={e => set('target', e.target.value)} />
          </Field>
          <div className="col-span-2">
            <Field label="Prompt the agent will run">
              <textarea
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' as const }}
                value={String(draft.prompt ?? '')}
                onChange={e => set('prompt', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Enabled">
            <select style={inputStyle} value={String(Boolean(draft.enabled))} onChange={e => set('enabled', e.target.value === 'true')}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </Field>
          <Field label="Delete after run">
            <select style={inputStyle} value={String(Boolean(draft.deleteAfterRun))} onChange={e => set('deleteAfterRun', e.target.value === 'true')}>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </Field>
        </div>
      )}

      {kind === 'hook' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input style={inputStyle} value={String(draft.name ?? '')} onChange={e => set('name', e.target.value)} />
          </Field>
          <Field label="Event">
            <input style={inputStyle} value={String(draft.event ?? '')} onChange={e => set('event', e.target.value)} />
          </Field>
          <Field label="Type">
            <select style={inputStyle} value={String(draft.type ?? 'prompt')} onChange={e => set('type', e.target.value)}>
              <option value="prompt">prompt</option>
              <option value="skill">skill</option>
              <option value="tool">tool</option>
            </select>
          </Field>
          <Field label="Enabled">
            <select style={inputStyle} value={String(Boolean(draft.enabled))} onChange={e => set('enabled', e.target.value === 'true')}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="Config (JSON)">
              <textarea
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' as const, fontFamily: 'ui-monospace, Menlo, monospace' }}
                value={JSON.stringify(draft.config ?? {}, null, 2)}
                onChange={e => {
                  try { set('config', JSON.parse(e.target.value)) } catch { /* ignore parse error while typing */ }
                }}
              />
            </Field>
          </div>
        </div>
      )}

      {kind === 'standing-order' && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input style={inputStyle} value={String(draft.name ?? '')} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="Scope">
              <input style={inputStyle} value={String(draft.scope ?? 'global')} onChange={e => set('scope', e.target.value)} />
            </Field>
          </div>
          <Field label="Body">
            <textarea
              rows={4}
              style={{ ...inputStyle, resize: 'vertical' as const }}
              value={String(draft.body ?? '')}
              onChange={e => set('body', e.target.value)}
            />
          </Field>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-1">
        <button
          onClick={onDiscard}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs transition-colors"
          style={{ background: 'transparent', color: 'var(--muted-foreground)', border: '1px solid var(--border)' }}
        >
          <X size={12} /> Discard
        </button>
        <button
          onClick={() => void onSave()}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs transition-colors disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--accent-foreground)', border: '1px solid var(--border)' }}
        >
          <Check size={12} /> {saving ? 'Saving…' : 'Save automation'}
        </button>
      </div>
    </div>
  )
}
