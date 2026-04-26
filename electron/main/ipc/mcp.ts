import { ipcMain } from 'electron'
import {
  listServers,
  getServer,
  addServer,
  removeServer,
  setServerEnabled,
  testConnection,
  listTools,
} from '../mcp/manager'
import { getDb, schema, notifyWrite } from '../db'
import { eq } from 'drizzle-orm'
import { encryptApiKey } from '../crypto'

export function registerMcpHandlers() {
  ipcMain.handle('mcp:list', () => listServers())

  ipcMain.handle('mcp:add', async (_e, input: {
    id?: string
    name: string
    transport: 'stdio' | 'http' | 'sse'
    command?: string
    args?: string[]
    url?: string
    env?: Record<string, string>
    enabled?: boolean
  }) => {
    try {
      const id = addServer(input)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('mcp:update', async (_e, { id, updates }: { id: string; updates: Record<string, unknown> }) => {
    const db = getDb()
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if ('name' in updates) patch.name = updates.name
    if ('transport' in updates) patch.transport = updates.transport
    if ('command' in updates) patch.command = updates.command
    if ('args' in updates) patch.argsJson = updates.args
    if ('url' in updates) patch.url = updates.url
    if ('toolPrefix' in updates) patch.toolPrefix = updates.toolPrefix
    if ('env' in updates && updates.env && typeof updates.env === 'object') {
      const envObj = updates.env as Record<string, string>
      if (Object.keys(envObj).length === 0) {
        patch.envEncrypted = null
        patch.envIv = null
      } else {
        const { encrypted, iv } = encryptApiKey(JSON.stringify(envObj))
        patch.envEncrypted = encrypted
        patch.envIv = iv
      }
    }
    db.update(schema.mcpServers).set(patch).where(eq(schema.mcpServers.id, id)).run()
    notifyWrite()
    return { success: true }
  })

  ipcMain.handle('mcp:remove', async (_e, id: string) => {
    removeServer(id)
    return { success: true }
  })

  ipcMain.handle('mcp:set-enabled', async (_e, { id, enabled }: { id: string; enabled: boolean }) => {
    setServerEnabled(id, enabled)
    return { success: true }
  })

  ipcMain.handle('mcp:test-connection', async (_e, id: string) => {
    const r = await testConnection(id)
    return { success: r.ok, error: r.error, toolCount: r.toolCount }
  })

  ipcMain.handle('mcp:list-tools', async (_e, id: string) => {
    try {
      const tools = await listTools(id)
      return { success: true, tools }
    } catch (err) {
      return { success: false, tools: [], error: (err as Error).message }
    }
  })
}
