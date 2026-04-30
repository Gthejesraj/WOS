import { getDb, schema, notifyWrite } from '../db'
import { eq } from 'drizzle-orm'
import { encryptApiKey, decryptApiKey } from '../crypto'
import { slackApp } from './slack'
import { githubApp } from './github'
import { jiraApp } from './jira'
import { googleApp } from './google'
import type { AppModule, AppManifest } from './types'
import type { Tool } from '../tools'
import { registerHooks, runOnConnect, runOnDisconnect } from '../hooks/manager'
import { getUserAppSkills, loadAllUserAppHooksOnce } from './userExtensions'
import { buildSnapshot } from '../context/snapshotManager'
import { scheduleAppOnConnect, clearAppScheduleOnDisconnect } from '../context/scheduler'

function buildSnapshotSafe(appId: string, creds: Record<string, string>): void {
  buildSnapshot(appId, creds)
    .then(() => scheduleAppOnConnect(appId))
    .catch(err => console.error(`[apps] snapshot failed for ${appId}`, err))
}

const REGISTRY: Record<string, AppModule> = {
  [slackApp.manifest.id]: slackApp,
  [githubApp.manifest.id]: githubApp,
  [jiraApp.manifest.id]: jiraApp,
  [googleApp.manifest.id]: googleApp,
}

export function listAvailableApps(): AppManifest[] {
  return Object.values(REGISTRY).map(a => a.manifest)
}

export function getApp(appId: string): AppModule | undefined {
  return REGISTRY[appId]
}

export interface StoredConnection {
  appId: string
  enabled: boolean
  creds: Record<string, string>
  metadata: Record<string, unknown> | null
}

export function getConnection(appId: string): StoredConnection | null {
  const db = getDb()
  const row = db.select().from(schema.appConnections).where(eq(schema.appConnections.appId, appId)).get()
  if (!row) return null
  let creds: Record<string, string> = {}
  try {
    creds = JSON.parse(decryptApiKey(row.encryptedCreds, row.iv)) as Record<string, string>
  } catch {
    creds = {}
  }
  return {
    appId: row.appId,
    enabled: !!row.enabled,
    creds,
    metadata: (row.metadataJson as Record<string, unknown> | null) ?? null,
  }
}

export function listConnections(): StoredConnection[] {
  const db = getDb()
  const rows = db.select().from(schema.appConnections).all()
  return rows.map(r => {
    let creds: Record<string, string> = {}
    try { creds = JSON.parse(decryptApiKey(r.encryptedCreds, r.iv)) as Record<string, string> } catch { creds = {} }
    return {
      appId: r.appId,
      enabled: !!r.enabled,
      creds,
      metadata: (r.metadataJson as Record<string, unknown> | null) ?? null,
    }
  })
}

export async function connectApp(
  appId: string,
  creds: Record<string, string>,
): Promise<{ success: boolean; error?: string; metadata?: Record<string, unknown> }> {
  const app = getApp(appId)
  if (!app) return { success: false, error: `Unknown app: ${appId}` }

  const test = await app.test(creds)
  if (!test.ok) return { success: false, error: test.error }

  const db = getDb()
  const { encrypted, iv } = encryptApiKey(JSON.stringify(creds))
  const now = new Date()
  const existing = db.select().from(schema.appConnections).where(eq(schema.appConnections.appId, appId)).get()
  if (existing) {
    db.update(schema.appConnections)
      .set({ encryptedCreds: encrypted, iv, enabled: true, metadataJson: test.identity, updatedAt: now })
      .where(eq(schema.appConnections.appId, appId))
      .run()
  } else {
    db.insert(schema.appConnections).values({
      appId,
      enabled: true,
      encryptedCreds: encrypted,
      iv,
      metadataJson: test.identity,
      createdAt: now,
      updatedAt: now,
    }).run()
  }
  notifyWrite()
  await runAppOnConnect(appId, creds)
  // Fire-and-forget snapshot — a failure must never break the connect flow.
  buildSnapshotSafe(appId, creds)
  return { success: true, metadata: test.identity }
}

