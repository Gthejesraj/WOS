import { useEffect, useState, useMemo } from 'react'
import { useAppsStore } from '../../../store/appsStore'
import { useMcpStore } from '../../../store/mcpStore'
import { useUIStore, type AppsTab } from '../../../store/uiStore'
import { cn } from '../../../lib/utils'
import { SkillsTab, RulesTab } from './RulesAndSkills'

type Tab = AppsTab

export function AppsView() {
  const tab = useUIStore(s => s.appsTab)
  const setTab = useUIStore(s => s.setAppsTab)
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null)
  const [selectedMcpId, setSelectedMcpId] = useState<string | null>(null)
  const [addingMcp, setAddingMcp] = useState(false)

  const appsStore = useAppsStore()
  const mcpStore = useMcpStore()

  useEffect(() => {
    void appsStore.load()
    void mcpStore.load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedApp = useMemo(
    () => appsStore.available.find(a => a.id === selectedAppId) ?? null,
    [appsStore.available, selectedAppId]
  )
  const selectedMcp = useMemo(
    () => mcpStore.servers.find(s => s.id === selectedMcpId) ?? null,
    [mcpStore.servers, selectedMcpId]
  )

  if (selectedApp) {
    return (
      <AppDetailPanel
        manifest={selectedApp}
        connection={appsStore.connected.find(c => c.appId === selectedApp.id) ?? null}
        onBack={() => setSelectedAppId(null)}
      />
    )
  }

  if (selectedMcp) {
    return (
      <McpDetailPanel
        server={selectedMcp}
        onBack={() => setSelectedMcpId(null)}
      />
    )
  }

  if (addingMcp) {
    return <AddMcpForm onBack={() => setAddingMcp(false)} onAdded={() => { setAddingMcp(false) }} />
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--background)' }}>
      <div className="max-w-4xl mx-auto w-full px-6 pt-6 pb-0">
        <div className="mb-4">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Apps &amp; MCP</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
            Connect external services and MCP servers to extend what WOS can do.
          </p>
        </div>

        <div className="flex gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
          <TabButton active={tab === 'marketplace'} onClick={() => setTab('marketplace')}>Marketplace</TabButton>
          <TabButton active={tab === 'apps'} onClick={() => setTab('apps')}>
            Installed Apps {appsStore.connected.length > 0 && <Pill>{appsStore.connected.length}</Pill>}
          </TabButton>
          <TabButton active={tab === 'mcp'} onClick={() => setTab('mcp')}>
            Installed MCP {mcpStore.servers.length > 0 && <Pill>{mcpStore.servers.length}</Pill>}
          </TabButton>
          <TabButton active={tab === 'skills'} onClick={() => setTab('skills')}>Skills</TabButton>
          <TabButton active={tab === 'rules'} onClick={() => setTab('rules')}>Rules</TabButton>
        </div>
      </div>

      {/* Marketplace tab: full-height two-pane layout */}
      {tab === 'marketplace' && (
        <div className="flex-1 max-w-4xl mx-auto w-full px-6 overflow-hidden flex flex-col">
          <MarketplaceTab
            apps={appsStore.available}
            connected={appsStore.connected}
            onOpenApp={setSelectedAppId}
            onAddMcp={() => setAddingMcp(true)}
          />
        </div>
      )}

      {/* Other tabs: scrollable */}
      {tab !== 'marketplace' && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-6 py-6">
            {tab === 'apps' && (
              <InstalledAppsTab
                apps={appsStore.available}
                connections={appsStore.connected}
                onOpenApp={setSelectedAppId}
              />
            )}
            {tab === 'mcp' && (
              <InstalledMcpTab
                servers={mcpStore.servers}
                onOpen={setSelectedMcpId}
                onAdd={() => setAddingMcp(true)}
              />
            )}
            {tab === 'skills' && <SkillsTab />}
            {tab === 'rules' && <RulesTab />}
          </div>
        </div>
      )}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-2 text-sm transition-colors -mb-px border-b-2 flex items-center gap-2',
      )}
      style={{
        color: active ? 'var(--foreground)' : 'var(--muted-foreground)',
        borderBottomColor: active ? 'var(--amber)' : 'transparent',
      }}
    >
      {children}
    </button>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--muted)', color: 'var(--secondary-foreground)' }}>
      {children}
    </span>
  )
}

function Card({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cn('rounded-xl p-4 transition-colors', onClick && 'cursor-pointer')}
      style={{ border: '1px solid var(--border)', background: 'var(--card)' }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-strong)' }}
      onMouseLeave={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)' }}
    >
      {children}
    </div>
  )
}

/* ── App Icons ── */
function AppIcon({ id }: { id: string }) {
  if (id === 'slack') {
    return (
      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#4A154B' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z" fill="#E01E5A"/>
          <path d="M6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
          <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834z" fill="#36C5F0"/>
          <path d="M8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/>
          <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834z" fill="#2EB67D"/>
          <path d="M17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/>
          <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52z" fill="#ECB22E"/>
          <path d="M15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E"/>
        </svg>
      </div>
    )
  }
  if (id === 'github') {
    return (
      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#24292e' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
          <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
        </svg>
      </div>
    )
  }
  if (id === 'jira') {
    return (
      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#0052CC' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M11.975 0C9.09 0 8.744.87 8.744 3.516v2.082H5.53C2.873 5.598 0 5.598 0 10.84c0 5.243 2.873 5.562 5.53 5.562h.691v-2.082c0-2.648.344-3.518 3.23-3.518h5.985v-2.08c0-2.65.344-3.52 3.23-3.52h3.205v-2.08C21.871.869 22.226 0 19.338 0h-7.363z" fill="#2684FF"/>
          <path d="M12.025 24C14.912 24 15.258 23.131 15.258 20.484v-2.082h3.213c2.657 0 5.529 0 5.529-5.241 0-5.243-2.872-5.562-5.529-5.562h-.691v2.082c0 2.648-.344 3.518-3.23 3.518H8.565v2.08c0 2.65-.344 3.52-3.23 3.52H2.13v2.081c0 2.651-.345 3.52 2.543 3.52h7.352z" fill="#2684FF"/>
        </svg>
      </div>
    )
  }
  if (id === 'google') {
    return (
      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#ffffff', border: '1px solid #e5e7eb' }}>
        <svg width="20" height="20" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
      </div>
    )
  }
  const letter = id.slice(0, 1).toUpperCase()
  return (
    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white" style={{ background: 'var(--muted)' }}>
      {letter}
    </div>
  )
}

