import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import * as schema from './schema'
import { runMigrations } from './migrations'

type WosDb = ReturnType<typeof drizzle<typeof schema>>

let _db: WosDb | null = null
let _sqlDb: Database.Database | null = null
let _dbPath = ''

export async function initDatabase(): Promise<WosDb> {
  _dbPath = path.join(app.getPath('userData'), 'wos.db')

  // Ensure userData directory exists (better-sqlite3 won't create it).
  fs.mkdirSync(path.dirname(_dbPath), { recursive: true })

  _sqlDb = new Database(_dbPath)
  // WAL gives us safe concurrent reads + crash-safe writes without the
  // per-second "export the whole DB and rename" loop the sql.js implementation
  // needed. NORMAL synchronous mode is the WAL-recommended default.
  _sqlDb.pragma('journal_mode = WAL')
  _sqlDb.pragma('synchronous = NORMAL')
  _sqlDb.pragma('foreign_keys = ON')

  _db = drizzle(_sqlDb, { schema })

  _sqlDb.exec(`
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

    -- ── Automations (OpenClaw-inspired) — REMOVED, rebuild in progress ────
    -- Old tables (scheduled_jobs, scheduled_runs, hooks, hook_runs,
    -- standing_orders) were dropped here. New schema lands in Phase 2.

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      title TEXT NOT NULL,
      payload TEXT,
      conversation_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_steps (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      status TEXT NOT NULL,
      label TEXT NOT NULL,
      output TEXT,
      error TEXT,
      ts INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subagent_runs (
      id TEXT PRIMARY KEY,
      parent_message_id TEXT,
      conversation_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      goal TEXT NOT NULL,
      summary TEXT,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      ended_at INTEGER
    );

    -- ── Automations v2 (OpenClaw-parity, redesigned) ─────────────────────
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,           -- 'cron' | 'heartbeat' | 'hook' | 'standing_order' | 'task_flow' | 'webhook'
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      prompt TEXT NOT NULL DEFAULT '',
      tools_allow TEXT NOT NULL DEFAULT '[]',   -- JSON array of tool names
      config TEXT NOT NULL DEFAULT '{}',         -- JSON: kind-specific params
      result_delivery TEXT NOT NULL DEFAULT 'silent',  -- 'silent' | 'notify' | 'chat' | 'external'
      result_target TEXT,                        -- conversation id / external tool spec
      owner TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_run_at INTEGER,
      next_run_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_automations_kind ON automations(kind);
    CREATE INDEX IF NOT EXISTS idx_automations_enabled ON automations(enabled);

    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL,                      -- 'running' | 'success' | 'error' | 'cancelled' | 'dryrun'
      trigger TEXT,                              -- JSON: what fired this run
      tool_calls TEXT,                           -- JSON array of {tool, args, result}
      output TEXT,
      error TEXT,
      scratch_dir TEXT,
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_automation_runs_aid ON automation_runs(automation_id);
    CREATE INDEX IF NOT EXISTS idx_automation_runs_started ON automation_runs(started_at);

    CREATE TABLE IF NOT EXISTS automation_webhooks (
      automation_id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      secret_hmac TEXT NOT NULL,
      public_url TEXT,
      last_seen_at INTEGER,
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS automation_heartbeats (
      automation_id TEXT PRIMARY KEY,
      interval_sec INTEGER NOT NULL,
      jitter_sec INTEGER NOT NULL DEFAULT 0,
      last_tick_at INTEGER,
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS automation_task_flows (
      automation_id TEXT PRIMARY KEY,
      current_step INTEGER NOT NULL DEFAULT 0,
      paused INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT '{}',           -- JSON state bag
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS automation_task_flow_steps (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',    -- 'pending' | 'running' | 'awaiting_human' | 'done' | 'error' | 'skipped'
      requires_human INTEGER NOT NULL DEFAULT 0,
      input TEXT,
      output TEXT,
      error TEXT,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_aflow_steps_aid ON automation_task_flow_steps(automation_id);

    CREATE TABLE IF NOT EXISTS automation_tasks_ledger (
      id TEXT PRIMARY KEY,
      automation_id TEXT,
      run_id TEXT,
      kind TEXT NOT NULL,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'open',       -- 'open' | 'done' | 'cancelled'
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_aledger_status ON automation_tasks_ledger(status);

    CREATE TABLE IF NOT EXISTS automation_consent_grants (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'always',      -- 'always' | 'once' | 'session'
      granted_at INTEGER NOT NULL,
      expires_at INTEGER,
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_aconsent_uniq ON automation_consent_grants(automation_id, tool, scope);

    CREATE TABLE IF NOT EXISTS app_context_snapshots (
      app_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      data_json TEXT NOT NULL DEFAULT '[]',
      fetched_at INTEGER NOT NULL,
      etag TEXT,
      PRIMARY KEY (app_id, scope)
    );

  `)
  // FTS5 ships with the better-sqlite3 amalgamation, so we always create the
  // virtual table + sync triggers — no probe + LIKE fallback needed.
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
  // Migrate: add branching columns to existing messages tables (safe, ignored on fresh DBs)
  const tryExec = (sql: string) => { try { _sqlDb!.exec(sql) } catch { /* already exists / not present */ } }
  tryExec('ALTER TABLE messages ADD COLUMN branch_group_id TEXT')
  tryExec('ALTER TABLE messages ADD COLUMN branch_index INTEGER DEFAULT 0')
  tryExec("ALTER TABLE meetings ADD COLUMN processing_status TEXT DEFAULT 'done'")
  tryExec('ALTER TABLE meetings ADD COLUMN processing_message TEXT')
  tryExec('ALTER TABLE meetings ADD COLUMN processing_progress INTEGER DEFAULT 100')
  tryExec('ALTER TABLE meetings ADD COLUMN last_error TEXT')
  // Drop legacy automation tables (rebuilt in Phase 2 of automations redesign).
  tryExec('DROP TABLE IF EXISTS scheduled_runs')
  tryExec('DROP TABLE IF EXISTS scheduled_jobs')
  tryExec('DROP TABLE IF EXISTS hook_runs')
  tryExec('DROP TABLE IF EXISTS hooks')
  tryExec('DROP TABLE IF EXISTS standing_orders')
  runMigrations(_sqlDb)

  // Seed default settings on first run
  const now = Date.now()
  const defaults = [
    { key: 'defaultModel', value: '""' },
    { key: 'reasoningEffort', value: '"medium"' },
    { key: 'defaultMode', value: '"default"' },
    { key: 'theme', value: '"dark"' },
    { key: 'activeWorkspaceId', value: 'null' },
  ]
  const insertSetting = _sqlDb.prepare(
    'INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)'
  )
  for (const { key, value } of defaults) {
    insertSetting.run(key, value, now)
  }
  const insertAgent = _sqlDb.prepare(
    `INSERT OR IGNORE INTO agent_settings
      (agent_key, inherit_from, model, mode, system_prompt, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  insertAgent.run('wos', null, null, null, null, JSON.stringify({}), now, now)
  insertAgent.run('meeting', 'wos', null, null, null, JSON.stringify({
    liveSource: 'captions',
    autoSummarize: true,
    defaultSlackChannel: '',
  }), now, now)

  // Cleanly close the native handle when the app exits so WAL is checkpointed.
  app.on('before-quit', () => {
    try { _sqlDb?.close() } catch { /* already closed */ }
    _sqlDb = null
  })

  return _db
}

export function getDb(): WosDb {
  if (!_db) throw new Error('Database not initialized — call initDatabase() first')
  return _db
}

// Kept for source-level backwards compatibility with the sql.js implementation.
// better-sqlite3 persists synchronously, so write notifications are no-ops now.
export function notifyWrite(): void {
  /* no-op */
}

// FTS5 ships with the better-sqlite3 amalgamation; always available now.
export function isFts5Available(): boolean {
  return true
}

type Bindable = string | number | bigint | Buffer | Uint8Array | null
type SqliteParam = string | number | bigint | Buffer | null

function toSqliteParams(params: Bindable[]): SqliteParam[] {
  return params.map(p =>
    p instanceof Uint8Array && !Buffer.isBuffer(p) ? Buffer.from(p) : p
  ) as SqliteParam[]
}

export function runRaw(sql: string, params: Bindable[] = []) {
  if (!_sqlDb) throw new Error('Database not initialized — call initDatabase() first')
  _sqlDb.prepare(sql).run(...toSqliteParams(params))
}

export function queryRaw<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: Bindable[] = []
): T[] {
  if (!_sqlDb) throw new Error('Database not initialized — call initDatabase() first')
  return _sqlDb.prepare(sql).all(...toSqliteParams(params)) as T[]
}

export { schema }
