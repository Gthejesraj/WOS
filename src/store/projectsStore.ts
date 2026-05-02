import { create } from 'zustand'
import { toast } from 'sonner'

export interface ProjectRow {
  id: string
  name: string
  slug: string
  icon: string | null
  color: string | null
  status: 'draft' | 'active' | 'paused' | 'shipped' | 'archived'
  ownerEmail: string | null
  description: string | null
  summary: string | null
  healthScore: number | null
  riskLevel: 'low' | 'medium' | 'high' | 'critical' | null
  modelOverride: string | null
  pinned: boolean
  metadata: Record<string, unknown> | null
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface ProjectResourceRow {
  id: string
  projectId: string
  kind: string
  ref: unknown
  label: string
  description: string | null
  addedAt: number
  lastFetchedAt: number | null
  refreshIntervalSec: number | null
}

export interface ProjectActivityRow {
  id: string
  projectId: string
  sourceApp: string
  sourceKind: string
  ts: number
  actor: string | null
  title: string
  url: string | null
  payload: unknown
  dedupeKey: string
}

export const NATIVE_APP_ID = 'native'
export const NATIVE_APP_NAME = 'WOS Native'

export interface ProjectMetricSample {
  metricKey: string
  ts: number
  value: number
  unit: string | null
}

export interface ResourceRefField {
  name: string
  label: string
  type: 'text' | 'textarea' | 'select'
  required?: boolean
  placeholder?: string
  hint?: string
  options?: Array<{ value: string; label: string }>
}
export interface ResourceRefSchema {
  hint?: string
  fields: ResourceRefField[]
}

export interface CatalogueEntry {
  kind: string
  label: string
  description?: string
  appId: string
  appName: string
  appIcon?: string
  multiSelect: boolean
  pickerComponentId: string
  snapshotScope?: string
  refreshIntervalSec: number
  refSchema?: ResourceRefSchema
  refExamples?: string[]
  isNative: boolean
  connected: boolean
}

export interface ProjectPersonRow {
  id: string
  projectId: string
  name: string
  email: string | null
  role: string | null
  avatarUrl: string | null
  sourceApp: string | null
  externalId: string | null
  notes: string | null
  createdAt: number
  updatedAt: number
}

export interface ProjectPersonInput {
  name: string
  email?: string
  role?: string
  avatarUrl?: string
  sourceApp?: string
  externalId?: string
  notes?: string
}

interface ProjectsStore {
  projects: ProjectRow[]
  loaded: boolean
  catalogue: CatalogueEntry[]
  selectedId: string | null
  peopleByProject: Record<string, ProjectPersonRow[]>

  load: () => Promise<void>
  loadCatalogue: () => Promise<void>
  select: (id: string | null) => void
  create: (input: Partial<ProjectRow> & { name: string }) => Promise<ProjectRow | null>
  update: (id: string, patch: Partial<ProjectRow>) => Promise<void>
  remove: (id: string) => Promise<void>
  setStatus: (id: string, status: ProjectRow['status']) => Promise<void>
  setPinned: (id: string, pinned: boolean) => Promise<void>

  loadPeople: (projectId: string) => Promise<void>
  addPerson: (projectId: string, input: ProjectPersonInput) => Promise<ProjectPersonRow | null>
  updatePerson: (projectId: string, personId: string, patch: Partial<ProjectPersonInput>) => Promise<void>
  removePerson: (projectId: string, personId: string) => Promise<void>
}

export const useProjectsStore = create<ProjectsStore>((set, get) => ({
  projects: [],
  loaded: false,
  catalogue: [],
  selectedId: null,

  load: async () => {
    try {
      const list = (await window.wos.projects.list(true)) as ProjectRow[]
      set({ projects: list, loaded: true })
    } catch (err) {
      console.error('[projects] load failed', err)
      set({ loaded: true })
    }
  },

  loadCatalogue: async () => {
    try {
      // Always fetch the FULL catalogue (connected + not connected). The
      // server tags each entry with `connected: boolean`; the renderer uses
      // that flag to badge unconnected apps and route to the custom-value
      // form fallback in ResourcePicker.
      const c = (await window.wos.projects.catalogue(false)) as CatalogueEntry[]
      set({ catalogue: c })
    } catch (err) {
      console.error('[projects] catalogue failed', err)
    }
  },

  select: (id) => set({ selectedId: id }),

  create: async (input) => {
    try {
      const row = (await window.wos.projects.create(input)) as ProjectRow
      await get().load()
      toast.success(`Created project ${row.name}`)
      return row
    } catch (err) {
      toast.error(`Create failed: ${(err as Error).message}`)
      return null
    }
  },

  update: async (id, patch) => {
    await window.wos.projects.update(id, patch)
    await get().load()
  },

  remove: async (id) => {
    await window.wos.projects.delete(id)
    await get().load()
    if (get().selectedId === id) set({ selectedId: null })
    toast.success('Project deleted')
  },

  setStatus: async (id, status) => {
    await window.wos.projects.setStatus(id, status)
    await get().load()
  },

  setPinned: async (id, pinned) => {
    await window.wos.projects.setPinned(id, pinned)
    await get().load()
  },

  peopleByProject: {},

  loadPeople: async (projectId) => {
    try {
      const list = (await window.wos.projects.listPeople(projectId)) as ProjectPersonRow[]
      set(s => ({ peopleByProject: { ...s.peopleByProject, [projectId]: list } }))
    } catch (err) {
      console.error('[projects] loadPeople failed', err)
    }
  },

  addPerson: async (projectId, input) => {
    try {
      const row = (await window.wos.projects.addPerson(projectId, input)) as ProjectPersonRow
      await get().loadPeople(projectId)
      return row
    } catch (err) {
      toast.error(`Add person failed: ${(err as Error).message}`)
      return null
    }
  },

  updatePerson: async (projectId, personId, patch) => {
    try {
      await window.wos.projects.updatePerson(personId, patch)
      await get().loadPeople(projectId)
    } catch (err) {
      toast.error(`Update person failed: ${(err as Error).message}`)
    }
  },

  removePerson: async (projectId, personId) => {
    try {
      await window.wos.projects.removePerson(personId)
      await get().loadPeople(projectId)
    } catch (err) {
      toast.error(`Remove person failed: ${(err as Error).message}`)
    }
  },
}))
