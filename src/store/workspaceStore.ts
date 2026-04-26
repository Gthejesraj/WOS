import { create } from 'zustand'
import type { Workspace } from '../types'

interface WorkspaceStore {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  activeWorkspace: Workspace | null

  loadWorkspaces: () => Promise<void>
  addWorkspace: () => Promise<Workspace | null>
  setActiveWorkspace: (id: string | null) => Promise<void>
  removeWorkspace: (id: string) => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  activeWorkspace: null,

  loadWorkspaces: async () => {
    const [workspaces, activeId] = await Promise.all([
      window.wos.getWorkspaces() as Promise<Workspace[]>,
      window.wos.getSetting('activeWorkspaceId') as Promise<string | null>,
    ])
    const activeWorkspace = workspaces.find(w => w.id === activeId) ?? null
    set({ workspaces, activeWorkspaceId: activeId, activeWorkspace })
  },

  addWorkspace: async () => {
    const ws = await window.wos.openWorkspace() as Workspace | null
    if (!ws) return null

    set(s => ({
      workspaces: [...s.workspaces.filter(w => w.id !== ws.id), ws],
      activeWorkspaceId: ws.id,
      activeWorkspace: ws,
    }))
    await window.wos.setSetting('activeWorkspaceId', ws.id)
    return ws
  },

  setActiveWorkspace: async (id) => {
    const { workspaces } = get()
    const activeWorkspace = id ? workspaces.find(w => w.id === id) ?? null : null
    set({ activeWorkspaceId: id, activeWorkspace })
    await window.wos.setSetting('activeWorkspaceId', id)
  },

  removeWorkspace: async (id) => {
    await window.wos.removeWorkspace(id)
    const { activeWorkspaceId } = get()
    set(s => ({
      workspaces: s.workspaces.filter(w => w.id !== id),
      activeWorkspaceId: activeWorkspaceId === id ? null : activeWorkspaceId,
      activeWorkspace: activeWorkspaceId === id ? null : s.activeWorkspace,
    }))
    if (activeWorkspaceId === id) {
      await window.wos.setSetting('activeWorkspaceId', null)
    }
  },
}))
