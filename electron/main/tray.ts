import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron'
import path from 'path'

let tray: Tray | null = null

export function setupTray(win: BrowserWindow) {
  const iconPath = path.join(__dirname, '../../resources/tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath)

  // Use template image on macOS for auto dark/light mode
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true)
  }

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('WOS')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open WOS',
      click: () => {
        win.show()
        win.focus()
      },
    },
    {
      label: 'New Conversation',
      click: () => {
        win.show()
        win.focus()
        win.webContents.send('shortcut:new-conversation')
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (win.isVisible()) {
      win.focus()
    } else {
      win.show()
      win.focus()
    }
  })
}
