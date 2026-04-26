import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'

/**
 * WOS keeps user-editable configuration in a dedicated top-level folder
 * (`~/.wos/`) so skills, rules, and MCP definitions are git-able and can
 * be edited with any editor. Secrets (OAuth tokens, API keys, encrypted
 * env vars) remain inside SQLite under `app.getPath('userData')`.
 */

let _wosHome: string | null = null

function getHome(): string {
  // Tests can override via env var.
  return process.env.WOS_HOME ?? path.join(os.homedir(), '.wos')
}

export function wosHome(): string {
  if (_wosHome) return _wosHome
  _wosHome = getHome()
  ensureDir(_wosHome)
  ensureDir(path.join(_wosHome, 'apps'))
  ensureDir(path.join(_wosHome, 'skills'))
  ensureDir(path.join(_wosHome, 'rules'))
  return _wosHome
}

export function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

export function wosSubpath(...segments: string[]): string {
  return path.join(wosHome(), ...segments)
}

export function appDataPath(...segments: string[]): string {
  return path.join(app.getPath('userData'), ...segments)
}

export function mcpConfigPath(): string {
  return wosSubpath('mcp.json')
}

export function skillsDir(): string {
  return wosSubpath('skills')
}

export function userRulesDir(): string {
  return wosSubpath('rules')
}

/**
 * Per-workspace Cursor-compatible rules directory.
 * Returns null if workspacePath is null or the directory doesn't exist.
 */
export function workspaceRulesDir(workspacePath: string | null): string | null {
  if (!workspacePath) return null
  const d = path.join(workspacePath, '.cursor', 'rules')
  return fs.existsSync(d) ? d : null
}
