import React, { DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertCircle, ArrowLeft, CheckCircle, Clipboard, CloudDownload,
  Edit3, File, FileText, FolderOpen, Hash, HelpCircle, Loader2, Mail, MessageSquare,
  RefreshCw, Search, Send, Trash2, Upload, X, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../../lib/utils'

interface DriveRecording {
  id: string
  name: string
  displayName: string
  date: string
  mimeType: string
  size: number
  webViewLink?: string
  hasTranscript: boolean
  transcriptFileId?: string
  transcriptName?: string
}

interface MeetingResult {
  summary: string
  actionItems: Array<{ owner?: string | null; task: string; dueDate?: string | null }>
  decisions: Array<{ decision: string; context?: string | null }>
  openQuestions: string[]
}

type MeetingStatus = 'queued' | 'reading' | 'transcribing' | 'analyzing' | 'done' | 'error' | 'interrupted'
type AnalyzeMode = 'home' | 'detail'
type ShareType = 'slack' | 'gmail'

interface SavedMeeting {
  id: string
  title: string
  source?: 'live' | 'upload' | 'calendar' | 'drive' | string
  startedAt?: string | number | Date
  endedAt?: string | number | Date | null
  duration?: number | null
  summary?: string | null
  transcript?: string | null
  actionItemsJson?: unknown
  decisionsJson?: unknown
  sourceUri?: string | null
  processingStatus?: MeetingStatus | string | null
  processingMessage?: string | null
  processingProgress?: number | null
  lastError?: string | null
  createdAt?: string | number | Date
  updatedAt?: string | number | Date
}

interface ActivityEntry {
  id: string
  meetingId?: string | null
  type: string
  status: 'success' | 'error' | 'info'
  label: string
  detailJson?: unknown
  createdAt?: string | number | Date
}

interface SlackDestination {
  id: string
  name: string
  type: string
  isPrivate?: boolean
  isIm?: boolean
}

interface UploadFile {
  name: string
  path: string
  mimeType: string
  size: number
}

interface ShareDialogState {
  type: ShareType
  title: string
  meetingId?: string | null
  result: MeetingResult
}

interface AnalyzeTabProps {
  googleConnected: boolean
  onOpenChat: (message: string) => void
}

const ACCEPTED_TYPES = '.mp4,.mov,.webm,.mp3,.wav,.m4a,.ogg,.aiff,.vtt,.srt,.txt,.docx,.pdf'

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDateValue(value: SavedMeeting['createdAt']): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTimeValue(value: ActivityEntry['createdAt']): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDurationSeconds(seconds?: number | null): string {
  if (!seconds) return ''
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function parseArray<T>(input: unknown): T[] {
  if (Array.isArray(input)) return input as T[]
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input)
      return Array.isArray(parsed) ? parsed as T[] : []
    } catch {
      return []
    }
  }
  return []
}

function getMeetingStatus(meeting?: SavedMeeting | null): MeetingStatus {
  const raw = meeting?.processingStatus
  if (raw === 'queued' || raw === 'reading' || raw === 'transcribing' || raw === 'analyzing' || raw === 'error' || raw === 'interrupted') return raw
  return 'done'
}

function isWorkingStatus(status: MeetingStatus): boolean {
  return status === 'queued' || status === 'reading' || status === 'transcribing' || status === 'analyzing'
}

function statusLabel(meeting: SavedMeeting): string {
  const status = getMeetingStatus(meeting)
  if (status === 'done') return meeting.summary ? 'Summary ready' : meeting.transcript ? 'Transcript saved' : 'Saved'
  if (status === 'error') return 'Needs retry'
  if (status === 'interrupted') return 'Interrupted'
  if (status === 'queued') return 'Queued'
  if (status === 'reading') return 'Reading file'
  if (status === 'transcribing') return 'Transcribing locally'
  if (status === 'analyzing') return 'Analyzing'
  return 'Saved'
}

function statusColor(status: MeetingStatus): string {
  if (status === 'done') return 'var(--amber)'
  if (status === 'error' || status === 'interrupted') return 'var(--destructive)'
  return 'var(--muted-foreground)'
}

function resultFromMeeting(meeting?: SavedMeeting | null): MeetingResult | null {
  if (!meeting?.summary) return null
  return {
    summary: meeting.summary,
    actionItems: parseArray<{ owner?: string | null; task: string; dueDate?: string | null }>(meeting.actionItemsJson),
    decisions: parseArray<{ decision: string; context?: string | null }>(meeting.decisionsJson),
    openQuestions: [],
  }
}

function buildMarkdown(title: string, result: MeetingResult): string {
  const lines = [`# ${title || 'Meeting Notes'}`, '']
  if (result.summary) lines.push('## Summary', result.summary, '')
  if (result.actionItems.length) {
    lines.push('## Action Items')
    for (const item of result.actionItems) {
      lines.push(`- ${item.task}${item.owner ? ` (${item.owner})` : ''}${item.dueDate ? ` - due ${item.dueDate}` : ''}`)
    }
    lines.push('')
  }
  if (result.decisions.length) {
    lines.push('## Decisions')
    for (const item of result.decisions) {
      lines.push(`- ${item.decision}${item.context ? ` - ${item.context}` : ''}`)
    }
    lines.push('')
  }
  if (result.openQuestions.length) lines.push('## Open Questions', ...result.openQuestions.map(q => `- ${q}`), '')
  return lines.join('\n')
}

