import { test as base, expect } from '@playwright/test'
import { launchWos, type HarnessHandle } from './launch'
import { openHarnessDb } from './db'
import { dumpState } from './artifacts'

type WosFixtures = {
  wos: HarnessHandle
  dump: (name?: string) => Promise<string>
  harnessDb: ReturnType<typeof openHarnessDb>
}

export const test = base.extend<WosFixtures>({
  wos: async ({}, use) => {
    const handle = await launchWos({ forwardLogs: !!process.env.WOS_E2E_VERBOSE })
    await use(handle)
    await handle.close()
  },
  dump: async ({ wos }, use) => {
    await use(async (name?: string) => dumpState(wos.window, wos, name))
  },
  harnessDb: async ({ wos }, use) => {
    const db = openHarnessDb(wos.app)
    // Wait for the main-process __wos_db helper to be installed.
    let tries = 0
    while (tries < 120) {
      try {
        await db.queryAll('SELECT 1')
        break
      } catch {
        await new Promise((r) => setTimeout(r, 250))
        tries += 1
      }
    }
    await use(db)
    db.close()
  },
})

export { expect }
