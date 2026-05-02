/**
 * Versioned database migrations framework.
 *
 * The initial schema is created in `electron/main/db/index.ts` as a series of
 * `CREATE TABLE IF NOT EXISTS` statements followed by inline `ALTER TABLE`
 * patches. That keeps existing installs alive but makes the next round of
 * schema changes ad-hoc and easy to forget.
 *
 * This module introduces a tiny migration runner: each migration is a function
 * that mutates the raw better-sqlite3 database, gated on a monotonically
 * increasing `version` number tracked in the `schema_version` table. New
 * migrations are appended to the `MIGRATIONS` array and run in order;
 * idempotency is guaranteed by the version gate (each migration runs once per
 * install).
 */
import type Database from 'better-sqlite3'

type SqliteDb = Database.Database

export interface Migration {
  version: number
  description: string
  up(db: SqliteDb): void
}

/**
 * Append new migrations to the END of this array. Never edit a published
 * migration's `version` or `up` once it's shipped — write a follow-up instead.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Baseline schema (created by initDatabase()).',
    up() {
      // Intentionally a no-op. The baseline tables are created by the
      // CREATE TABLE IF NOT EXISTS block in initDatabase(), which runs
      // before this migration framework. We just record version=1 so
      // future migrations have a starting point.
    },
  },
  {
    version: 2,
    description: 'Automations: collapse cron+heartbeat into unified schedule kind; drop standing_order and task_flow rows (replaced by Rules + native flows).',
    up(db) {
      // Skip if automations table doesn't exist yet (fresh DB initialised
      // before migrations run, or test fixtures without app schema).
      const hasTable = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='automations'`,
      ).get()
      if (!hasTable) return
      // cron → schedule (mode=cron). Old cfg: { expr, tz?|timezone? }.
      db.exec(`
        UPDATE automations
        SET kind = 'schedule',
            config = json_object(
              'mode', 'cron',
              'cron', json_extract(config, '$.expr'),
              'tz', coalesce(json_extract(config, '$.tz'), json_extract(config, '$.timezone'))
            )
        WHERE kind = 'cron';
      `)
      // heartbeat → schedule (mode=every). Old cfg: { intervalSec, jitterSec? }.
      db.exec(`
        UPDATE automations
        SET kind = 'schedule',
            config = json_object(
              'mode', 'every',
              'every', (json_extract(config, '$.intervalSec') || 's'),
              'jitterSec', json_extract(config, '$.jitterSec')
            )
        WHERE kind = 'heartbeat';
      `)
      // standing_order rows are deleted — Rules feature (~/.wos/rules/*.md)
      // already handles persistent prompt rules.
      db.exec(`DELETE FROM automations WHERE kind = 'standing_order';`)
      // task_flow is now an orchestration concern, not an automation kind.
      db.exec(`DELETE FROM automations WHERE kind = 'task_flow';`)
    },
  },
  {
    version: 3,
    description: 'Projects feature: ensure project tables exist (no-op for fresh DBs since initDatabase() already created them; this version pin lets future migrations target the projects schema).',
    up() {
      // No-op. The CREATE TABLE IF NOT EXISTS block in initDatabase()
      // already creates the projects.* tables on every boot. This entry
      // exists so subsequent migrations can target schema_version >= 3.
    },
  },
]

function ensureSchemaVersionTable(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      description TEXT
    );
  `)
}

function getCurrentVersion(db: SqliteDb): number {
  ensureSchemaVersionTable(db)
  const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null } | undefined
  return row?.v ?? 0
}

/**
 * Run any pending migrations against the given better-sqlite3 database.
 * Returns the version the database is at when the call returns.
 */
export function runMigrations(db: SqliteDb): number {
  ensureSchemaVersionTable(db)
  const current = getCurrentVersion(db)
  const pending = MIGRATIONS.filter(m => m.version > current).sort((a, b) => a.version - b.version)
  const insert = db.prepare(
    'INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)',
  )
  for (const m of pending) {
    m.up(db)
    insert.run(m.version, Date.now(), m.description)
  }
  return getCurrentVersion(db)
}
