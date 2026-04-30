import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

export interface HarnessOptions {
  /** Optional pre-existing userData dir. If omitted, a fresh tmp dir is used. */
  userDataDir?: string
  /** Extra env to merge into the launch. */
  env?: Record<string, string>
  /** Forward stdout/stderr from the main process to the test runner. */
  forwardLogs?: boolean
}

export interface HarnessHandle {
  app: ElectronApplication
  window: Page
  userDataDir: string
  /** Consoles and main-process stdout collected so far. */
  logs: { main: string[]; renderer: string[] }
  close: () => Promise<void>
}

const repoRoot = path.resolve(__dirname, '..', '..')

function findElectronBinary(): string {
  // Prefer the locally-installed electron — it sees the project's
  // node_modules/, which is what the externalised deps in vite.main.config.ts
  // resolve from. The packaged WOS.app does not currently ship a node_modules
  // tree, so launching it directly fails to load drizzle-orm/etc.
  const platform = process.platform
  const cands: string[] = []
  if (platform === 'darwin') {
    cands.push(path.join(repoRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'))
  } else if (platform === 'win32') {
    cands.push(path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe'))
  } else {
    cands.push(path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron'))
  }
  for (const c of cands) if (fs.existsSync(c)) return c
  throw new Error('Local electron binary not found in node_modules.')
}

function ensureBuilt(): void {
  // The harness needs a production main+preload+renderer build (no Vite dev
  // server). `npm run e2e:build` produces these via electron-forge package.
  const mainJs = path.join(repoRoot, '.vite', 'build', 'main.js')
  const rendererHtml = path.join(repoRoot, '.vite', 'renderer', 'main_window', 'index.html')
  if (!fs.existsSync(mainJs) || !fs.existsSync(rendererHtml)) {
    throw new Error(
      'Production build missing. Run `npm run e2e:build` to populate .vite/build and .vite/renderer.',
    )
  }
}

function makeTmpUserData(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-e2e-'))
  return dir
}

/**
 * Launch the WOS Electron app under Playwright control.
 *
 * Uses the local electron binary and the production build under `.vite/`.
 * Run `npm run e2e:build` first to refresh the build artifacts. The
 * packaged WOS.app under `out/` is *not* used because Forge's vite plugin
 * does not currently bundle externalised node_modules into the asar.
 */
export async function launchWos(opts: HarnessOptions = {}): Promise<HarnessHandle> {
  ensureBuilt()
  const userDataDir = opts.userDataDir ?? makeTmpUserData()
  fs.mkdirSync(userDataDir, { recursive: true })

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    WOS_E2E: '1',
    WOS_USER_DATA: userDataDir,
    WOS_HOME: path.join(userDataDir, 'wos-home'),
    ...opts.env,
  }
  // electron-forge sets ELECTRON_RUN_AS_NODE=1 for its own subprocess
  // tooling. Inheriting that env var would make our binary launch as Node.
  delete env.ELECTRON_RUN_AS_NODE

  const app = await electron.launch({
    executablePath: findElectronBinary(),
    args: [repoRoot],
    cwd: repoRoot,
    env,
    timeout: 60_000,
  })

  const logs = { main: [] as string[], renderer: [] as string[] }
  app.process().stdout?.on('data', (b) => {
    const s = b.toString()
    logs.main.push(s)
    if (opts.forwardLogs) process.stdout.write(`[wos:main] ${s}`)
  })
  app.process().stderr?.on('data', (b) => {
    const s = b.toString()
    logs.main.push(s)
    if (opts.forwardLogs) process.stderr.write(`[wos:main] ${s}`)
  })

  const window = await app.firstWindow()
  window.on('console', (msg) => {
    const line = `[${msg.type()}] ${msg.text()}`
    logs.renderer.push(line)
    if (opts.forwardLogs) console.log(`[wos:renderer] ${line}`)
  })
  window.on('pageerror', (err) => {
    logs.renderer.push(`[pageerror] ${err.message}`)
    if (opts.forwardLogs) console.error(`[wos:renderer] [pageerror] ${err.message}`)
  })

  return {
    app,
    window,
    userDataDir,
    logs,
    close: async () => {
      try { await app.close() } catch { /* already gone */ }
    },
  }
}
