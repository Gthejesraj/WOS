/**
 * Unit tests for the projects manager using an in-memory SQLite DB.
 *
 * Mirrors the snapshotManager test pattern: mock `../../db` so manager.ts
 * speaks to a per-test in-memory database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

let db: Database.Database

function resetDb() {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      icon TEXT, color TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      owner_email TEXT, description TEXT, summary TEXT,
      health_score INTEGER, risk_level TEXT, model_override TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER
    );
    CREATE TABLE project_resources (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL,
      ref TEXT NOT NULL, label TEXT NOT NULL, description TEXT,
      added_at INTEGER NOT NULL, last_fetched_at INTEGER, refresh_interval_sec INTEGER
    );
    CREATE TABLE project_widgets (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, tab TEXT NOT NULL,
      widget_kind TEXT NOT NULL, config_json TEXT,
      x INTEGER NOT NULL DEFAULT 0, y INTEGER NOT NULL DEFAULT 0,
      w INTEGER NOT NULL DEFAULT 4, h INTEGER NOT NULL DEFAULT 3,
      hidden INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE project_alerts (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, rule_kind TEXT NOT NULL,
      config_json TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      severity TEXT NOT NULL DEFAULT 'important', last_fired_at INTEGER
    );
    CREATE TABLE project_summaries (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL,
      body TEXT NOT NULL, model_used TEXT,
      tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
      generated_at INTEGER NOT NULL, source_fingerprint TEXT
    );
    CREATE TABLE project_activity (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      source_app TEXT NOT NULL, source_kind TEXT NOT NULL,
      ts INTEGER NOT NULL, actor TEXT, title TEXT NOT NULL, url TEXT,
      payload_json TEXT, dedupe_key TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_project_activity_dedupe ON project_activity(project_id, dedupe_key);
    CREATE TABLE project_metrics (
      project_id TEXT NOT NULL, metric_key TEXT NOT NULL, ts INTEGER NOT NULL,
      value INTEGER NOT NULL, unit TEXT,
      PRIMARY KEY (project_id, metric_key, ts)
    );
    CREATE TABLE project_decisions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
      body TEXT, decided_at INTEGER NOT NULL, decided_by TEXT, linked_activity_id TEXT
    );
    CREATE TABLE project_risks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
      description TEXT, severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'open', owner TEXT, mitigation TEXT,
      created_at INTEGER NOT NULL, resolved_at INTEGER
    );
  `)
}

vi.mock('../../db', () => ({
  queryRaw: <T>(sql: string, params?: unknown[]): T[] => {
    const stmt = db.prepare(sql)
    return (params ? stmt.all(...(params as unknown[])) : stmt.all()) as T[]
  },
  runRaw: (sql: string, params?: unknown[]) => {
    const stmt = db.prepare(sql)
    params ? stmt.run(...(params as unknown[])) : stmt.run()
  },
  notifyWrite: () => {},
}))

import {
  createProject,
  getProject,
  getProjectBySlug,
  findProjectsByName,
  listProjects,
  updateProject,
  deleteProject,
  setProjectPinned,
  setProjectStatus,
  addResource,
  listResources,
  removeResource,
  recordActivity,
  listActivity,
  addRisk,
  listRisks,
  addDecision,
  listDecisions,
  addAlert,
  listAlerts,
  markAlertFired,
} from '../manager'

describe('projects/manager', () => {
  beforeEach(() => { resetDb() })

  describe('CRUD + slug', () => {
    it('creates with derived unique slug', () => {
      const a = createProject({ name: 'Atlas Mobile' })
      const b = createProject({ name: 'Atlas Mobile' })
      expect(a.slug).toBe('atlas-mobile')
      expect(b.slug).not.toBe(a.slug)
      expect(b.slug.startsWith('atlas-mobile')).toBe(true)
    })

    it('reads by id, slug, and partial name', () => {
      const p = createProject({ name: 'Beacon Web' })
      expect(getProject(p.id)?.id).toBe(p.id)
      expect(getProjectBySlug('beacon-web')?.id).toBe(p.id)
      expect(findProjectsByName('beac').map(x => x.id)).toContain(p.id)
    })

    it('updates fields and bumps updated_at', async () => {
      const p = createProject({ name: 'Comet' })
      await new Promise(r => setTimeout(r, 5))
      const u = updateProject(p.id, { description: 'hi', healthScore: 80 })
      expect(u.description).toBe('hi')
      expect(u.healthScore).toBe(80)
      expect(u.updatedAt).toBeGreaterThanOrEqual(p.updatedAt)
    })

    it('archive sets archivedAt; pinned + status helpers work', () => {
      const p = createProject({ name: 'Delta' })
      expect(setProjectPinned(p.id, true).pinned).toBe(true)
      const arch = setProjectStatus(p.id, 'archived')
      expect(arch.status).toBe('archived')
      expect(arch.archivedAt).not.toBeNull()
    })

    it('listProjects hides archived by default; orders by pinned then updated_at', () => {
      const a = createProject({ name: 'Alpha' })
      const b = createProject({ name: 'Bravo' })
      setProjectPinned(b.id, true)
      setProjectStatus(a.id, 'archived')
      const visible = listProjects()
      expect(visible.map(p => p.id)).toEqual([b.id])
      const all = listProjects({ includeArchived: true })
      expect(all.length).toBe(2)
      expect(all[0]!.id).toBe(b.id) // pinned first
    })
  })

  describe('cascade delete', () => {
    it('removes all child rows when a project is deleted', () => {
      const p = createProject({ name: 'Echo' })
      addResource(p.id, { kind: 'note', label: 'spec', ref: { text: 'x' } })
      recordActivity({ projectId: p.id, sourceApp: 'native', sourceKind: 'note', ts: 1, title: 't', dedupeKey: 'k1' })
      addRisk(p.id, { title: 'rsk', severity: 'high', status: 'open', description: null, owner: null, mitigation: null })
      addDecision(p.id, { title: 'dec' })
      addAlert(p.id, { ruleKind: 'no_activity', config: { days: 5 } })
      deleteProject(p.id)
      expect(getProject(p.id)).toBeNull()
      expect(listResources(p.id)).toEqual([])
      expect(listActivity(p.id)).toEqual([])
      expect(listRisks(p.id)).toEqual([])
      expect(listDecisions(p.id)).toEqual([])
      expect(listAlerts(p.id)).toEqual([])
    })
  })

  describe('resources + activity', () => {
    it('addResource → listResources → removeResource', () => {
      const p = createProject({ name: 'Foxtrot' })
      const r = addResource(p.id, { kind: 'github:repo', label: 'wos', ref: 'a/b' })
      expect(listResources(p.id)).toHaveLength(1)
      removeResource(r.id)
      expect(listResources(p.id)).toEqual([])
    })

    it('recordActivity dedupes by dedupeKey', () => {
      const p = createProject({ name: 'Golf' })
      recordActivity({ projectId: p.id, sourceApp: 'github', sourceKind: 'pr', ts: 1, title: 'first', dedupeKey: 'same' })
      recordActivity({ projectId: p.id, sourceApp: 'github', sourceKind: 'pr', ts: 2, title: 'dup', dedupeKey: 'same' })
      const acts = listActivity(p.id)
      expect(acts).toHaveLength(1)
      expect(acts[0]!.title).toBe('first')
    })

    it('listActivity respects since + limit', () => {
      const p = createProject({ name: 'Hotel' })
      for (let i = 0; i < 5; i++) {
        recordActivity({ projectId: p.id, sourceApp: 'native', sourceKind: 'note', ts: i + 1, title: `t${i}`, dedupeKey: `d${i}` })
      }
      expect(listActivity(p.id, { since: 3 })).toHaveLength(3)
      expect(listActivity(p.id, { limit: 2 })).toHaveLength(2)
    })
  })

  describe('alerts', () => {
    it('markAlertFired updates lastFiredAt', () => {
      const p = createProject({ name: 'India' })
      const a = addAlert(p.id, { ruleKind: 'no_activity', config: { days: 5 } })
      markAlertFired(a.id, 12345)
      const updated = listAlerts(p.id)[0]!
      expect(updated.lastFiredAt).toBe(12345)
    })
  })
})
