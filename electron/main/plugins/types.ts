/**
 * WOS Plugin SDK — public types.
 *
 * Plugins live in `~/.wos/plugins/<id>/` with a `wos-plugin.json` manifest
 * and an entry JS file. They run in the main process (no sandbox in v1 —
 * trust model: install only plugins you wrote or verified). The SDK gives
 * plugins a stable surface to register tools that show up in chat.
 */

export interface PluginManifest {
  /** Stable plugin identifier; folder name and tool prefix. */
  id: string
  /** Human-readable name shown in the UI. */
  name: string
  /** Semver. */
  version: string
  /** Entry file relative to the plugin folder. CommonJS or ESM. */
  entry: string
  /** Short one-line description. */
  description?: string
  /** Plugin author/homepage. */
  author?: string
  /** Declared capabilities — currently only 'tool' is implemented. */
  kinds?: Array<'tool'>
  /** Free-form permissions string list (e.g. 'fs.read', 'net'). Logged on load; not enforced in v1. */
  permissions?: string[]
  /**
   * Trigger keywords / phrases — used by the intent engine to auto-include
   * this plugin's tools when the user's message matches one of these terms.
   * E.g. ["linear", "ticket", "issue tracker"]
   */
  triggers?: string[]
  /**
   * Lifecycle hooks this plugin wants to subscribe to.
   * Reserved for v2; declared but not yet dispatched.
   */
  hooks?: Array<'before-tool-call' | 'after-tool-call' | 'before-turn' | 'after-turn'>
}

export interface PluginToolDefinition {
  /** Tool name as it will appear to the agent. The plugin id is prepended
   * automatically (`<pluginId>__<name>`) to avoid collisions. */
  name: string
  description: string
  inputSchema: object
  handler: (input: unknown, ctx: PluginToolContext) => Promise<PluginToolResult> | PluginToolResult
}

export interface PluginToolContext {
  workspacePath: string | null
  signal: AbortSignal
  log: (line: string) => void
}

export type PluginToolResult =
  | { output: string | object; error?: undefined }
  | { output?: undefined; error: string }

export interface PluginModule {
  register: (api: PluginRegistrationApi) => void | Promise<void>
}

export interface PluginRegistrationApi {
  defineTool: (def: PluginToolDefinition) => void
  logger: {
    info: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }
}

export interface LoadedPlugin {
  manifest: PluginManifest
  dir: string
  tools: PluginToolDefinition[]
  loadError?: string
}
