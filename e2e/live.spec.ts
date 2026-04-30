import { test } from './harness/fixtures'

/**
 * `live.spec.ts` — interactive driving session.
 *
 * Run with: `npm run e2e:live`
 *
 * This intentionally calls `page.pause()` so the Playwright Inspector opens
 * and you (or the agent) can drive the app turn-by-turn. The harness already
 * wired isolated userData, console capture, and a read-only DB handle on
 * `harnessDb` you can poke from the Inspector REPL.
 */
test('live: drive the running app', async ({ wos, harnessDb }) => {
  // eslint-disable-next-line no-console
  console.log('[live] userData =', wos.userDataDir)
  // eslint-disable-next-line no-console
  console.log('[live] tables =', (await harnessDb.queryAll<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  )).map((r) => r.name).join(', '))

  await wos.window.pause()
})
