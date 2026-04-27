import { useState } from 'react'
import { Cpu, X } from 'lucide-react'

export const MODEL_LIST = [
  { id: 'claude-opus-4-7',   name: 'Claude Opus 4.7',   provider: 'anthropic' as const, desc: 'Strongest reasoning & analysis' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic' as const, desc: 'Best balance of speed & quality' },
  { id: 'claude-haiku-4-5',  name: 'Claude Haiku 4.5',  provider: 'anthropic' as const, desc: 'Fastest, great for quick tasks' },
  { id: 'gpt-5.4',           name: 'GPT-5.4',           provider: 'openai'    as const, desc: 'OpenAI flagship model' },
  { id: 'gpt-5.3-codex',     name: 'GPT-5.3 Codex',     provider: 'openai'    as const, desc: 'Optimised for code generation' },
  { id: 'gpt-4o',            name: 'GPT-4o',             provider: 'openai'    as const, desc: 'Fast multimodal model' },
  { id: 'gpt-4o-mini',       name: 'GPT-4o Mini',       provider: 'openai'    as const, desc: 'Compact & cost-effective' },
  { id: 'o3',                name: 'o3',                 provider: 'openai'    as const, desc: 'Advanced reasoning model' },
  { id: 'o4-mini',           name: 'o4-mini',            provider: 'openai'    as const, desc: 'Compact reasoning model' },
]

export function ModelPickerModal({ current, onSelect, onClose }: {
  current: string
  onSelect: (modelId: string) => void | Promise<void>
  onClose: () => void
}) {
  const [provider, setProvider] = useState<'anthropic' | 'openai'>(
    MODEL_LIST.find(m => m.id === current)?.provider ?? 'anthropic'
  )
  const [selected, setSelected] = useState(current)
  const models = MODEL_LIST.filter(m => m.provider === provider)

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: 'var(--popover)',
          border: '1px solid var(--border)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
          width: '380px',
          maxHeight: '480px',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <Cpu size={14} style={{ color: 'var(--primary)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Choose Model</span>
          </div>
          <button onMouseDown={onClose} style={{ color: 'var(--muted-foreground)' }} className="hover:opacity-70">
            <X size={14} />
          </button>
        </div>

        {/* Provider tabs */}
        <div className="flex gap-1 px-4 pt-3 pb-2">
          {(['anthropic', 'openai'] as const).map(p => (
            <button
              key={p}
              onMouseDown={() => setProvider(p)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors"
              style={{
                background: provider === p ? 'var(--primary)' : 'var(--card)',
                color: provider === p ? 'white' : 'var(--muted-foreground)',
                border: '1px solid var(--border)',
              }}
            >
              {p === 'anthropic' ? 'Anthropic' : 'OpenAI'}
            </button>
          ))}
        </div>

        {/* Model list */}
        <div className="overflow-y-auto flex-1 px-2 pb-2">
          {models.map(m => {
            const isActive = selected === m.id
            return (
              <button
                key={m.id}
                onMouseDown={() => setSelected(m.id)}
                className="w-full text-left px-3 py-2.5 rounded-xl flex items-start gap-3 mb-0.5 transition-colors"
                style={{
                  background: isActive ? 'rgba(var(--primary-rgb, 99, 102, 241), 0.12)' : 'transparent',
                  border: `1px solid ${isActive ? 'var(--primary)' : 'transparent'}`,
                }}
              >
                <div className="mt-0.5 shrink-0 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center"
                  style={{ borderColor: isActive ? 'var(--primary)' : 'var(--border)' }}>
                  {isActive && <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--primary)' }} />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium" style={{ color: 'var(--foreground)' }}>{m.name}</span>
                    {m.id === current && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(var(--primary-rgb,99,102,241),0.15)', color: 'var(--primary)' }}>
                        Current
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--muted-foreground)' }}>{m.desc}</div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 flex gap-2 justify-end" style={{ borderTop: '1px solid var(--border)' }}>
          <button onMouseDown={onClose}
            className="px-3 py-1.5 rounded-lg text-xs transition-colors"
            style={{ color: 'var(--muted-foreground)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
          <button
            onMouseDown={() => { void onSelect(selected); onClose() }}
            className="px-4 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: 'var(--primary)', color: 'white' }}
          >
            Apply Model
          </button>
        </div>
      </div>
    </div>
  )
}
