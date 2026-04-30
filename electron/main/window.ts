import { BrowserWindow, app, shell } from 'electron'
import path from 'node:path'

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string
declare const MAIN_WINDOW_VITE_NAME: string

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 12 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
    show: false,
  })

  // Show when ready (prevents flash)
  win.once('ready-to-show', () => {
    win.show()
  })

  // Hide on close instead of quitting — automations keep running in background.
  // Only actually close when app is explicitly quitting.
  win.on('close', (event) => {
    const quitting = (app as unknown as { isQuitting?: boolean }).isQuitting === true
    if (!quitting) {
      event.preventDefault()
      win.hide()
      if (process.platform === 'darwin') app.dock?.hide()
    }
  })

  // Open external links in browser, not Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    )
  }

  return win
}
