import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ViewType } from '../types'

export type AppsTab = 'marketplace' | 'apps' | 'mcp' | 'skills' | 'rules'
export type AutomationsTab = 'scheduled' | 'hooks' | 'standing' | 'tasks'
export type MeetingsTab = 'calendar' | 'analyze'
export type CalendarView = 'week' | 'month' | 'today'

const SIDEBAR_MIN = 165
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 220

const HOME_DRAFT_KEY = '__home__'

interface UIState {
  // top-level routing
  currentView: ViewType
  lastConversationId: string | null

  // chrome
  isSidebarCollapsed: boolean
  sidebarWidth: number

  // sub-tabs (per-feature)
  appsTab: AppsTab
  automationsTab: AutomationsTab
  meetingsTab: MeetingsTab
  calendarView: CalendarView

  // composer drafts keyed by conversation id (or '__home__' for the new-chat home view)
  composerDrafts: Record<string, string>

  // actions
  setCurrentView: (v: ViewType) => void
  setLastConversationId: (id: string | null) => void
  setSidebarCollapsed: (b: boolean) => void
  toggleSidebar: () => void
  setSidebarWidth: (n: number) => void
  setAppsTab: (t: AppsTab) => void
  setAutomationsTab: (t: AutomationsTab) => void
  setMeetingsTab: (t: MeetingsTab) => void
  setCalendarView: (v: CalendarView) => void

  getDraft: (conversationId: string | null) => string
  setDraft: (conversationId: string | null, text: string) => void
  clearDraft: (conversationId: string | null) => void
}

const draftKey = (id: string | null) => id ?? HOME_DRAFT_KEY

const clampSidebar = (n: number) =>
  Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Number.isFinite(n) ? n : SIDEBAR_DEFAULT))

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      currentView: 'home',
      lastConversationId: null,
      isSidebarCollapsed: false,
      sidebarWidth: SIDEBAR_DEFAULT,
      appsTab: 'marketplace',
      automationsTab: 'scheduled',
      meetingsTab: 'calendar',
      calendarView: 'week',
      composerDrafts: {},

      setCurrentView: (v) => set({ currentView: v }),
      setLastConversationId: (id) => set({ lastConversationId: id }),
      setSidebarCollapsed: (b) => set({ isSidebarCollapsed: b }),
      toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed })),
      setSidebarWidth: (n) => set({ sidebarWidth: clampSidebar(n) }),
      setAppsTab: (t) => set({ appsTab: t }),
      setAutomationsTab: (t) => set({ automationsTab: t }),
      setMeetingsTab: (t) => set({ meetingsTab: t }),
      setCalendarView: (v) => set({ calendarView: v }),

      getDraft: (id) => get().composerDrafts[draftKey(id)] ?? '',
      setDraft: (id, text) =>
        set((s) => {
          const k = draftKey(id)
          if ((s.composerDrafts[k] ?? '') === text) return s
          if (text === '') {
            const { [k]: _omit, ...rest } = s.composerDrafts
            return { composerDrafts: rest }
          }
          return { composerDrafts: { ...s.composerDrafts, [k]: text } }
        }),
      clearDraft: (id) =>
        set((s) => {
          const k = draftKey(id)
          if (!(k in s.composerDrafts)) return s
          const { [k]: _omit, ...rest } = s.composerDrafts
          return { composerDrafts: rest }
        }),
    }),
    {
      name: 'wos.ui',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only persist user-affecting UI prefs / drafts. Volatile state stays in memory.
      partialize: (s) => ({
        currentView: s.currentView,
        lastConversationId: s.lastConversationId,
        isSidebarCollapsed: s.isSidebarCollapsed,
        sidebarWidth: s.sidebarWidth,
        appsTab: s.appsTab,
        automationsTab: s.automationsTab,
        meetingsTab: s.meetingsTab,
        calendarView: s.calendarView,
        composerDrafts: s.composerDrafts,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UIState>
        return {
          ...current,
          ...p,
          sidebarWidth: clampSidebar(p.sidebarWidth ?? current.sidebarWidth),
          composerDrafts: { ...current.composerDrafts, ...(p.composerDrafts ?? {}) },
        }
      },
    },
  ),
)

// One-time migration: hoist the legacy 'wos.sidebarWidth' localStorage key into the
// persisted ui store so existing users keep their sidebar size on first run.
try {
  const legacy = localStorage.getItem('wos.sidebarWidth')
  if (legacy) {
    const n = parseInt(legacy, 10)
    if (!Number.isNaN(n)) {
      const cur = useUIStore.getState().sidebarWidth
      if (cur === SIDEBAR_DEFAULT) useUIStore.setState({ sidebarWidth: clampSidebar(n) })
    }
    localStorage.removeItem('wos.sidebarWidth')
  }
} catch {
  /* localStorage unavailable */
}

export const SIDEBAR_BOUNDS = { MIN: SIDEBAR_MIN, MAX: SIDEBAR_MAX, DEFAULT: SIDEBAR_DEFAULT }
