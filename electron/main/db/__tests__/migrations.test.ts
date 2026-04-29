import { describe, it, expect } from 'vitest'
import initSqlJs from 'sql.js'
import { runMigrations, MIGRATIONS } from '../migrations'

describe('runMigrations', () => {
  it('records baseline version on a fresh database', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    const v = runMigrations(db)
    expect(v).toBe(MIGRATIONS[MIGRATIONS.length - 1].version)
    const stmt = db.prepare('SELECT version FROM schema_version ORDER BY version')
    const versions: number[] = []
    while (stmt.step()) versions.push((stmt.getAsObject() as { version: number }).version)
    stmt.free()
    expect(versions).toEqual(MIGRATIONS.map(m => m.version))
  })

  it('is idempotent across repeat calls', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    runMigrations(db)
    runMigrations(db)
    runMigrations(db)
    const stmt = db.prepare('SELECT COUNT(*) as c FROM schema_version')
    stmt.step()
    const row = stmt.getAsObject() as { c: number }
    stmt.free()
    expect(row.c).toBe(MIGRATIONS.length)
  })

  it('only runs migrations newer than current version', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, description TEXT)`)
    db.run('INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)', [
      MIGRATIONS[MIGRATIONS.length - 1].version,
      Date.now(),
      'pre-existing',
    ])
    const v = runMigrations(db)
    expect(v).toBe(MIGRATIONS[MIGRATIONS.length - 1].version)
    const stmt = db.prepare('SELECT COUNT(*) as c FROM schema_version')
    stmt.step()
    const row = stmt.getAsObject() as { c: number }
    stmt.free()
    expect(row.c).toBe(1)
  })
})
