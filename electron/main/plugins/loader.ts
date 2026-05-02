import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pluginsDir, ensureDir } from '../paths'
import type {
  LoadedPlugin,
  PluginManifest,
  PluginRegistrationApi,
  PluginToolDefinition,
} from './types'
import type { Tool, ToolContext } from '../tools'

// User-supplied plugin entry points may be CommonJS files. Use createRequire so
// the loader keeps working under both CJS and ESM builds of the main process.
const pluginRequire = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url)

const REQUIRED_FIELDS = ['id', 'name', 'version', 'entry'] as const
const ID_RE = /^[a-z0-9][a-z0-9_-]{1,62}$/

let cache: LoadedPlugin[] | null = null

function validateManifest(raw: unknown, dir: string): PluginManifest | string {
  if (!raw || typeof raw !== 'object') return 'manifest is not an object'
  const m = raw as Record<string, unknown>
  for (const f of REQUIRED_FIELDS) {
    if (typeof m[f] !== 'string' || !(m[f] as string).trim()) {
      return `missing required field '${f}'`
    }
  }
  const id = m.id as string
  if (!ID_RE.test(id)) return `invalid id '${id}' (must match ${ID_RE})`
  const folderName = path.basename(dir)
  if (folderName !== id) return `folder name '${folderName}' must match manifest id '${id}'`
  const entry = m.entry as string
  const entryPath = path.resolve(dir, entry)
  if (!entryPath.startsWith(dir + path.sep)) return `entry '${entry}' escapes plugin dir`
  if (!fs.existsSync(entryPath)) return `entry file '${entry}' not found`
  return {
    id,
    name: m.name as string,
    version: m.version as string,
    entry,
    description: typeof m.description === 'string' ? m.description : undefined,
    author: typeof m.author === 'string' ? m.author : undefined,
    kinds: Array.isArray(m.kinds) ? (m.kinds.filter((k) => k === 'tool') as Array<'tool'>) : ['tool'],
    permissions: Array.isArray(m.permissions)
      ? m.permissions.filter((p): p is string => typeof p === 'string')
      : [],
    triggers: Array.isArray(m.triggers)
      ? m.triggers.filter((t): t is string => typeof t === 'string').map(t => t.toLowerCase())
      : [],
    hooks: Array.isArray(m.hooks)
      ? m.hooks.filter((h): h is string => typeof h === 'string') as PluginManifest['hooks']
      : [],
  }
}

async function loadOne(dir: string): Promise<LoadedPlugin> {
  const manifestPath = path.join(dir, 'wos-plugin.json')
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  } catch (err) {
    return {
      manifest: { id: path.basename(dir), name: path.basename(dir), version: '0.0.0', entry: '' },
      dir,
      tools: [],
      loadError: `failed to read manifest: ${(err as Error).message}`,
    }
  }
  const m = validateManifest(raw, dir)
  if (typeof m === 'string') {
    return {
      manifest: { id: path.basename(dir), name: path.basename(dir), version: '0.0.0', entry: '' },
      dir,
      tools: [],
      loadError: m,
    }
  }

  const tools: PluginToolDefinition[] = []
  const api: PluginRegistrationApi = {
    defineTool(def) {
      if (!def || typeof def.name !== 'string' || !def.name.trim()) {
        console.warn(`[plugins] ${m.id}: defineTool called with invalid name`)
        return
      }
      tools.push(def)
    },
    logger: {
      info: (...args) => console.log(`[plugin:${m.id}]`, ...args),
      warn: (...args) => console.warn(`[plugin:${m.id}]`, ...args),
      error: (...args) => console.error(`[plugin:${m.id}]`, ...args),
    },
  }

  try {
    const entryPath = path.resolve(dir, m.entry)
    // Use dynamic import for both ESM (.mjs) and CJS (.js) entries.
    // Bust require cache on reload by stripping from require.cache for CJS.
    if (entryPath.endsWith('.mjs')) {
      // file:// URL form for ESM
      const url = `file://${entryPath}?t=${Date.now()}`
      const mod = await import(url)
      const reg = (mod.default && typeof mod.default.register === 'function')
        ? mod.default.register
        : mod.register
      if (typeof reg !== 'function') {
        return { manifest: m, dir, tools: [], loadError: `entry does not export 'register' function` }
      }
      await reg(api)
    } else {
      delete pluginRequire.cache[entryPath]
      const mod = pluginRequire(entryPath)
      const reg = (mod && typeof mod.register === 'function')
        ? mod.register
        : (mod && mod.default && typeof mod.default.register === 'function')
          ? mod.default.register
          : null
      if (typeof reg !== 'function') {
        return { manifest: m, dir, tools: [], loadError: `entry does not export 'register' function` }
      }
      await reg(api)
    }
  } catch (err) {
    return { manifest: m, dir, tools: [], loadError: `entry threw: ${(err as Error).message}` }
  }

  if (m.permissions && m.permissions.length > 0) {
    console.log(`[plugins] ${m.id} declared permissions:`, m.permissions.join(', '), '(advisory only — not enforced in v1)')
  }
  return { manifest: m, dir, tools }
}

