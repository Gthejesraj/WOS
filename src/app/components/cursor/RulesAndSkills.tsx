import React, { useEffect, useState } from 'react'
import { RefreshCw, Plus, Trash2 } from 'lucide-react'
import { useSkillsStore } from '../../../store/skillsStore'
import { useRulesStore } from '../../../store/rulesStore'

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-0.5">
      <div className="font-semibold" style={{ color: 'var(--foreground)', fontSize: '14px' }}>{title}</div>
      {subtitle && <div style={{ color: 'var(--muted-foreground)', fontSize: '12px' }}>{subtitle}</div>}
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

export function SkillsTab() {
  const { skills, loaded, load, reload, setEnabled, create, remove } = useSkillsStore()
  const [showCreate, setShowCreate] = useState(false)
  useEffect(() => { if (!loaded) void load() }, [loaded, load])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionHeader title="Skills" subtitle="Claude-style skill packs stored under ~/.wos/skills. Enable to expose them to the agent." />
        <div className="flex gap-2">
          <button onClick={() => reload()}
            className="px-3 py-1.5 rounded-md wos-hover transition-colors"
            style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)', fontSize: '12px' }}>
            <RefreshCw size={12} className="inline mr-1" /> Rescan
          </button>
          <button onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 rounded-md transition-colors"
            style={{ background: 'var(--surface-raised)', color: 'var(--foreground)', border: '1px solid var(--border-strong)', fontSize: '12px' }}>
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
                <div className="font-mono mt-1" style={{ color: 'var(--muted-foreground)', fontSize: '10px' }}>{s.path}</div>
              </div>
              <label className="flex items-center gap-1.5" style={{ color: 'var(--secondary-foreground)', fontSize: '11px' }}>
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={e => setEnabled(s.id, e.target.checked)}
                />
                Enabled
              </label>
              <button
                onClick={() => remove(s.id)}
                className="p-1 rounded transition-colors"
                style={{ color: 'var(--muted-foreground)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--destructive)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted-foreground)' }}
              >
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
          className="px-3 py-1.5 rounded-md wos-hover transition-colors"
          style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)', fontSize: '12px' }}>
          Cancel
        </button>
        <button type="submit" disabled={saving}
          className="px-3 py-1.5 rounded-md disabled:opacity-50 transition-colors"
          style={{ background: 'var(--surface-raised)', color: 'var(--foreground)', border: '1px solid var(--border-strong)', fontSize: '12px' }}>
          {saving ? 'Saving…' : 'Create skill'}
        </button>
      </div>
    </form>
  )
}

// ---------------- Rules ----------------

export function RulesTab() {
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
            className="px-3 py-1.5 rounded-md wos-hover transition-colors"
            style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)', fontSize: '12px' }}>
            <RefreshCw size={12} className="inline mr-1" /> Rescan
          </button>
          <button onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 rounded-md transition-colors"
            style={{ background: 'var(--surface-raised)', color: 'var(--foreground)', border: '1px solid var(--border-strong)', fontSize: '12px' }}>
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
                  {r.alwaysApply && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-base)', color: 'var(--foreground)' }}>always</span>}
                  {r.globs.length > 0 && <span className="text-[10px]" style={{ color: 'var(--secondary-foreground)' }}>{r.globs.join(', ')}</span>}
                </div>
                <div style={{ color: 'var(--secondary-foreground)', fontSize: '11px' }}>{r.description || '—'}</div>
                <div className="font-mono mt-1" style={{ color: 'var(--muted-foreground)', fontSize: '10px' }}>{r.path}</div>
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
              <button
                onClick={() => remove(r.id)}
                className="p-1 rounded transition-colors"
                style={{ color: 'var(--muted-foreground)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--destructive)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted-foreground)' }}
              >
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
                background: scope === s ? 'var(--surface-raised)' : 'var(--card)',
                color: scope === s ? 'var(--foreground)' : 'var(--muted-foreground)',
                border: '1px solid ' + (scope === s ? 'var(--border-strong)' : 'var(--border)'),
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
          className="px-3 py-1.5 rounded-md wos-hover transition-colors"
          style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)', fontSize: '12px' }}>
          Cancel
        </button>
        <button type="submit" disabled={saving}
          className="px-3 py-1.5 rounded-md disabled:opacity-50 transition-colors"
          style={{ background: 'var(--surface-raised)', color: 'var(--foreground)', border: '1px solid var(--border-strong)', fontSize: '12px' }}>
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
          style={{ background: 'var(--surface-raised)', color: 'var(--foreground)', border: '1px solid var(--border-strong)', fontSize: '12px' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
