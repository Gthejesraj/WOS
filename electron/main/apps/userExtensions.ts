import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { wosSubpath, ensureDir } from '../paths'
import { registerHooks, type HookHandlers } from '../hooks/manager'
import type { AppSkill } from './types'

/**
 * User-editable extensions for apps live under `~/.wos/apps/<appId>/`:
 *   - `skills/*.md`   — extra app skills (parsed via gray-matter; id = filename stem).
 *   - `hooks/*.js`    — CommonJS modules exporting a `HookHandlers` object as
 *                       default or named `hooks`. Loaded once at startup.
 *
 * These are layered on top of the built-in `app.skills` / `app.hooks`. We
 * call them "user extensions" because users own the files and they survive
 * app updates.
 *
 * For safety we deliberately don't import TypeScript or use dynamic ESM here —
 * just plain CJS via require(). Errors are logged, not thrown, so a bad file
 * never blocks startup.
 */

const userAppsRoot = () => wosSubpath('apps')

function readSkillsForApp(appId: string): AppSkill[] {
  const dir = path.join(userAppsRoot(), appId, 'skills')
  if (!fs.existsSync(dir)) return []
  const out: AppSkill[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const full = path.join(dir, entry.name)
    try {
      const raw = fs.readFileSync(full, 'utf8')
      const parsed = matter(raw)
      const data = parsed.data as Record<string, unknown>
      const id = (data.id as string) || entry.name.replace(/\.md$/, '')
      const description = (data.description as string) || ''
      out.push({ id, description, body: parsed.content })
    } catch (err) {
      console.error(`[userExtensions] failed to parse skill ${full}`, err)
    }
  }
  return out
}

function loadHooksForApp(appId: string): void {
  const dir = path.join(userAppsRoot(), appId, 'hooks')
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue
    const full = path.join(dir, entry.name)
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(full) as { default?: HookHandlers; hooks?: HookHandlers }
      const handlers: HookHandlers | undefined = mod.hooks ?? mod.default
      if (!handlers || typeof handlers !== 'object') {
        console.warn(`[userExtensions] hook file has no exports: ${full}`)
        continue
      }
      registerHooks(`user:apps/${appId}/${entry.name}`, handlers)
    } catch (err) {
      console.error(`[userExtensions] failed to load hooks ${full}`, err)
    }
  }
}

const userSkillsCache = new Map<string, AppSkill[]>()

/**
 * Return user-defined skills for an app. Cached after first read; pass
 * `{ refresh: true }` to bust the cache (e.g. after a settings change).
 */
export function getUserAppSkills(appId: string, opts: { refresh?: boolean } = {}): AppSkill[] {
  ensureDir(userAppsRoot())
  if (opts.refresh) userSkillsCache.delete(appId)
  if (!userSkillsCache.has(appId)) {
    userSkillsCache.set(appId, readSkillsForApp(appId))
  }
  return userSkillsCache.get(appId) ?? []
}

let hooksLoaded = false
/**
 * Discover and register user hooks for every app dir under `~/.wos/apps/`.
 * Idempotent — safe to call multiple times; hooks are only registered once.
 */
export function loadAllUserAppHooksOnce(): void {
  if (hooksLoaded) return
  hooksLoaded = true
  ensureDir(userAppsRoot())
  for (const entry of fs.readdirSync(userAppsRoot(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    loadHooksForApp(entry.name)
  }
}
