import { drizzle } from 'drizzle-orm/sql-js'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import * as schema from './schema'

type WosDb = ReturnType<typeof drizzle<typeof schema>>

let _db: WosDb | null = null
let _sqlDb: import('sql.js').Database | null = null
let _dbPath = ''
let _dirty = false
let _fts5Available = false

function saveToDisk() {
  if (!_sqlDb || !_dirty) return
  try {
    const data = _sqlDb.export()
    fs.writeFileSync(_dbPath, Buffer.from(data))
    _dirty = false
  } catch (e) {
    console.error('[db] save error', e)
  }
}

function markDirty() {
  _dirty = true
}

export async function initDatabase(): Promise<WosDb> {
  _dbPath = path.join(app.getPath('userData'), 'wos.db')

  // sql.js loads its WASM binary from its own package — works in Node.js/Electron main process
  const initSqlJs = (await import('sql.js')).default
  const SQL = await initSqlJs()

  if (fs.existsSync(_dbPath)) {
    const buf = fs.readFileSync(_dbPath)
    _sqlDb = new SQL.Database(buf)
  } else {
    _sqlDb = new SQL.Database()
    _dirty = true
  }

  _db = drizzle(_sqlDb, { schema })

  // The default sql.js WASM build is compiled WITHOUT the FTS5 extension, so
  // CREATE VIRTUAL TABLE ... USING fts5(...) blows up DB init. Detect support
  // first; if missing, we skip FTS objects and `searchMeetings` falls back to
  // a LIKE query.
  try {
    _sqlDb.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS __wos_fts5_probe USING fts5(t)`)
    _sqlDb.exec(`DROP TABLE __wos_fts5_probe`)
    _fts5Available = true
  } catch {
    _fts5Available = false
    console.warn('[db] FTS5 extension not available in sql.js — falling back to LIKE search for meetings.')
  }

  _sqlDb.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      last_accessed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Conversation',
      workspace_id TEXT,
      model TEXT NOT NULL DEFAULT 'gpt-4o',
      mode TEXT NOT NULL DEFAULT 'default',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      context_limit INTEGER NOT NULL DEFAULT 200000,
      is_compacted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      blocks TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      token_count INTEGER DEFAULT 0,
      branch_group_id TEXT,
      branch_index INTEGER DEFAULT 0,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      provider TEXT PRIMARY KEY,
      encrypted_key TEXT NOT NULL,
      iv TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permission_grants (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      scope TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_connections (
      app_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      encrypted_creds TEXT NOT NULL,
      iv TEXT NOT NULL,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      transport TEXT NOT NULL,
      command TEXT,
      args_json TEXT,
      url TEXT,
      env_encrypted TEXT,
      env_iv TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      tool_prefix TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      triggers_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      workspace_id TEXT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL,
      always_apply INTEGER NOT NULL DEFAULT 0,
      globs TEXT,
      body TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_settings (
      agent_key TEXT PRIMARY KEY,
      inherit_from TEXT,
      model TEXT,
      mode TEXT,
      system_prompt TEXT,
      config_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Meeting',
      source TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      duration INTEGER,
      transcript TEXT,
      summary TEXT,
      action_items_json TEXT,
      decisions_json TEXT,
      speaker_map_json TEXT,
      source_uri TEXT,
      agent_key TEXT DEFAULT 'meeting',
      processing_status TEXT DEFAULT 'done',
      processing_message TEXT,
      processing_progress INTEGER DEFAULT 100,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meeting_activity (
      id TEXT PRIMARY KEY,
      meeting_id TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      label TEXT NOT NULL,
      detail_json TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

  `)
  if (_fts5Available) {
    _sqlDb.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS meetings_fts USING fts5(
        title,
        transcript,
        summary,
        content='meetings',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS meetings_ai AFTER INSERT ON meetings BEGIN
        INSERT INTO meetings_fts(rowid, title, transcript, summary)
        VALUES (new.rowid, new.title, coalesce(new.transcript, ''), coalesce(new.summary, ''));
      END;

      CREATE TRIGGER IF NOT EXISTS meetings_ad AFTER DELETE ON meetings BEGIN
        INSERT INTO meetings_fts(meetings_fts, rowid, title, transcript, summary)
        VALUES('delete', old.rowid, old.title, coalesce(old.transcript, ''), coalesce(old.summary, ''));
      END;

      CREATE TRIGGER IF NOT EXISTS meetings_au AFTER UPDATE ON meetings BEGIN
        INSERT INTO meetings_fts(meetings_fts, rowid, title, transcript, summary)
        VALUES('delete', old.rowid, old.title, coalesce(old.transcript, ''), coalesce(old.summary, ''));
        INSERT INTO meetings_fts(rowid, title, transcript, summary)
        VALUES (new.rowid, new.title, coalesce(new.transcript, ''), coalesce(new.summary, ''));
      END;
    `)
  }
  // Migrate: add branching columns to existing messages tables (safe, ignored on fresh DBs)
  try { _sqlDb.run('ALTER TABLE messages ADD COLUMN branch_group_id TEXT') } catch { /* already exists */ }
  try { _sqlDb.run('ALTER TABLE messages ADD COLUMN branch_index INTEGER DEFAULT 0') } catch { /* already exists */ }
  try { _sqlDb.run("ALTER TABLE meetings ADD COLUMN processing_status TEXT DEFAULT 'done'") } catch { /* already exists */ }
  try { _sqlDb.run('ALTER TABLE meetings ADD COLUMN processing_message TEXT') } catch { /* already exists */ }
  try { _sqlDb.run('ALTER TABLE meetings ADD COLUMN processing_progress INTEGER DEFAULT 100') } catch { /* already exists */ }
  try { _sqlDb.run('ALTER TABLE meetings ADD COLUMN last_error TEXT') } catch { /* already exists */ }
  markDirty()

  // Seed default settings on first run
  const now = Date.now()
  const defaults = [
    { key: 'defaultModel', value: '""' },
    { key: 'reasoningEffort', value: '"medium"' },
    { key: 'defaultMode', value: '"default"' },
    { key: 'theme', value: '"dark"' },
    { key: 'activeWorkspaceId', value: 'null' },
  ]
  for (const { key, value } of defaults) {
    _sqlDb.run(
      'INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
      [key, value, now]
    )
  }
  _sqlDb.run(
    `INSERT OR IGNORE INTO agent_settings
      (agent_key, inherit_from, model, mode, system_prompt, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['wos', null, null, null, null, JSON.stringify({}), now, now]
  )
  _sqlDb.run(
    `INSERT OR IGNORE INTO agent_settings
      (agent_key, inherit_from, model, mode, system_prompt, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['meeting', 'wos', null, null, null, JSON.stringify({
      liveSource: 'captions',
      autoSummarize: true,
      defaultSlackChannel: '',
    }), now, now]
  )
  markDirty()

  // Persist every 3 seconds and on quit
  setInterval(saveToDisk, 3000)
  app.on('before-quit', saveToDisk)

  return _db
}

export function getDb(): WosDb {
  if (!_db) throw new Error('Database not initialized — call initDatabase() first')
  return _db
}

export function notifyWrite() {
  markDirty()
}

export function isFts5Available(): boolean {
  return _fts5Available
}

export function runRaw(sql: string, params: (string | number | Uint8Array | null)[] = []) {
  if (!_sqlDb) throw new Error('Database not initialized — call initDatabase() first')
  _sqlDb.run(sql, params)
  markDirty()
}

export function queryRaw<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: (string | number | Uint8Array | null)[] = []): T[] {
  if (!_sqlDb) throw new Error('Database not initialized — call initDatabase() first')
  const stmt = _sqlDb.prepare(sql, params)
  const rows: T[] = []
  try {
    while (stmt.step()) rows.push(stmt.getAsObject() as T)
  } finally {
    stmt.free()
  }
  return rows
}

export { schema }
