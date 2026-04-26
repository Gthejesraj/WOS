import { getDb, schema, notifyWrite } from '../db'
import { eq } from 'drizzle-orm'
import { encryptApiKey, decryptApiKey } from '../crypto'
import { slackApp } from './slack'
import { githubApp } from './github'
import { jiraApp } from './jira'
import { googleApp } from './google'
import type { AppModule, AppManifest } from './types'
import type { Tool } from '../tools'

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
  return { success: true, metadata: result.identity }
}

export function disconnectApp(appId: string) {
  const db = getDb()
  db.delete(schema.appConnections).where(eq(schema.appConnections.appId, appId)).run()
  notifyWrite()
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
 * Build tool implementations for every connected and enabled app.
 * Called by the query loop at tool-list construction time.
 */
export function buildConnectedAppTools(): Tool[] {
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
