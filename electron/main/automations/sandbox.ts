import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

/**
 * Returns the root folder for all automation runtime artifacts.
 * Layout: <userData>/automations/{runs,scratch,webhooks,logs}
 */
export function automationsRoot(): string {
  const root = path.join(app.getPath('userData'), 'automations')
  ensureDir(root)
  return root
}

export function runsRoot(): string {
  const dir = path.join(automationsRoot(), 'runs')
  ensureDir(dir)
  return dir
}

/**
 * Create a sandbox scratch directory for a single run.
 * Tools that respect cwd should be pointed here so writes never escape.
 */
export function createRunSandbox(runId: string): string {
  const dir = path.join(runsRoot(), runId)
  ensureDir(dir)
  return dir
}

export function ensureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* ignore */
  }
}

export function isInsideAutomationsRoot(p: string): boolean {
  const root = automationsRoot()
  const resolved = path.resolve(p)
  return resolved === root || resolved.startsWith(root + path.sep)
}
