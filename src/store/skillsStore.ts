import { create } from 'zustand'
import { toast } from 'sonner'

interface SkillsStore {
  skills: SkillInfo[]
  loaded: boolean
  load: () => Promise<void>
  reload: () => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  create: (input: { name: string; description?: string; body: string; triggers?: string[] }) => Promise<{ success: boolean; id?: string; error?: string }>
  remove: (id: string) => Promise<void>
  read: (id: string) => Promise<{ success: boolean; body?: string; meta?: Record<string, unknown>; error?: string }>
}

export const useSkillsStore = create<SkillsStore>((set, get) => ({
  skills: [],
  loaded: false,

  load: async () => {
    try {
      const skills = await window.wos.skills.list()
      set({ skills, loaded: true })
    } catch (err) {
      console.error('[skills] load failed', err)
      set({ loaded: true })
    }
  },

  reload: async () => {
    await window.wos.skills.reload()
    await get().load()
  },

  setEnabled: async (id, enabled) => {
    await window.wos.skills.setEnabled(id, enabled)
    await get().load()
  },

  create: async (input) => {
    const r = await window.wos.skills.create(input)
    if (r.success) {
      toast.success(`Created skill "${input.name}"`)
      await get().load()
    } else {
      toast.error(`Create failed: ${r.error ?? 'unknown error'}`)
    }
    return r
  },

  remove: async (id) => {
    await window.wos.skills.delete(id)
    toast.success('Skill removed')
    await get().load()
  },

  read: async (id) => window.wos.skills.read(id),
}))
