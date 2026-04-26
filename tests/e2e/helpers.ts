import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

/**
 * Launch the WOS electron app against the built main bundle.
 *
 * To build the bundle once:
 *   npx electron-forge package
 * (or use the vite plugin from electron-forge to emit `.vite/build/main.js`).
 *
 * Tests use an ephemeral USER_DATA_DIR so they don't clobber the user's real
 * ~/.wos state or SQLite database.
 */
export async function launchWos(): Promise<{ app: ElectronApplication; page: Page; userDataDir: string }> {
  const root = path.resolve(__dirname, '..', '..')
  const mainPath = path.join(root, '.vite', 'build', 'main.js')

  if (!fs.existsSync(mainPath)) {
    throw new Error(
      `Build artifact missing at ${mainPath}. Run \`npx electron-forge package\` first.`,
    )
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-e2e-'))

  const app = await electron.launch({
    args: [mainPath, '--no-sandbox', `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      WOS_E2E: '1',
      WOS_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'wos-home-')),
    },
    timeout: 30_000,
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userDataDir }
}

export async function closeWos(app: ElectronApplication, userDataDir: string) {
  try {
    await app.close()
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}
