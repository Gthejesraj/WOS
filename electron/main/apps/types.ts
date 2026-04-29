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
}

