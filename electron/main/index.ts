import { app, BrowserWindow, globalShortcut, nativeImage } from 'electron'
import path from 'path'
import { createWindow } from './window'
import { setupTray } from './tray'
import { setupAutoUpdater } from './updater'
import { initDatabase } from './db'
import { registerIpcHandlers } from './ipc'

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string
declare const MAIN_WINDOW_VITE_NAME: string

// Enable Chrome DevTools Protocol for remote debugging when debug env is set.
if (process.env.WOS_DEBUG === '1' || process.env.WOS_CDP_PORT) {
  const port = process.env.WOS_CDP_PORT || '9222'
  app.commandLine.appendSwitch('remote-debugging-port', port)
  console.log('[main] CDP enabled on', port)
}

// Expose for use in other modules
export let mainWindow: BrowserWindow | null = null
export { MAIN_WINDOW_VITE_DEV_SERVER_URL, MAIN_WINDOW_VITE_NAME }

// Handle single instance
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  console.log('[main] app ready')
  try {
    // Init DB first (async with sql.js WASM)
    console.log('[main] initializing database...')
    await initDatabase()
    console.log('[main] database initialized')

    // Dev-only: seed OpenAI API key from env so E2E runs work out of the box.
    if (process.env.WOS_DEV_OPENAI_KEY) {
      try {
        const { getDb, schema, notifyWrite } = await import('./db')
        const { encryptApiKey } = await import('./crypto')
        const { eq } = await import('drizzle-orm')
        const db = getDb()
        const existing = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.provider, 'openai')).get()
        if (!existing) {
          const { encrypted, iv } = encryptApiKey(process.env.WOS_DEV_OPENAI_KEY)
          const now = new Date()
          db.insert(schema.apiKeys).values({ provider: 'openai', encryptedKey: encrypted, iv, createdAt: now, updatedAt: now }).run()
          notifyWrite()
          console.log('[main] seeded OpenAI API key from WOS_DEV_OPENAI_KEY')
        }
      } catch (err) {
        console.warn('[main] API key seed failed', err)
      }
    }
  } catch (err) {
    console.error('[main] database init failed:', err)
    // Continue without DB in dev — show window anyway
  }

  // Create main window
  mainWindow = createWindow()
  console.log('[main] window created')

  // Register IPC handlers
  registerIpcHandlers(mainWindow)

  // Scan skills and rules from disk so they're available to the first query.
  try {
    const { scanSkills } = await import('./skills/manager')
    scanSkills()
  } catch (err) {
    console.warn('[main] scanSkills failed', err)
  }
  try {
    const { scanRules } = await import('./rules/manager')
    const { getDb, schema } = await import('./db')
    const { eq } = await import('drizzle-orm')
    const db = getDb()
    const row = db.select().from(schema.settings).where(eq(schema.settings.key, 'activeWorkspaceId')).get()
    let wsPath: string | null = null
    let wsId: string | null = null
    if (row) {
      try { wsId = JSON.parse(row.value as string) as string | null } catch { wsId = null }
      if (wsId) {
        const ws = db.select().from(schema.workspaces).where(eq(schema.workspaces.id, wsId)).get()
        wsPath = ws?.path ?? null
      }
    }
    scanRules(wsPath, wsId)
  } catch (err) {
    console.warn('[main] scanRules failed', err)
  }

  // Dev dock icon (production uses the packaged .icns)
  if (process.platform === 'darwin' && !app.isPackaged) {
    const iconPath = path.join(__dirname, '../../resources/icon.png')
    app.dock?.setIcon(nativeImage.createFromPath(iconPath))
  }

  // Setup tray
  setupTray(mainWindow)

  // Setup auto updater (only in production)
  if (app.isPackaged) {
    setupAutoUpdater(mainWindow)
  }

  // Register global shortcuts
  globalShortcut.register('CommandOrControl+N', () => {
    mainWindow?.webContents.send('shortcut:new-conversation')
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
      registerIpcHandlers(mainWindow)
    }
    mainWindow?.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', async () => {
  globalShortcut.unregisterAll()
  try {
    const { disconnectAll } = await import('./mcp/manager')
    await disconnectAll()
  } catch { /* ignore */ }
})
