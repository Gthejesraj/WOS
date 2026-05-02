import type { Tool } from '../tools'
import type { HookHandlers } from '../hooks/manager'

export interface AppAuthField {
  key: string
  label: string
  placeholder?: string
  required: boolean
  secret?: boolean
  helper?: string
}

export interface AppManifest {
  id: string
  name: string
  description: string
  icon?: string
  scopes?: string[]
  docsUrl?: string
  authFields: AppAuthField[]
  /** 'token' (default) = simple credential form; 'oauth' = browser-based OAuth2 flow */
  authType?: 'token' | 'oauth'
}

/**
 * Markdown skill shipped alongside an app. Skills are short procedural
 * documents the agent can read on-demand (similar to Claude-Code skills).
 * They show up in the global skill index so the agent knows they exist.
 */
export interface AppSkill {
  /** Stable id, scoped under the app id (e.g. "post-update"). */
  id: string
  /** One-line description rendered into the skill index. */
  description: string
  /** Markdown body fetched on demand via read_skill. */
  body: string
}

export interface AppModule {
  manifest: AppManifest
  /**
   * Validate a set of credentials and return identity info for the metadata
   * column. Should throw (or return `{ok: false, error}`) when creds are bad.
   * For OAuth apps, called after token exchange to confirm the tokens are valid.
   */
  test(creds: Record<string, string>): Promise<{ ok: true; identity: Record<string, unknown> } | { ok: false; error: string }>
  /**
   * Build tool implementations bound to these credentials. Called lazily when
   * the queryLoop constructs its tool list.
   */
  buildTools(creds: Record<string, string>): Tool[]
  /**
   * OAuth apps only: open browser OAuth flow, exchange code for tokens, and
   * return the full credentials (including tokens) that should be persisted.
   */
  initiateOAuth?(creds: Record<string, string>): Promise<{ ok: true; identity: Record<string, unknown>; fullCreds: Record<string, string> } | { ok: false; error: string }>
  /** Optional: skills shipped with this app (markdown snippets). */
  skills?: AppSkill[]
  /** Optional: lifecycle/tool hooks the app wants to register. */
  hooks?: HookHandlers
  /**
   * Optional: build a lightweight resource snapshot for this app. Called once
   * after a successful connect. Returns a plain object whose top-level keys
   * become individual snapshot scopes (e.g. "channels", "repos").
   */
  snapshot?(creds: Record<string, string>): Promise<Record<string, unknown[]>>
  /**
   * Optional: declare what kinds of project resources this app contributes.
   * Used by the Projects feature to render dynamic pickers and refresh
   * loops. The catalogue is derived live from connected apps — never
   * hardcoded — so new apps automatically participate.
   */
  projectResourceTypes?(): ProjectResourceTypeDef[]
}

export interface ProjectResourceTypeDef {
  /** Namespaced kind, e.g. 'slack:channel', 'github:repo'. */
  kind: string
  /** Human label rendered in the picker. */
  label: string
  /** Short helper sentence shown under the label. */
  description?: string
  /** Allow multiple selections in the picker UI. */
  multiSelect: boolean
  /**
   * Renderer-side picker component id. The renderer maintains a registry
   * mapping these ids to React components. Falls back to a generic snapshot
   * picker when unknown.
   */
  pickerComponentId: string
  /**
   * Snapshot scope to source picker choices from (when using the generic
   * picker). e.g. 'channels' | 'repos'. When omitted the renderer falls
   * back to a free-form text input.
   */
  snapshotScope?: string
  /** Default refresh cadence in seconds for resources of this kind. */
  refreshIntervalSec: number
  /**
   * Declarative schema for the "custom value" fallback in the picker UI.
   * Pure data (no functions) so it can cross IPC. The renderer renders a
   * tiny form using these fields, then submits them as the resource ref.
   * Apps are encouraged to ship this so the renderer never has to hand-code
   * per-kind labels/placeholders.
   */
  refSchema?: ProjectResourceRefSchema
  /** Plain-text examples of valid refs (shown as placeholder hints). */
  refExamples?: string[]
  /**
   * Optional fetcher: pulls fresh data for one resource. Receives the
   * stored ref payload from project_resources and returns activity-shaped
   * objects to be normalised into project_activity by the refresh loop.
   * Implementations are app-specific.
   *
   * NOTE: this function is server-only — it must NEVER be included in any
   * IPC payload because Electron's structured-clone cannot serialize
   * functions. `apps/manager.ts → listProjectResourceTypes()` strips it
   * before returning. Use `findFetcherFor(appId, kind)` server-side to look
   * it up at refresh time.
   */
  fetcher?(creds: Record<string, string>, ref: unknown): Promise<unknown>
}

export interface ProjectResourceRefSchema {
  /** Plain-language helper sentence shown above the form. */
  hint?: string
  /** One or more form fields the user fills in to construct the ref. */
  fields: ProjectResourceRefField[]
  /**
   * If set, the renderer also exposes a "Paste raw JSON / URL" toggle that
   * accepts a single string and parses it via the listed strategies. All
   * strategies are pure regex/string operations (no functions over IPC).
   */
  pasteParsers?: ProjectResourceRefPasteParser[]
}

export interface ProjectResourceRefField {
  name: string
  label: string
  /** 'text' renders an input; 'textarea' a multiline; 'select' a dropdown. */
  type: 'text' | 'textarea' | 'select'
  required?: boolean
  placeholder?: string
  hint?: string
  options?: Array<{ value: string; label: string }>
}

export interface ProjectResourceRefPasteParser {
  /** Regex string that, when matched against pasted input, yields named groups. */
  regex: string
  /** Map of regex group → ref field name. */
  groupToField: Record<string, string>
}

