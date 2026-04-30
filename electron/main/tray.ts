import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron'
import path from 'node:path'

let tray: Tray | null = null
let refreshTimer: NodeJS.Timeout | null = null

async function readMasterEnabled(): Promise<boolean> {
  try {
    const { getDb } = await import('./db')
    const schema = await import('./db/schema')
    const { eq } = await import('drizzle-orm')
    const db = getDb()
    const row = db.select().from(schema.settings).where(eq(schema.settings.key, 'automations.masterEnabled')).get()
    if (!row) return true
    try { return JSON.parse(row.value as string) !== false } catch { return true }
  } catch { return true }
}

async function setMasterEnabled(enabled: boolean): Promise<void> {
  const { getDb, notifyWrite } = await import('./db')
  const schema = await import('./db/schema')
  const { eq } = await import('drizzle-orm')
  const db = getDb()
  const now = new Date()
  const existing = db.select().from(schema.settings).where(eq(schema.settings.key, 'automations.masterEnabled')).get()
  if (existing) {
    db.update(schema.settings).set({ value: JSON.stringify(enabled), updatedAt: now }).where(eq(schema.settings.key, 'automations.masterEnabled')).run()
  } else {
    db.insert(schema.settings).values({ key: 'automations.masterEnabled', value: JSON.stringify(enabled), updatedAt: now }).run()
  }
  notifyWrite()
  const { automationsRuntime } = await import('./automations')
  if (enabled) automationsRuntime.start()
  else automationsRuntime.stop()
}

async function readActiveCount(): Promise<number> {
  try {
    const { getDb } = await import('./db')
    const schema = await import('./db/schema')
    const { eq } = await import('drizzle-orm')
    const db = getDb()
    const rows = db.select().from(schema.automations).where(eq(schema.automations.enabled, true)).all()
    return rows.length
  } catch { return 0 }
}

async function buildMenu(win: BrowserWindow): Promise<Menu> {
  const masterEnabled = await readMasterEnabled()
  const activeCount = await readActiveCount()
  return Menu.buildFromTemplate([
    {
      label: 'Open WOS',
      click: () => { win.show(); win.focus(); if (process.platform === 'darwin') app.dock?.show() },
    },
    {
      label: 'New Conversation',
      click: () => {
        win.show(); win.focus()
        if (process.platform === 'darwin') app.dock?.show()
        win.webContents.send('shortcut:new-conversation')
      },
    },
    {
      label: 'Open Automations',
      click: () => {
        win.show(); win.focus()
        if (process.platform === 'darwin') app.dock?.show()
        win.webContents.send('shortcut:open-automations')
      },
    },
    { type: 'separator' },
    {
      label: `Automations: ${activeCount} active`,
      enabled: false,
    },
    {
      label: masterEnabled ? 'Pause All Automations' : 'Resume Automations',
      click: async () => {
        await setMasterEnabled(!masterEnabled)
        await refreshMenu(win)
      },
    },
    { type: 'separator' },
    {
      label: 'Quit WOS',
      click: () => {
        ;(app as unknown as { isQuitting: boolean }).isQuitting = true
        app.quit()
      },
    },
  ])
}

async function refreshMenu(win: BrowserWindow) {
  if (!tray) return
  try {
    const menu = await buildMenu(win)
    tray.setContextMenu(menu)
    const count = await readActiveCount()
    const enabled = await readMasterEnabled()
    tray.setToolTip(`WOS — ${enabled ? `${count} automations active` : 'paused'}`)
  } catch { /* ignore */ }
}

export function setupTray(win: BrowserWindow) {
  const iconPath = path.join(__dirname, '../../resources/tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin') icon.setTemplateImage(true)

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('WOS')

  refreshMenu(win)

  tray.on('click', () => {
    if (win.isVisible()) win.focus()
    else { win.show(); win.focus(); if (process.platform === 'darwin') app.dock?.show() }
  })

  // Refresh active-count display periodically
  refreshTimer = setInterval(() => { refreshMenu(win) }, 30_000)
}

export function refreshTrayMenu() {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) refreshMenu(win)
}

export function disposeTray() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
  if (tray) { tray.destroy(); tray = null }
}
