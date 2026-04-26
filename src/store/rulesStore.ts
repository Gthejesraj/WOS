import { create } from 'zustand'
import { toast } from 'sonner'

interface RulesStore {
  rules: RuleInfo[]
  loaded: boolean
  load: () => Promise<void>
  reload: () => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  create: (input: {
    scope: 'user' | 'workspace'
    name: string
    description?: string
    alwaysApply?: boolean
    globs?: string[]
    body: string
  }) => Promise<{ success: boolean; id?: string; error?: string }>
  update: (id: string, updates: Record<string, unknown>) => Promise<void>
  remove: (id: string) => Promise<void>
  read: (id: string) => Promise<{ success: boolean; body?: string; meta?: Record<string, unknown>; error?: string }>
}

export const useRulesStore = create<RulesStore>((set, get) => ({
  rules: [],
  loaded: false,

  load: async () => {
    try {
      const rules = await window.wos.rules.list()
      set({ rules, loaded: true })
    } catch (err) {
      console.error('[rules] load failed', err)
      set({ loaded: true })
    }
  },

  reload: async () => {
    await window.wos.rules.reload()
    await get().load()
  },

  setEnabled: async (id, enabled) => {
    await window.wos.rules.setEnabled(id, enabled)
    await get().load()
  },

  create: async (input) => {
    const r = await window.wos.rules.create(input)
    if (r.success) {
      toast.success(`Created rule "${input.name}"`)
      await get().load()
    } else {
      toast.error(`Create failed: ${r.error ?? 'unknown error'}`)
    }
    return r
  },

  update: async (id, updates) => {
    const r = await window.wos.rules.update(id, updates)
    if (!r.success) toast.error('Update failed')
    await get().load()
  },

  remove: async (id) => {
    await window.wos.rules.delete(id)
    toast.success('Rule removed')
    await get().load()
  },

  read: async (id) => window.wos.rules.read(id),
}))
