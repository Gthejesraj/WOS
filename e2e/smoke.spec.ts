import { test, expect } from './harness/fixtures'

test('smoke: app boots, window opens, db initializes', async ({ wos, harnessDb, dump }) => {
  // 1. Window appears.
  await expect(wos.window).toHaveTitle(/.+/, { timeout: 30_000 })

  // 2. Renderer hooks the preload bridge.
  const hasBridge = await wos.window.evaluate(() => typeof (window as unknown as { wos?: unknown }).wos !== 'undefined')
  expect(hasBridge).toBe(true)

  // 3. DB exists, has the workspaces table (canary for migrations).
  const tables = (await harnessDb.queryAll<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  )).map((r) => r.name)
  expect(tables).toContain('workspaces')
  expect(tables).toContain('settings')

  // 4. Drop a snapshot to scratch/ for human inspection.
  await dump('smoke-final')
})
