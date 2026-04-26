import { useEffect, useState, useMemo } from 'react'
import { X, Download, Trash2 } from 'lucide-react'
import { eventLog, type LoggedEvent } from '../../../lib/eventLog'

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * Debug drawer (⌥⌘D / Alt+Ctrl+D): shows a live feed of every AgentEvent
 * received by the renderer. Supports filtering, export, clear.
 */
export function DebugDrawer({ open, onClose }: Props) {
  const [events, setEvents] = useState<LoggedEvent[]>(() => [...eventLog.getAll()])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!open) return
    const unsub = eventLog.subscribe((all) => setEvents([...all]))
    return unsub
  }, [open])

  const filtered = useMemo(() => {
    if (!filter.trim()) return events
    const q = filter.toLowerCase()
    return events.filter(e =>
      e.event.type.toLowerCase().includes(q) ||
      JSON.stringify(e.event).toLowerCase().includes(q)
    )
  }, [events, filter])

  const handleExport = () => {
    const blob = new Blob([eventLog.exportJson()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `wos-events-${Date.now()}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-y-0 right-0 z-40 w-[560px] max-w-[90vw] flex flex-col shadow-2xl"
      style={{ background: '#141414', borderLeft: '1px solid #2a2a2a' }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2a2a2a]">
        <span className="text-xs uppercase tracking-wider text-[#888] font-medium">Debug · Events</span>
        <span className="text-[10px] text-[#555]">{filtered.length}/{events.length}</span>
        <div className="flex-1" />
        <button
          onClick={handleExport}
          title="Export as JSON"
          className="p-1.5 rounded hover:bg-[#252525] text-[#888] hover:text-[#ccc]"
        >
          <Download size={13} />
        </button>
        <button
          onClick={() => eventLog.clear()}
          title="Clear log"
          className="p-1.5 rounded hover:bg-[#252525] text-[#888] hover:text-[#ccc]"
        >
          <Trash2 size={13} />
        </button>
        <button
          onClick={onClose}
          title="Close (⌥⌘D)"
          className="p-1.5 rounded hover:bg-[#252525] text-[#888] hover:text-[#ccc]"
        >
          <X size={13} />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-[#2a2a2a]">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by event type or content…"
          className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-[#ddd] outline-none focus:border-[#3a3a3a] placeholder:text-[#555]"
        />
      </div>

      <div className="flex-1 overflow-y-auto font-mono text-[11px]">
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-[#555]">No events yet</div>
        )}
        {filtered.slice().reverse().map((ev, i) => (
          <div key={`${ev.ts}-${i}`} className="px-3 py-1.5 border-b border-[#1f1f1f] hover:bg-[#1a1a1a]">
            <div className="flex items-center gap-2">
              <span className="text-[#666]">{new Date(ev.ts).toLocaleTimeString()}</span>
              <span className="text-blue-300 font-semibold">{ev.event.type}</span>
            </div>
            <pre className="text-[#888] mt-0.5 whitespace-pre-wrap break-all">
              {JSON.stringify(ev.event, null, 0).slice(0, 400)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  )
}
