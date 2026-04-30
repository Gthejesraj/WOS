import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Toaster } from 'sonner'
import { TopBar } from './components/cursor/TopBar'
import { Sidebar } from './components/cursor/Sidebar'
import { HomeView } from './components/cursor/HomeView'
import { ChatView } from './components/cursor/ChatView'
import { SettingsView } from './components/cursor/SettingsView'
import { AppsView } from './components/cursor/AppsView'
import { AutomationsView } from './components/cursor/AutomationsView'
import { MeetingsView } from './components/cursor/MeetingsView'
import { CommandPalette, type CommandItem } from './components/cursor/CommandPalette'
import { DebugDrawer } from './components/cursor/DebugDrawer'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useAgentStore } from '../store/agentStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useSettingsStore } from '../store/settingsStore'
import { useUIStore, SIDEBAR_BOUNDS } from '../store/uiStore'
import { toast } from 'sonner'

function useThemeClass() {
  const { theme } = useSettingsStore()
  useEffect(() => {
    const html = document.documentElement
    html.classList.remove('dark', 'light')
    if (theme === 'light') {
      html.classList.add('light')
    } else if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: light)')
      html.classList.add(mq.matches ? 'light' : 'dark')
      const handler = (e: MediaQueryListEvent) => {
        html.classList.remove('dark', 'light')
        html.classList.add(e.matches ? 'light' : 'dark')
      }
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    } else {
      html.classList.add('dark')
    }
  }, [theme])
}

