/**
 * Cross-conversation semantic memory service.
 *
 * Stores key facts extracted from completed turns as plain text entries in
 * SQLite. Retrieval uses simple keyword matching (no vectors required).
 * Designed to be upgraded to sqlite-vec cosine search later without changing
 * the calling API.
 */
import { execRaw, runRaw, queryRaw } from '../db'

export interface MemoryEntry {
  id: string
  content: string
  tags: string[]
  importance: number
  source: 'auto' | 'manual'
  createdAt: number
}

let _schemaCreated = false

function ensureSchema(): void {
  if (_schemaCreated) return
  execRaw(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      importance INTEGER DEFAULT 1,
      source TEXT DEFAULT 'auto',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_created ON memory_entries(created_at);
  `)
  _schemaCreated = true
}

/** Store a memory entry. */
export function writeMemory(
  content: string,
  tags: string[] = [],
  importance: 1 | 2 | 3 = 1,
  source: 'auto' | 'manual' = 'auto',
): void {
  if (!content.trim()) return
  ensureSchema()
  const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  runRaw(
    'INSERT INTO memory_entries (id, content, tags, importance, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, content.trim(), JSON.stringify(tags), importance, source, Date.now()]
  )
}

type MemoryRow = { id: string; content: string; tags: string; importance: number; source: string; created_at: number }

/** Retrieve the most relevant memories for a query using keyword scoring. */
export function recallMemories(query: string, limit = 5): MemoryEntry[] {
  ensureSchema()
  const rows = queryRaw<MemoryRow>(
    'SELECT * FROM memory_entries ORDER BY importance DESC, created_at DESC LIMIT 200'
  )

  if (rows.length === 0) return []

  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  if (queryWords.length === 0) {
    return rows.slice(0, limit).map(toEntry)
  }

  const scored = rows.map(row => {
    const text = row.content.toLowerCase()
    let score = 0
    for (const word of queryWords) {
      if (text.includes(word)) score += 1
    }
    score += row.importance * 0.5
    return { row, score }
  })

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => toEntry(s.row))
}

function toEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    content: row.content,
    tags: JSON.parse(row.tags || '[]') as string[],
    importance: row.importance,
    source: row.source as 'auto' | 'manual',
    createdAt: row.created_at,
  }
}

/** Remove old low-importance memories to keep the store bounded. */
export function pruneOldMemories(maxEntries = 1000): void {
  ensureSchema()
  const rows = queryRaw<{ n: number }>('SELECT COUNT(*) as n FROM memory_entries')
  const count = rows[0]?.n ?? 0
  if (count <= maxEntries) return
  const cutoff = count - maxEntries
  runRaw(
    `DELETE FROM memory_entries WHERE id IN (
       SELECT id FROM memory_entries WHERE importance = 1
       ORDER BY created_at ASC LIMIT ?
     )`,
    [cutoff]
  )
}

/** Build a <memory> block for injection into system prompts. */
export function buildMemoryBlock(memories: MemoryEntry[]): string {
  if (memories.length === 0) return ''
  const lines = memories.map(m => `- ${m.content}`).join('\n')
  return `<memory>\n${lines}\n</memory>`
}