function buildChatDraft(title: string, result: MeetingResult): string {
  return `Here are the meeting notes for "${title}":\n\n${buildMarkdown(title, result)}\n\nPlease help me follow up on this meeting.`
}

function buildEmailDraft(title: string, result: MeetingResult): string {
  return `Hi,\n\nHere are the notes from ${title || 'the meeting'}.\n\n${buildMarkdown(title, result)}\n\nBest,\nWOS`
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function isTranscriptFile(file: UploadFile): boolean {
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  return ['txt', 'vtt', 'srt', 'docx', 'pdf'].includes(ext)
}

function StatusPill({ meeting }: { meeting: SavedMeeting }) {
  const status = getMeetingStatus(meeting)
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ background: 'var(--border)', color: statusColor(status) }}
    >
      {isWorkingStatus(status) && <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: statusColor(status) }} />}
      {statusLabel(meeting)}
    </span>
  )
}

type ResultTab = 'summary' | 'actions' | 'decisions'

function ResultPanel({
  result,
  title,
  disabled,
  onAskAi,
  onShare,
  onCopy,
  onExport,
}: {
  result: MeetingResult
  title: string
  disabled?: boolean
  onAskAi: () => void
  onShare: (type: ShareType) => void
  onCopy: () => void
  onExport: () => void
}) {
  const [activeTab, setActiveTab] = useState<ResultTab>('summary')

  const tabs: Array<{ id: ResultTab; label: string; count?: number }> = [
    { id: 'summary', label: 'Summary' },
    { id: 'actions', label: 'Action Items', count: result.actionItems.length || undefined },
    { id: 'decisions', label: 'Decisions', count: result.decisions.length || undefined },
  ]

  return (
    <div className="space-y-3">
      {/* Actions bar */}
      <div className="rounded-xl p-3" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <ActionButton disabled={disabled} icon={<MessageSquare className="h-4 w-4" />} label="Ask AI" onClick={onAskAi} />
          <ActionButton disabled={disabled} icon={<Clipboard className="h-4 w-4" />} label="Copy" onClick={onCopy} />
          <ActionButton disabled={disabled} icon={<CloudDownload className="h-4 w-4" />} label="Export" onClick={onExport} />
          <ActionButton disabled={disabled} icon={<Mail className="h-4 w-4" />} label="Gmail" onClick={() => onShare('gmail')} />
          <ActionButton disabled={disabled} icon={<Hash className="h-4 w-4" />} label="Slack" onClick={() => onShare('slack')} />
        </div>
      </div>

      {/* Segmented result card */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
        {/* Tab header */}
        <div className="flex" style={{ borderBottom: '1px solid var(--border)' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors relative"
              style={{
                color: activeTab === tab.id ? 'var(--foreground)' : 'var(--muted-foreground)',
                borderBottom: activeTab === tab.id ? '2px solid var(--amber)' : '2px solid transparent',
                marginBottom: '-1px',
              }}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                  style={{
                    background: activeTab === tab.id ? 'var(--amber-muted)' : 'var(--secondary)',
                    color: activeTab === tab.id ? 'var(--amber)' : 'var(--muted-foreground)',
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-4">
          {activeTab === 'summary' && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--muted-foreground)' }}>
              {result.summary || 'No summary available.'}
            </p>
          )}

          {activeTab === 'actions' && (
            result.actionItems.length ? (
              <div className="space-y-3">
                {result.actionItems.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
                    <div className="min-w-0">
                      <p>{item.task}</p>
                      {(item.owner || item.dueDate) && (
                        <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
                          {item.owner ?? 'Unassigned'}{item.dueDate ? ` · ${item.dueDate}` : ''}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>No action items found in this meeting.</p>
            )
          )}

          {activeTab === 'decisions' && (
            result.decisions.length ? (
              <div className="space-y-3">
                {result.decisions.map((d, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <Zap className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
                    <div className="min-w-0">
                      <p className="font-medium">{d.decision}</p>
                      {d.context && <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>{d.context}</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>No key decisions found in this meeting.</p>
            )
          )}
        </div>
      </div>

      {/* Open Questions (stays separate) */}
      {result.openQuestions?.length > 0 && (
        <div className="rounded-xl p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
          <div className="mb-3 flex items-center gap-2">
            <HelpCircle className="h-4 w-4" style={{ color: 'var(--muted-foreground)' }} />
            <span className="text-sm font-semibold">Open Questions</span>
          </div>
          <div className="space-y-1.5">
            {result.openQuestions.map((q, i) => (
              <p key={i} className="text-sm" style={{ color: 'var(--muted-foreground)' }}>? {q}</p>
            ))}
          </div>
        </div>
      )}

      <span className="sr-only">{title}</span>
    </div>
  )
}

function ActionButton({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
      style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
    >
      {icon} {label}
    </button>
  )
}

function SavedTranscriptSidebar({
  meetings,
  selectedId,
  query,
  onQueryChange,
  onSearch,
  onRefresh,
  onSelect,
  onDelete,
}: {
  meetings: SavedMeeting[]
  selectedId: string | null
  query: string
  onQueryChange: (v: string) => void
  onSearch: () => void
  onRefresh: () => void
  onSelect: (meeting: SavedMeeting) => void
  onDelete: (meeting: SavedMeeting) => void
}) {
  return (
    <aside className="rounded-2xl p-4 lg:sticky lg:top-4 lg:self-start" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>Previous transcripts</p>
          <p className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>{meetings.length} saved</p>
        </div>
        <button onClick={onRefresh} className="rounded-lg p-1.5" title="Refresh" style={{ color: 'var(--muted-foreground)' }}>
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-lg px-2" style={{ border: '1px solid var(--border)', background: 'var(--input)' }}>
        <Search className="h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />
        <input
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSearch() }}
          placeholder="Search transcripts..."
          className="min-w-0 flex-1 bg-transparent py-2 text-xs outline-none"
          style={{ color: 'var(--foreground)' }}
        />
      </div>

      <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: '430px' }}>
        {meetings.length === 0 ? (
          <div className="rounded-xl p-4 text-center" style={{ border: '1px dashed var(--border)' }}>
            <FileText className="mx-auto mb-2 h-5 w-5" style={{ color: 'var(--muted-foreground)' }} />
            <p className="text-xs font-medium">No transcripts yet</p>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--muted-foreground)' }}>Upload a file to create the first row.</p>
          </div>
        ) : (
          meetings.map(meeting => (
            <button
              key={meeting.id}
              onClick={() => onSelect(meeting)}
              className="group w-full rounded-xl p-3 text-left transition-colors"
              style={{
                border: selectedId === meeting.id ? '1px solid var(--amber)' : '1px solid var(--border)',
                background: selectedId === meeting.id ? 'var(--accent)' : 'var(--background)',
              }}
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium">{meeting.title}</p>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(meeting) }}
                  className="rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: 'var(--destructive)' }}
                  title="Delete transcript"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full px-2 py-0.5 text-[10px] capitalize" style={{ background: 'var(--border)', color: 'var(--muted-foreground)' }}>
                  {meeting.source ?? 'meeting'}
                </span>
                <StatusPill meeting={meeting} />
              </div>
              <p className="line-clamp-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                {meeting.processingMessage || meeting.summary || meeting.transcript || meeting.lastError || 'Waiting for transcript content.'}
              </p>
            </button>
          ))
        )}
      </div>
    </aside>
  )
}

function UploadCard({
  dragActive,
  onDragActive,
  onDrop,
  onBrowse,
  fileInputRef,
  onNativeFile,
}: {
  dragActive: boolean
  onDragActive: (v: boolean) => void
  onDrop: (e: DragEvent<HTMLDivElement>) => void
  onBrowse: () => void
  fileInputRef: React.RefObject<HTMLInputElement>
  onNativeFile: (file: File) => void
}) {
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragActive(true) }}
      onDragLeave={() => onDragActive(false)}
      onDrop={onDrop}
      onClick={onBrowse}
      className="rounded-2xl p-8 text-center cursor-pointer transition-colors"
      style={{
        border: `2px dashed ${dragActive ? 'var(--amber)' : 'var(--border)'}`,
        background: dragActive ? 'rgba(245,158,11,0.05)' : 'var(--card)',
      }}
    >
      <Upload className="mx-auto mb-3 h-8 w-8" style={{ color: dragActive ? 'var(--amber)' : 'var(--muted-foreground)' }} />
      <p className="text-sm font-medium">{dragActive ? 'Drop to start background analysis' : 'Drop file or click to upload'}</p>
      <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>A transcript row is created immediately and processed in the background.</p>
      <p className="mt-1 text-[11px]" style={{ color: 'var(--muted-foreground)' }}>.mp4 .mov .webm .mp3 .wav .m4a .vtt .srt .txt .docx .pdf</p>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onNativeFile(file)
          e.currentTarget.value = ''
        }}
      />
    </div>
  )
}