export default function App() {
  useThemeClass()
  const { theme } = useSettingsStore()
  const toasterTheme = (theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme) as 'light' | 'dark'

  const currentView = useUIStore(s => s.currentView)
  const setCurrentView = useUIStore(s => s.setCurrentView)
  const isSidebarCollapsed = useUIStore(s => s.isSidebarCollapsed)
  const toggleSidebar = useUIStore(s => s.toggleSidebar)
  const sidebarWidth = useUIStore(s => s.sidebarWidth)
  const setSidebarWidth = useUIStore(s => s.setSidebarWidth)
  const lastConversationId = useUIStore(s => s.lastConversationId)
  const setLastConversationId = useUIStore(s => s.setLastConversationId)

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const resizingRef = useRef(false)
  const restoredRef = useRef(false)

  const {
    activeConversationId, conversations, loadConversations,
    loadConversation, startNewConversation, deleteConversation, setActiveConversationId,
    renameConversation,
  } = useAgentStore()

  const { loadWorkspaces } = useWorkspaceStore()
  const { loadSettings } = useSettingsStore()

  useEffect(() => {
    loadSettings()
    loadConversations()
    loadWorkspaces()
    if (window.wos?.onShortcut) {
      const cleanup = window.wos.onShortcut((name) => {
        if (name === 'new-conversation') handleNewChat()
        else if (name === 'open-automations') setCurrentView('automations')
      })
      return cleanup
    }
  }, [])

  // Restore the last open conversation once after conversations have loaded.
  // This preserves "where you left off" across reloads/relaunches.
  useEffect(() => {
    if (restoredRef.current) return
    if (conversations.length === 0) return
    restoredRef.current = true
    if (
      currentView === 'chat' &&
      lastConversationId &&
      !activeConversationId &&
      conversations.some(c => c.id === lastConversationId)
    ) {
      void loadConversation(lastConversationId)
    }
  }, [conversations, currentView, lastConversationId, activeConversationId, loadConversation])

  // Mirror the active conversation into the persisted UI store so the next
  // launch knows which chat to reopen.
  useEffect(() => {
    if (activeConversationId !== lastConversationId) {
      setLastConversationId(activeConversationId)
    }
  }, [activeConversationId, lastConversationId, setLastConversationId])

  useEffect(() => {
    if (!window.wos) return
    const cleanup1 = window.wos.onUpdateReady(() => {
      toast('Update downloaded — restart to install', {
        duration: Infinity,
        action: {
          label: 'Restart Now',
          onClick: () => window.wos.restartAndUpdate(),
        },
      })
    })
    return cleanup1
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        handleNewChat()
      }
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen(o => !o)
      }
      // ⌥⌘D / Alt+Ctrl+D — debug drawer
      if (e.altKey && mod && (e.key === 'd' || e.key === 'D' || e.code === 'KeyD')) {
        e.preventDefault()
        setDebugOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const paletteCommands: CommandItem[] = [
    { id: 'new-chat',    label: 'New chat',              hint: '⌘N', run: () => handleNewChat() },
    { id: 'go-home',     label: 'Go to Home',                        run: () => setCurrentView('home') },
    { id: 'go-apps',     label: 'Open Apps',                         run: () => setCurrentView('apps') },
    { id: 'go-meetings', label: 'Open Meetings',                      run: () => setCurrentView('meetings') },
    { id: 'go-settings', label: 'Open Settings',         hint: '⌘,', run: () => setCurrentView('settings') },
    { id: 'toggle-sb',   label: 'Toggle sidebar',        hint: '⌘B', run: () => toggleSidebar() },
    { id: 'toggle-debug',label: 'Toggle Debug drawer',   hint: '⌥⌘D', run: () => setDebugOpen(o => !o) },
  ]

  const handleNewChat = () => {
    setActiveConversationId(null)
    setCurrentView('home')
  }

  const handleSelectConversation = async (id: string) => {
    await loadConversation(id)
    setCurrentView('chat')
  }

  const handleStartChat = async (message: string, _attachments?: unknown[]) => {
    const { sendMessage } = useAgentStore.getState()
    const { activeWorkspaceId } = useWorkspaceStore.getState()
    const convId = await startNewConversation(activeWorkspaceId)
    setCurrentView('chat')
    setTimeout(() => sendMessage(message), 50)
  }

  const handleRenameConversation = useCallback(async (id: string, title: string) => {
    await renameConversation(id, title)
  }, [renameConversation])

  const handleOpenChatDraft = (message: string) => {
    setActiveConversationId(null)
    useUIStore.getState().setDraft(null, message)
    setCurrentView('home')
  }

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    const startX = e.clientX
    const startW = sidebarWidth

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const next = Math.min(SIDEBAR_BOUNDS.MAX, Math.max(SIDEBAR_BOUNDS.MIN, startW + (ev.clientX - startX)))
      setSidebarWidth(next)
    }
    const onUp = () => {
      resizingRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [sidebarWidth, setSidebarWidth])

  const renderMain = () => {
    const view = (() => {
      switch (currentView) {
        case 'chat':
          return activeConversationId ? (
            <ChatView key={activeConversationId} />
          ) : (
            <HomeView onSendMessage={handleStartChat} />
          )
        case 'settings':
          return <SettingsView onBack={() => setCurrentView(activeConversationId ? 'chat' : 'home')} />
        case 'apps':
          return <AppsView />
        case 'automations':
          return <AutomationsView />
        case 'meetings':
          return <MeetingsView onOpenChat={handleOpenChatDraft} />
        default:
          return <HomeView onSendMessage={handleStartChat} />
      }
    })()
    return <ErrorBoundary key={`${currentView}-${activeConversationId ?? 'none'}`}>{view}</ErrorBoundary>
  }

  return (
    <div
      className="w-full h-screen flex flex-col overflow-hidden select-none"
      style={{ background: 'var(--background)' }}
    >
      <TopBar
        currentView={currentView}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        onRenameConversation={handleRenameConversation}
      />

      <div className="flex flex-1 overflow-hidden min-h-0">
        {!isSidebarCollapsed && (
          <Sidebar
            conversations={conversations}
            activeConversationId={activeConversationId}
            currentView={currentView}
            width={sidebarWidth}
            onResizeStart={onResizeStart}
            onSelectConversation={handleSelectConversation}
            onNewChat={handleNewChat}
            onApps={() => setCurrentView('apps')}
            onMeetings={() => setCurrentView('meetings')}
            onAutomations={() => setCurrentView('automations')}
            onSettings={() => setCurrentView('settings')}
            onDeleteConversation={deleteConversation}
            onRenameConversation={handleRenameConversation}
          />
        )}

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {renderMain()}
        </div>
      </div>

      <Toaster
        theme={toasterTheme}
        position="bottom-right"
        richColors
        toastOptions={{
          style: {
            background: 'var(--card)',
            border: '1px solid var(--border)',
            color: 'var(--foreground)',
          },
        }}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={paletteCommands}
      />

      <DebugDrawer open={debugOpen} onClose={() => setDebugOpen(false)} />
    </div>
  )
}
