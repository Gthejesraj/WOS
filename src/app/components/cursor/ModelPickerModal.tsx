import { useState } from 'react'
import { Cpu, X } from 'lucide-react'

type ProviderTab = 'anthropic' | 'openai' | 'wos'

export const MODEL_LIST = [
  { id: 'claude-opus-4-7',   name: 'Claude Opus 4.7',   provider: 'anthropic' as ProviderTab, desc: 'Strongest reasoning & analysis' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic' as ProviderTab, desc: 'Best balance of speed & quality' },
  { id: 'claude-haiku-4-5',  name: 'Claude Haiku 4.5',  provider: 'anthropic' as ProviderTab, desc: 'Fastest, great for quick tasks' },
  { id: 'gpt-5.4',           name: 'GPT-5.4',           provider: 'openai'    as ProviderTab, desc: 'OpenAI flagship model' },
  { id: 'gpt-5.3-codex',     name: 'GPT-5.3 Codex',     provider: 'openai'    as ProviderTab, desc: 'Optimised for code generation' },
  { id: 'gpt-4o',            name: 'GPT-4o',             provider: 'openai'    as ProviderTab, desc: 'Fast multimodal model' },
  { id: 'gpt-4o-mini',       name: 'GPT-4o Mini',       provider: 'openai'    as ProviderTab, desc: 'Compact & cost-effective' },
  { id: 'o3',                name: 'o3',                 provider: 'openai'    as ProviderTab, desc: 'Advanced reasoning model' },
  { id: 'o4-mini',           name: 'o4-mini',            provider: 'openai'    as ProviderTab, desc: 'Compact reasoning model' },
  // ── Qwen 2.5-32B ──────────────────────────────────────────────────────────
  { id: 'wos-coding',          name: 'WOS Coding',              provider: 'wos' as ProviderTab, desc: 'Fine-tuned on 60k coding examples · Qwen2.5-32B' },
  { id: 'wos-meeting',         name: 'WOS Meeting',             provider: 'wos' as ProviderTab, desc: 'Fine-tuned on 22k meeting transcripts · Qwen2.5-32B' },
  { id: 'wos-main',            name: 'WOS Main',                provider: 'wos' as ProviderTab, desc: 'General assistant fine-tune · Qwen2.5-32B' },
  // ── Mixtral 8x7B ──────────────────────────────────────────────────────────
  { id: 'wos-coding-mixtral',  name: 'WOS Coding (Mixtral)',    provider: 'wos' as ProviderTab, desc: 'Fine-tuned on 60k coding examples · Mixtral 8x7B' },
  { id: 'wos-meeting-mixtral', name: 'WOS Meeting (Mixtral)',   provider: 'wos' as ProviderTab, desc: 'Fine-tuned on 22k meeting transcripts · Mixtral 8x7B' },
  { id: 'wos-main-mixtral',    name: 'WOS Main (Mixtral)',      provider: 'wos' as ProviderTab, desc: 'General assistant fine-tune · Mixtral 8x7B' },
  // ── Gemma 2-27B ───────────────────────────────────────────────────────────
  { id: 'wos-coding-gemma',    name: 'WOS Coding (Gemma)',      provider: 'wos' as ProviderTab, desc: 'Fine-tuned on 60k coding examples · Gemma 2-27B' },
  { id: 'wos-meeting-gemma',   name: 'WOS Meeting (Gemma)',     provider: 'wos' as ProviderTab, desc: 'Fine-tuned on 22k meeting transcripts · Gemma 2-27B' },
  { id: 'wos-main-gemma',      name: 'WOS Main (Gemma)',        provider: 'wos' as ProviderTab, desc: 'General assistant fine-tune · Gemma 2-27B' },
  // ── Baseline ──────────────────────────────────────────────────────────────
  { id: 'qwen-baseline',       name: 'Qwen2.5-32B (Baseline)',  provider: 'wos' as ProviderTab, desc: 'Untuned baseline via Together AI' },
]

const PROVIDER_LABELS: Record<ProviderTab, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  wos: 'WOS Fine-tuned',
}

export function ModelPickerModal({ current, onSelect, onClose }: {
  current: string
  onSelect: (modelId: string) => void | Promise<void>
  onClose: () => void
}) {
  const [provider, setProvider] = useState<ProviderTab>(
    (MODEL_LIST.find(m => m.id === current)?.provider as ProviderTab) ?? 'anthropic'
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
          {(['anthropic', 'openai', 'wos'] as ProviderTab[]).map(p => (
            <button
              key={p}
              onMouseDown={() => setProvider(p)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                background: provider === p ? 'var(--primary)' : 'var(--card)',
                color: provider === p ? 'white' : 'var(--muted-foreground)',
                border: '1px solid var(--border)',
              }}
            >
              {PROVIDER_LABELS[p]}
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium" style={{ color: 'var(--foreground)' }}>{m.name}</span>
                    {m.id === current && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(var(--primary-rgb,99,102,241),0.15)', color: 'var(--primary)' }}>
                        Current
                      </span>
                    )}
                    {m.provider === 'wos' && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>
                        RunPod
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
