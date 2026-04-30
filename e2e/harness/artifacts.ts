import path from 'node:path'
import fs from 'node:fs'
import type { Page } from '@playwright/test'
import type { HarnessHandle } from './launch'

const scratchDir = path.resolve(__dirname, '..', 'scratch')

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * Capture screenshot + DOM HTML + console + main-process logs to e2e/scratch/
 * under the given run name. Returns the directory path.
 */
export async function dumpState(
  page: Page,
  handle: HarnessHandle,
  name = `dump-${Date.now()}`,
): Promise<string> {
  const dir = path.join(scratchDir, name)
  ensureDir(dir)
  await page.screenshot({ path: path.join(dir, 'screenshot.png'), fullPage: true })
  fs.writeFileSync(path.join(dir, 'dom.html'), await page.content(), 'utf8')
  fs.writeFileSync(path.join(dir, 'main.log'), handle.logs.main.join(''), 'utf8')
  fs.writeFileSync(path.join(dir, 'renderer.log'), handle.logs.renderer.join('\n'), 'utf8')
  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify({ url: page.url(), title: await page.title(), userDataDir: handle.userDataDir }, null, 2),
    'utf8',
  )
  return dir
}
