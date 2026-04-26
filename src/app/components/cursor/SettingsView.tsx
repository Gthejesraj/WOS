import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Key, Settings as SettingsIcon, Info, CheckCircle2, XCircle, Loader2, RefreshCw,
  ChevronDown, Eye, Brain, Folder, Trash2, Plus, Sparkles, ScrollText, Sun, Moon, Monitor,
  Link, BarChart2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { ModelInfo, AgentMode } from '../../../types'
import { useSettingsStore } from '../../../store/settingsStore'
import { useWorkspaceStore } from '../../../store/workspaceStore'
import { useAgentStore } from '../../../store/agentStore'
import { useSkillsStore } from '../../../store/skillsStore'
import { useRulesStore } from '../../../store/rulesStore'
import { modelSupportsReasoning } from '../../../lib/modelCapabilities'

interface SettingsViewProps {
  onBack: () => void
}

type SectionId = 'preferences' | 'ai-agents' | 'connections' | 'account'

const SECTIONS: Array<{ id: SectionId; label: string; icon: React.ElementType; description: string }> = [
  { id: 'preferences', label: 'Preferences', icon: SettingsIcon, description: 'Appearance, theme, default mode' },
  { id: 'ai-agents', label: 'AI & Agents', icon: Brain, description: 'Models, agents, skills, rules, workspaces' },
  { id: 'connections', label: 'Connections', icon: Link, description: 'API keys and integrations' },
  { id: 'account', label: 'Account', icon: BarChart2, description: 'Usage, billing, and about' },
]

