/**
 * Clone-safety guard for the Projects catalogue IPC payload.
 *
 * The renderer fetches the catalogue via `ipcMain.handle('projects:catalogue')`,
 * which uses the structured-clone algorithm. Functions are NOT clonable.
 * Historically a `fetcher` function leaked through `apps/manager.ts` and broke
 * the entire Projects tab. This test deep-walks the payload and fails if any
 * function value sneaks in — catching future regressions at unit-test time.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { initDatabase } from '../../db'
import { listCatalogue } from '../resources'

const userData = (app as unknown as { getPath: (name: string) => string }).getPath('userData')

beforeAll(async () => {
  fs.mkdirSync(userData, { recursive: true })
  const dbPath = path.join(userData, 'wos.db')
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath)
  await initDatabase()
})

afterAll(() => {
  const dbPath = path.join(userData, 'wos.db')
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath)
})

function findFunctions(value: unknown, path: string, found: string[]): void {
  if (value === null || value === undefined) return
  if (typeof value === 'function') {
    found.push(path)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => findFunctions(v, `${path}[${i}]`, found))
    return
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      findFunctions(v, path ? `${path}.${k}` : k, found)
    }
  }
}

describe('projects catalogue clone-safety', () => {
  it('contains no function values (would break IPC structured-clone)', () => {
    const cat = listCatalogue({ onlyConnected: false })
    const found: string[] = []
    findFunctions(cat, 'catalogue', found)
    expect(found).toEqual([])
  })

  it('round-trips through structured clone without throwing', () => {
    const cat = listCatalogue({ onlyConnected: false })
    expect(() => structuredClone(cat)).not.toThrow()
  })

  it('surfaces all known apps with connected flag (false when no apps connected)', () => {
    const cat = listCatalogue({ onlyConnected: false })
    const appIds = new Set(cat.map(e => e.appId))
    for (const id of ['native', 'slack', 'github', 'jira', 'google']) {
      expect(appIds.has(id)).toBe(true)
    }
    for (const entry of cat) {
      if (entry.appId === 'native') {
        expect(entry.connected).toBe(true)
      } else {
        expect(entry.connected).toBe(false)
      }
    }
  })
})