export async function discoverAndLoadPlugins(): Promise<LoadedPlugin[]> {
  const root = pluginsDir()
  ensureDir(root)
  let entries: string[] = []
  try {
    entries = fs.readdirSync(root)
  } catch {
    return []
  }
  const out: LoadedPlugin[] = []
  for (const name of entries) {
    const full = path.join(root, name)
    let stat: fs.Stats
    try {
      stat = fs.statSync(full)
    } catch { continue }
    if (!stat.isDirectory()) continue
    const manifestPath = path.join(full, 'wos-plugin.json')
    if (!fs.existsSync(manifestPath)) continue
    out.push(await loadOne(full))
  }
  return out
}

/** Cache-aware loader; call reloadPlugins() to invalidate. */
export async function getLoadedPlugins(): Promise<LoadedPlugin[]> {
  if (cache) return cache
  cache = await discoverAndLoadPlugins()
  for (const p of cache) {
    if (p.loadError) {
      console.warn(`[plugins] ${p.manifest.id}: ${p.loadError}`)
    } else {
      console.log(`[plugins] loaded ${p.manifest.id}@${p.manifest.version} (${p.tools.length} tool${p.tools.length === 1 ? '' : 's'})`)
    }
  }
  return cache
}

export async function reloadPlugins(): Promise<LoadedPlugin[]> {
  cache = null
  return getLoadedPlugins()
}

/**
 * Sync accessor — requires getLoadedPlugins() to have been awaited at boot.
 * Returns [] if not yet initialized (avoids forcing every getAllTools() call site to be async).
 */
export function buildPluginToolsSync(): Tool[] {
  if (!cache) return []
  const out: Tool[] = []
  for (const p of cache) {
    if (p.loadError) continue
    for (const t of p.tools) {
      const fullName = `${p.manifest.id}__${t.name}`
      out.push({
        name: fullName,
        description: `[plugin:${p.manifest.id}] ${t.description}`,
        inputSchema: t.inputSchema,
        async execute(input: unknown, ctx: ToolContext) {
          const log = (line: string) => {
            try { ctx.yieldEvent({ type: 'tool_stdout_delta', toolId: ctx.toolId ?? fullName, delta: line + '\n' } as never) } catch { /* best effort */ }
          }
          try {
            const r = await t.handler(input, {
              workspacePath: ctx.workspacePath,
              signal: ctx.signal,
              log,
            })
            if (r && 'error' in r && r.error) return { output: '', error: r.error }
            return { output: (r as { output: string | object }).output }
          } catch (err) {
            return { output: '', error: `Plugin '${p.manifest.id}' threw: ${(err as Error).message}` }
          }
        },
      })
    }
  }
  return out
}

/**
 * Convert all loaded plugin tools into the agent Tool[] shape, with the
 * plugin id prepended to each tool name to avoid collisions.
 */
export async function buildPluginTools(): Promise<Tool[]> {
  await getLoadedPlugins()
  return buildPluginToolsSync()
}

/** Lightweight summary used by the IPC handler / future settings UI. */
export interface PluginSummary {
  id: string
  name: string
  version: string
  description?: string
  toolCount: number
  loadError?: string
}

export async function listPluginSummaries(): Promise<PluginSummary[]> {
  const plugins = await getLoadedPlugins()
  return plugins.map((p) => ({
    id: p.manifest.id,
    name: p.manifest.name,
    version: p.manifest.version,
    description: p.manifest.description,
    toolCount: p.tools.length,
    loadError: p.loadError,
  }))
}

/**
 * Return all trigger keywords declared across loaded plugins.
 * Used by the intent engine to auto-include relevant plugin tools.
 * Map: lowercase trigger → plugin id
 */
export function getPluginTriggerMap(): Map<string, string> {
  const map = new Map<string, string>()
  if (!cache) return map
  for (const p of cache) {
    if (p.loadError || !p.manifest.triggers) continue
    for (const trigger of p.manifest.triggers) {
      map.set(trigger.toLowerCase(), p.manifest.id)
    }
  }
  return map
}

let _watcher: fs.FSWatcher | null = null

/**
 * Start watching ~/.wos/plugins/ for manifest changes (add / change / delete).
 * When a wos-plugin.json changes, invalidates the plugin cache so the next
 * getAllTools() call re-discovers the updated plugin. Call once at startup.
 * Returns a cleanup function that stops the watcher.
 */
export function startPluginWatcher(): () => void {
  if (_watcher) return () => { /* already watching */ }
  const root = pluginsDir()
  ensureDir(root)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const onchange = (filename: string | null) => {
    if (filename && !filename.endsWith('wos-plugin.json')) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      console.log('[plugins] manifest changed, reloading...')
      reloadPlugins().then(plugins => {
        const ok = plugins.filter(p => !p.loadError).length
        const fail = plugins.filter(p => p.loadError).length
        console.log(`[plugins] hot-reload complete: ${ok} loaded, ${fail} failed`)
      }).catch(err => console.warn('[plugins] hot-reload failed', err))
    }, 250)
  }

  try {
    _watcher = fs.watch(root, { recursive: true }, (_, filename) => onchange(filename))
    _watcher.on('error', (err) => console.warn('[plugins] watcher error', err))
    console.log(`[plugins] watching ${root} for changes`)
  } catch (err) {
    console.warn('[plugins] could not start watcher (non-fatal)', err)
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    _watcher?.close()
    _watcher = null
  }
}
