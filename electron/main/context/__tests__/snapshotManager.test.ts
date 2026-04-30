/**
 * Unit tests for snapshotManager using an in-memory SQLite DB.
 *
 * We bootstrap only the `app_context_snapshots` table (no need for the full
 * WOS schema) and wire `queryRaw`/`runRaw`/`notifyWrite` to that DB via vi.mock
 * so that snapshotManager never touches the real singleton.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

// ─── In-memory DB shared across mocks ─────────────────────────────────────────
let db: Database.Database

function resetDb() {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_context_snapshots (
      app_id    TEXT NOT NULL,
      scope     TEXT NOT NULL,
      data_json TEXT NOT NULL DEFAULT '[]',
      fetched_at INTEGER NOT NULL DEFAULT 0,
      etag      TEXT,
      PRIMARY KEY (app_id, scope)
    )
  `)
}

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../../db', () => ({
  queryRaw: <T>(sql: string, params?: unknown[]): T[] => {
    const stmt = db.prepare(sql)
    return (params ? stmt.all(...params) : stmt.all()) as T[]
  },
  runRaw: (sql: string, params?: unknown[]) => {
    const stmt = db.prepare(sql)
    params ? stmt.run(...params) : stmt.run()
  },
  notifyWrite: () => {},
}))

vi.mock('../../apps/manager', () => ({
  getApp: vi.fn(),
  listConnections: vi.fn(),
}))

// ─── Import SUT after mocks ────────────────────────────────────────────────────
import { getSnapshot, getAllSnapshots, buildSnapshot } from '../snapshotManager'
import { getApp, listConnections } from '../../apps/manager'

const mockGetApp = vi.mocked(getApp)
const _mockListConnections = vi.mocked(listConnections)

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('snapshotManager', () => {
  beforeEach(() => {
    resetDb()
    vi.clearAllMocks()
  })

  describe('getSnapshot', () => {
    it('returns null when no snapshot exists', () => {
      expect(getSnapshot('slack', 'channels')).toBeNull()
    })

    it('returns the stored snapshot row', () => {
      db.prepare(
        `INSERT INTO app_context_snapshots (app_id, scope, data_json, fetched_at) VALUES (?, ?, ?, ?)`
      ).run('slack', 'channels', JSON.stringify([{ id: 'C1', name: 'general' }]), 1000)

      const row = getSnapshot('slack', 'channels')
      expect(row).not.toBeNull()
      expect(row!.appId).toBe('slack')
      expect(row!.scope).toBe('channels')
      expect(row!.data).toEqual([{ id: 'C1', name: 'general' }])
      expect(row!.fetchedAt).toBe(1000)
    })
  })

  describe('getAllSnapshots', () => {
    it('returns empty array when no snapshots', () => {
      expect(getAllSnapshots()).toEqual([])
    })

    it('returns all snapshots sorted by app_id, scope', () => {
      db.prepare(
        `INSERT INTO app_context_snapshots (app_id, scope, data_json, fetched_at) VALUES (?, ?, ?, ?)`
      ).run('slack', 'channels', '[]', 1)
      db.prepare(
        `INSERT INTO app_context_snapshots (app_id, scope, data_json, fetched_at) VALUES (?, ?, ?, ?)`
      ).run('github', 'repos', '[]', 2)

      const rows = getAllSnapshots()
      expect(rows).toHaveLength(2)
      expect(rows[0].appId).toBe('github')
      expect(rows[1].appId).toBe('slack')
    })

    it('filters by appId when provided', () => {
      db.prepare(
        `INSERT INTO app_context_snapshots (app_id, scope, data_json, fetched_at) VALUES (?, ?, ?, ?)`
      ).run('slack', 'channels', '[]', 1)
      db.prepare(
        `INSERT INTO app_context_snapshots (app_id, scope, data_json, fetched_at) VALUES (?, ?, ?, ?)`
      ).run('github', 'repos', '[]', 2)

      const rows = getAllSnapshots('slack')
      expect(rows).toHaveLength(1)
      expect(rows[0].appId).toBe('slack')
    })
  })

  describe('buildSnapshot', () => {
    it('no-ops when app has no snapshot function', async () => {
      mockGetApp.mockReturnValue({ id: 'slack' } as any)
      await buildSnapshot('slack', {})
      expect(getAllSnapshots()).toHaveLength(0)
    })

    it('no-ops when app is not found', async () => {
      mockGetApp.mockReturnValue(undefined)
      await buildSnapshot('unknown', {})
      expect(getAllSnapshots()).toHaveLength(0)
    })

    it('persists each scope returned by the snapshot function', async () => {
      const creds = { token: 'xoxb-test' }
      mockGetApp.mockReturnValue({
        id: 'slack',
        snapshot: async (_creds: Record<string, string>) => ({
          channels: [{ id: 'C1', name: 'general' }],
          users: [{ id: 'U1', name: 'alice' }],
        }),
      } as any)

      await buildSnapshot('slack', creds)

      const channels = getSnapshot('slack', 'channels')
      expect(channels).not.toBeNull()
      expect(channels!.data).toEqual([{ id: 'C1', name: 'general' }])

      const users = getSnapshot('slack', 'users')
      expect(users).not.toBeNull()
      expect(users!.data).toEqual([{ id: 'U1', name: 'alice' }])
    })

    it('upserts on repeated calls', async () => {
      const makeApp = (name: string) => ({
        id: 'github',
        snapshot: async () => ({ repos: [{ full_name: name }] }),
      })

      mockGetApp.mockReturnValue(makeApp('first/repo') as any)
      await buildSnapshot('github', {})
      expect(getSnapshot('github', 'repos')!.data).toEqual([{ full_name: 'first/repo' }])

      mockGetApp.mockReturnValue(makeApp('second/repo') as any)
      await buildSnapshot('github', {})
      expect(getSnapshot('github', 'repos')!.data).toEqual([{ full_name: 'second/repo' }])
      expect(getAllSnapshots('github')).toHaveLength(1)
    })
  })
})
