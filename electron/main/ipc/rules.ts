import { ipcMain } from 'electron'
import {
  listRules,
  scanRules,
  setRuleEnabled,
  readRuleBody,
  createRule,
  deleteRule,
} from '../rules/manager'
import { getDb, schema, notifyWrite } from '../db'
import { eq } from 'drizzle-orm'
import fs from 'node:fs'
import matter from 'gray-matter'

export function registerRulesHandlers() {
  ipcMain.handle('rules:list', () => listRules())

  ipcMain.handle('rules:reload', async () => {
    const db = getDb()
    const activeWorkspace = db.select().from(schema.settings).where(eq(schema.settings.key, 'activeWorkspaceId')).get()
    let wsId: string | null = null
    let wsPath: string | null = null
    if (activeWorkspace) {
      try { wsId = JSON.parse(activeWorkspace.value as string) as string } catch { wsId = null }
      if (wsId) {
        const ws = db.select().from(schema.workspaces).where(eq(schema.workspaces.id, wsId)).get()
        wsPath = ws?.path ?? null
      }
    }
    const list = scanRules(wsPath, wsId)
    return { success: true, count: list.length }
  })

  ipcMain.handle('rules:set-enabled', async (_e, { id, enabled }: { id: string; enabled: boolean }) => {
    setRuleEnabled(id, enabled)
    return { success: true }
  })

  ipcMain.handle('rules:read', async (_e, id: string) => {
    const r = readRuleBody(id)
    if (!r) return { success: false, error: 'Rule not found' }
    return { success: true, body: r.body, meta: r.meta }
  })

  ipcMain.handle('rules:create', async (_e, input: {
    scope: 'user' | 'workspace'
    name: string
    description?: string
    alwaysApply?: boolean
    globs?: string[]
    body: string
  }) => {
    try {
      // Resolve workspace path/id for workspace-scoped rules.
      let workspacePath: string | null = null
      let workspaceId: string | null = null
      if (input.scope === 'workspace') {
        const db = getDb()
        const activeWorkspace = db.select().from(schema.settings).where(eq(schema.settings.key, 'activeWorkspaceId')).get()
        if (activeWorkspace) {
          try { workspaceId = JSON.parse(activeWorkspace.value as string) as string } catch { workspaceId = null }
          if (workspaceId) {
            const ws = db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).get()
            workspacePath = ws?.path ?? null
          }
        }
        if (!workspacePath) return { success: false, error: 'No active workspace to attach rule to.' }
      }
      const { id } = createRule({ ...input, workspacePath, workspaceId })
      return { success: true, id }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('rules:update', async (_e, { id, updates }: { id: string; updates: Record<string, unknown> }) => {
    try {
      const db = getDb()
      const row = db.select().from(schema.rules).where(eq(schema.rules.id, id)).get()
      if (!row) return { success: false, error: 'Not found' }

      // If updating content, rewrite the file on disk so the frontmatter stays authoritative.
      if ('body' in updates || 'name' in updates || 'description' in updates || 'alwaysApply' in updates || 'globs' in updates) {
        const raw = fs.existsSync(row.path) ? fs.readFileSync(row.path, 'utf8') : ''
        const parsed = raw ? matter(raw) : { data: {}, content: '' }
        const data = { ...(parsed.data as Record<string, unknown>) }
        if ('name' in updates) data.name = updates.name
        if ('description' in updates) data.description = updates.description
        if ('alwaysApply' in updates) data.alwaysApply = Boolean(updates.alwaysApply)
        if ('globs' in updates) data.globs = updates.globs
        const body = 'body' in updates ? String(updates.body) : parsed.content
        const serialized = matter.stringify(body, data as object)
        fs.writeFileSync(row.path, serialized)
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() }
      if ('name' in updates) patch.name = updates.name
      if ('description' in updates) patch.description = updates.description
      if ('alwaysApply' in updates) patch.alwaysApply = Boolean(updates.alwaysApply)
      if ('globs' in updates) patch.globs = updates.globs
      if ('body' in updates) patch.body = updates.body
      db.update(schema.rules).set(patch).where(eq(schema.rules.id, id)).run()
      notifyWrite()
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('rules:delete', async (_e, id: string) => {
    deleteRule(id)
    return { success: true }
  })
}
