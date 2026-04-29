import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, ChevronDown, Zap, Shield, BookOpen, Search } from 'lucide-react'
import { useAgentStore } from '../../../store/agentStore'
import { useWorkspaceStore } from '../../../store/workspaceStore'
import { useSettingsStore } from '../../../store/settingsStore'
import { cn } from '../../../lib/utils'
import { MicButton } from './MicButton'
import type { FileAttachment } from '../../../types'
import { ModelPickerModal } from './ModelPickerModal'

interface HomeViewProps {
  onSendMessage: (message: string, attachments?: FileAttachment[]) => void
  initialDraft?: string
  onDraftConsumed?: () => void
}

function NoWorkspacePromptHome({ onClose }: { onClose: () => void }) {
  const { workspaces, addWorkspace, setActiveWorkspace } = useWorkspaceStore()
  const hasWorkspaces = workspaces.length > 0
  return (
    <div className="px-3 py-3 flex flex-col gap-2">
      <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
        {hasWorkspaces ? 'No workspace is active. Pick one to browse files:' : 'No workspace selected. Add one to browse files:'}
      </div>
      {hasWorkspaces && (
        <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
          {workspaces.map(ws => (
            <button
              key={ws.id}
              onMouseDown={async () => { await setActiveWorkspace(ws.id); onClose() }}
              className="text-left px-2 py-1 rounded text-xs"
              style={{ color: 'var(--foreground)', background: 'transparent' }}
            >
              {ws.name}
            </button>
          ))}
        </div>
      )}
      <button
        onMouseDown={async () => { await addWorkspace(); onClose() }}
        className="text-left px-2 py-1 rounded text-xs flex items-center gap-1.5"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
      >
        <Plus size={11} />
        <span>Add workspace folder…</span>
      </button>
    </div>
  )
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

const SLASH_COMMANDS = [
  { id: 'plan',    hint: '/plan',    desc: 'Switch to plan mode' },
  { id: 'yolo',   hint: '/yolo',    desc: 'Fully autonomous — no interruptions' },
  { id: 'default', hint: '/default', desc: 'Switch to default mode' },
  { id: 'model',  hint: '/model',   desc: 'Choose AI model' },
  { id: 'clear',  hint: '/clear',   desc: 'Clear input and attachments' },
  { id: 'file',   hint: '/file',    desc: 'Attach a workspace file' },
  { id: 'help',   hint: '/help',    desc: 'Show all commands' },
] as const

type MeetingChip = { id: string; title: string; date?: string }

export function HomeView({ onSendMessage, initialDraft, onDraftConsumed }: HomeViewProps) {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState('default')
  const [showModeDropdown, setShowModeDropdown] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const [meetingChips, setMeetingChips] = useState<MeetingChip[]>([])

  // Slash command state
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)

  // File picker state
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [filePickerQuery, setFilePickerQuery] = useState('')
  const [filePickerResults, setFilePickerResults] = useState<string[]>([])
  const [filePickerIndex, setFilePickerIndex] = useState(0)
  const filePickerSearchRef = useRef<HTMLInputElement>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const partialStartRef = useRef<number>(-1)

  const { defaultMode } = useSettingsStore()
  const { activeWorkspace, workspaces } = useWorkspaceStore()
  const { setMode: storeSetMode, currentModel, setModel } = useAgentStore()

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

  const filteredSlashCmds = SLASH_COMMANDS.filter(c =>
    c.id.startsWith(slashFilter.toLowerCase()) || slashFilter === ''
  )

  const closeMenus = () => {
    setSlashOpen(false)
    setFilePickerOpen(false)
  }

  const resizeTextarea = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const handleModeChange = (id: string) => {
    setMode(id)
    storeSetMode(id)
    setShowModeDropdown(false)
  }

  const openFilePicker = useCallback(async (query = '') => {
    setFilePickerQuery(query)
    setFilePickerOpen(true)
    setFilePickerIndex(0)
    closeMenus()
    const wsId = workspaces.find(w => w.id === activeWorkspace?.id)?.id ?? workspaces[0]?.id
    if (wsId) {
      const res = await window.wos.globWorkspace({ workspaceId: wsId, query })
      setFilePickerResults(res?.files ?? [])
    }
    setTimeout(() => filePickerSearchRef.current?.focus(), 50)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace, workspaces])

  const refreshFileSearch = useCallback(async (q: string) => {
    setFilePickerQuery(q)
    setFilePickerIndex(0)
    const wsId = workspaces.find(w => w.id === activeWorkspace?.id)?.id ?? workspaces[0]?.id
    if (wsId) {
      const res = await window.wos.globWorkspace({ workspaceId: wsId, query: q })
      setFilePickerResults(res?.files ?? [])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace, workspaces])

  const executeSlash = useCallback(async (cmdId: string) => {
    closeMenus()
    setInput('')
    setTimeout(resizeTextarea, 0)
    switch (cmdId) {
      case 'plan':    handleModeChange('plan');    break
      case 'yolo':   handleModeChange('yolo');   break
      case 'default': handleModeChange('default'); break
      case 'model':  setShowModelPicker(true);  break
      case 'file':   void openFilePicker(); break
      case 'clear': {
        setAttachments([])
        setMeetingChips([])
        break
      }
      case 'help':
        setSlashFilter('')
        setSlashIndex(0)
        setSlashOpen(true)
        setInput('/')
        break
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFilePicker])

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInput(val)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'

    // Slash detection
    if (val.startsWith('/')) {
      setSlashFilter(val.slice(1))
      setSlashOpen(true)
      setSlashIndex(0)
    } else {
      setSlashOpen(false)
    }

    // @ detection: open the workspace file typeahead immediately.
    const atMatch = /(?:^|\s)@(\w*)$/.exec(val)
    if (atMatch) {
      const q = atMatch[1] ?? ''
      setSlashOpen(false)
      if (!filePickerOpen) void openFilePicker(q)
      else void refreshFileSearch(q)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (slashOpen && filteredSlashCmds.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => Math.min(i + 1, filteredSlashCmds.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSlashIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter')     { e.preventDefault(); void executeSlash(filteredSlashCmds[slashIndex]?.id ?? ''); return }
      if (e.key === 'Escape')    { e.preventDefault(); closeMenus(); return }
      if (e.key === 'Tab')       { e.preventDefault(); void executeSlash(filteredSlashCmds[slashIndex]?.id ?? ''); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = () => {
    if (!input.trim() && attachments.length === 0) return
    closeMenus()
    storeSetMode(mode)
    let text = input.trim()
    if (meetingChips.length > 0) {
      text += '\n\n[Attached meeting context: ' + meetingChips.map(m => m.title).join(', ') + ']'
    }
    onSendMessage(text, attachments)
    setInput('')
    setAttachments([])
    setMeetingChips([])
    partialStartRef.current = -1
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    const read = await Promise.all(files.map(async f => ({ name: f.name, content: await f.text(), type: f.type })))
    setAttachments(prev => [...prev, ...read])
    e.target.value = ''
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
        <div className="relative">
          {/* Slash command picker */}
          {slashOpen && filteredSlashCmds.length > 0 && (
            <div
              className="absolute bottom-full mb-1.5 left-0 rounded-xl overflow-hidden z-50 py-1"
              style={{
                background: 'var(--popover)',
                border: '1px solid var(--border)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                minWidth: '240px',
              }}
            >
              {filteredSlashCmds.map((cmd, i) => (
                <button
                  key={cmd.id}
                  onMouseDown={e => { e.preventDefault(); void executeSlash(cmd.id) }}
                  className="w-full text-left px-3 py-2 flex items-center gap-3 transition-colors"
                  style={{
                    background: i === slashIndex ? 'var(--accent)' : 'transparent',
                    color: 'var(--foreground)',
                  }}
                >
                  <span className="font-mono text-xs shrink-0" style={{ color: 'var(--muted-foreground)', minWidth: '72px' }}>{cmd.hint}</span>
                  <span style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>{cmd.desc}</span>
                </button>
              ))}
            </div>
          )}

          <div
            className="rounded-2xl overflow-visible"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            {/* Attachments row */}
            {(attachments.length > 0 || meetingChips.length > 0) && (
              <div className="flex flex-wrap gap-1.5 px-4 pt-3">
                {attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs"
                    style={{ background: 'var(--accent)', color: 'var(--muted-foreground)', border: '1px solid var(--border)' }}>
                    <span className="max-w-[120px] truncate">{a.name}</span>
                    <button onClick={() => setAttachments(p => p.filter((_, j) => j !== i))} className="ml-0.5 opacity-60 hover:opacity-100">✕</button>
                  </div>
                ))}
                {meetingChips.map(m => (
                  <div key={m.id} className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs"
                    style={{ background: 'var(--accent)', color: 'var(--muted-foreground)', border: '1px solid var(--border)' }}>
                    <span className="max-w-[120px] truncate">📅 {m.title}</span>
                    <button onClick={() => setMeetingChips(p => p.filter(x => x.id !== m.id))} className="ml-0.5 opacity-60 hover:opacity-100">✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* Textarea */}
            <div className="px-4 pt-3 pb-1">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder="Plan, build, or ask anything… (type / or @)"
                autoFocus
                className="w-full bg-transparent outline-none resize-none leading-relaxed"
                style={{ minHeight: '68px', maxHeight: '200px', fontSize: '13px', color: 'var(--foreground)' }}
                rows={3}
              />
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-1.5 px-3 pb-3 pt-1">
              <button
                onClick={() => void openFilePicker()}
                className="w-5 h-5 rounded flex items-center justify-center wos-hover transition-colors"
                style={{ color: 'var(--muted-foreground)' }}
                title="Attach file"
              >
                <Plus size={13} />
              </button>

              {/* Mode picker */}
              <div className="relative">
                <button
                  onClick={() => setShowModeDropdown(o => !o)}
                  className="flex items-center gap-0.5 px-2 py-1 rounded-lg wos-hover transition-colors"
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
                        className="w-full text-left px-3 py-2 wos-hover transition-colors flex items-center gap-2"
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

              <MicButton
                onPartial={(text) => {
                  const trimmed = text.trim()
                  if (!trimmed) return
                  setInput(prev => {
                    if (partialStartRef.current < 0) partialStartRef.current = prev.length
                    return prev.slice(0, partialStartRef.current) + trimmed
                  })
                  setTimeout(resizeTextarea, 0)
                }}
                onCommitText={(text) => {
                  const el = textareaRef.current
                  const t = text.trim()
                  partialStartRef.current = -1
                  if (!t) return
                  if (!el) {
                    setInput(prev => (prev ? prev + ' ' : '') + t)
                    return
                  }
                  const start = el.selectionStart ?? input.length
                  const end = el.selectionEnd ?? input.length
                  const before = input.slice(0, start)
                  const after = input.slice(end)
                  const needsSpace = before.length > 0 && !/\s$/.test(before)
                  const insert = (needsSpace ? ' ' : '') + t + (after && !/^\s/.test(after) ? ' ' : '')
                  const next = before + insert + after
                  setInput(next)
                  requestAnimationFrame(() => {
                    el.focus()
                    el.style.height = 'auto'
                    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
                    const caret = (before + insert).length
                    try { el.setSelectionRange(caret, caret) } catch { /* ignore */ }
                  })
                }}
              />

              {/* Send */}
              <button
                onClick={input.trim() || attachments.length > 0 ? handleSend : undefined}
                disabled={!input.trim() && attachments.length === 0}
                className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center transition-all',
                  (input.trim() || attachments.length > 0)
                    ? 'bg-white text-black hover:bg-[#e8e8e8]'
                    : 'opacity-50 cursor-not-allowed'
                )}
                style={{ color: (input.trim() || attachments.length > 0) ? undefined : 'var(--muted-foreground)' }}
                aria-label="Send"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </div>
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

        {/* Hidden file input (OS fallback) */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

      {/* Workspace file picker popup */}
      {filePickerOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}
          onMouseDown={e => { if (e.target === e.currentTarget) setFilePickerOpen(false) }}>
          <div className="rounded-xl overflow-hidden flex flex-col" style={{ background: 'var(--popover)', border: '1px solid var(--border)', boxShadow: '0 24px 60px rgba(0,0,0,0.7)', width: '440px', maxHeight: '360px' }}>
            <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
              <Search size={13} style={{ color: 'var(--muted-foreground)' }} />
              <input
                ref={filePickerSearchRef}
                value={filePickerQuery}
                onChange={e => void refreshFileSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setFilePickerIndex(i => Math.min(i + 1, filePickerResults.length - 1)) }
                  if (e.key === 'ArrowUp')   { e.preventDefault(); setFilePickerIndex(i => Math.max(i - 1, 0)) }
                  if (e.key === 'Enter' && filePickerResults[filePickerIndex]) {
                    const f = filePickerResults[filePickerIndex]
                    setAttachments(prev => [...prev, { name: f, content: `[File: ${f}]`, type: 'text/plain' }])
                    setFilePickerOpen(false)
                  }
                  if (e.key === 'Escape') setFilePickerOpen(false)
                }}
                placeholder="Search workspace files…"
                className="flex-1 text-xs outline-none bg-transparent"
                style={{ color: 'var(--foreground)' }}
              />
            </div>
            <div className="overflow-y-auto flex-1">
              {!workspaces[0] && (
                <NoWorkspacePromptHome onClose={() => setFilePickerOpen(false)} />
              )}
              {workspaces[0] && filePickerResults.length === 0 && (
                <div className="px-3 py-6 text-center text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  No files found — try a different search
                </div>
              )}
              {filePickerResults.map((f, i) => (
                <button key={f} onMouseDown={() => {
                  setAttachments(prev => [...prev, { name: f, content: `[File: ${f}]`, type: 'text/plain' }])
                  setFilePickerOpen(false)
                }}
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors"
                  style={{ background: i === filePickerIndex ? 'var(--accent)' : 'transparent', color: 'var(--foreground)' }}>
                  <span style={{ color: 'var(--muted-foreground)', fontSize: '10px' }}>📄</span>
                  <span className="font-mono truncate">{f}</span>
                </button>
              ))}
              <button onMouseDown={() => { fileInputRef.current?.click(); setFilePickerOpen(false) }}
                className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors border-t"
                style={{ color: 'var(--secondary-foreground)', borderColor: 'var(--border)' }}>
                <Plus size={12} /> Browse computer…
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Model picker modal */}
      {showModelPicker && (
        <ModelPickerModal
          current={currentModel ?? 'claude-sonnet-4-6'}
          onSelect={id => { setModel(id) }}
          onClose={() => setShowModelPicker(false)}
        />
      )}
    </div>
  )
}
