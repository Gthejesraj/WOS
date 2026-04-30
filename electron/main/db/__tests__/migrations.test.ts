import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations, MIGRATIONS } from '../migrations'

describe('runMigrations', () => {
  it('records baseline version on a fresh database', () => {
    const db = new Database(':memory:')
    const v = runMigrations(db)
    expect(v).toBe(MIGRATIONS[MIGRATIONS.length - 1].version)
    const versions = (db.prepare('SELECT version FROM schema_version ORDER BY version').all() as { version: number }[]).map(r => r.version)
    expect(versions).toEqual(MIGRATIONS.map(m => m.version))
    db.close()
  })

  it('is idempotent across repeat calls', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    runMigrations(db)
    runMigrations(db)
    const row = db.prepare('SELECT COUNT(*) as c FROM schema_version').get() as { c: number }
    expect(row.c).toBe(MIGRATIONS.length)
    db.close()
  })

  it('only runs migrations newer than current version', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, description TEXT)`)
    db.prepare('INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)').run(
      MIGRATIONS[MIGRATIONS.length - 1].version,
      Date.now(),
      'pre-existing',
    )
    const v = runMigrations(db)
    expect(v).toBe(MIGRATIONS[MIGRATIONS.length - 1].version)
    const row = db.prepare('SELECT COUNT(*) as c FROM schema_version').get() as { c: number }
    expect(row.c).toBe(1)
    db.close()
  })
})
