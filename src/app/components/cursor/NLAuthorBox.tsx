import { useState } from 'react'
import { Send } from 'lucide-react'

type AuthorKind = 'scheduled' | 'hook' | 'standing-order'

const PLACEHOLDERS: Record<AuthorKind, string> = {
  scheduled: 'Every weekday at 9am, summarise yesterday\'s Jira activity into the daily-standup conversation.',
  hook: 'When a new conversation starts, run the workspace-warmup skill.',
  'standing-order': 'Always confirm before sending email or modifying calendar events outside working hours.',
}

interface NLAuthorBoxProps {
  kind: AuthorKind
  onDraft?: (draft: Record<string, unknown>) => void
}

export function NLAuthorBox({ kind, onDraft }: NLAuthorBoxProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await (window as any).wos.automations.authorAutomation(kind, text.trim())
      if (!result?.ok) {
        setError(result?.error ?? 'Could not draft automation.')
        return
      }
      onDraft?.(result.draft ?? {})
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-2"
      style={{ border: '1px solid var(--border)', background: 'var(--card)' }}
    >
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={PLACEHOLDERS[kind]}
        rows={2}
        disabled={busy}
        className="w-full resize-none text-sm outline-none bg-transparent"
        style={{ color: 'var(--foreground)' }}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
          ⌘↵ to draft from prompt
        </span>
        <button
          onClick={() => void submit()}
          disabled={!text.trim() || busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors disabled:opacity-50"
          style={{
            background: 'var(--accent)',
            color: 'var(--accent-foreground)',
            border: '1px solid var(--border)',
          }}
        >
          <Send size={12} />
          {busy ? 'Drafting…' : 'Draft'}
        </button>
      </div>
      {error && (
        <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
          {error}
        </div>
      )}
    </div>
  )
}
