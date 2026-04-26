import { ipcMain, dialog } from 'electron'
import path from 'path'
import { getDb, schema, notifyWrite } from '../db'
import { eq, desc } from 'drizzle-orm'
import { randomUUID } from 'crypto'

export function registerWorkspaceHandlers() {
  ipcMain.handle('workspace:open', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Workspace Folder',
      buttonLabel: 'Open as Workspace',
    })

    if (result.canceled || !result.filePaths.length) return null

    const folderPath = result.filePaths[0]
    const name = path.basename(folderPath)
    const db = getDb()

    const existing = db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.path, folderPath))
      .get()

    if (existing) {
      db.update(schema.workspaces)
        .set({ lastAccessedAt: new Date() })
        .where(eq(schema.workspaces.id, existing.id))
        .run()
      return existing
    }

    const ws = {
      id: randomUUID(),
      path: folderPath,
      name,
      addedAt: new Date(),
      lastAccessedAt: new Date(),
    }
    db.insert(schema.workspaces).values(ws).run()
    notifyWrite()
    return ws
  })

  ipcMain.handle('workspace:list', () => {
    const db = getDb()
    return db.select().from(schema.workspaces).orderBy(desc(schema.workspaces.lastAccessedAt)).all()
  })

  ipcMain.handle('workspace:remove', (_event, id: string) => {
    const db = getDb()
    db.delete(schema.workspaces).where(eq(schema.workspaces.id, id)).run()
    return { success: true }
  })
}
