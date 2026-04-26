import { autoUpdater } from 'electron-updater'
import { BrowserWindow } from 'electron'

export function setupAutoUpdater(win: BrowserWindow) {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', () => {
    win.webContents.send('update:available')
  })

  autoUpdater.on('update-downloaded', () => {
    win.webContents.send('update:ready')
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err)
  })

  autoUpdater.checkForUpdates().catch(console.error)
}
