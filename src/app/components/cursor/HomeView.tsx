import React, { useState, useRef, useEffect } from 'react'
import { Plus, Mic, ChevronDown, Zap, Shield, BookOpen } from 'lucide-react'
import { useAgentStore } from '../../../store/agentStore'
import { useWorkspaceStore } from '../../../store/workspaceStore'
import { useSettingsStore } from '../../../store/settingsStore'
import { cn } from '../../../lib/utils'

interface HomeViewProps {
  onSendMessage: (message: string) => void
  initialDraft?: string
  onDraftConsumed?: () => void
}

const MODES = [
  { id: 'default', label: 'Default', icon: Shield },
  { id: 'plan', label: 'Plan', icon: BookOpen },
  { id: 'yolo', label: 'Yolo', icon: Zap },
] as const

const SUGGESTIONS = [
  'Explain this codebase and suggest improvements',
  'Create a new feature with tests',
  'Find and fix bugs in the project',
  'Refactor the code for better performance',
]

export function HomeView({ onSendMessage, initialDraft, onDraftConsumed }: HomeViewProps) {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState('default')
  const [showModeDropdown, setShowModeDropdown] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { defaultMode } = useSettingsStore()
  const { activeWorkspace } = useWorkspaceStore()
  const { setMode: storeSetMode } = useAgentStore()

  useEffect(() => {
    setMode(defaultMode ?? 'default')
  }, [defaultMode])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!initialDraft) return
    setInput(initialDraft)
    onDraftConsumed?.()
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 200) + 'px'
    })
  }, [initialDraft, onDraftConsumed])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const handleSend = () => {
    if (!input.trim()) return
    storeSetMode(mode)
    onSendMessage(input.trim())
    setInput('')
  }

  const handleModeChange = (id: string) => {
    setMode(id)
    storeSetMode(id)
    setShowModeDropdown(false)
  }

  const activeMode = MODES.find(m => m.id === mode) ?? MODES[0]
  const ModeIcon = activeMode.icon

  return (
    <div
      className="flex flex-col h-full items-center justify-center"
      style={{ background: 'var(--background)' }}
    >
      <div className="w-full max-w-[520px] px-4">

        {/* Greeting */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--foreground)' }}>WOS Agent</h1>
          <p className="text-sm mb-1" style={{ color: 'var(--secondary-foreground)' }}>Start a conversation below.</p>
          {activeWorkspace ? (
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              Working in <span className="font-mono" style={{ color: 'var(--secondary-foreground)' }}>{activeWorkspace.name}</span>
            </p>
          ) : (
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>No workspace selected — tools work without restriction</p>
          )}
        </div>

        {/* Composer */}
        <div
          className="rounded-2xl overflow-visible"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          {/* Textarea */}
          <div className="px-4 pt-3 pb-1">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Plan, build, or ask anything…"
              autoFocus
              className="w-full bg-transparent outline-none resize-none leading-relaxed"
              style={{ minHeight: '68px', maxHeight: '200px', fontSize: '13px', color: 'var(--foreground)' }}
              rows={3}
            />
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-1.5 px-3 pb-3 pt-1">
            <button className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/10 transition-colors" style={{ color: 'var(--muted-foreground)' }}>
              <Plus size={13} />
            </button>

            {/* Mode picker */}
            <div className="relative">
              <button
                onClick={() => setShowModeDropdown(o => !o)}
                className="flex items-center gap-0.5 px-2 py-1 rounded-lg hover:bg-white/8 transition-colors"
                style={{ color: mode === 'yolo' ? 'var(--terracotta)' : 'var(--muted-foreground)', fontSize: '12px' }}
              >
                <ModeIcon size={11} />
                <span className="ml-1">{activeMode.label}</span>
                <ChevronDown size={10} className="ml-0.5" />
              </button>
              {showModeDropdown && (
                <div
                  className="absolute bottom-full mb-1.5 left-0 rounded-xl overflow-hidden z-50 py-1"
                  style={{
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    minWidth: '200px',
                  }}
                >
                  {MODES.map(m => (
                    <button
                      key={m.id}
                      onClick={() => handleModeChange(m.id)}
                      className="w-full text-left px-3 py-2 hover:bg-white/8 transition-colors flex items-center gap-2"
                      style={{
                        fontSize: '12px',
                        color: mode === m.id ? 'var(--foreground)' : 'var(--muted-foreground)',
                      }}
                    >
                      <m.icon size={12} />
                      <span>{m.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1" />

            {/* Send */}
            <button
              onClick={input.trim() ? handleSend : undefined}
              className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center transition-all',
                input.trim()
                  ? 'bg-white text-black hover:bg-[#e8e8e8]'
                  : 'hover:bg-white/8'
              )}
              style={{ color: input.trim() ? undefined : 'var(--muted-foreground)' }}
            >
              {input.trim() ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              ) : (
                <Mic size={11} />
              )}
            </button>
          </div>
        </div>

        {/* Suggestion pills */}
        <div className="flex flex-wrap gap-2 mt-3">
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              onClick={() => onSendMessage(s)}
              className="px-3 py-1.5 rounded-lg transition-colors text-left"
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                color: 'var(--muted-foreground)',
                fontSize: '11px',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-strong)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)' }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
