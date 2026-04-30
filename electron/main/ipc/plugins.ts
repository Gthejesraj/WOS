import { ipcMain } from 'electron'
import { listPluginSummaries, reloadPlugins } from '../plugins/loader'

export function registerPluginsHandlers() {
  ipcMain.handle('plugins:list', () => listPluginSummaries())
  ipcMain.handle('plugins:reload', async () => {
    await reloadPlugins()
    return listPluginSummaries()
  })
}