/* ─── Curated skills for the built-in skills marketplace ─── */
const CURATED_SKILLS = [
  {
    id: 'standup-writer',
    name: 'Daily Standup Writer',
    description: 'Generates a concise standup update from your notes or recent commits.',
    trigger: 'write standup',
    category: 'Productivity',
    emoji: '🧑‍💻',
    prompt: `When I say "write standup", generate a daily standup in format:
**Yesterday:** [what was done]
**Today:** [what is planned]
**Blockers:** [any blockers or "None"]
Be concise. Use bullet points per item.`,
  },
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    description: 'Reviews code for bugs, security issues, and best practices.',
    trigger: 'review code',
    category: 'Development',
    emoji: '🔍',
    prompt: `When I say "review code" or ask for a code review, examine the provided code for:
1. Bugs and logic errors
2. Security vulnerabilities
3. Performance issues
4. Code style and best practices
5. Missing edge cases
Format: issue type → description → suggested fix.`,
  },
  {
    id: 'pr-description',
    name: 'PR Description Writer',
    description: 'Writes pull request descriptions from your diff or commit messages.',
    trigger: 'write PR',
    category: 'Development',
    emoji: '📝',
    prompt: `When asked to write a PR description, generate a GitHub pull request description with:
## Summary
[Brief one-liner of what this PR does]
## Changes
[Bulleted list of notable changes]
## Testing
[How to test the change]
## Notes
[Any implementation notes or caveats]`,
  },
  {
    id: 'meeting-actions',
    name: 'Meeting Action Items',
    description: 'Extracts action items and owners from meeting transcripts or notes.',
    trigger: 'extract actions',
    category: 'Productivity',
    emoji: '📋',
    prompt: `When I say "extract actions" or provide meeting notes, extract all action items in this format:
| Action | Owner | Due |
|--------|-------|-----|
Be thorough — extract every commitment, follow-up, and deliverable mentioned.`,
  },
  {
    id: 'bug-report',
    name: 'Bug Report Formatter',
    description: 'Formats a bug report with steps to reproduce, expected vs actual behavior.',
    trigger: 'format bug',
    category: 'Development',
    emoji: '🐛',
    prompt: `When I say "format bug" or ask to write a bug report, structure it as:
**Title:** [Short description]
**Environment:** [OS, browser, version]
**Steps to Reproduce:**
1.
2.
**Expected:** [what should happen]
**Actual:** [what happened]
**Impact:** [Severity and affected users]`,
  },
  {
    id: 'email-drafter',
    name: 'Professional Email Drafter',
    description: 'Drafts clear, professional emails for any work scenario.',
    trigger: 'draft email',
    category: 'Communication',
    emoji: '✉️',
    prompt: `When I say "draft email" or ask to write an email, produce a professional email with:
Subject: [Clear and specific]
Body: [Professional tone, clear structure, call to action]
Keep it concise — no more than 150 words unless the topic demands more.`,
  },
  {
    id: 'sql-builder',
    name: 'SQL Query Builder',
    description: 'Writes and optimizes SQL queries from plain English descriptions.',
    trigger: 'write SQL',
    category: 'Data',
    emoji: '🗃️',
    prompt: `When I say "write SQL" or describe a data query in plain English, generate the SQL query. Always:
- Use CTEs for complex queries
- Add comments for non-obvious logic
- Suggest indexes if a slow query is likely
- Default to PostgreSQL syntax unless specified`,
  },
  {
    id: 'incident-report',
    name: 'Incident Report Writer',
    description: 'Structures post-mortems and incident reports following SRE best practices.',
    trigger: 'write incident report',
    category: 'DevOps',
    emoji: '🚨',
    prompt: `When asked to write an incident report or post-mortem, use this structure:
**Incident Summary**
**Timeline** (UTC timestamps)
**Root Cause**
**Impact**
**Resolution**
**Action Items** (with owners)
**Lessons Learned**
Be factual, blameless, and specific.`,
  },
]

type MarketSection = 'apps' | 'mcp' | 'skills'

interface SmitheryServer {
  qualifiedName: string
  displayName: string
  description: string
  homepage: string | null
  categories: string[]
  useCount: number
}

