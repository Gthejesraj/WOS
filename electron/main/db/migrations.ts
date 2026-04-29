/**
 * Versioned database migrations framework.
 *
 * The initial schema is created in `electron/main/db/index.ts` as a series of
 * `CREATE TABLE IF NOT EXISTS` statements followed by inline `ALTER TABLE`
 * patches. That keeps existing installs alive but makes the next round of
 * schema changes ad-hoc and easy to forget.
 *
 * This module introduces a tiny migration runner: each migration is a function
 * that mutates the raw sql.js database, gated on a monotonically increasing
 * `version` number tracked in the `schema_version` table. New migrations are
 * appended to the `MIGRATIONS` array and run in order; idempotency is
 * guaranteed by the version gate (each migration runs once per install).
 *
 * Existing installs are safe because the first runner pass simply records the
 * current version as the highest one defined here — there are no migrations
 * to backfill, so it's a no-op.
 */
import type { Database as SqlJsDatabase } from 'sql.js'

export interface Migration {
  version: number
  description: string
  up(db: SqlJsDatabase): void
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
]

function ensureSchemaVersionTable(db: SqlJsDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      description TEXT
    );
  `)
}

function getCurrentVersion(db: SqlJsDatabase): number {
  ensureSchemaVersionTable(db)
  const stmt = db.prepare('SELECT MAX(version) as v FROM schema_version')
  try {
    if (!stmt.step()) return 0
    const row = stmt.getAsObject() as { v: number | null }
    return row.v ?? 0
  } finally {
    stmt.free()
  }
}

/**
 * Run any pending migrations against the given sql.js database. Returns the
 * version the database is at when the call returns. Caller is responsible
 * for persisting the database to disk afterwards.
 */
export function runMigrations(db: SqlJsDatabase): number {
  ensureSchemaVersionTable(db)
  const current = getCurrentVersion(db)
  const pending = MIGRATIONS.filter(m => m.version > current).sort((a, b) => a.version - b.version)
  for (const m of pending) {
    m.up(db)
    db.run(
      'INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)',
      [m.version, Date.now(), m.description],
    )
  }
  return getCurrentVersion(db)
}
