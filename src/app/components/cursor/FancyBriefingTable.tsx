import React from 'react'
import { LayoutGrid, Sparkles } from 'lucide-react'

/** Split a markdown pipe row into trimmed cells (GFM style). */
export function splitPipeRow(line: string): string[] {
  const t = line.trim()
  if (!t.includes('|')) return []
  const inner = t.replace(/^\|/, '').replace(/\|$/g, '')
  return inner.split('|').map(c => c.trim())
}

export function isTableSeparatorRow(line: string): boolean {
  const cells = splitPipeRow(line).filter(c => c.length > 0)
  if (cells.length < 2) return false
  return cells.every(c => /^:?-{2,}:?$/.test(c))
}

export type ParsedGFMTable = { headers: string[]; rows: string[][] }

/** If `lines[start]` is a table header and `lines[start+1]` is a separator, return table + index after last table row. */
export function tryParseGFMTable(lines: string[], start: number): { table: ParsedGFMTable; endExclusive: number } | null {
  if (start >= lines.length) return null
  const headerLine = lines[start]
  if (!headerLine.includes('|')) return null
  const headers = splitPipeRow(headerLine)
  if (headers.length < 2) return null
  if (start + 1 >= lines.length) return null
  if (!isTableSeparatorRow(lines[start + 1])) return null

  const rows: string[][] = []
  let j = start + 2
  for (; j < lines.length; j++) {
    const rowLine = lines[j]
    if (rowLine.trim() === '') break
    if (!rowLine.includes('|')) break
    const cells = splitPipeRow(rowLine)
    if (cells.length < 2) break
    rows.push(cells)
  }
  if (rows.length === 0) return null
  return { table: { headers, rows }, endExclusive: j }
}

const ACCENTS = [
  'linear-gradient(135deg, #a855f7, #ec4899)',
  'linear-gradient(135deg, #06b6d4, #3b82f6)',
  'linear-gradient(135deg, #f59e0b, #ef4444)',
  'linear-gradient(135deg, #22c55e, #14b8a6)',
  'linear-gradient(135deg, #eab308, #f97316)',
  'linear-gradient(135deg, #8b5cf6, #6366f1)',
]

function accentForKey(key: string, i: number): string {
  let h = 0
  for (let k = 0; k < key.length; k++) h = (h * 31 + key.charCodeAt(k)) | 0
  return ACCENTS[Math.abs(h + i) % ACCENTS.length]
}

function statusBadgeStyle(cell: string): React.CSSProperties {
  const t = cell.toLowerCase()
  if (t.includes('critical') || t.includes('🔴')) {
    return {
      background: 'linear-gradient(135deg, rgba(239,68,68,0.25), rgba(220,38,38,0.2))',
      color: '#fecaca',
      border: '1px solid rgba(248,113,113,0.45)',
    }
  }
  if (t.includes('pending') || t.includes('⌛') || t.includes('open')) {
    return {
      background: 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(251,191,36,0.12))',
      color: '#fde68a',
      border: '1px solid rgba(251,191,36,0.35)',
    }
  }
  if (t.includes('done') || t.includes('complete') || t.includes('✓')) {
    return {
      background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(16,185,129,0.12))',
      color: '#bbf7d0',
      border: '1px solid rgba(74,222,128,0.35)',
    }
  }
  return {
    background: 'rgba(148,163,184,0.12)',
    color: '#cbd5e1',
    border: '1px solid rgba(148,163,184,0.25)',
  }
}

/** Strip markdown ** from cell for display */
function stripMdBold(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
}

export function FancyBriefingTable({ headers, rows }: ParsedGFMTable) {
  const nCols = Math.max(headers.length, ...rows.map(r => r.length))
  const padRow = (r: string[]) => {
    const x = [...r]
    while (x.length < nCols) x.push('')
    return x.slice(0, nCols)
  }

  return (
    <div
      className="my-4 rounded-2xl overflow-hidden"
      style={{
        border: '1px solid rgba(168,85,247,0.35)',
        boxShadow: '0 0 0 1px rgba(236,72,153,0.12), 0 18px 50px -12px rgba(0,0,0,0.45)',
        background: 'linear-gradient(145deg, rgba(88,28,135,0.35) 0%, rgba(15,23,42,0.92) 45%, rgba(15,23,42,0.98) 100%)',
      }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{
          borderBottom: '1px solid rgba(168,85,247,0.25)',
          background: 'linear-gradient(90deg, rgba(168,85,247,0.2), rgba(236,72,153,0.12), rgba(245,158,11,0.08))',
        }}
      >
        <Sparkles className="h-4 w-4 shrink-0 text-amber-300" />
        <span className="text-xs font-semibold uppercase tracking-widest text-violet-100/90">Briefing board</span>
        <LayoutGrid className="h-3.5 w-3.5 ml-auto text-fuchsia-300/70" />
      </div>

      {/* Kanban-style lanes: one card per row, columns as chips */}
      <div className="p-3 flex gap-3 overflow-x-auto pb-4" style={{ scrollbarWidth: 'thin' }}>
        {rows.map((rawRow, ri) => {
          const row = padRow(rawRow)
          const laneKey = row[0] || `row-${ri}`
          const stripe = accentForKey(laneKey, ri)
          const statusIdx = headers.findIndex(h => /status/i.test(h))

          return (
            <div
              key={ri}
              className="min-w-[220px] max-w-[280px] flex-shrink-0 rounded-xl p-3 flex flex-col gap-2"
              style={{
                border: '1px solid rgba(148,163,184,0.2)',
                background: 'linear-gradient(180deg, rgba(30,41,59,0.85), rgba(15,23,42,0.95))',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
              }}
            >
              <div className="flex items-start gap-2">
                <div className="w-1 self-stretch rounded-full shrink-0" style={{ background: stripe, minHeight: '36px' }} />
                <div className="min-w-0 flex-1 space-y-2">
                  {headers.map((h, hi) => {
                    const val = stripMdBold(row[hi] ?? '')
                    const isStatus = /status/i.test(h)
                    return (
                      <div key={`${ri}-${hi}`}>
                        <div className="text-[10px] font-medium uppercase tracking-wide mb-0.5" style={{ color: '#a5b4fc' }}>
                          {stripMdBold(h)}
                        </div>
                        {isStatus ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-lg text-[11px] font-medium" style={statusBadgeStyle(val)}>
                            {val || '—'}
                          </span>
                        ) : (
                          <div className="text-[12px] leading-snug" style={{ color: '#e2e8f0' }}>
                            {val || '—'}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
