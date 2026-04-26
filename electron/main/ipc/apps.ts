import { ipcMain } from 'electron'
import {
  listAvailableApps,
  listConnections,
  getApp,
  connectApp,
  initiateOAuthApp,
  disconnectApp,
  setAppEnabled,
} from '../apps/manager'

export function registerAppsHandlers() {
  ipcMain.handle('apps:list-available', () => {
    return listAvailableApps().map(m => ({
      id: m.id,
      name: m.name,
      description: m.description,
      icon: m.icon,
      scopes: m.scopes,
      docsUrl: m.docsUrl,
      authFields: m.authFields,
      authType: m.authType ?? 'token',
      tools: [],
    }))
  })

  ipcMain.handle('apps:list', () => {
    const conns = listConnections()
    return conns.map(c => {
      const app = getApp(c.appId)
      if (!app) return null
      const tools = (() => {
        try {
          return app.buildTools(c.creds).map(t => ({ name: t.name, description: t.description }))
        } catch { return [] }
      })()
      return {
        appId: c.appId,
        name: app.manifest.name,
        description: app.manifest.description,
        enabled: c.enabled,
        connected: true,
        metadata: c.metadata,
        tools,
      }
    }).filter(Boolean)
  })

  ipcMain.handle('apps:connect', async (_e, { appId, creds }: { appId: string; creds: Record<string, string> }) => {
    try {
      return await connectApp(appId, creds)
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('apps:disconnect', async (_e, appId: string) => {
    disconnectApp(appId)
    return { success: true }
  })

  ipcMain.handle('apps:test', async (_e, { appId, creds }: { appId: string; creds: Record<string, string> }) => {
    const app = getApp(appId)
    if (!app) return { success: false, error: `Unknown app: ${appId}` }
    try {
      const r = await app.test(creds)
      if (r.ok) return { success: true, identity: r.identity }
      return { success: false, error: r.error }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('apps:set-enabled', async (_e, { appId, enabled }: { appId: string; enabled: boolean }) => {
    setAppEnabled(appId, enabled)
    return { success: true }
  })

  ipcMain.handle('apps:initiate-oauth', async (_e, { appId, creds }: { appId: string; creds: Record<string, string> }) => {
    try {
      return await initiateOAuthApp(appId, creds)
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