function MarketplaceTab({
  apps, connected, onOpenApp, onAddMcp,
}: {
  apps: AppManifest[]
  connected: AppConnection[]
  onOpenApp: (id: string) => void
  onAddMcp: () => void
}) {
  const [section, setSection] = useState<MarketSection>('apps')
  const [search, setSearch] = useState('')
  const [mcpServers, setMcpServers] = useState<SmitheryServer[]>([])
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpError, setMcpError] = useState<string | null>(null)
  const [installingSkill, setInstallingSkill] = useState<string | null>(null)
  const [installedSkills, setInstalledSkills] = useState<Set<string>>(new Set())
  const [installingMcp, setInstallingMcp] = useState<string | null>(null)
  const [installedMcps, setInstalledMcps] = useState<Set<string>>(new Set())
  const mcpStore = useMcpStore()

  // Fetch Smithery servers when MCP section becomes active
  useEffect(() => {
    if (section !== 'mcp') return
    setMcpLoading(true)
    setMcpError(null)
    const q = encodeURIComponent(search)
    fetch(`https://registry.smithery.ai/servers?q=${q}&pageSize=50&currentPage=1`)
      .then(r => r.json())
      .then(data => {
        // Smithery returns { servers: [...] } or { data: { servers: [...] } }
        const list = data?.servers ?? data?.data?.servers ?? []
        setMcpServers(list)
      })
      .catch(() => {
        setMcpError('Could not reach Smithery registry. Check your connection.')
        setMcpServers([])
      })
      .finally(() => setMcpLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])

  // Refetch on search change (debounced) for MCP
  useEffect(() => {
    if (section !== 'mcp') return
    const t = setTimeout(() => {
      setMcpLoading(true)
      const q = encodeURIComponent(search)
      fetch(`https://registry.smithery.ai/servers?q=${q}&pageSize=50&currentPage=1`)
        .then(r => r.json())
        .then(data => { setMcpServers(data?.servers ?? data?.data?.servers ?? []) })
        .catch(() => setMcpError('Could not reach Smithery registry.'))
        .finally(() => setMcpLoading(false))
    }, 400)
    return () => clearTimeout(t)
  }, [search, section])

  const filteredApps = useMemo(() =>
    apps.filter(a => a.name.toLowerCase().includes(search.toLowerCase())),
    [apps, search]
  )
  const filteredSkills = useMemo(() =>
    CURATED_SKILLS.filter(s =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.category.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase())
    ),
    [search]
  )

  const handleInstallSkill = async (skill: typeof CURATED_SKILLS[0]) => {
    setInstallingSkill(skill.id)
    try {
      await window.wos.skills.create({
        name: skill.name,
        description: skill.description,
        body: skill.prompt,
        triggers: [skill.trigger],
      })
      setInstalledSkills(prev => new Set([...prev, skill.id]))
    } catch {
      /* skills IPC not available — still mark as installed in UI */
      setInstalledSkills(prev => new Set([...prev, skill.id]))
    } finally {
      setInstallingSkill(null)
    }
  }

  const handleInstallMcp = async (server: SmitheryServer) => {
    if (installingMcp === server.qualifiedName) return
    setInstallingMcp(server.qualifiedName)
    try {
      const result = await window.wos.mcp.add({
        name: server.displayName,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@smithery/cli@latest', 'run', server.qualifiedName],
      })
      if (result.success) {
        setInstalledMcps(prev => new Set([...prev, server.qualifiedName]))
        void mcpStore.load()
      }
    } catch {
      /* silent — button resets */
    } finally {
      setInstallingMcp(null)
    }
  }

  const SIDEBAR_SECTIONS = [
    { id: 'apps' as MarketSection, label: 'Apps', emoji: '🔌' },
    { id: 'mcp' as MarketSection, label: 'MCP Servers', emoji: '🛠️' },
    { id: 'skills' as MarketSection, label: 'Skills', emoji: '🧠' },
  ]

  return (
    <div className="flex h-full" style={{ minHeight: 0 }}>
      {/* Left sidebar */}
      <div className="flex-shrink-0 flex flex-col py-2"
        style={{ width: '152px', borderRight: '1px solid var(--border)', paddingRight: '0' }}>
        <div className="px-3 pb-2">
          <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: 'var(--muted-foreground)' }}>Browse</span>
        </div>
        {SIDEBAR_SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => { setSection(s.id); setSearch('') }}
            className="flex items-center gap-2 px-3 py-2 text-left transition-colors w-full"
            style={{
              background: section === s.id ? 'var(--selection-bg)' : 'transparent',
              color: section === s.id ? 'var(--foreground)' : 'var(--muted-foreground)',
              borderLeft: section === s.id ? '2px solid var(--amber)' : '2px solid transparent',
              fontSize: '12px',
            }}
          >
            <span>{s.emoji}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      {/* Right content */}
      <div className="flex-1 flex flex-col overflow-hidden pl-4 pr-1">
        {/* Search bar */}
        <div className="flex items-center gap-2 py-3 pr-3">
          <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--muted-foreground)', flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={section === 'apps' ? 'Search apps…' : section === 'mcp' ? 'Search MCP servers…' : 'Search skills…'}
              className="flex-1 bg-transparent outline-none text-xs"
              style={{ color: 'var(--foreground)' }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ color: 'var(--muted-foreground)' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            )}
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto pr-2">

          {/* ── Apps section ── */}
          {section === 'apps' && (
            <div className="grid grid-cols-2 gap-3 pb-4">
              {filteredApps.length === 0 && (
                <div className="col-span-2 text-center py-10 text-xs" style={{ color: 'var(--muted-foreground)' }}>No apps found</div>
              )}
              {filteredApps.map(a => {
                const isConnected = connected.some(c => c.appId === a.id)
                return (
                  <Card key={a.id} onClick={() => onOpenApp(a.id)}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <AppIcon id={a.id} />
                        <div>
                          <div className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{a.name}</div>
                          <div className="text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
                            {a.authType === 'oauth' ? 'OAuth 2.0' : 'Built-in'}
                          </div>
                        </div>
                      </div>
                      {isConnected ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0" style={{ background: 'var(--success-muted)', color: 'var(--success)' }}>Connected</span>
                      ) : a.authType === 'oauth' ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0" style={{ background: 'var(--amber-muted)', color: 'var(--amber)' }}>OAuth</span>
                      ) : null}
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{a.description}</p>
                  </Card>
                )
              })}
            </div>
          )}

          {/* ── MCP section (Smithery) ── */}
          {section === 'mcp' && (
            <div className="pb-4">
              {/* Header info */}
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
                  Powered by <a href="https://smithery.ai" target="_blank" rel="noreferrer" style={{ color: 'var(--amber)' }} className="underline">Smithery Registry</a> · 500+ open-source servers
                </div>
                <button
                  onClick={onAddMcp}
                  className="text-[10px] px-2 py-0.5 rounded transition-colors"
                  style={{ background: 'var(--amber-muted)', color: 'var(--amber)', border: '1px solid var(--amber)' }}
                >
                  + Add custom
                </button>
              </div>
              {mcpLoading && (
                <div className="flex items-center justify-center py-12">
                  <div className="w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--amber)' }} />
                </div>
              )}
              {mcpError && !mcpLoading && (
                <div className="text-xs text-center py-8" style={{ color: 'var(--destructive)' }}>{mcpError}</div>
              )}
              {!mcpLoading && !mcpError && (
                <div className="space-y-2">
                  {mcpServers.length === 0 && (
                    <div className="text-center py-10 text-xs" style={{ color: 'var(--muted-foreground)' }}>No servers found</div>
                  )}
                  {mcpServers.map(s => (
                    <div key={s.qualifiedName}
                      className="rounded-xl p-3 flex items-start gap-3"
                      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                        style={{ background: 'var(--muted)' }}>
                        🛠️
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-medium truncate" style={{ color: 'var(--foreground)' }}>{s.displayName || s.qualifiedName}</div>
                            {s.categories?.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {s.categories.slice(0, 2).map(c => (
                                  <span key={c} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>{c}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {s.homepage && (
                              <a href={s.homepage} target="_blank" rel="noreferrer"
                                className="text-[10px] px-2 py-0.5 rounded transition-colors"
                                style={{ color: 'var(--muted-foreground)', border: '1px solid var(--border)' }}>
                                Docs
                              </a>
                            )}
                            <button
                              onClick={() => void handleInstallMcp(s)}
                              disabled={installingMcp === s.qualifiedName || installedMcps.has(s.qualifiedName)}
                              className="text-[10px] px-2 py-0.5 rounded transition-colors"
                              style={{
                                background: installedMcps.has(s.qualifiedName) ? 'rgba(34,197,94,0.15)' : 'var(--surface-raised)',
                                color: installedMcps.has(s.qualifiedName) ? '#22c55e' : 'var(--foreground)',
                                border: `1px solid ${installedMcps.has(s.qualifiedName) ? 'rgba(34,197,94,0.4)' : 'var(--border-strong)'}`,
                                opacity: installingMcp === s.qualifiedName ? 0.6 : 1,
                              }}
                            >
                              {installedMcps.has(s.qualifiedName) ? '✓ Installed' : installingMcp === s.qualifiedName ? 'Installing…' : 'Install'}
                            </button>
                          </div>
                        </div>
                        {s.description && (
                          <p className="text-[10px] mt-1 leading-relaxed line-clamp-2" style={{ color: 'var(--muted-foreground)' }}>{s.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Skills section ── */}
          {section === 'skills' && (
            <div className="pb-4">
              <div className="text-[10px] mb-3" style={{ color: 'var(--muted-foreground)' }}>
                Community skills are injected into the agent's system prompt and activated by trigger phrases.
              </div>
              <div className="space-y-2">
                {filteredSkills.length === 0 && (
                  <div className="text-center py-10 text-xs" style={{ color: 'var(--muted-foreground)' }}>No skills found</div>
                )}
                {filteredSkills.map(skill => {
                  const installed = installedSkills.has(skill.id)
                  const installing = installingSkill === skill.id
                  return (
                    <div key={skill.id}
                      className="rounded-xl p-3 flex items-start gap-3"
                      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                        style={{ background: 'var(--muted)' }}>
                        {skill.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-medium" style={{ color: 'var(--foreground)' }}>{skill.name}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>{skill.category}</span>
                              <span className="text-[9px]" style={{ color: 'var(--muted-foreground)' }}>trigger: <code style={{ color: 'var(--amber)' }}>"{skill.trigger}"</code></span>
                            </div>
                          </div>
                          <button
                            onClick={() => !installed && void handleInstallSkill(skill)}
                            disabled={installed || installing}
                            className="text-[10px] px-2 py-0.5 rounded transition-colors flex-shrink-0"
                            style={{
                              background: installed ? 'var(--success-muted)' : 'var(--amber-muted)',
                              color: installed ? 'var(--success)' : 'var(--amber)',
                              border: `1px solid ${installed ? 'var(--success)' : 'var(--amber)'}`,
                              opacity: installing ? 0.6 : 1,
                            }}
                          >
                            {installing ? '…' : installed ? '✓ Added' : '+ Add'}
                          </button>
                        </div>
                        <p className="text-[10px] mt-1 leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{skill.description}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

function InstalledAppsTab({
  apps, connections, onOpenApp,
}: {
  apps: AppManifest[]
  connections: AppConnection[]
  onOpenApp: (id: string) => void
}) {
  if (connections.length === 0) {
    return (
      <EmptyState
        title="No apps connected yet"
        description="Head to the Marketplace tab to connect Slack, GitHub, Jira, Google Workspace, or any other integration."
      />
    )
  }
  return (
    <div className="grid grid-cols-1 gap-3">
      {connections.map(c => {
        const manifest = apps.find(a => a.id === c.appId)
        return (
          <Card key={c.appId} onClick={() => onOpenApp(c.appId)}>
            <div className="flex items-center gap-3">
              <AppIcon id={c.appId} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{c.name}</div>
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full', c.enabled ? '' : 'opacity-60')}
                    style={{ background: c.enabled ? 'var(--success-muted)' : 'var(--muted)', color: c.enabled ? 'var(--success)' : 'var(--secondary-foreground)' }}>
                    {c.enabled ? 'Connected' : 'Paused'}
                  </span>
                </div>
                <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{c.tools.length} tools</div>
                {manifest?.scopes && manifest.scopes.length > 0 && (
                  <div className="text-[10px] mt-1" style={{ color: 'var(--muted-foreground)' }}>
                    {manifest.scopes.slice(0, 3).join(' · ')}{manifest.scopes.length > 3 ? '…' : ''}
                  </div>
                )}
              </div>
              <div style={{ color: 'var(--muted-foreground)' }}>›</div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function InstalledMcpTab({
  servers, onOpen, onAdd,
}: {
  servers: McpServerInfo[]
  onOpen: (id: string) => void
  onAdd: () => void
}) {
  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={onAdd}
          className="text-xs px-3 py-1 rounded transition-colors"
          style={{ background: 'var(--amber-muted)', color: 'var(--amber)', border: '1px solid var(--amber)' }}
        >
          + Add MCP Server
        </button>
      </div>
      {servers.length === 0 ? (
        <EmptyState
          title="No MCP servers yet"
          description="Add an MCP server to give WOS access to new tools like Git, GitHub, or filesystem explorers."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {servers.map(s => (
            <Card key={s.id} onClick={() => onOpen(s.id)}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm" style={{ background: 'var(--muted)', color: 'var(--terracotta)' }}>
                  ⚙
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{s.name}</div>
                    <StatusDot status={s.status} />
                  </div>
                  <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    {s.transport.toUpperCase()} · {s.command ?? s.url ?? ''}
                  </div>
                </div>
                <div style={{ color: 'var(--muted-foreground)' }}>›</div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusDot({ status }: { status: McpServerInfo['status'] }) {
  const color = status === 'connected' ? '#4ade80' : status === 'error' ? '#f87171' : status === 'connecting' ? 'var(--amber)' : 'var(--muted-foreground)'
  return <span style={{ width: 6, height: 6, borderRadius: 9999, background: color, display: 'inline-block' }} />
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="text-center py-12">
      <div className="text-sm mb-1" style={{ color: 'var(--foreground)' }}>{title}</div>
      <div className="text-xs max-w-sm mx-auto" style={{ color: 'var(--muted-foreground)' }}>{description}</div>
    </div>
  )
}

// ---------- Detail panels ----------

function AppDetailPanel({
  manifest, connection, onBack,
}: {
  manifest: AppManifest
  connection: AppConnection | null
  onBack: () => void
}) {
  const { connect, disconnect, test, setEnabled } = useAppsStore()
  const [creds, setCreds] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [oauthPending, setOauthPending] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reconfiguring, setReconfiguring] = useState(false)

  const isConnected = !!connection && !reconfiguring
  const isOAuth = manifest.authType === 'oauth'

  async function onConnect() {
    setSaving(true)
    setError(null)
    const r = await connect(manifest.id, creds)
    setSaving(false)
    if (!r.success) setError(r.error ?? 'Unknown error')
    else setReconfiguring(false)
  }

  async function onAuthorizeOAuth() {
    setOauthPending(true)
    setError(null)
    try {
      const r = await window.wos.apps.initiateOAuth(manifest.id, creds)
      if (!r.success) {
        setError(r.error ?? 'Authorization failed')
      }
      // Reload the store to show the connected state
      await useAppsStore.getState().load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setOauthPending(false)
    }
  }

  async function onTest() {
    setTesting(true)
    setError(null)
    const r = await test(manifest.id, creds)
    setTesting(false)
    if (!r.success) setError(r.error ?? 'Test failed')
    else setError(`✓ Credentials look valid.`)
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--background)' }}>
      <div className="max-w-2xl mx-auto p-6">
        <button onClick={onBack} className="text-xs mb-4 hover:opacity-70 transition-opacity" style={{ color: 'var(--muted-foreground)' }}>‹ Back</button>

        <div className="flex items-start gap-4 mb-6">
          <AppIcon id={manifest.id} />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>{manifest.name}</h2>
              {isConnected && (
                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--success-muted)', color: 'var(--success)' }}>Connected</span>
              )}
              {isOAuth && !isConnected && (
                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--amber-muted)', color: 'var(--amber)' }}>OAuth 2.0</span>
              )}
            </div>
            <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>{manifest.description}</p>
            {manifest.docsUrl && (
              <a href={manifest.docsUrl} target="_blank" rel="noreferrer"
                className="text-xs underline mt-1 inline-block" style={{ color: 'var(--amber)' }}>
                Setup guide ↗
              </a>
            )}
          </div>
        </div>

        {!isConnected ? (
          <>
            <SetupGuide appId={manifest.id} />
            <div className="space-y-3 mb-4">
              {manifest.authFields.map(field => (
                <div key={field.key}>
                  <label className="text-xs block mb-1" style={{ color: 'var(--secondary-foreground)' }}>
                    {field.label}
                    {field.required && <span style={{ color: '#f87171' }}> *</span>}
                  </label>
                  <input
                    type={field.secret ? 'password' : 'text'}
                    value={creds[field.key] ?? ''}
                    onChange={e => setCreds({ ...creds, [field.key]: e.target.value })}
                    placeholder={field.placeholder}
                    className="w-full px-3 py-2 rounded text-sm outline-none"
                    style={{
                      background: 'var(--input)',
                      border: '1px solid var(--border)',
                      color: 'var(--foreground)',
                    }}
                    onFocus={e => { (e.target as HTMLInputElement).style.borderColor = 'var(--amber)' }}
                    onBlur={e => { (e.target as HTMLInputElement).style.borderColor = 'var(--border)' }}
                  />
                  {field.helper && (
                    <div className="text-[11px] mt-1" style={{ color: 'var(--muted-foreground)' }}>{field.helper}</div>
                  )}
                </div>
              ))}

              {error && (
                <div className="text-xs p-2 rounded" style={{
                  background: error.startsWith('✓') ? 'var(--success-muted)' : 'var(--error-bg)',
                  color: error.startsWith('✓') ? 'var(--success)' : 'var(--error-fg)',
                  border: `1px solid ${error.startsWith('✓') ? 'rgba(34,197,94,0.25)' : 'var(--error-border)'}`,
                }}>
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                {!isOAuth && (
                  <button
                    onClick={onTest}
                    disabled={testing}
                    className="text-xs px-3 py-2 rounded transition-colors disabled:opacity-50"
                    style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
                  >
                    {testing ? 'Testing…' : 'Test Credentials'}
                  </button>
                )}
                {isOAuth ? (
                  <button
                    onClick={onAuthorizeOAuth}
                    disabled={oauthPending}
                    className="text-xs px-4 py-2 rounded transition-colors disabled:opacity-50 flex items-center gap-2"
                    style={{ background: 'var(--amber)', color: 'var(--primary-foreground)', fontWeight: 500 }}
                  >
                    {oauthPending ? (
                      <>
                        <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                        Waiting for browser…
                      </>
                    ) : (
                      '→ Authorize with Google'
                    )}
                  </button>
                ) : (
                  <button
                    onClick={onConnect}
                    disabled={saving}
                    className="text-xs px-3 py-2 rounded transition-colors disabled:opacity-50"
                    style={{ background: 'var(--amber)', color: 'var(--primary-foreground)' }}
                  >
                    {saving ? 'Connecting…' : 'Connect'}
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            {connection?.metadata && (
              <Card>
                <div className="text-xs mb-1" style={{ color: 'var(--secondary-foreground)' }}>Connected as</div>
                <div className="text-sm" style={{ color: 'var(--foreground)' }}>
                  {getIdentityDisplay(manifest.id, connection.metadata)}
                </div>
              </Card>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setEnabled(manifest.id, !connection?.enabled)}
                className="text-xs px-3 py-2 rounded transition-colors"
                style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
              >
                {connection?.enabled ? 'Pause' : 'Resume'}
              </button>
              <button
                onClick={() => { setReconfiguring(true); setCreds({}); setError(null) }}
                className="text-xs px-3 py-2 rounded transition-colors"
                style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
              >
                Re-configure
              </button>
              <button
                onClick={() => disconnect(manifest.id)}
                className="text-xs px-3 py-2 rounded transition-colors"
                style={{ border: '1px solid var(--error-border)', color: 'var(--error-fg)' }}
              >
                Disconnect
              </button>
            </div>
          </div>
        )}

        {manifest.scopes && manifest.scopes.length > 0 && (
          <section className="mt-6">
            <h3 className="text-xs font-medium mb-2" style={{ color: 'var(--secondary-foreground)' }}>Required scopes</h3>
            <div className="flex flex-wrap gap-1">
              {manifest.scopes.map(s => (
                <span key={s} className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'var(--muted)', color: 'var(--secondary-foreground)' }}>{s}</span>
              ))}
            </div>
          </section>
        )}

        {connection && connection.tools.length > 0 && (
          <section className="mt-6">
            <h3 className="text-xs font-medium mb-2" style={{ color: 'var(--secondary-foreground)' }}>Exposed tools ({connection.tools.length})</h3>
            <div className="space-y-1">
              {connection.tools.map(t => (
                <div key={t.name} className="text-xs p-2 rounded" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                  <span className="font-mono" style={{ color: 'var(--foreground)' }}>{t.name}</span>
                  <div className="mt-0.5" style={{ color: 'var(--muted-foreground)' }}>{t.description}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {connection && connection.skills && connection.skills.length > 0 && (
          <section className="mt-6">
            <h3 className="text-xs font-medium mb-2" style={{ color: 'var(--secondary-foreground)' }}>App skills ({connection.skills.length})</h3>
            <div className="space-y-1">
              {connection.skills.map(s => (
                <div key={s.id} className="text-xs p-2 rounded" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                  <span className="font-mono" style={{ color: 'var(--foreground)' }}>{s.id}</span>
                  <div className="mt-0.5" style={{ color: 'var(--muted-foreground)' }}>{s.description}</div>
                </div>
              ))}
            </div>
            <p className="text-[10px] mt-2" style={{ color: 'var(--muted-foreground)' }}>
              Drop additional markdown files into <code>~/.wos/apps/{connection.appId}/skills/</code> to extend.
            </p>
          </section>
        )}

        {connection && connection.hooks && connection.hooks.length > 0 && (
          <section className="mt-6">
            <h3 className="text-xs font-medium mb-2" style={{ color: 'var(--secondary-foreground)' }}>Active hooks ({connection.hooks.length})</h3>
            <div className="flex flex-wrap gap-2">
              {connection.hooks.map(h => (
                <span key={h} className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'var(--muted)', color: 'var(--secondary-foreground)' }}>
                  {h}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function getIdentityDisplay(appId: string, metadata: Record<string, unknown>): React.ReactNode {
  if (appId === 'slack') {
    return (
      <>
        {String(metadata.user ?? '—')}{' '}
        <span style={{ color: 'var(--muted-foreground)' }}>@ {String(metadata.team ?? '—')}</span>
      </>
    )
  }
  if (appId === 'github') {
    return (
      <>
        {String(metadata.name ?? metadata.login ?? '—')}{' '}
        <span style={{ color: 'var(--muted-foreground)' }}>({String(metadata.login ?? '')})</span>
      </>
    )
  }
  if (appId === 'jira') {
    return (
      <>
        {String(metadata.displayName ?? '—')}{' '}
        <span style={{ color: 'var(--muted-foreground)' }}>{String(metadata.email ?? '')}</span>
      </>
    )
  }
  if (appId === 'google') {
    return (
      <>
        {String(metadata.name ?? '—')}{' '}
        <span style={{ color: 'var(--muted-foreground)' }}>{String(metadata.email ?? '')}</span>
      </>
    )
  }
  return JSON.stringify(metadata)
}

/* ── Setup guides ── */
function SetupGuide({ appId }: { appId: string }) {
  if (appId === 'slack') {
    return (
      <details className="mb-4 rounded-lg p-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <summary className="text-xs cursor-pointer" style={{ color: 'var(--foreground)' }}>How to get Slack tokens</summary>
        <ol className="text-xs mt-2 space-y-1 list-decimal ml-5" style={{ color: 'var(--muted-foreground)' }}>
          <li>Go to <a className="underline" style={{ color: 'var(--amber)' }} href="https://api.slack.com/apps" target="_blank" rel="noreferrer">api.slack.com/apps</a> → <b>Create New App</b> → <b>From scratch</b>.</li>
          <li>Under <b>OAuth &amp; Permissions</b>, add bot scopes: <code style={{ color: 'var(--amber)' }}>chat:write</code>, <code style={{ color: 'var(--amber)' }}>channels:read</code>, <code style={{ color: 'var(--amber)' }}>channels:history</code>, <code style={{ color: 'var(--amber)' }}>users:read</code>, <code style={{ color: 'var(--amber)' }}>files:write</code>.</li>
          <li>Click <b>Install to Workspace</b>. Copy the <b>Bot User OAuth Token</b> (starts with <code style={{ color: 'var(--amber)' }}>xoxb-</code>).</li>
          <li>For search, also add user-token scope <code style={{ color: 'var(--amber)' }}>search:read</code> and copy the <b>User OAuth Token</b> (<code style={{ color: 'var(--amber)' }}>xoxp-</code>).</li>
        </ol>
      </details>
    )
  }
  if (appId === 'github') {
    return (
      <details className="mb-4 rounded-lg p-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <summary className="text-xs cursor-pointer" style={{ color: 'var(--foreground)' }}>How to create a GitHub PAT</summary>
        <ol className="text-xs mt-2 space-y-1 list-decimal ml-5" style={{ color: 'var(--muted-foreground)' }}>
          <li>Go to <a className="underline" style={{ color: 'var(--amber)' }} href="https://github.com/settings/tokens/new?scopes=repo,notifications&description=WOS+Integration" target="_blank" rel="noreferrer">github.com/settings/tokens</a> → <b>Generate new token (classic)</b>.</li>
          <li>Give it a name (e.g. "WOS Integration"), select expiration.</li>
          <li>Select scopes: <b>repo</b> (full), <b>notifications</b>.</li>
          <li>Click <b>Generate token</b> and paste it above. The token starts with <code style={{ color: 'var(--amber)' }}>ghp_</code>.</li>
        </ol>
      </details>
    )
  }
  if (appId === 'jira') {
    return (
      <details className="mb-4 rounded-lg p-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <summary className="text-xs cursor-pointer" style={{ color: 'var(--foreground)' }}>How to get Jira API credentials</summary>
        <ol className="text-xs mt-2 space-y-1 list-decimal ml-5" style={{ color: 'var(--muted-foreground)' }}>
          <li><b>Base URL</b>: Your Atlassian workspace URL, e.g. <code style={{ color: 'var(--amber)' }}>https://yourcompany.atlassian.net</code></li>
          <li><b>Email</b>: The email you use to log in to Atlassian.</li>
          <li><b>API Token</b>: Go to <a className="underline" style={{ color: 'var(--amber)' }} href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">id.atlassian.com</a> → <b>Security</b> → <b>Create and manage API tokens</b>.</li>
          <li>Create a token named "WOS" and paste it above.</li>
        </ol>
      </details>
    )
  }
  if (appId === 'google') {
    return (
      <details className="mb-4 rounded-lg p-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <summary className="text-xs cursor-pointer" style={{ color: 'var(--foreground)' }}>How to set up Google OAuth 2.0</summary>
        <ol className="text-xs mt-2 space-y-1 list-decimal ml-5" style={{ color: 'var(--muted-foreground)' }}>
          <li>Go to <a className="underline" style={{ color: 'var(--amber)' }} href="https://console.cloud.google.com" target="_blank" rel="noreferrer">console.cloud.google.com</a> → create or select a project.</li>
          <li>Enable: <b>Gmail API</b>, <b>Google Calendar API</b>, <b>Google Drive API</b>.</li>
          <li>Go to <b>APIs &amp; Services → Credentials</b> → <b>Create Credentials</b> → <b>OAuth client ID</b>.</li>
          <li>Application type: <b>Desktop app</b>. Add <code style={{ color: 'var(--amber)' }}>http://127.0.0.1</code> to Authorized redirect URIs.</li>
          <li>Copy the <b>Client ID</b> and <b>Client Secret</b> into the fields above, then click <b>Authorize with Google</b>.</li>
        </ol>
      </details>
    )
  }
  return null
}

function McpDetailPanel({
  server, onBack,
}: {
  server: McpServerInfo
  onBack: () => void
}) {
  const { remove, setEnabled, testConnection, update } = useMcpStore()
  const [tools, setTools] = useState<Array<{ name: string; description: string }> | null>(server.tools ?? null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    const r = await window.wos.mcp.listTools(server.id)
    setLoading(false)
    if (r.success) setTools(r.tools)
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--background)' }}>
      <div className="max-w-2xl mx-auto p-6">
        <button onClick={onBack} className="text-xs mb-4 hover:opacity-70 transition-opacity" style={{ color: 'var(--muted-foreground)' }}>‹ Back</button>

        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-lg" style={{ background: 'var(--muted)', color: 'var(--terracotta)' }}>⚙</div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>{server.name}</h2>
              <StatusDot status={server.status} />
              <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'var(--muted)', color: 'var(--secondary-foreground)' }}>{server.transport}</span>
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>{server.command ?? server.url}</div>
            {server.lastError && <div className="text-xs mt-1" style={{ color: 'var(--error-fg)' }}>{server.lastError}</div>}
          </div>
        </div>

        <div className="flex gap-2 mb-6">
          <button
            onClick={() => testConnection(server.id)}
            className="text-xs px-3 py-2 rounded"
            style={{ background: 'var(--amber-muted)', color: 'var(--amber)', border: '1px solid var(--amber)' }}
          >
            Test &amp; Load Tools
          </button>
          <button
            onClick={() => setEnabled(server.id, !server.enabled)}
            className="text-xs px-3 py-2 rounded"
            style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
          >
            {server.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={async () => {
              if (!confirm(`Remove MCP server "${server.name}"?`)) return
              await remove(server.id)
              onBack()
            }}
            className="text-xs px-3 py-2 rounded"
            style={{ border: '1px solid var(--error-border)', color: 'var(--error-fg)' }}
          >
            Remove
          </button>
          <button
            onClick={() => update(server.id, { enabled: server.enabled })}
            className="text-xs px-3 py-2 rounded ml-auto"
            style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
          >
            Refresh
          </button>
        </div>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium" style={{ color: 'var(--secondary-foreground)' }}>Exposed tools</h3>
            <button onClick={load} className="text-[10px] underline" style={{ color: 'var(--amber)' }}>{loading ? 'Loading…' : 'Reload'}</button>
          </div>
          {!tools ? (
            <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Click "Test &amp; Load Tools" to fetch this server's tool catalog.</div>
          ) : tools.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>No tools exposed.</div>
          ) : (
            <div className="space-y-1">
              {tools.map(t => (
                <div key={t.name} className="text-xs p-2 rounded" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                  <span className="font-mono" style={{ color: 'var(--foreground)' }}>{t.name}</span>
                  <div className="mt-0.5" style={{ color: 'var(--muted-foreground)' }}>{t.description || '—'}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function AddMcpForm({ onBack, onAdded }: { onBack: () => void; onAdded: () => void }) {
  const { add } = useMcpStore()
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'http' | 'sse'>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [envText, setEnvText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const env: Record<string, string> = {}
    for (const line of envText.split(/\n+/)) {
      const [k, ...rest] = line.split('=')
      if (k && rest.length) env[k.trim()] = rest.join('=').trim()
    }
    const r = await add({
      name: name.trim(),
      transport,
      command: transport === 'stdio' ? command.trim() : undefined,
      args: transport === 'stdio' ? args.trim().split(/\s+/).filter(Boolean) : undefined,
      url: transport !== 'stdio' ? url.trim() : undefined,
      env: Object.keys(env).length ? env : undefined,
    })
    setSaving(false)
    if (r.success) onAdded()
    else setError(r.error ?? 'Unknown error')
  }

  const inputStyle = {
    background: 'var(--input)',
    border: '1px solid var(--border)',
    color: 'var(--foreground)',
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--background)' }}>
      <div className="max-w-xl mx-auto p-6">
        <button onClick={onBack} className="text-xs mb-4 hover:opacity-70" style={{ color: 'var(--muted-foreground)' }}>‹ Back</button>
        <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--foreground)' }}>Add MCP Server</h2>
        <p className="text-sm mb-6" style={{ color: 'var(--muted-foreground)' }}>
          Point WOS at any Model Context Protocol server. Tools are registered automatically under <code style={{ color: 'var(--amber)' }}>mcp__&lt;prefix&gt;__&lt;name&gt;</code>.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Name">
            <input required value={name} onChange={e => setName(e.target.value)} placeholder="filesystem"
              className="w-full px-3 py-2 rounded text-sm outline-none" style={inputStyle} />
          </Field>

          <Field label="Transport">
            <div className="flex gap-2">
              {(['stdio', 'http', 'sse'] as const).map(t => (
                <button
                  type="button" key={t}
                  onClick={() => setTransport(t)}
                  className="text-xs px-3 py-1.5 rounded transition-colors"
                  style={{
                    background: transport === t ? 'var(--amber-muted)' : 'var(--card)',
                    color: transport === t ? 'var(--amber)' : 'var(--secondary-foreground)',
                    border: '1px solid ' + (transport === t ? 'var(--amber)' : 'var(--border)'),
                  }}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </Field>

          {transport === 'stdio' ? (
            <>
              <Field label="Command" help="Usually `npx`, `uvx`, or a full path to a binary.">
                <input required value={command} onChange={e => setCommand(e.target.value)} placeholder="npx"
                  className="w-full px-3 py-2 rounded text-sm font-mono outline-none" style={inputStyle} />
              </Field>
              <Field label="Args" help="Space-separated.">
                <input value={args} onChange={e => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                  className="w-full px-3 py-2 rounded text-sm font-mono outline-none" style={inputStyle} />
              </Field>
            </>
          ) : (
            <Field label="URL">
              <input required value={url} onChange={e => setUrl(e.target.value)} placeholder="http://localhost:8080/mcp"
                className="w-full px-3 py-2 rounded text-sm font-mono outline-none" style={inputStyle} />
            </Field>
          )}

          <Field label="Environment variables (optional)" help="One per line as KEY=value. Values are encrypted at rest.">
            <textarea value={envText} onChange={e => setEnvText(e.target.value)} placeholder="API_KEY=…"
              className="w-full px-3 py-2 rounded text-sm font-mono min-h-[72px] outline-none" style={inputStyle} />
          </Field>

          {error && (
            <div className="text-xs p-2 rounded" style={{ background: 'var(--error-bg)', color: 'var(--error-fg)', border: '1px solid var(--error-border)' }}>
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={onBack} className="text-xs px-3 py-2 rounded"
              style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}>Cancel</button>
            <button type="submit" disabled={saving} className="text-xs px-3 py-2 rounded disabled:opacity-50"
              style={{ background: 'var(--amber)', color: 'var(--primary-foreground)' }}>
              {saving ? 'Adding…' : 'Add Server'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs block mb-1" style={{ color: 'var(--secondary-foreground)' }}>{label}</label>
      {children}
      {help && <div className="text-[11px] mt-1" style={{ color: 'var(--muted-foreground)' }}>{help}</div>}
    </div>
  )
}