export async function initiateOAuthApp(
  appId: string,
  creds: Record<string, string>,
): Promise<{ success: boolean; error?: string; metadata?: Record<string, unknown> }> {
  const app = getApp(appId)
  if (!app) return { success: false, error: `Unknown app: ${appId}` }
  if (!app.initiateOAuth) return { success: false, error: `App ${appId} does not support OAuth.` }

  const result = await app.initiateOAuth(creds)
  if (!result.ok) return { success: false, error: result.error }

  const db = getDb()
  const { encrypted, iv } = encryptApiKey(JSON.stringify(result.fullCreds))
  const now = new Date()
  const existing = db.select().from(schema.appConnections).where(eq(schema.appConnections.appId, appId)).get()
  if (existing) {
    db.update(schema.appConnections)
      .set({ encryptedCreds: encrypted, iv, enabled: true, metadataJson: result.identity, updatedAt: now })
      .where(eq(schema.appConnections.appId, appId))
      .run()
  } else {
    db.insert(schema.appConnections).values({
      appId,
      enabled: true,
      encryptedCreds: encrypted,
      iv,
      metadataJson: result.identity,
      createdAt: now,
      updatedAt: now,
    }).run()
  }
  notifyWrite()
  if (result.fullCreds) {
    await runAppOnConnect(appId, result.fullCreds)
  }
  return { success: true, metadata: result.identity }
}

export async function disconnectApp(appId: string): Promise<void> {
  clearAppScheduleOnDisconnect(appId)
  const db = getDb()
  db.delete(schema.appConnections).where(eq(schema.appConnections.appId, appId)).run()
  notifyWrite()
  await runAppOnDisconnect(appId)
}

export function setAppEnabled(appId: string, enabled: boolean) {
  const db = getDb()
  db.update(schema.appConnections)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(schema.appConnections.appId, appId))
    .run()
  notifyWrite()
}

/**
 * Register every app-declared hook with the central dispatcher exactly once
 * per process. Apps may export `hooks` on their `AppModule` and we wire
 * them under a stable source id (`app:<id>`) so they can be cleared on
 * disconnect if needed in the future.
 */
let APP_HOOKS_REGISTERED = false
function registerAppHooksOnce(): void {
  if (APP_HOOKS_REGISTERED) return
  APP_HOOKS_REGISTERED = true
  for (const app of Object.values(REGISTRY)) {
    if (app.hooks) registerHooks(`app:${app.manifest.id}`, app.hooks)
  }
  loadAllUserAppHooksOnce()
}

async function runAppOnConnect(appId: string, creds: Record<string, string>): Promise<void> {
  registerAppHooksOnce()
  await runOnConnect(appId, creds)
}

async function runAppOnDisconnect(appId: string): Promise<void> {
  registerAppHooksOnce()
  await runOnDisconnect(appId)
}

/**
 * Build tool implementations for every connected and enabled app.
 * Called by the query loop at tool-list construction time.
 */
export function buildConnectedAppTools(): Tool[] {
  registerAppHooksOnce()
  const out: Tool[] = []
  for (const c of listConnections()) {
    if (!c.enabled) continue
    const app = getApp(c.appId)
    if (!app) continue
    try {
      out.push(...app.buildTools(c.creds))
    } catch (err) {
      console.error(`[apps] failed to build tools for ${c.appId}`, err)
    }
  }
  return out
}

/**
 * Skills declared by every connected & enabled app, scoped under the app id.
 * Consumed by `buildSkillIndex()` so the agent sees app skills in its system
 * prompt and can pull bodies via the `ReadAppSkill` tool.
 */
export function listConnectedAppSkills(): Array<{ appId: string; appName: string; id: string; description: string; body: string }> {
  const out: Array<{ appId: string; appName: string; id: string; description: string; body: string }> = []
  for (const c of listConnections()) {
    if (!c.enabled) continue
    const app = getApp(c.appId)
    if (!app) continue
    const builtIn = app.skills ?? []
    const user = getUserAppSkills(c.appId)
    // user skills override built-ins on id collision
    const merged = new Map<string, { id: string; description: string; body: string }>()
    for (const s of builtIn) merged.set(s.id, s)
    for (const s of user) merged.set(s.id, s)
    for (const s of merged.values()) {
      out.push({ appId: c.appId, appName: app.manifest.name, id: s.id, description: s.description, body: s.body })
    }
  }
  return out
}

/** Return body of an app skill or undefined if not found / not connected. */
export function getConnectedAppSkillBody(appId: string, skillId: string): string | undefined {
  const conn = listConnections().find(c => c.appId === appId && c.enabled)
  if (!conn) return undefined
  const user = getUserAppSkills(appId).find(s => s.id === skillId)
  if (user) return user.body
  const app = getApp(appId)
  return app?.skills?.find(s => s.id === skillId)?.body
}
