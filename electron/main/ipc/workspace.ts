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

  ipcMain.handle(
    'workspace:save-file',
    async (_event, { workspaceId, relPath, content }: { workspaceId: string; relPath: string; content: string }) => {
      try {
        const fs = await import('fs/promises')
        const db = getDb()
        const ws = db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).get()
        if (!ws) return { ok: false, error: 'Workspace not found' }

        // Sanitize relPath: no parent traversal, no absolute paths.
        const safeRel = relPath.replace(/^[/\\]+/, '').replace(/\.\.[/\\]/g, '')
        const absPath = path.join(ws.path, safeRel)
        const absResolved = path.resolve(absPath)
        const wsResolved = path.resolve(ws.path)
        if (!absResolved.startsWith(wsResolved + path.sep) && absResolved !== wsResolved) {
          return { ok: false, error: 'Refusing to write outside workspace' }
        }
        await fs.mkdir(path.dirname(absPath), { recursive: true })
        await fs.writeFile(absPath, content, 'utf8')
        return { ok: true, absPath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // Glob files inside a workspace — used by the @file fuzzy search in the composer.
  ipcMain.handle(
    'workspace:glob',
    async (_event, { workspaceId, query }: { workspaceId: string; query: string }) => {
      try {
        const db = getDb()
        const ws = db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).get()
        if (!ws) return { files: [] }

        const fg = await import('fast-glob')
        const glob = fg.default ?? fg.glob ?? fg
        const allFiles: string[] = await (glob as (pattern: string, opts: object) => Promise<string[]>)(
          '**/*',
          {
            cwd: ws.path,
            onlyFiles: true,
            ignore: ['node_modules/**', '.git/**', 'dist/**', '.next/**', 'build/**', 'out/**'],
            deep: 8,
            dot: false,
          }
        )

        const q = (query || '').toLowerCase()
        const scored = allFiles
          .map(f => {
            const lower = f.toLowerCase()
            const basename = path.basename(lower)
            // Prioritise: exact basename match > basename includes > full path includes
            const score = basename === q ? 100 : basename.includes(q) ? 50 : lower.includes(q) ? 20 : q === '' ? 10 : 0
            return { file: f, score }
          })
          .filter(x => x.score > 0 || q === '')
          .sort((a, b) => b.score - a.score)
          .slice(0, 30)
          .map(x => x.file)

        return { files: scored }
      } catch (err) {
        return { files: [], error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}

