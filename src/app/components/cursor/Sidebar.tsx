import React, { useEffect, useRef, useState } from 'react'
import { Search, Plus, ShoppingBag, Settings, Trash2, X, Calendar, MoreHorizontal, Pencil, Zap, FolderKanban } from 'lucide-react'
import type { Conversation, ViewType } from '../../../types'
import { useWorkspaceStore } from '../../../store/workspaceStore'

interface SidebarProps {
  conversations: Conversation[]
  activeConversationId: string | null
  currentView: ViewType
  width: number
  onResizeStart: (e: React.MouseEvent) => void
  onSelectConversation: (id: string) => void
  onNewChat: () => void
  onApps: () => void
  onProjects: () => void
  onMeetings: () => void
  onAutomations: () => void
  onSettings: () => void
  onDeleteConversation: (id: string) => void
  onRenameConversation: (id: string, title: string) => void
}

export function Sidebar({
  conversations,
  activeConversationId,
  currentView,
  width,
  onResizeStart,
  onSelectConversation,
  onNewChat,
  onApps,
  onProjects,
  onMeetings,
  onAutomations,
  onSettings,
  onDeleteConversation,
  onRenameConversation,
}: SidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [hoveredConvId, setHoveredConvId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(new Set())
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null)
  const { workspaces, removeWorkspace } = useWorkspaceStore()

  const filtered = searchQuery
    ? conversations.filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : conversations

  const grouped = React.useMemo(() => {
    const groups: Record<string, Conversation[]> = {}
    for (const c of filtered) {
      const key = c.workspaceId ?? 'No Workspace'
      if (!groups[key]) groups[key] = []
      groups[key].push(c)
    }
    return groups
  }, [filtered])

  const workspaceById = React.useMemo(() => {
    const m: Record<string, string> = {}
    for (const ws of workspaces) m[ws.id] = ws.name
    return m
  }, [workspaces])

  return (
    <div
      className="relative flex flex-col h-full select-none shrink-0"
      style={{
        width: `${width}px`,
        minWidth: `${width}px`,
        background: 'var(--sidebar)',
        borderRight: '1px solid var(--border)',
      }}
    >
      {/* Top nav */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-1.5">
        <button
          onClick={onNewChat}
          className="flex items-center gap-1.5 flex-1 px-2 py-1.5 rounded-md wos-hover transition-colors group"
        >
          <Plus size={13} className="shrink-0" style={{ color: 'var(--zinc-500)' }} />
          <span className="text-[12px] truncate" style={{ color: 'var(--zinc-400)' }}>New chat</span>
        </button>
        <button
          onClick={() => { setSearchOpen(o => !o); if (searchOpen) setSearchQuery('') }}
          className="p-1.5 rounded wos-hover transition-colors shrink-0"
          style={{ color: searchOpen ? 'var(--zinc-400)' : 'var(--zinc-600)' }}
        >
          {searchOpen ? <X size={13} /> : <Search size={13} />}
        </button>
      </div>

      {searchOpen && (
        <div className="px-2 pb-2">
          <input
            autoFocus
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search chats…"
            className="w-full rounded-lg px-2.5 py-1.5 outline-none"
            style={{
              background: 'var(--input)',
              border: '1px solid var(--border-strong)',
              color: 'var(--foreground)',
              fontSize: '12px',
            }}
          />
        </div>
      )}

      {/* Nav items */}
      <button
        onClick={onApps}
        className={`flex items-center gap-2 mx-2 px-2 py-1.5 rounded-md transition-colors group mb-0.5 ${
          currentView === 'apps' ? 'wos-sidebar-active' : 'wos-hover-sm'
        }`}
      >
        <ShoppingBag size={13} className="shrink-0" style={{ color: currentView === 'apps' ? 'var(--amber)' : 'var(--zinc-500)' }} />
        <span
          className="text-[12px]"
          style={{ color: currentView === 'apps' ? 'var(--foreground)' : 'var(--zinc-400)' }}
        >
          Apps
        </span>
      </button>

      <button
        onClick={onProjects}
        className={`flex items-center gap-2 mx-2 px-2 py-1.5 rounded-md transition-colors group mb-0.5 ${
          currentView === 'projects' ? 'wos-sidebar-active' : 'wos-hover-sm'
        }`}
      >
        <FolderKanban size={13} className="shrink-0" style={{ color: currentView === 'projects' ? 'var(--amber)' : 'var(--zinc-500)' }} />
        <span
          className="text-[12px]"
          style={{ color: currentView === 'projects' ? 'var(--foreground)' : 'var(--zinc-400)' }}
        >
          Projects
        </span>
      </button>

      <button
        onClick={onMeetings}
        className={`flex items-center gap-2 mx-2 px-2 py-1.5 rounded-md transition-colors group mb-0.5 ${
          currentView === 'meetings' ? 'wos-sidebar-active' : 'wos-hover-sm'
        }`}
      >
        <Calendar size={13} className="shrink-0" style={{ color: currentView === 'meetings' ? 'var(--amber)' : 'var(--zinc-500)' }} />
        <span
          className="text-[12px]"
          style={{ color: currentView === 'meetings' ? 'var(--foreground)' : 'var(--zinc-400)' }}
        >
          Meetings
        </span>
      </button>

      <button
        onClick={onAutomations}
        className={`flex items-center gap-2 mx-2 px-2 py-1.5 rounded-md transition-colors group mb-2 ${
          currentView === 'automations' ? 'wos-sidebar-active' : 'wos-hover-sm'
        }`}
      >
        <Zap size={13} className="shrink-0" style={{ color: currentView === 'automations' ? 'var(--amber)' : 'var(--zinc-500)' }} />
        <span
          className="text-[12px]"
          style={{ color: currentView === 'automations' ? 'var(--foreground)' : 'var(--zinc-400)' }}
        >
          Automations
        </span>
      </button>

      {/* Conversation list */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--border-strong) transparent' }}
      >
        {searchQuery ? (
          filtered.length === 0 ? (
            <div className="px-3 py-3 text-[12px]" style={{ color: 'var(--zinc-600)' }}>No results</div>
          ) : (
            filtered.map(c => (
              <ConvItem
                key={c.id}
                conv={c}
                isActive={c.id === activeConversationId}
                hovered={hoveredConvId === c.id}
                isRenaming={renamingId === c.id}
                onHover={setHoveredConvId}
                onClick={() => onSelectConversation(c.id)}
                onDelete={() => onDeleteConversation(c.id)}
                onRenameStart={() => setRenamingId(c.id)}
                onRenameConfirm={(title) => {
                  onRenameConversation(c.id, title)
                  setRenamingId(null)
                }}
                onRenameCancel={() => setRenamingId(null)}
              />
            ))
          )
        ) : (
          Object.entries(grouped).map(([groupKey, convs]) => {
            const isCollapsed = collapsedWorkspaces.has(groupKey)
            const isRealWorkspace = groupKey !== 'No Workspace' && workspaceById[groupKey]
            return (
              <div key={groupKey}>
                <div
                  className="flex items-center px-2 pt-3 pb-1 group/group"
                  onMouseEnter={() => setHoveredGroup(groupKey)}
                  onMouseLeave={() => setHoveredGroup(null)}
                >
                  <button
                    onClick={() => setCollapsedWorkspaces(prev => {
                      const next = new Set(prev)
                      if (next.has(groupKey)) next.delete(groupKey)
                      else next.add(groupKey)
                      return next
                    })}
                    className="flex items-center gap-1 flex-1 min-w-0 hover:opacity-80 transition-opacity"
                  >
                    <svg
                      width="8" height="8" viewBox="0 0 8 8" fill="currentColor"
                      className="shrink-0 transition-transform duration-150"
                      style={{
                        color: 'var(--zinc-600)',
                        transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                      }}
                    >
                      <path d="M1 2l3 3 3-3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span
                      className="truncate"
                      style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: 'var(--zinc-600)',
                      }}
                    >
                      {workspaceById[groupKey] ?? groupKey}
                    </span>
                  </button>
                  {isRealWorkspace && hoveredGroup === groupKey && (
                    <button
                      onClick={async () => {
                        if (!confirm(`Delete workspace "${workspaceById[groupKey]}"?\nThis removes the workspace entry only — files on disk are not deleted.`)) return
                        await removeWorkspace(groupKey)
                      }}
                      className="shrink-0 p-0.5 rounded wos-hover transition-colors"
                      style={{ color: 'var(--zinc-600)' }}
                      title="Delete workspace"
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
                {!isCollapsed && convs.map(c => (
                  <ConvItem
                    key={c.id}
                    conv={c}
                    isActive={c.id === activeConversationId}
                    hovered={hoveredConvId === c.id}
                    isRenaming={renamingId === c.id}
                    onHover={setHoveredConvId}
                    onClick={() => onSelectConversation(c.id)}
                    onDelete={() => onDeleteConversation(c.id)}
                    onRenameStart={() => setRenamingId(c.id)}
                    onRenameConfirm={(title) => {
                      onRenameConversation(c.id, title)
                      setRenamingId(null)
                    }}
                    onRenameCancel={() => setRenamingId(null)}
                  />
                ))}
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <button
        onClick={onSettings}
        className={`flex items-center gap-2 px-3 py-2.5 transition-colors ${
          currentView === 'settings' ? 'wos-sidebar-active' : 'wos-hover-sm'
        }`}
        style={{ borderTop: '1px solid var(--border)', color: currentView === 'settings' ? 'var(--foreground)' : 'var(--zinc-500)' }}
      >
        <Settings size={13} className="shrink-0" />
        <span style={{ fontSize: '12px' }}>Settings</span>
      </button>

      {/* Resize handle */}
      <div
        onMouseDown={onResizeStart}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize wos-resize-hover transition-colors"
        style={{ marginRight: '-1px' }}
      />
    </div>
  )
}

function ConvItem({
  conv, isActive, hovered, isRenaming, onHover, onClick, onDelete, onRenameStart, onRenameConfirm, onRenameCancel,
}: {
  conv: Conversation
  isActive: boolean
  hovered: boolean
  isRenaming: boolean
  onHover: (id: string | null) => void
  onClick: () => void
  onDelete: () => void
  onRenameStart: () => void
  onRenameConfirm: (title: string) => void
  onRenameCancel: () => void
}) {
  const [renameValue, setRenameValue] = useState(conv.title)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(conv.title)
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [isRenaming, conv.title])

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setMenuOpen(true)
  }

  const handleRenameKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const trimmed = renameValue.trim()
      if (trimmed) onRenameConfirm(trimmed)
      else onRenameCancel()
    } else if (e.key === 'Escape') {
      onRenameCancel()
    }
  }

  return (
    <div
      className="relative flex items-center group"
      onMouseEnter={() => onHover(conv.id)}
      onMouseLeave={() => { onHover(null); setMenuOpen(false) }}
      onContextMenu={handleContextMenu}
    >
      {isRenaming ? (
        <div className="flex-1 px-3 py-1.5">
          <input
            ref={inputRef}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKey}
            onBlur={() => {
              const trimmed = renameValue.trim()
              if (trimmed) onRenameConfirm(trimmed)
              else onRenameCancel()
            }}
            className="w-full rounded px-1.5 py-0.5 outline-none"
            style={{
              fontSize: '12px',
              background: 'var(--input)',
              border: '1px solid var(--amber)',
              color: 'var(--foreground)',
            }}
          />
        </div>
      ) : (
        <button
          onClick={onClick}
          className={`flex items-center w-full px-3 py-1.5 text-left transition-colors ${
            isActive ? 'wos-sidebar-active' : 'wos-hover-sm'
          }`}
        >
          <span
            className="truncate flex-1 text-left"
            style={{
              fontSize: '12px',
              color: isActive ? 'var(--foreground)' : 'var(--zinc-400)',
              fontWeight: isActive ? 500 : 400,
            }}
          >
            {conv.title}
          </span>
        </button>
      )}

      {/* Context menu trigger (hover) */}
      {hovered && !isRenaming && (
        <button
          onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
          className="absolute right-1 p-1 rounded wos-hover transition-colors"
          style={{ color: 'var(--zinc-500)' }}
        >
          <MoreHorizontal size={11} />
        </button>
      )}

      {/* Context menu */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full mt-0.5 z-50 rounded-lg overflow-hidden py-0.5"
          style={{
            background: 'var(--popover)',
            border: '1px solid var(--border-strong)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            minWidth: '140px',
          }}
        >
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(false); onRenameStart() }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-left wos-hover transition-colors"
            style={{ fontSize: '12px', color: 'var(--foreground)' }}
          >
            <Pencil size={11} style={{ color: 'var(--zinc-500)' }} />
            Rename
          </button>
          <div style={{ height: '1px', background: 'var(--border)', margin: '2px 0' }} />
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete() }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-red-500/10 transition-colors"
            style={{ fontSize: '12px', color: '#ef4444' }}
          >
            <Trash2 size={11} />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
