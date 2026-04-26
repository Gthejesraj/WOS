import { create } from 'zustand'
import { toast } from 'sonner'

interface McpStore {
  servers: McpServerInfo[]
  loaded: boolean
  load: () => Promise<void>
  add: (input: {
    name: string
    transport: 'stdio' | 'http' | 'sse'
    command?: string
    args?: string[]
    url?: string
    env?: Record<string, string>
  }) => Promise<{ success: boolean; id?: string; error?: string }>
  remove: (id: string) => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  testConnection: (id: string) => Promise<{ success: boolean; error?: string; toolCount?: number }>
  listTools: (id: string) => Promise<{ success: boolean; tools: Array<{ name: string; description: string }>; error?: string }>
  update: (id: string, updates: Record<string, unknown>) => Promise<void>
}

export const useMcpStore = create<McpStore>((set, get) => ({
  servers: [],
  loaded: false,

  load: async () => {
    try {
      const servers = await window.wos.mcp.list()
      set({ servers, loaded: true })
    } catch (err) {
      console.error('[mcp] load failed', err)
      set({ loaded: true })
    }
  },

  add: async (input) => {
    const r = await window.wos.mcp.add(input)
    if (r.success) {
      toast.success(`Added ${input.name}`)
      await get().load()
    } else {
      toast.error(`Add failed: ${r.error ?? 'unknown error'}`)
    }
    return r
  },

  remove: async (id) => {
    await window.wos.mcp.remove(id)
    toast.success('Removed')
    await get().load()
  },

  setEnabled: async (id, enabled) => {
    await window.wos.mcp.setEnabled(id, enabled)
    await get().load()
  },

  testConnection: async (id) => {
    const r = await window.wos.mcp.testConnection(id)
    if (r.success) toast.success(`Connected — ${r.toolCount ?? 0} tools available`)
    else toast.error(`Connection failed: ${r.error ?? 'unknown error'}`)
    await get().load()
    return r
  },

  listTools: async (id) => {
    return window.wos.mcp.listTools(id)
  },

  update: async (id, updates) => {
    await window.wos.mcp.update(id, updates)
    await get().load()
  },
}))