function DriveImportCard({
  googleConnected,
  driveLoading,
  driveError,
  driveRecordings,
  onRefresh,
  onAnalyze,
}: {
  googleConnected: boolean
  driveLoading: boolean
  driveError: string | null
  driveRecordings: DriveRecording[]
  onRefresh: () => void
  onAnalyze: (recording: DriveRecording) => void
}) {
  return (
    <div className="rounded-2xl p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>From Google Drive</p>
          <p className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>Meet recordings appear here when Google Workspace is connected.</p>
        </div>
        <button onClick={onRefresh} disabled={driveLoading} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs disabled:opacity-50" style={{ color: 'var(--muted-foreground)' }}>
          <RefreshCw className={cn('h-3.5 w-3.5', driveLoading && 'animate-spin')} /> Refresh
        </button>
      </div>
      {!googleConnected ? (
        <p className="rounded-xl p-3 text-xs" style={{ border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}>Connect Google Workspace in Settings to discover Meet recordings.</p>
      ) : driveLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl p-5 text-xs" style={{ border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}>
          <Loader2 className="h-4 w-4 animate-spin" /> Scanning Meet Recordings...
        </div>
      ) : driveError ? (
        <div className="flex items-start gap-2 rounded-xl p-3 text-xs" style={{ border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}>
          <AlertCircle className="h-4 w-4 shrink-0" /> {driveError}
        </div>
      ) : driveRecordings.length === 0 ? (
        <div className="rounded-xl p-5 text-center" style={{ border: '1px dashed var(--border)' }}>
          <FolderOpen className="mx-auto mb-2 h-6 w-6" style={{ color: 'var(--muted-foreground)' }} />
          <p className="text-xs font-medium">No recordings found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {driveRecordings.map(rec => (
            <div key={rec.id} className="flex items-center justify-between gap-3 rounded-xl p-3" style={{ border: '1px solid var(--border)', background: 'var(--background)' }}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{rec.displayName || rec.name}</p>
                <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{formatDateValue(rec.date)}{rec.size ? ` - ${formatFileSize(rec.size)}` : ''} - {rec.hasTranscript ? 'Transcript found' : 'Video only'}</p>
              </div>
              <button onClick={() => onAnalyze(rec)} className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium" style={{ background: 'var(--amber)', color: '#000' }}>
                Analyze
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ActivityLog({ entries }: { entries: ActivityEntry[] }) {
  return (
    <div className="rounded-2xl p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
      <div className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4" style={{ color: 'var(--muted-foreground)' }} />
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>Activity</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>No actions yet.</p>
      ) : (
        <div className="space-y-2">
          {entries.slice(0, 5).map(entry => (
            <div key={entry.id} className="flex items-start justify-between gap-3 text-xs">
              <span style={{ color: entry.status === 'error' ? 'var(--destructive)' : 'var(--foreground)' }}>{entry.label}</span>
              <span className="shrink-0" style={{ color: 'var(--muted-foreground)' }}>{formatTimeValue(entry.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TranscriptDetail({
  meeting,
  activity,
  onBack,
  onShare,
  onCopy,
  onExport,
  onAskAi,
  onReanalyze,
  onRename,
  onDelete,
}: {
  meeting: SavedMeeting
  activity: ActivityEntry[]
  onBack: () => void
  onShare: (type: ShareType, result: MeetingResult) => void
  onCopy: (result: MeetingResult) => void
  onExport: (result: MeetingResult) => void
  onAskAi: (result: MeetingResult) => void
  onReanalyze: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const status = getMeetingStatus(meeting)
  const result = resultFromMeeting(meeting)
  const working = isWorkingStatus(status)
  const meta = [
    meeting.source,
    formatDateValue(meeting.startedAt ?? meeting.createdAt),
    formatDurationSeconds(meeting.duration),
  ].filter(Boolean).join(' - ')

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
        <button onClick={onBack} className="mb-3 flex items-center gap-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Analyze Home
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold">{meeting.title}</h3>
            <p className="mt-1 text-xs capitalize" style={{ color: 'var(--muted-foreground)' }}>{meta || 'Saved transcript'}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill meeting={meeting} />
            <button onClick={onRename} className="rounded-lg p-1.5" style={{ color: 'var(--muted-foreground)' }} title="Rename">
              <Edit3 className="h-4 w-4" />
            </button>
            <button onClick={onDelete} className="rounded-lg p-1.5" style={{ color: 'var(--destructive)' }} title="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {working && (
        <div className="rounded-2xl p-5" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
          <div className="mb-3 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--amber)' }} />
            <p className="text-sm font-medium">{meeting.processingMessage || statusLabel(meeting)}</p>
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--border)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(5, Math.min(100, meeting.processingProgress ?? 20))}%`, background: 'var(--amber)' }} />
          </div>
          <p className="mt-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>You can keep working. WOS will notify you when this analysis is ready.</p>
        </div>
      )}

      {(status === 'error' || status === 'interrupted') && (
        <div className="rounded-2xl p-4" style={{ border: '1px solid var(--destructive)', background: 'var(--card)' }}>
          <div className="mb-2 flex items-center gap-2" style={{ color: 'var(--destructive)' }}>
            <AlertCircle className="h-4 w-4" />
            <p className="text-sm font-medium">This transcript needs attention</p>
          </div>
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{meeting.lastError || meeting.processingMessage || 'Processing stopped before completion.'}</p>
          <button onClick={onReanalyze} disabled={!meeting.transcript} className="mt-3 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50" style={{ background: 'var(--amber)', color: '#000' }}>
            Retry analysis
          </button>
        </div>
      )}

      {result ? (
        <ResultPanel
          result={result}
          title={meeting.title}
          disabled={working}
          onAskAi={() => onAskAi(result)}
          onShare={(type) => onShare(type, result)}
          onCopy={() => onCopy(result)}
          onExport={() => onExport(result)}
        />
      ) : !working && status !== 'error' && (
        <div className="rounded-2xl p-5" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
          <p className="text-sm font-medium">Transcript saved without summary</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>Analyze this transcript to create a summary, action items, and shareable notes.</p>
          <button onClick={onReanalyze} disabled={!meeting.transcript} className="mt-3 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50" style={{ background: 'var(--amber)', color: '#000' }}>
            Analyze this transcript
          </button>
        </div>
      )}

      {meeting.transcript && (
        <div className="rounded-2xl p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>Transcript</p>
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
            {meeting.transcript}
          </pre>
        </div>
      )}

      <ActivityLog entries={activity} />
    </div>
  )
}

function ShareDialog({
  state,
  onClose,
  onDone,
}: {
  state: ShareDialogState
  onClose: () => void
  onDone: () => void
}) {
  const markdown = useMemo(() => buildMarkdown(state.title, state.result), [state.title, state.result])
  const [draft, setDraft] = useState(state.type === 'gmail' ? buildEmailDraft(state.title, state.result) : markdown)
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(`Meeting notes: ${state.title}`)
  const [manualDestination, setManualDestination] = useState('')
  const [selectedDestination, setSelectedDestination] = useState('')
  const [destinations, setDestinations] = useState<SlackDestination[]>([])
  const [destinationError, setDestinationError] = useState<string | null>(null)
  const [loadingDestinations, setLoadingDestinations] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (state.type !== 'slack') return
    let mounted = true
    setLoadingDestinations(true)
    window.wos.meetings.listSlackDestinations().then(res => {
      if (!mounted) return
      setDestinations(res.destinations as SlackDestination[])
      setDestinationError(res.error)
    }).finally(() => {
      if (mounted) setLoadingDestinations(false)
    })
    return () => { mounted = false }
  }, [state.type])

  const sendSlack = async () => {
    const channel = selectedDestination || manualDestination.trim()
    if (!channel) {
      toast.error('Choose a Slack destination or enter a channel/DM ID.')
      return
    }
    setSending(true)
    const res = await window.wos.meetings.postSlack({ channel, text: draft, meetingId: state.meetingId })
    setSending(false)
    if (res.ok) {
      toast.success('Sent to Slack')
      onDone()
      onClose()
    } else {
      toast.error(res.error ?? 'Failed to send to Slack')
      onDone()
    }
  }

  const sendGmail = async (asDraft: boolean) => {
    const recipients = to.split(',').map(v => v.trim()).filter(Boolean)
    if (recipients.length === 0 || recipients.some(v => !looksLikeEmail(v))) {
      toast.error('Enter a valid To email address.')
      return
    }
    if (!subject.trim()) {
      toast.error('Subject is required.')
      return
    }
    setSending(true)
    const res = asDraft
      ? await window.wos.meetings.createGmailDraft({ to, subject, body: draft, meetingId: state.meetingId })
      : await window.wos.meetings.emailNotes({ to, cc: cc || undefined, subject, body: draft, meetingId: state.meetingId })
    setSending(false)
    if (res.ok) {
      toast.success(asDraft ? 'Gmail draft saved' : 'Email sent')
      onDone()
      onClose()
    } else {
      toast.error(res.error ?? 'Gmail action failed')
      onDone()
    }
  }

  const title = state.type === 'slack' ? 'Review Slack message' : 'Compose Gmail draft'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between gap-3 border-b p-4" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Review and edit before anything is sent.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1" style={{ color: 'var(--muted-foreground)' }}><X className="h-4 w-4" /></button>
        </div>

        <div className="max-h-[68vh] space-y-3 overflow-y-auto p-4">
          {state.type === 'slack' && (
            <div className="space-y-2">
              <label className="text-xs font-medium">Slack destination</label>
              {loadingDestinations ? (
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted-foreground)' }}><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading channels and DMs...</div>
              ) : destinations.length > 0 ? (
                <select value={selectedDestination} onChange={e => setSelectedDestination(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: 'var(--input)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>
                  <option value="">Choose destination...</option>
                  {destinations.map(dest => (
                    <option key={dest.id} value={dest.id}>{dest.type === 'dm' ? 'DM' : dest.type === 'group-dm' ? 'Group DM' : dest.isPrivate ? 'Private' : 'Channel'} - {dest.name} ({dest.id})</option>
                  ))}
                </select>
              ) : (
                <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{destinationError || 'No Slack destinations available.'}</p>
              )}
              <input value={manualDestination} onChange={e => setManualDestination(e.target.value)} placeholder="Manual channel/DM ID fallback, e.g. C123 or D123" className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: 'var(--input)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>
          )}

          {state.type === 'gmail' && (
            <div className="space-y-2">
              <input value={to} onChange={e => setTo(e.target.value)} placeholder="To" className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: 'var(--input)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
              <input value={cc} onChange={e => setCc(e.target.value)} placeholder="Cc (optional)" className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: 'var(--input)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
              <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: 'var(--input)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>
          )}

          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="min-h-[280px] w-full resize-y rounded-xl p-3 text-sm leading-relaxed outline-none"
            style={{ background: 'var(--input)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          />
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t p-4" style={{ borderColor: 'var(--border)' }}>
          <button onClick={() => navigator.clipboard.writeText(draft).then(() => toast.success('Draft copied'))} className="rounded-lg px-3 py-1.5 text-sm" style={{ border: '1px solid var(--border)' }}>Copy draft</button>
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm" style={{ border: '1px solid var(--border)' }}>Cancel</button>
          {state.type === 'slack' && <button disabled={sending} onClick={sendSlack} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50" style={{ background: 'var(--amber)', color: '#000' }}><Send className="h-4 w-4" /> Send to Slack</button>}
          {state.type === 'gmail' && (
            <>
              <button disabled={sending} onClick={() => sendGmail(true)} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50" style={{ border: '1px solid var(--border)' }}><Edit3 className="h-4 w-4" /> Save Gmail draft</button>
              <button disabled={sending} onClick={() => sendGmail(false)} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50" style={{ background: 'var(--amber)', color: '#000' }}><Send className="h-4 w-4" /> Send email</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function AnalyzeTab({ googleConnected, onOpenChat }: AnalyzeTabProps) {
  const [meetings, setMeetings] = useState<SavedMeeting[]>([])
  const [meetingSearch, setMeetingSearch] = useState('')
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
  const [analyzeMode, setAnalyzeMode] = useState<AnalyzeMode>('home')
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [driveFolderId, setDriveFolderId] = useState<string | null>(null)
  const [driveRecordings, setDriveRecordings] = useState<DriveRecording[]>([])
  const [driveLoading, setDriveLoading] = useState(false)
  const [driveError, setDriveError] = useState<string | null>(null)
  const [shareDialog, setShareDialog] = useState<ShareDialogState | null>(null)
  const [renameTarget, setRenameTarget] = useState<SavedMeeting | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedMeeting = useMemo(
    () => meetings.find(m => m.id === selectedMeetingId) ?? null,
    [meetings, selectedMeetingId],
  )

  const loadSavedMeetings = useCallback(async (query = meetingSearch) => {
    const { meetings: rows, error } = await window.wos.meetings.listSaved({ query })
    if (error) {
      toast.error(error)
      return
    }
    setMeetings(rows as SavedMeeting[])
  }, [meetingSearch])

  const loadActivity = useCallback(async (meetingId = selectedMeetingId) => {
    const { entries } = await window.wos.meetings.listActivity({ meetingId, limit: 20 })
    setActivity(entries as ActivityEntry[])
  }, [selectedMeetingId])

  const refreshAll = useCallback(async () => {
    await loadSavedMeetings()
    await loadActivity()
  }, [loadActivity, loadSavedMeetings])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    void loadActivity(selectedMeetingId)
  }, [loadActivity, selectedMeetingId])

  const loadDriveRecordings = useCallback(async () => {
    setDriveLoading(true)
    setDriveError(null)
    try {
      let folderId = driveFolderId
      if (!folderId) {
        const found = await window.wos.meetings.findDriveFolder()
        if (found.error) throw new Error(found.error)
        if (!found.folderId) throw new Error('No "Meet Recordings" folder found in Google Drive.')
        folderId = found.folderId
        setDriveFolderId(folderId)
      }
      const { recordings, error } = await window.wos.meetings.listDriveRecordings({ folderId })
      if (error) throw new Error(error)
      setDriveRecordings(recordings as DriveRecording[])
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : String(err))
    } finally {
      setDriveLoading(false)
    }
  }, [driveFolderId])

  useEffect(() => {
    if (googleConnected && driveRecordings.length === 0 && !driveLoading && !driveError) void loadDriveRecordings()
  }, [googleConnected, driveError, driveLoading, driveRecordings.length, loadDriveRecordings])

  const selectMeeting = useCallback((meeting: SavedMeeting) => {
    setSelectedMeetingId(meeting.id)
    setAnalyzeMode('detail')
  }, [])

  const addUiActivity = useCallback(async (label: string, type: string, status: 'success' | 'error' | 'info' = 'info', meetingId = selectedMeetingId) => {
    await window.wos.meetings.addActivity({ meetingId, type, status, label })
    await loadActivity(meetingId)
  }, [loadActivity, selectedMeetingId])

  const processTranscript = useCallback(async (id: string, title: string, transcript: string, source: 'upload' | 'drive', sourceUri?: string | null) => {
    const analyzed = await window.wos.meetings.analyze({ id, transcript, title, source, sourceUri })
    if (analyzed.error || !analyzed.result) throw new Error(analyzed.error ?? 'No analysis returned')
    await loadSavedMeetings()
    await loadActivity(id)
    setSelectedMeetingId(id)
    setAnalyzeMode('detail')
    toast.success(`Analysis ready: ${title}`)
  }, [loadActivity, loadSavedMeetings])

  const startFileJob = useCallback(async (file: UploadFile) => {
    const title = file.name.replace(/\.[^.]+$/, '')
    const pending = await window.wos.meetings.createPending({ title, source: 'upload', sourceUri: file.path })
    if (!pending.id) {
      toast.error(pending.error ?? 'Could not create transcript row')
      return
    }
    const id = pending.id
    setSelectedMeetingId(id)
    setAnalyzeMode('detail')
    await loadSavedMeetings()
    try {
      const transcriptFile = isTranscriptFile(file)
      await window.wos.meetings.updateStatus({ id, status: transcriptFile ? 'reading' : 'transcribing', message: transcriptFile ? 'Reading file' : 'Transcribing locally', progress: transcriptFile ? 25 : 35 })
      await loadSavedMeetings()
      const { transcript, error } = await window.wos.meetings.processFile({ filePath: file.path, fileName: file.name, mimeType: file.mimeType })
      if (error) throw new Error(error)
      if (!transcript) throw new Error('Could not extract text from file')
      await window.wos.meetings.updateStatus({ id, status: 'analyzing', message: 'Analyzing with Meeting Agent', progress: 80 })
      await loadSavedMeetings()
      await processTranscript(id, title, transcript, 'upload', file.path)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await window.wos.meetings.updateStatus({ id, status: 'error', message: 'Needs retry', progress: 100, lastError: message })
      await window.wos.meetings.addActivity({ meetingId: id, type: 'processing', status: 'error', label: `Processing failed: ${message}` })
      await loadSavedMeetings()
      await loadActivity(id)
      toast.error(`Analysis failed: ${title}`)
    }
  }, [loadActivity, loadSavedMeetings, processTranscript])

  const handleNativeFile = useCallback((file: File) => {
    const filePath = window.wos.meetings.getPathForFile(file)
    if (!filePath) {
      toast.error('Could not read the file path from Electron. Try Browse instead.')
      return
    }
    void startFileJob({ name: file.name, path: filePath, mimeType: file.type, size: file.size })
  }, [startFileJob])

  const handleBrowseFile = useCallback(async () => {
    const res = await window.wos.meetings.openFileDialog()
    if (res.error) {
      toast.error(res.error)
      return
    }
    if (res.file) void startFileJob(res.file)
  }, [startFileJob])

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files[0]
    if (file) handleNativeFile(file)
  }, [handleNativeFile])

  const handleAnalyzeDrive = useCallback(async (recording: DriveRecording) => {
    const title = recording.displayName || recording.name.replace(/\.[^.]+$/, '')
    const pending = await window.wos.meetings.createPending({ title, source: 'drive', sourceUri: recording.webViewLink ?? recording.id })
    if (!pending.id) {
      toast.error(pending.error ?? 'Could not create Drive transcript row')
      return
    }
    const id = pending.id
    setSelectedMeetingId(id)
    setAnalyzeMode('detail')
    await loadSavedMeetings()
    try {
      let transcript: string | null = null
      if (recording.hasTranscript && recording.transcriptFileId && recording.transcriptName) {
        await window.wos.meetings.updateStatus({ id, status: 'reading', message: 'Reading transcript from Drive', progress: 35 })
        const res = await window.wos.meetings.getDriveTranscript({ fileId: recording.transcriptFileId, fileName: recording.transcriptName })
        if (res.error) throw new Error(res.error)
        transcript = res.transcript
      } else {
        await window.wos.meetings.updateStatus({ id, status: 'transcribing', message: 'Transcribing Drive recording locally', progress: 35 })
        const res = await window.wos.meetings.transcribeDriveVideo({ fileId: recording.id, fileName: recording.name })
        if (res.error) throw new Error(res.error)
        transcript = res.transcript
      }
      if (!transcript) throw new Error('Empty transcript')
      await processTranscript(id, title, transcript, 'drive', recording.webViewLink ?? recording.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await window.wos.meetings.updateStatus({ id, status: 'error', message: 'Needs retry', progress: 100, lastError: message })
      await window.wos.meetings.addActivity({ meetingId: id, type: 'processing', status: 'error', label: `Drive import failed: ${message}` })
      await loadSavedMeetings()
      await loadActivity(id)
      toast.error(`Drive analysis failed: ${title}`)
    }
  }, [loadActivity, loadSavedMeetings, processTranscript])

  const deleteMeeting = useCallback(async (meeting: SavedMeeting) => {
    if (!window.confirm(`Delete "${meeting.title}"? This removes the saved transcript.`)) return
    await window.wos.meetings.addActivity({ type: 'delete', status: 'info', label: `Deleted ${meeting.title}` })
    const res = await window.wos.meetings.deleteSaved({ ids: [meeting.id] })
    if (!res.ok) {
      toast.error(res.error ?? 'Delete failed')
      return
    }
    if (selectedMeetingId === meeting.id) {
      setSelectedMeetingId(null)
      setAnalyzeMode('home')
    }
    await refreshAll()
    toast.success('Transcript deleted')
  }, [refreshAll, selectedMeetingId])

  const openRenameDialog = useCallback((meeting: SavedMeeting) => {
    setRenameTarget(meeting)
    setRenameDraft(meeting.title)
  }, [])

  const confirmRename = useCallback(async () => {
    if (!renameTarget) return
    const title = renameDraft.trim()
    if (!title || title === renameTarget.title) {
      setRenameTarget(null)
      return
    }
    const res = await window.wos.meetings.renameSaved({ id: renameTarget.id, title })
    if (!res.ok) {
      toast.error(res.error ?? 'Rename failed')
      return
    }
    await refreshAll()
    setRenameTarget(null)
    toast.success('Transcript renamed')
  }, [refreshAll, renameDraft, renameTarget])

  const copyResult = useCallback(async (meeting: SavedMeeting, result: MeetingResult) => {
    await window.wos.meetings.copyMarkdown({ title: meeting.title, result })
    await addUiActivity(`Copied notes for ${meeting.title}`, 'copy', 'success', meeting.id)
    toast.success('Meeting notes copied')
  }, [addUiActivity])

  const askAiAboutMeeting = useCallback(async (meeting: SavedMeeting, result: MeetingResult) => {
    onOpenChat(buildChatDraft(meeting.title, result))
    await addUiActivity(`Opened Ask AI draft for ${meeting.title}`, 'chat', 'success', meeting.id)
    toast.success('Ask AI draft opened')
  }, [addUiActivity, onOpenChat])

  const exportResult = useCallback(async (meeting: SavedMeeting, result: MeetingResult) => {
    const res = await window.wos.meetings.exportMarkdown({ title: meeting.title, result })
    if (res.ok) {
      await addUiActivity(`Exported notes for ${meeting.title}`, 'export', 'success', meeting.id)
      toast.success('Meeting notes exported')
    }
  }, [addUiActivity])

  const reanalyzeMeeting = useCallback(async (meeting: SavedMeeting) => {
    if (!meeting.transcript) {
      toast.error('This meeting has no transcript to analyze.')
      return
    }
    try {
      await window.wos.meetings.updateStatus({ id: meeting.id, status: 'analyzing', message: 'Re-analyzing with Meeting Agent', progress: 80, lastError: null })
      await loadSavedMeetings()
      await processTranscript(meeting.id, meeting.title, meeting.transcript, (meeting.source === 'drive' ? 'drive' : 'upload'), meeting.sourceUri)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [loadSavedMeetings, processTranscript])

  const homeActivity = selectedMeeting ? activity : activity

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <SavedTranscriptSidebar
          meetings={meetings}
          selectedId={selectedMeetingId}
          query={meetingSearch}
          onQueryChange={setMeetingSearch}
          onSearch={() => void loadSavedMeetings(meetingSearch)}
          onRefresh={() => void refreshAll()}
          onSelect={selectMeeting}
          onDelete={deleteMeeting}
        />

        <main className="min-w-0 space-y-4">
          {analyzeMode === 'detail' && selectedMeeting ? (
            <TranscriptDetail
              meeting={selectedMeeting}
              activity={activity}
              onBack={() => setAnalyzeMode('home')}
              onShare={(type, result) => setShareDialog({ type, title: selectedMeeting.title, meetingId: selectedMeeting.id, result })}
              onCopy={(result) => void copyResult(selectedMeeting, result)}
              onExport={(result) => void exportResult(selectedMeeting, result)}
              onAskAi={(result) => void askAiAboutMeeting(selectedMeeting, result)}
              onReanalyze={() => void reanalyzeMeeting(selectedMeeting)}
              onRename={() => openRenameDialog(selectedMeeting)}
              onDelete={() => void deleteMeeting(selectedMeeting)}
            />
          ) : (
            <>
              <div className="rounded-2xl p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">Analyze workspace</h3>
                    <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Upload a transcript, audio, or video file. WOS creates a row immediately and works in the background.</p>
                  </div>
                  <button onClick={() => { setSelectedMeetingId(null); setAnalyzeMode('home') }} className="rounded-lg px-3 py-1.5 text-xs font-medium" style={{ background: 'var(--amber)', color: '#000' }}>
                    New analysis
                  </button>
                </div>
              </div>

              <UploadCard
                dragActive={dragActive}
                onDragActive={setDragActive}
                onDrop={handleDrop}
                onBrowse={handleBrowseFile}
                fileInputRef={fileInputRef}
                onNativeFile={handleNativeFile}
              />

              <DriveImportCard
                googleConnected={googleConnected}
                driveLoading={driveLoading}
                driveError={driveError}
                driveRecordings={driveRecordings}
                onRefresh={() => { setDriveFolderId(null); void loadDriveRecordings() }}
                onAnalyze={(rec) => void handleAnalyzeDrive(rec)}
              />

              <ActivityLog entries={homeActivity} />
            </>
          )}
        </main>
      </div>

      {shareDialog && (
        <ShareDialog
          state={shareDialog}
          onClose={() => setShareDialog(null)}
          onDone={() => void refreshAll()}
        />
      )}

      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div className="w-full max-w-md rounded-2xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Rename transcript</h3>
                <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Update the title shown in the transcript library.</p>
              </div>
              <button onClick={() => setRenameTarget(null)} className="rounded-lg p-1" style={{ color: 'var(--muted-foreground)' }}><X className="h-4 w-4" /></button>
            </div>
            <input
              autoFocus
              value={renameDraft}
              onChange={e => setRenameDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void confirmRename() }}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--input)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setRenameTarget(null)} className="rounded-lg px-3 py-1.5 text-sm" style={{ border: '1px solid var(--border)' }}>Cancel</button>
              <button onClick={() => void confirmRename()} className="rounded-lg px-3 py-1.5 text-sm font-medium" style={{ background: 'var(--amber)', color: '#000' }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AnalyzeTab
