import type { ElectronApplication } from '@playwright/test'

/**
 * Inspect the WOS app's SQLite DB by running queries inside the Electron
 * main process. We can't open the DB file directly from the Playwright test
 * runner because better-sqlite3 is rebuilt against Electron's Node ABI
 * (different from the host Node). Routing through `app.evaluate()` reuses
 * the running main-process binding.
 */
export function openHarnessDb(app: ElectronApplication) {
  return {
    async queryAll<T = unknown>(sql: string, ...params: unknown[]): Promise<T[]> {
      return await app.evaluate(async (_electron, payload) => {
        // The bundled main.js exposes runtime helpers via globalThis when
        // WOS_E2E=1 (see electron/main/index.ts). Falls back to a direct
        // dynamic import of the bundled module URL during dev runs.
        type Q = { queryRaw: (s: string, p: unknown[]) => unknown[] }
        const g = globalThis as unknown as { __wos_db?: Q }
        if (!g.__wos_db) throw new Error('main process: __wos_db not exposed (set WOS_E2E=1)')
        return g.__wos_db.queryRaw(payload.sql, payload.params) as unknown[]
      }, { sql, params }) as T[]
    },
    async queryOne<T = unknown>(sql: string, ...params: unknown[]): Promise<T | undefined> {
      const rows = await this.queryAll<T>(sql, ...params)
      return rows[0]
    },
    close() { /* nothing to close — DB lives in main */ },
  }
}