export function SettingsView({ onBack }: SettingsViewProps) {
  const [section, setSection] = useState<SectionId>('preferences')
  return (
    <div className="w-full h-full flex" style={{ background: 'var(--background)' }}>
      {/* Settings sidebar nav */}
      <div className="shrink-0 w-56 flex flex-col" style={{ background: 'var(--sidebar)', borderRight: '1px solid var(--border)' }}>
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-2.5 hover:bg-white/5 transition-colors"
          style={{ fontSize: '12px', color: 'var(--muted-foreground)', borderBottom: '1px solid var(--border)' }}
        >
          <ArrowLeft size={12} />
          Back
        </button>
        <div className="mt-2 px-2 space-y-0.5">
          {SECTIONS.map(s => {
            const Icon = s.icon
            const active = section === s.id
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-md transition-colors text-left ${
                  active ? 'bg-white/8' : 'hover:bg-white/5'
                }`}
              >
                <Icon size={13} style={{ color: active ? 'var(--amber)' : 'var(--zinc-500)', flexShrink: 0 }} />
                <span style={{ fontSize: '13px', color: active ? 'var(--foreground)' : 'var(--zinc-400)', fontWeight: active ? 500 : 400 }}>
                  {s.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Settings content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-8">
          {section === 'preferences' && <PreferencesSection />}
          {section === 'ai-agents' && <AIAgentsSection />}
          {section === 'connections' && <ConnectionsSection />}
          {section === 'account' && <AccountSection />}
        </div>
      </div>
    </div>
  )
}

// Preferences = Appearance + Default Mode (from former General, minus model/reasoning)
function PreferencesSection() {
  const { defaultMode, theme, saveSetting } = useSettingsStore()

  const THEME_OPTIONS: Array<{ id: 'dark' | 'light' | 'system'; label: string; icon: React.ElementType }> = [
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'system', label: 'System', icon: Monitor },
  ]

  return (
    <div className="space-y-8">
      <SectionHeader title="Preferences" subtitle="Appearance and default behavior for new chats" />

      <Field label="Appearance" hint="Choose your color theme">
        <div className="flex items-center gap-1">
          {THEME_OPTIONS.map(opt => {
            const Icon = opt.icon
            const active = (theme ?? 'dark') === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => saveSetting('theme', opt.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors"
                style={{
                  fontSize: '12px',
                  background: active ? 'var(--amber-muted)' : 'rgba(255,255,255,0.05)',
                  color: active ? 'var(--amber)' : 'var(--muted-foreground)',
                  border: active ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent',
                }}
              >
                <Icon size={12} />
                {opt.label}
              </button>
            )
          })}
        </div>
      </Field>

      <Field label="Default Mode" hint="Starting agent mode for new chats">
        <div className="flex items-center gap-1">
          {(['default', 'plan', 'yolo'] as AgentMode[]).map(m => (
            <button
              key={m}
              onClick={() => saveSetting('defaultMode', m)}
              className="px-3 py-1.5 rounded-md capitalize transition-colors"
              style={{
                fontSize: '12px',
                background: defaultMode === m ? 'var(--amber-muted)' : 'rgba(255,255,255,0.05)',
                color: defaultMode === m ? 'var(--amber)' : 'var(--muted-foreground)',
                border: defaultMode === m ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent',
              }}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="mt-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
          <strong className="font-medium" style={{ color: 'var(--foreground)' }}>Default</strong> — asks permission before each action.{' '}
          <strong className="font-medium" style={{ color: 'var(--foreground)' }}>Plan</strong> — plans first, waits for your approval.{' '}
          <strong className="font-medium" style={{ color: 'var(--foreground)' }}>Yolo</strong> — fully autonomous.
        </div>
      </Field>
    </div>
  )
}

// AI & Agents = Model + Reasoning + Agents + Skills + Rules + Workspaces
function AIAgentsSection() {
  const { defaultModel, reasoningEffort, saveSetting } = useSettingsStore()
  const { models, loading, refresh } = useSavedModels()

  const selected = models.find(m => m.id === defaultModel)
  const supportsReasoning = selected
    ? selected.supportsReasoning === true
    : modelSupportsReasoning(defaultModel)

  return (
    <div className="space-y-10">
      <SectionHeader title="AI & Agents" subtitle="Model, reasoning, agent configuration, skills, rules, and workspaces" />

      {/* Model */}
      <div className="space-y-6">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Default Model</h3>
        <Field label="Model" hint="Used for new conversations">
          <ModelAutocomplete
            models={models}
            loading={loading}
            value={defaultModel}
            onChange={(id) => saveSetting('defaultModel', id)}
            onRefresh={refresh}
          />
          {selected?.description && (
            <div className="mt-2" style={{ color: 'var(--muted-foreground)', fontSize: '11px' }}>{selected.description}</div>
          )}
        </Field>
        <Field
          label="Reasoning Effort"
          hint={supportsReasoning
            ? 'Controls how much the model reasons before answering'
            : 'The selected model does not support reasoning.'}
        >
          <div className={supportsReasoning ? '' : 'opacity-40 pointer-events-none'}>
            <div className="flex items-center gap-1">
              {(['low', 'medium', 'high', 'max'] as const).map(e => (
                <button
                  key={e}
                  disabled={!supportsReasoning}
                  onClick={() => saveSetting('reasoningEffort', e)}
                  className="px-3 py-1.5 rounded-md capitalize transition-colors"
                  style={{
                    fontSize: '12px',
                    background: reasoningEffort === e ? 'var(--amber-muted)' : 'rgba(255,255,255,0.05)',
                    color: reasoningEffort === e ? 'var(--amber)' : 'var(--muted-foreground)',
                    border: reasoningEffort === e ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent',
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </Field>
      </div>

      <div style={{ height: '1px', background: 'var(--border)' }} />

      {/* Agents */}
      <div className="space-y-6">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Agents</h3>
        <AgentsSection />
      </div>

      <div style={{ height: '1px', background: 'var(--border)' }} />

      {/* Skills */}
      <div className="space-y-6">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Skills</h3>
        <SkillsSection />
      </div>

      <div style={{ height: '1px', background: 'var(--border)' }} />

      {/* Rules */}
      <div className="space-y-6">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Rules</h3>
        <RulesSection />
      </div>

      <div style={{ height: '1px', background: 'var(--border)' }} />

      {/* Workspaces */}
      <div className="space-y-6">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Workspaces</h3>
        <WorkspacesSection />
      </div>
    </div>
  )
}

// Connections = API Keys (+ future integrations)
function ConnectionsSection() {
  return (
    <div className="space-y-8">
      <SectionHeader title="Connections" subtitle="API keys and external integrations" />
      <ApiKeysSection />
    </div>
  )
}

// Account = Usage + About
function AccountSection() {
  return (
    <div className="space-y-10">
      <SectionHeader title="Account" subtitle="Usage, billing, and application info" />
      <div className="space-y-6">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Usage</h3>
        <UsageSection />
      </div>
      <div style={{ height: '1px', background: 'var(--border)' }} />
      <div className="space-y-6">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>About</h3>
        <AboutSection />
      </div>
    </div>
  )
}

// ---------------- Models hook ----------------

function useSavedModels() {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const fetch = async () => {
    setLoading(true)
    try {
      const res = await window.wos.fetchSavedModels()
      if (res?.models?.length) setModels(res.models)
      else {
        const fb = await window.wos.getFallbackModels()
        setModels(fb)
      }
    } catch {
      try {
        const fb = await window.wos.getFallbackModels()
        setModels(fb)
      } catch {}
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { fetch() }, [])
  return { models, loading, refresh: fetch }
}

// ---------------- General ----------------

function GeneralSection() {
  const { defaultModel, reasoningEffort, defaultMode, theme, saveSetting } = useSettingsStore()
  const { models, loading, refresh } = useSavedModels()

  const selected = models.find(m => m.id === defaultModel)
  const supportsReasoning = selected
    ? selected.supportsReasoning === true
    : modelSupportsReasoning(defaultModel)

  const THEME_OPTIONS: Array<{ id: 'dark' | 'light' | 'system'; label: string; icon: React.ElementType }> = [
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'system', label: 'System', icon: Monitor },
  ]

  return (
    <div className="space-y-8">
      <SectionHeader title="General" subtitle="Default model, reasoning, agent mode, and appearance" />

      <Field label="Default Model" hint="Used for new conversations">
        <ModelAutocomplete
          models={models}
          loading={loading}
          value={defaultModel}
          onChange={(id) => saveSetting('defaultModel', id)}
          onRefresh={refresh}
        />
        {selected?.description && (
          <div className="mt-2" style={{ color: 'var(--muted-foreground)', fontSize: '11px' }}>{selected.description}</div>
        )}
      </Field>

      <Field
        label="Reasoning Effort"
        hint={supportsReasoning
          ? 'Controls how much the model reasons before answering'
          : 'The selected model does not support reasoning.'}
      >
        <div className={supportsReasoning ? '' : 'opacity-40 pointer-events-none'}>
          <div className="flex items-center gap-1">
            {(['low', 'medium', 'high', 'max'] as const).map(e => (
              <button
                key={e}
                disabled={!supportsReasoning}
                onClick={() => saveSetting('reasoningEffort', e)}
                className="px-3 py-1 rounded-md capitalize transition-colors"
                style={{
                  fontSize: '11px',
                  background: reasoningEffort === e ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)',
                  color: reasoningEffort === e ? 'var(--amber)' : 'var(--muted-foreground)',
                  border: reasoningEffort === e ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent',
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      </Field>

      <Field label="Default Mode" hint="Starting mode for new chats">
        <div className="flex items-center gap-1">
          {(['default', 'plan', 'yolo'] as AgentMode[]).map(m => (
            <button
              key={m}
              onClick={() => saveSetting('defaultMode', m)}
              className="px-3 py-1 rounded-md capitalize transition-colors"
              style={{
                fontSize: '11px',
                background: defaultMode === m ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)',
                color: defaultMode === m ? 'var(--amber)' : 'var(--muted-foreground)',
                border: defaultMode === m ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent',
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Appearance" hint="Choose your color theme">
        <div className="flex items-center gap-1">
          {THEME_OPTIONS.map(opt => {
            const Icon = opt.icon
            const active = (theme ?? 'dark') === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => saveSetting('theme', opt.id)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors"
                style={{
                  fontSize: '11px',
                  background: active ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)',
                  color: active ? 'var(--amber)' : 'var(--muted-foreground)',
                  border: active ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent',
                }}
              >
                <Icon size={11} />
                {opt.label}
              </button>
            )
          })}
        </div>
      </Field>
    </div>
  )
}

// ---------------- Agents ----------------

type AgentSettingsRecord = {
  agentKey: string
  inheritFrom: string | null
  model: string | null
  mode: string | null
  systemPrompt: string | null
  config: Record<string, unknown>
}

function AgentsSection() {
  const { models, loading, refresh } = useSavedModels()
  const [agents, setAgents] = useState<Record<string, AgentSettingsRecord>>({})
  const [resolved, setResolved] = useState<Record<string, AgentSettingsRecord>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const load = async () => {
    const res = await window.wos.getAgentSettings()
    const direct = Object.fromEntries(res.agents.map(a => [a.agentKey, a]))
    const resolvedMap = Object.fromEntries(res.resolved.map(a => [a.agentKey, a]))
    setAgents(direct)
    setResolved(resolvedMap)
  }

  useEffect(() => { void load() }, [])

  const save = async (agentKey: 'wos' | 'meeting', patch: Partial<AgentSettingsRecord>, apiKeys?: Record<string, string>) => {
    const current = agents[agentKey] ?? { agentKey, inheritFrom: agentKey === 'meeting' ? 'wos' : null, model: null, mode: null, systemPrompt: null, config: {} }
    setSaving(agentKey)
    await window.wos.saveAgentSettings({
      ...current,
      ...patch,
      config: { ...current.config, ...(patch.config ?? {}) },
      apiKeys,
    })
    await load()
    setSaving(null)
    toast.success(`${agentKey === 'meeting' ? 'Meeting Agent' : 'WOS Main Agent'} saved`)
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Agents" subtitle="Configure WOS Main and the dedicated Meeting Agent independently." />
      <AgentCard
        title="WOS Main Agent"
        agentKey="wos"
        agent={agents.wos}
        resolved={resolved.wos}
        models={models}
        loading={loading}
        onRefreshModels={refresh}
        saving={saving === 'wos'}
        onSave={save}
      />
      <AgentCard
        title="Meeting Agent"
        agentKey="meeting"
        agent={agents.meeting}
        resolved={resolved.meeting}
        models={models}
        loading={loading}
        onRefreshModels={refresh}
        saving={saving === 'meeting'}
        onSave={save}
      />
    </div>
  )
}

function AgentCard({
  title,
  agentKey,
  agent,
  resolved,
  models,
  loading,
  onRefreshModels,
  saving,
  onSave,
}: {
  title: string
  agentKey: 'wos' | 'meeting'
  agent?: AgentSettingsRecord
  resolved?: AgentSettingsRecord
  models: ModelInfo[]
  loading: boolean
  onRefreshModels: () => void
  saving: boolean
  onSave: (agentKey: 'wos' | 'meeting', patch: Partial<AgentSettingsRecord>, apiKeys?: Record<string, string>) => Promise<void>
}) {
  const inherits = agentKey === 'meeting' && (agent?.inheritFrom ?? 'wos') === 'wos'
  const [model, setModel] = useState(agent?.model ?? resolved?.model ?? '')
  const [mode, setMode] = useState((agent?.mode ?? resolved?.mode ?? 'default') as AgentMode)
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? resolved?.systemPrompt ?? '')
  const [inherit, setInherit] = useState(inherits)
  const [liveSource, setLiveSource] = useState((agent?.config?.liveSource as string) ?? 'captions')
  const [autoSummarize, setAutoSummarize] = useState((agent?.config?.autoSummarize as boolean | undefined) ?? true)
  const [slackChannel, setSlackChannel] = useState((agent?.config?.defaultSlackChannel as string) ?? '')
  const [openaiKey, setOpenaiKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')

  useEffect(() => {
    setModel(agent?.model ?? resolved?.model ?? '')
    setMode((agent?.mode ?? resolved?.mode ?? 'default') as AgentMode)
    setSystemPrompt(agent?.systemPrompt ?? resolved?.systemPrompt ?? '')
    setInherit(agentKey === 'meeting' && (agent?.inheritFrom ?? 'wos') === 'wos')
    setLiveSource((agent?.config?.liveSource as string) ?? 'captions')
    setAutoSummarize((agent?.config?.autoSummarize as boolean | undefined) ?? true)
    setSlackChannel((agent?.config?.defaultSlackChannel as string) ?? '')
  }, [agent, resolved, agentKey])

  const disabledByInherit = agentKey === 'meeting' && inherit
  const inputStyle = { background: 'var(--input)', border: '1px solid var(--border)', color: 'var(--foreground)', fontSize: '12px' }

  return (
    <div className="rounded-xl p-4 space-y-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium" style={{ color: 'var(--foreground)', fontSize: '14px' }}>{title}</h3>
          <p style={{ color: 'var(--muted-foreground)', fontSize: '11px' }}>
            Resolved model: {resolved?.model || 'not selected'}
          </p>
        </div>
        {agentKey === 'meeting' && (
          <label className="flex items-center gap-2" style={{ color: 'var(--secondary-foreground)', fontSize: '12px' }}>
            <input type="checkbox" checked={inherit} onChange={e => setInherit(e.target.checked)} />
            Inherit WOS Main
          </label>
        )}
      </div>

      <div className={disabledByInherit ? 'opacity-50 pointer-events-none' : ''}>
        <Field label="Model">
          <ModelAutocomplete models={models} loading={loading} value={model} onChange={setModel} onRefresh={onRefreshModels} />
        </Field>
      </div>

      <Field label="Mode">
        <div className={`flex items-center gap-1 ${disabledByInherit ? 'opacity-50 pointer-events-none' : ''}`}>
          {(['default', 'plan', 'yolo'] as AgentMode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="px-3 py-1 rounded-md capitalize"
              style={{
                fontSize: '11px',
                background: mode === m ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)',
                color: mode === m ? 'var(--amber)' : 'var(--muted-foreground)',
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </Field>

      <Field label="System Prompt">
        <textarea
          value={systemPrompt}
          disabled={disabledByInherit}
          onChange={e => setSystemPrompt(e.target.value)}
          className="w-full min-h-[110px] px-3 py-2 rounded-md outline-none font-mono disabled:opacity-50"
          style={inputStyle}
        />
      </Field>

      {agentKey === 'meeting' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Live Source">
            <select value={liveSource} onChange={e => setLiveSource(e.target.value)} className="w-full px-3 py-2 rounded-md outline-none" style={inputStyle}>
              <option value="captions">Captions (recommended)</option>
            </select>
            <p className="mt-1" style={{ color: 'var(--muted-foreground)', fontSize: '11px' }}>
              v1 ships captions-only. WebRTC audio capture is paused while we build out a webm→wav decoder.
            </p>
          </Field>
          <Field label="Default Slack Channel">
            <input value={slackChannel} onChange={e => setSlackChannel(e.target.value)} className="w-full px-3 py-2 rounded-md outline-none" style={inputStyle} placeholder="#meetings" />
          </Field>
          <label className="flex items-center gap-2" style={{ color: 'var(--secondary-foreground)', fontSize: '12px' }}>
            <input type="checkbox" checked={autoSummarize} onChange={e => setAutoSummarize(e.target.checked)} />
            Auto-summarize after meeting ends
          </label>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={`OpenAI key ${agent?.config?.openaiApiKeySet ? '(configured)' : ''}`}>
          <input type="password" value={openaiKey} onChange={e => setOpenaiKey(e.target.value)} className="w-full px-3 py-2 rounded-md outline-none" style={inputStyle} placeholder="Leave blank to keep current" />
        </Field>
        <Field label={`Anthropic key ${agent?.config?.anthropicApiKeySet ? '(configured)' : ''}`}>
          <input type="password" value={anthropicKey} onChange={e => setAnthropicKey(e.target.value)} className="w-full px-3 py-2 rounded-md outline-none" style={inputStyle} placeholder="Leave blank to keep current" />
        </Field>
      </div>

      <button
        disabled={saving}
        onClick={() => onSave(agentKey, {
          inheritFrom: agentKey === 'meeting' && inherit ? 'wos' : null,
          model: disabledByInherit ? null : model,
          mode: disabledByInherit ? null : mode,
          systemPrompt: disabledByInherit ? null : systemPrompt,
          config: { liveSource, autoSummarize, defaultSlackChannel: slackChannel },
        }, {
          ...(openaiKey ? { openai: openaiKey } : {}),
          ...(anthropicKey ? { anthropic: anthropicKey } : {}),
        }).then(() => { setOpenaiKey(''); setAnthropicKey('') })}
        className="px-3 py-1.5 rounded-md disabled:opacity-50"
        style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.25)', fontSize: '12px' }}
      >
        {saving ? 'Saving...' : 'Save Agent'}
      </button>
    </div>
  )
}

function ModelAutocomplete({
  models, loading, value, onChange, onRefresh,
}: {
  models: ModelInfo[]
  loading: boolean
  value: string
  onChange: (id: string) => void
  onRefresh: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return models
    return models.filter(m =>
      m.id.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q)
    )
  }, [models, query])

  const selected = models.find(m => m.id === value)

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center justify-between flex-1 px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors"
          style={{ background: 'var(--card)', border: '1px solid var(--border)', fontSize: '12px' }}
        >
          <span className="flex items-center gap-2 truncate" style={{ color: 'var(--foreground)' }}>
            <span style={{ color: 'var(--muted-foreground)' }}>{selected?.provider ?? 'unknown'}</span>
            <span>{selected?.name ?? value}</span>
            {selected && <ModelCapPills m={selected} />}
          </span>
          <ChevronDown size={12} style={{ color: 'var(--muted-foreground)' }} />
        </button>
        <button
          onClick={onRefresh}
          title="Refresh model list"
          className="p-1.5 rounded-md hover:bg-white/10"
          style={{ color: 'var(--muted-foreground)' }}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>

      {open && (
        <div
          className="absolute top-full left-0 right-0 mt-1 rounded-md overflow-hidden z-50 max-h-80 overflow-y-auto"
          style={{ background: 'var(--popover)', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
        >
          <div className="sticky top-0 p-2" style={{ background: 'var(--popover)', borderBottom: '1px solid var(--border)' }}>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={`Search ${models.length} models…`}
              className="w-full px-2 py-1 rounded outline-none"
              style={{ background: 'var(--input)', border: '1px solid var(--border)', color: 'var(--foreground)', fontSize: '12px' }}
            />
          </div>
          {filtered.length === 0 && (
            <div className="px-3 py-4" style={{ color: 'var(--muted-foreground)', fontSize: '12px' }}>
              {loading ? 'Loading…' : 'No models match. Add an API key in API Keys.'}
            </div>
          )}
          {filtered.map(m => (
            <button
              key={m.id}
              onClick={() => { onChange(m.id); setOpen(false); setQuery('') }}
              className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-white/6 ${
                m.id === value ? 'bg-white/8' : ''
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="font-mono uppercase" style={{ color: 'var(--border-strong)', fontSize: '9px' }}>
                  {m.provider}
                </span>
                <span className="truncate" style={{ color: 'var(--foreground)', fontSize: '12px' }}>
                  {m.name}
                </span>
              </span>
              <ModelCapPills m={m} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ModelCapPills({ m }: { m: ModelInfo }) {
  const pills: React.ReactNode[] = []
  if (m.contextWindow) {
    const k = m.contextWindow >= 1_000_000 ? `${(m.contextWindow / 1_000_000).toFixed(0)}M` : `${Math.round(m.contextWindow / 1000)}k`
    pills.push(
      <span key="ctx" className="px-1.5 py-0.5 rounded" style={{ background: 'var(--card)', color: 'var(--border-strong)', fontSize: '9px' }}>{k}</span>
    )
  }
  if (m.supportsReasoning) {
    pills.push(
      <span key="r" title="Reasoning" className="px-1 rounded flex items-center gap-0.5 text-purple-300"
        style={{ background: 'rgba(139, 92, 246, 0.1)', fontSize: '9px' }}>
        <Brain size={8} />R
      </span>
    )
  }
  if (m.supportsVision) {
    pills.push(
      <span key="v" title="Vision" className="px-1 rounded flex items-center gap-0.5 text-emerald-300"
        style={{ background: 'rgba(16, 185, 129, 0.1)', fontSize: '9px' }}>
        <Eye size={8} />V
      </span>
    )
  }
  return <span className="flex items-center gap-1 shrink-0">{pills}</span>
}

// ---------------- API Keys ----------------

function ApiKeysSection() {
  const [presence, setPresence] = useState<Record<string, boolean>>({})
  useEffect(() => {
    window.wos.getApiKeysPresence().then(setPresence)
  }, [])

  const refreshPresence = async () => setPresence(await window.wos.getApiKeysPresence())

  return (
    <div className="space-y-6">
      <SectionHeader title="API Keys" subtitle="Keys are stored encrypted using your OS keychain" />
      <ApiKeyRow provider="openai" label="OpenAI" hasKey={!!presence.openai} onChange={refreshPresence} />
      <ApiKeyRow provider="anthropic" label="Anthropic" hasKey={!!presence.anthropic} onChange={refreshPresence} />
    </div>
  )
}

function ApiKeyRow({
  provider, label, hasKey, onChange,
}: { provider: 'openai' | 'anthropic'; label: string; hasKey: boolean; onChange: () => void }) {
  const [value, setValue] = useState('')
  const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const test = async () => {
    if (!value) return
    setState('testing'); setError(null)
    const r = await window.wos.testApiKey(provider, value)
    if (r.ok) setState('ok')
    else { setState('error'); setError(r.error ?? 'Failed') }
  }

  const save = async () => {
    if (!value) return
    setState('testing'); setError(null)
    const r = await window.wos.testApiKey(provider, value)
    if (!r.ok) { setState('error'); setError(r.error ?? 'Failed'); return }
    await window.wos.saveApiKey(provider, value)
    toast.success(`${label} key saved`)
    setValue(''); setState('idle')
    onChange()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div style={{ color: 'var(--foreground)', fontSize: '13px' }}>{label}</div>
          <div style={{ color: 'var(--muted-foreground)', fontSize: '11px' }}>
            {hasKey ? '✓ Key configured' : 'No key saved'}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={hasKey ? '••••••••  (paste to replace)' : `Paste ${label} API key`}
          className="flex-1 px-3 py-1.5 rounded-md outline-none"
          style={{ background: 'var(--input)', border: '1px solid var(--border)', color: 'var(--foreground)', fontSize: '12px' }}
        />
        <button
          onClick={test}
          disabled={!value || state === 'testing'}
          className="px-3 py-1.5 rounded-md hover:bg-white/10 disabled:opacity-30 transition-colors"
          style={{ background: 'var(--card)', color: 'var(--foreground)', fontSize: '12px', border: '1px solid var(--border)' }}
        >
          {state === 'testing' ? <Loader2 size={12} className="animate-spin" /> : 'Test'}
        </button>
        <button
          onClick={save}
          disabled={!value || state === 'testing'}
          className="px-3 py-1.5 rounded-md disabled:opacity-30 transition-colors"
          style={{ background: 'rgba(245,158,11,0.2)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.3)', fontSize: '12px' }}
        >
          Save
        </button>
      </div>
      {state === 'ok' && (
        <div className="flex items-center gap-1 text-emerald-400" style={{ fontSize: '11px' }}>
          <CheckCircle2 size={12} /> Key is valid
        </div>
      )}
      {state === 'error' && error && (
        <div className="flex items-center gap-1 text-red-400" style={{ fontSize: '11px' }}>
          <XCircle size={12} /> {error}
        </div>
      )}
    </div>
  )
}

// ---------------- Workspaces ----------------

function WorkspacesSection() {
  const { workspaces, activeWorkspaceId, addWorkspace, removeWorkspace, setActiveWorkspace } = useWorkspaceStore()
  return (
    <div className="space-y-6">
      <SectionHeader title="Workspaces" subtitle="Directories the agent can access" />
      <div className="space-y-2">
        {workspaces.length === 0 && (
          <div style={{ color: 'var(--muted-foreground)', fontSize: '12px' }}>No workspaces yet</div>
        )}
        {workspaces.map(ws => (
          <div
            key={ws.id}
            className="flex items-center gap-2 px-3 py-2 rounded-md"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <Folder size={12} className="shrink-0" style={{ color: 'var(--muted-foreground)' }} />
            <div className="flex-1 min-w-0">
              <div className="truncate" style={{ color: 'var(--foreground)', fontSize: '12px' }}>{ws.name}</div>
              <div className="truncate font-mono" style={{ color: 'var(--border-strong)', fontSize: '10px' }}>{ws.path}</div>
            </div>
            {activeWorkspaceId === ws.id ? (
              <span className="text-emerald-400" style={{ fontSize: '10px' }}>Active</span>
            ) : (
              <button
                onClick={() => setActiveWorkspace(ws.id)}
                className="hover:opacity-100 opacity-70 transition-opacity"
                style={{ color: 'var(--secondary-foreground)', fontSize: '11px' }}
              >
                Set active
              </button>
            )}
            <button
              onClick={() => removeWorkspace(ws.id)}
              className="p-1 rounded hover:text-red-400 transition-colors"
              style={{ color: 'var(--border-strong)' }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => addWorkspace()}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors"
        style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.25)', fontSize: '12px' }}
      >
        <Plus size={12} /> Open workspace…
      </button>
    </div>
  )
}

// ---------------- Usage ----------------

function UsageSection() {
  const sessionTokens = (useAgentStore(s => s.sessionTokens) ?? { input: 0, output: 0 })
  const total = sessionTokens.input + sessionTokens.output
  return (
    <div className="space-y-4">
      <SectionHeader title="Usage" subtitle="Session-scoped token totals. Resets when the app restarts." />
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Input tokens" value={sessionTokens.input.toLocaleString()} />
        <StatCard label="Output tokens" value={sessionTokens.output.toLocaleString()} />
        <StatCard label="Total" value={total.toLocaleString()} highlight />
      </div>
      <p style={{ color: 'var(--border-strong)', fontSize: '11px' }}>
        Cost estimates require per-model pricing which is provider-specific and changes frequently. We show
        raw token totals only to avoid stale numbers.
      </p>
    </div>
  )
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className="rounded-md p-3"
      style={{
        background: highlight ? 'rgba(245,158,11,0.05)' : 'var(--card)',
        border: `1px solid ${highlight ? 'rgba(245,158,11,0.2)' : 'var(--border)'}`,
      }}
    >
      <div style={{ color: 'var(--muted-foreground)', fontSize: '11px' }}>{label}</div>
      <div className="mt-1 font-medium" style={{ color: 'var(--foreground)', fontSize: '20px' }}>{value}</div>
    </div>
  )
}

// ---------------- About ----------------

function AboutSection() {
  const [version, setVersion] = useState('')
  useEffect(() => { window.wos.getVersion().then(setVersion) }, [])
  return (
    <div className="space-y-4">
      <SectionHeader title="About" subtitle={`WOS ${version ? 'v' + version : ''}`} />
      <button
        onClick={() => window.wos.openLogs()}
        className="px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors"
        style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)', fontSize: '12px' }}
      >
        Open logs folder
      </button>
    </div>
  )
}

// ---------------- Shared ----------------

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="font-medium" style={{ color: 'var(--foreground)', fontSize: '18px' }}>{title}</h2>
      {subtitle && <p className="mt-1" style={{ color: 'var(--muted-foreground)', fontSize: '12px' }}>{subtitle}</p>}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block" style={{ color: 'var(--secondary-foreground)', fontSize: '12px' }}>{label}</label>
      {children}
      {hint && <div style={{ color: 'var(--muted-foreground)', fontSize: '11px' }}>{hint}</div>}
    </div>
  )
}

// ---------------- Skills ----------------

function SkillsSection() {
  const { skills, loaded, load, reload, setEnabled, create, remove } = useSkillsStore()
  const [showCreate, setShowCreate] = useState(false)
  useEffect(() => { if (!loaded) void load() }, [loaded, load])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionHeader title="Skills" subtitle="Claude-style skill packs stored under ~/.wos/skills. Enable to expose them to the agent." />
        <div className="flex gap-2">
          <button onClick={() => reload()}
            className="px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors"
            style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)', fontSize: '12px' }}>
            <RefreshCw size={12} className="inline mr-1" /> Rescan
          </button>
          <button onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 rounded-md transition-colors"
            style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.25)', fontSize: '12px' }}>
            <Plus size={12} className="inline mr-1" /> New skill
          </button>
        </div>
      </div>

      {showCreate && <NewSkillForm onCancel={() => setShowCreate(false)} onDone={async (input) => {
        await create(input)
        setShowCreate(false)
      }} />}

      {skills.length === 0 && !showCreate && (
        <div style={{ color: 'var(--muted-foreground)', fontSize: '12px' }}>
          No skills yet. Drop a folder with a <code>SKILL.md</code> into <code>~/.wos/skills/</code>, then click Rescan.
        </div>
      )}

      <div className="space-y-2">
        {skills.map(s => (
          <div key={s.id} className="rounded-md p-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium" style={{ color: 'var(--foreground)', fontSize: '13px' }}>{s.name}</span>
                  {!s.enabled && <span style={{ color: 'var(--muted-foreground)', fontSize: '10px' }}>disabled</span>}
                </div>
                <div style={{ color: 'var(--secondary-foreground)', fontSize: '11px' }}>{s.description || '—'}</div>
                {s.triggers.length > 0 && (
                  <div className="mt-1" style={{ color: 'var(--muted-foreground)', fontSize: '10px' }}>
                    triggers: {s.triggers.join(', ')}
                  </div>
                )}
                <div className="font-mono mt-1" style={{ color: 'var(--border-strong)', fontSize: '10px' }}>{s.path}</div>
              </div>
              <label className="flex items-center gap-1.5" style={{ color: 'var(--secondary-foreground)', fontSize: '11px' }}>
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={e => setEnabled(s.id, e.target.checked)}
                />
                Enabled
              </label>
              <button onClick={() => remove(s.id)} className="p-1 rounded hover:text-red-400 transition-colors" style={{ color: 'var(--border-strong)' }}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function NewSkillForm({ onCancel, onDone }: {
  onCancel: () => void
  onDone: (input: { name: string; description: string; body: string; triggers: string[] }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [triggers, setTriggers] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  const inputStyle = { background: 'var(--input)', border: '1px solid var(--border)', color: 'var(--foreground)', fontSize: '12px' }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setSaving(true)
        await onDone({
          name: name.trim(),
          description: description.trim(),
          body,
          triggers: triggers.split(',').map(s => s.trim()).filter(Boolean),
        })
        setSaving(false)
      }}
      className="space-y-3 p-4 rounded-md"
      style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
    >
      <Field label="Name">
        <input required value={name} onChange={e => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-md outline-none"
          style={inputStyle} />
      </Field>
      <Field label="Description" hint="One-liner shown in the agent's skill index.">
        <input value={description} onChange={e => setDescription(e.target.value)}
          className="w-full px-3 py-2 rounded-md outline-none"
          style={inputStyle} />
      </Field>
      <Field label="Triggers" hint="Comma-separated keywords that hint when to use this skill.">
        <input value={triggers} onChange={e => setTriggers(e.target.value)} placeholder="pptx, slide deck, presentation"
          className="w-full px-3 py-2 rounded-md outline-none"
          style={inputStyle} />
      </Field>
      <Field label="Body (markdown)">
        <textarea required value={body} onChange={e => setBody(e.target.value)}
          className="w-full px-3 py-2 rounded-md font-mono min-h-[160px] outline-none"
          style={inputStyle} />
      </Field>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors"
          style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)', fontSize: '12px' }}>
          Cancel
        </button>
        <button type="submit" disabled={saving}
          className="px-3 py-1.5 rounded-md disabled:opacity-50 transition-colors"
          style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.25)', fontSize: '12px' }}>
          {saving ? 'Saving…' : 'Create skill'}
        </button>
      </div>
    </form>
  )
}

// ---------------- Rules ----------------

function RulesSection() {
  const { rules, loaded, load, reload, setEnabled, create, update, remove } = useRulesStore()
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  useEffect(() => { if (!loaded) void load() }, [loaded, load])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionHeader title="Rules" subtitle="User rules live in ~/.wos/rules. Workspace rules use the Cursor-compatible .cursor/rules/*.mdc format." />
        <div className="flex gap-2">
          <button onClick={() => reload()}
            className="px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors"
            style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)', fontSize: '12px' }}>
            <RefreshCw size={12} className="inline mr-1" /> Rescan
          </button>
          <button onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 rounded-md transition-colors"
            style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.25)', fontSize: '12px' }}>
            <Plus size={12} className="inline mr-1" /> New rule
          </button>
        </div>
      </div>

      {showCreate && (
        <NewRuleForm
          onCancel={() => setShowCreate(false)}
          onDone={async (input) => { await create(input); setShowCreate(false) }}
        />
      )}

      <div className="space-y-2">
        {rules.length === 0 && !showCreate && (
          <div style={{ color: 'var(--muted-foreground)', fontSize: '12px' }}>No rules yet.</div>
        )}
        {rules.map(r => (
          <div key={r.id} className="rounded-md p-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium" style={{ color: 'var(--foreground)', fontSize: '13px' }}>{r.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--background)', color: 'var(--secondary-foreground)' }}>{r.scope}</span>
                  {r.alwaysApply && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--amber)' }}>always</span>}
                  {r.globs.length > 0 && <span className="text-[10px]" style={{ color: 'var(--secondary-foreground)' }}>{r.globs.join(', ')}</span>}
                </div>
                <div style={{ color: 'var(--secondary-foreground)', fontSize: '11px' }}>{r.description || '—'}</div>
                <div className="font-mono mt-1" style={{ color: 'var(--border-strong)', fontSize: '10px' }}>{r.path}</div>
              </div>
              <label className="flex items-center gap-1.5" style={{ color: 'var(--secondary-foreground)', fontSize: '11px' }}>
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={e => setEnabled(r.id, e.target.checked)}
                />
                Enabled
              </label>
              <button onClick={() => setEditingId(editingId === r.id ? null : r.id)}
                className="px-2 transition-colors"
                style={{ color: 'var(--secondary-foreground)', fontSize: '11px' }}>
                {editingId === r.id ? 'Close' : 'Edit'}
              </button>
              <button onClick={() => remove(r.id)} className="p-1 rounded hover:text-red-400 transition-colors" style={{ color: 'var(--border-strong)' }}>
                <Trash2 size={12} />
              </button>
            </div>

            {editingId === r.id && (
              <RuleEditor rule={r} onSave={async (patch) => { await update(r.id, patch); setEditingId(null) }} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function NewRuleForm({ onCancel, onDone }: {
  onCancel: () => void
  onDone: (input: {
    scope: 'user' | 'workspace'
    name: string
    description: string
    alwaysApply: boolean
    globs: string[]
    body: string
  }) => Promise<void>
}) {
  const [scope, setScope] = useState<'user' | 'workspace'>('user')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [alwaysApply, setAlwaysApply] = useState(true)
  const [globs, setGlobs] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  const inputStyle = { background: 'var(--input)', border: '1px solid var(--border)', color: 'var(--foreground)', fontSize: '12px' }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setSaving(true)
        await onDone({
          scope,
          name: name.trim(),
          description: description.trim(),
          alwaysApply,
          globs: globs.split(',').map(s => s.trim()).filter(Boolean),
          body,
        })
        setSaving(false)
      }}
      className="space-y-3 p-4 rounded-md"
      style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
    >
      <Field label="Scope">
        <div className="flex gap-2">
          {(['user', 'workspace'] as const).map(s => (
            <button
              type="button"
              key={s}
              onClick={() => setScope(s)}
              className="px-3 py-1.5 rounded-md transition-colors"
              style={{
                background: scope === s ? 'rgba(245,158,11,0.15)' : 'var(--card)',
                color: scope === s ? 'var(--amber)' : 'var(--muted-foreground)',
                border: '1px solid ' + (scope === s ? 'rgba(245,158,11,0.3)' : 'var(--border)'),
                fontSize: '11px',
              }}
            >
              {s === 'user' ? 'User (~/.wos/rules)' : 'Workspace (.cursor/rules)'}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Name">
        <input required value={name} onChange={e => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-md outline-none" style={inputStyle} />
      </Field>
      <Field label="Description">
        <input value={description} onChange={e => setDescription(e.target.value)}
          className="w-full px-3 py-2 rounded-md outline-none" style={inputStyle} />
      </Field>
      <div className="flex gap-3 items-start">
        <Field label="Always apply" hint="Inlined into every system prompt.">
          <input type="checkbox" checked={alwaysApply} onChange={e => setAlwaysApply(e.target.checked)} />
        </Field>
        <div className="flex-1">
          <Field label="Globs (optional)" hint="Comma-separated, e.g. **/*.ts,**/*.tsx">
            <input value={globs} onChange={e => setGlobs(e.target.value)}
              className="w-full px-3 py-2 rounded-md outline-none" style={inputStyle} />
          </Field>
        </div>
      </div>
      <Field label="Body (markdown)">
        <textarea required value={body} onChange={e => setBody(e.target.value)}
          className="w-full px-3 py-2 rounded-md font-mono min-h-[160px] outline-none"
          style={inputStyle} />
      </Field>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors"
          style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)', fontSize: '12px' }}>
          Cancel
        </button>
        <button type="submit" disabled={saving}
          className="px-3 py-1.5 rounded-md disabled:opacity-50 transition-colors"
          style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.25)', fontSize: '12px' }}>
          {saving ? 'Saving…' : 'Create rule'}
        </button>
      </div>
    </form>
  )
}

function RuleEditor({ rule, onSave }: {
  rule: RuleInfo
  onSave: (patch: { body: string; alwaysApply: boolean; globs: string[] }) => Promise<void>
}) {
  const [body, setBody] = useState('')
  const [alwaysApply, setAlwaysApply] = useState(rule.alwaysApply)
  const [globs, setGlobs] = useState(rule.globs.join(', '))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.wos.rules.read(rule.id).then(r => {
      if (r.success) setBody(r.body ?? '')
    })
  }, [rule.id])

  const inputStyle = { background: 'var(--input)', border: '1px solid var(--border)', color: 'var(--foreground)', fontSize: '11px' }

  return (
    <div className="mt-3 space-y-3 p-3 rounded" style={{ background: 'var(--background)', border: '1px solid var(--border)' }}>
      <div className="flex gap-3 items-center">
        <label className="flex items-center gap-1" style={{ color: 'var(--secondary-foreground)', fontSize: '11px' }}>
          <input type="checkbox" checked={alwaysApply} onChange={e => setAlwaysApply(e.target.checked)} /> alwaysApply
        </label>
        <input value={globs} onChange={e => setGlobs(e.target.value)} placeholder="globs (comma-separated)"
          className="flex-1 px-2 py-1 rounded outline-none" style={inputStyle} />
      </div>
      <textarea value={body} onChange={e => setBody(e.target.value)}
        className="w-full px-3 py-2 rounded-md font-mono min-h-[160px] outline-none"
        style={{ ...inputStyle, fontSize: '12px' }} />
      <div className="flex gap-2">
        <button
          onClick={async () => {
            setSaving(true)
            await onSave({ body, alwaysApply, globs: globs.split(',').map(s => s.trim()).filter(Boolean) })
            setSaving(false)
          }}
          disabled={saving}
          className="px-3 py-1.5 rounded-md disabled:opacity-50 transition-colors"
          style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.25)', fontSize: '12px' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
