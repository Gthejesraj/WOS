// Minimal Electron API stub used by Vitest. Tests that need real Electron
// objects (BrowserWindow, ipcMain, shell) must mock those calls explicitly via
// `vi.mock` in the test file.
import os from 'node:os'
import path from 'node:path'

const userData = path.join(os.tmpdir(), `wos-vitest-userdata-${process.pid}`)

export const app = {
  isPackaged: false,
  getPath(name: string): string {
    if (name === 'userData') return userData
    if (name === 'temp') return os.tmpdir()
    return os.tmpdir()
  },
  getVersion(): string {
    return '0.0.0-test'
  },
  on(_event: string, _listener: (...args: unknown[]) => void) {
    return app
  },
  once(_event: string, _listener: (...args: unknown[]) => void) {
    return app
  },
  off(_event: string, _listener: (...args: unknown[]) => void) {
    return app
  },
  removeListener(_event: string, _listener: (...args: unknown[]) => void) {
    return app
  },
  whenReady() {
    return Promise.resolve()
  },
  quit() { /* noop */ },
}

export const ipcMain = {
  handle() { /* noop */ },
  on() { /* noop */ },
  removeHandler() { /* noop */ },
}

export const shell = {
  openExternal: async () => true,
}

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString('utf8'),
}

export class BrowserWindow {
  webContents = { send() { /* noop */ } }
  isDestroyed() { return false }
}

export const session = { defaultSession: {} }
export default { app, ipcMain, shell, safeStorage, BrowserWindow, session }
