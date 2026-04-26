import { create } from 'zustand'
import { toast } from 'sonner'

interface AppsStore {
  available: AppManifest[]
  connected: AppConnection[]
  loaded: boolean
  load: () => Promise<void>
  connect: (appId: string, creds: Record<string, string>) => Promise<{ success: boolean; error?: string }>
  disconnect: (appId: string) => Promise<void>
  test: (appId: string, creds: Record<string, string>) => Promise<{ success: boolean; error?: string }>
  setEnabled: (appId: string, enabled: boolean) => Promise<void>
}

export const useAppsStore = create<AppsStore>((set, get) => ({
  available: [],
  connected: [],
  loaded: false,

  load: async () => {
    try {
      const [available, connected] = await Promise.all([
        window.wos.apps.listAvailable(),
        window.wos.apps.list(),
      ])
      set({ available, connected, loaded: true })
    } catch (err) {
      console.error('[apps] load failed', err)
      set({ loaded: true })
    }
  },

  connect: async (appId, creds) => {
    const r = await window.wos.apps.connect(appId, creds)
    if (r.success) {
      toast.success('Connected')
      await get().load()
    } else {
      toast.error(`Connection failed: ${r.error ?? 'unknown error'}`)
    }
    return r
  },

  disconnect: async (appId) => {
    await window.wos.apps.disconnect(appId)
    toast.success('Disconnected')
    await get().load()
  },

  test: async (appId, creds) => {
    const r = await window.wos.apps.test(appId, creds)
    return r
  },

  setEnabled: async (appId, enabled) => {
    await window.wos.apps.setEnabled(appId, enabled)
    await get().load()
  },
}))
