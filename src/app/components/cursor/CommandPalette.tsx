import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'

export interface CommandItem {
  id: string
  label: string
  hint?: string
  run: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  commands: CommandItem[]
}

/**
 * ⌘K / Ctrl+K command palette.
 * Fuzzy filter (simple substring, case-insensitive) over command labels + hints.
 */
export function CommandPalette({ open, onClose, commands }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) || (c.hint?.toLowerCase().includes(q) ?? false)
    )
  }, [query, commands])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(filtered.length - 1, s + 1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(0, s - 1)) }
      if (e.key === 'Enter') {
        const cmd = filtered[selected]
        if (cmd) { cmd.run(); onClose() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, selected, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] max-w-[90vw] rounded-xl overflow-hidden shadow-2xl"
        style={{ background: '#181818', border: '1px solid #2a2a2a' }}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#2a2a2a]">
          <Search size={14} className="text-[#666]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0) }}
            placeholder="Type a command…"
            className="flex-1 bg-transparent outline-none text-sm text-[#eee] placeholder:text-[#555]"
          />
          <span className="text-[10px] text-[#555] font-mono">ESC</span>
        </div>
        <div className="max-h-[40vh] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-[#555]">No matching commands</div>
          )}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setSelected(i)}
              onClick={() => { c.run(); onClose() }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
              style={{ background: i === selected ? '#252525' : 'transparent' }}
            >
              <span className="text-sm text-[#e8e8e8] flex-1">{c.label}</span>
              {c.hint && <span className="text-[10px] text-[#666] font-mono">{c.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
