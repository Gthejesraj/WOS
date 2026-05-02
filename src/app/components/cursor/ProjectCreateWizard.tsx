import React, { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, X, Check } from 'lucide-react'
import { useProjectsStore, type CatalogueEntry } from '../../../store/projectsStore'

const ICONS = ['📁', '🚀', '🎯', '🛠️', '🧪', '📊', '🌐', '⚡', '🔧', '💡', '🅰️', '🅱️']
const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6']

interface WizardProps {
  onClose: () => void
  onCreated: (id: string) => void
}

export function ProjectCreateWizard({ onClose, onCreated }: WizardProps) {
  const { create, catalogue, loadCatalogue } = useProjectsStore()
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)

  // Step 1
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('📁')
  const [color, setColor] = useState(COLORS[0])
  const [description, setDescription] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')

  // Step 2: resources
  const [pickedResourceKinds, setPickedResourceKinds] = useState<Set<string>>(new Set())

  // Step 3: people (just freeform list)
  const [peopleText, setPeopleText] = useState('')

  useEffect(() => {
    void loadCatalogue()
  }, [loadCatalogue])

  const groupedCatalogue = useMemo(() => {
    const byApp: Record<string, { appName: string; entries: CatalogueEntry[] }> = {}
    for (const c of catalogue) {
      const k = c.appId
      if (!byApp[k]) byApp[k] = { appName: c.appName, entries: [] }
      byApp[k].entries.push(c)
    }
    return byApp
  }, [catalogue])

  const canNext = step === 1 ? name.trim().length > 0 : true

  async function submit() {
    setSubmitting(true)
    const project = await create({
      name: name.trim(),
      icon,
      color,
      description: description.trim() || null,
      ownerEmail: ownerEmail.trim() || null,
      metadata: {
        resourceKinds: Array.from(pickedResourceKinds),
        people: peopleText.split(/[\n,]/).map(s => s.trim()).filter(Boolean),
      },
    })
    setSubmitting(false)
    if (project) onCreated(project.id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div
        className="rounded-lg w-full max-w-2xl flex flex-col"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          maxHeight: '85vh',
        }}
      >
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="text-[13px] font-medium" style={{ color: 'var(--foreground)' }}>
            New project — Step {step}/4
          </div>
          <button onClick={onClose} className="p-1 rounded wos-hover-sm">
            <X size={14} style={{ color: 'var(--zinc-500)' }} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-5 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
          {['Identity', 'Resources', 'People', 'Review'].map((label, i) => (
            <div key={label} className="flex items-center gap-1 flex-1">
              <div
                className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-medium"
                style={{
                  background: step > i + 1 ? 'var(--amber)' : step === i + 1 ? 'var(--amber)' : 'var(--input)',
                  color: step >= i + 1 ? '#000' : 'var(--zinc-500)',
                }}
              >
                {step > i + 1 ? <Check size={10} /> : i + 1}
              </div>
              <span className="text-[11px]" style={{ color: step >= i + 1 ? 'var(--foreground)' : 'var(--zinc-500)' }}>
                {label}
              </span>
              {i < 3 && <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 1 && (
            <div className="flex flex-col gap-3">
              <Field label="Name *">
                <input
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Atlas Mobile"
                  className="w-full px-2 py-1.5 rounded-md text-[12px] outline-none"
                  style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
                />
              </Field>
              <Field label="Icon">
                <div className="flex flex-wrap gap-1">
                  {ICONS.map(i => (
                    <button
                      key={i}
                      onClick={() => setIcon(i)}
                      className="w-8 h-8 rounded-md text-[16px] flex items-center justify-center"
                      style={{
                        background: icon === i ? 'var(--amber)' : 'var(--input)',
                        border: '1px solid var(--border-strong)',
                      }}
                    >{i}</button>
                  ))}
                </div>
              </Field>
              <Field label="Accent">
                <div className="flex gap-1.5">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className="w-7 h-7 rounded-full"
                      style={{ background: c, border: color === c ? '2px solid var(--foreground)' : '1px solid var(--border-strong)' }}
                    />
                  ))}
                </div>
              </Field>
              <Field label="Owner email">
                <input
                  value={ownerEmail}
                  onChange={e => setOwnerEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full px-2 py-1.5 rounded-md text-[12px] outline-none"
                  style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
                />
              </Field>
              <Field label="Short description">
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={3}
                  placeholder="What's this project about?"
                  className="w-full px-2 py-1.5 rounded-md text-[12px] outline-none resize-none"
                  style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
                />
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <p className="text-[12px]" style={{ color: 'var(--zinc-400)' }}>
                Mark which resource types this project will use. After creation you can link concrete channels, repos, tickets, and more — including from apps that aren't connected yet (you'll add them by URL).
              </p>
              {Object.keys(groupedCatalogue).length === 0 ? (
                <div className="text-[12px] py-6 text-center" style={{ color: 'var(--zinc-500)' }}>
                  Loading apps…
                </div>
              ) : (
                Object.entries(groupedCatalogue).map(([appId, group]) => {
                  const anyConnected = group.entries.some(e => e.connected !== false)
                  return (
                    <div key={appId}>
                      <div className="text-[11px] font-medium uppercase tracking-wide mb-1.5 flex items-center gap-2" style={{ color: 'var(--zinc-500)' }}>
                        <span>{group.entries[0]?.appIcon}</span>
                        <span>{group.appName}</span>
                        {!anyConnected && (
                          <span
                            className="px-1.5 rounded text-[9px] tracking-wider normal-case"
                            style={{ background: 'rgba(245, 158, 11, 0.12)', color: 'var(--amber)' }}
                          >
                            not connected
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {group.entries.map(e => {
                          const picked = pickedResourceKinds.has(e.kind)
                          const disconnected = e.connected === false
                          return (
                            <button
                              key={e.kind}
                              onClick={() => {
                                const next = new Set(pickedResourceKinds)
                                if (picked) next.delete(e.kind)
                                else next.add(e.kind)
                                setPickedResourceKinds(next)
                              }}
                              className="px-2.5 py-1.5 rounded-md text-[12px] flex items-center gap-1.5"
                              style={{
                                background: picked ? 'var(--amber)' : 'var(--input)',
                                color: picked ? '#000' : 'var(--foreground)',
                                border: '1px solid var(--border-strong)',
                                opacity: disconnected && !picked ? 0.7 : 1,
                              }}
                              title={disconnected ? 'Not connected — you can still add by URL after creation' : undefined}
                            >
                              {picked && <Check size={11} />}
                              {e.label}
                              {disconnected && (
                                <span className="text-[9px]" style={{ color: picked ? '#000' : 'var(--zinc-500)' }}>•</span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-3">
              <p className="text-[12px]" style={{ color: 'var(--zinc-400)' }}>
                Add people involved (one per line, or comma-separated). This is metadata only — used for stakeholder tracking.
              </p>
              <textarea
                value={peopleText}
                onChange={e => setPeopleText(e.target.value)}
                rows={6}
                placeholder="alice@company.com, bob@company.com&#10;Carol Smith - PM"
                className="w-full px-2 py-1.5 rounded-md text-[12px] outline-none resize-none"
                style={{ background: 'var(--input)', border: '1px solid var(--border-strong)', color: 'var(--foreground)' }}
              />
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-3">
              <p className="text-[12px]" style={{ color: 'var(--zinc-400)' }}>Review your new project:</p>
              <div className="rounded-md p-3 flex flex-col gap-1.5" style={{ background: 'var(--input)', border: '1px solid var(--border-strong)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[20px]">{icon}</span>
                  <div className="text-[13px] font-medium" style={{ color: 'var(--foreground)' }}>{name}</div>
                  <div className="w-3 h-3 rounded-full" style={{ background: color }} />
                </div>
                {description && <div className="text-[11px]" style={{ color: 'var(--zinc-400)' }}>{description}</div>}
                {ownerEmail && <div className="text-[11px]" style={{ color: 'var(--zinc-500)' }}>Owner: {ownerEmail}</div>}
                <div className="text-[11px]" style={{ color: 'var(--zinc-500)' }}>
                  Resources: {pickedResourceKinds.size === 0 ? 'none' : Array.from(pickedResourceKinds).join(', ')}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
            disabled={submitting}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px]"
            style={{ background: 'var(--input)', color: 'var(--foreground)', border: '1px solid var(--border-strong)' }}
          >
            <ChevronLeft size={12} /> {step === 1 ? 'Cancel' : 'Back'}
          </button>
          {step < 4 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canNext}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-medium disabled:opacity-50"
              style={{ background: 'var(--amber)', color: '#000' }}
            >
              Next <ChevronRight size={12} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={submitting || !name.trim()}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-medium disabled:opacity-50"
              style={{ background: 'var(--amber)', color: '#000' }}
            >
              {submitting ? 'Creating…' : 'Create project'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium" style={{ color: 'var(--zinc-400)' }}>{label}</span>
      {children}
    </label>
  )
}
