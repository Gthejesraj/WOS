import React, { useEffect, useState, useCallback, useRef, DragEvent } from 'react'
import {
  Calendar, Upload, RefreshCw, Loader2, Users, Clock,
  AlertCircle, WifiOff, Mic, Play, FileText, ChevronRight,
  CheckCircle, HelpCircle, Zap, FolderOpen, File, X,
  MessageSquare, ExternalLink, CloudDownload, Clipboard, Mail, Hash,
  ChevronLeft,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../../lib/utils'
import { useUIStore, type MeetingsTab, type CalendarView } from '../../../store/uiStore'
import AnalyzeTab from './AnalyzeTab'

/* ── Types ── */

interface CalendarEvent {
  id: string
  summary?: string
  start: { dateTime?: string; date?: string; timeZone?: string }
  end: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: Array<{ email: string; displayName?: string; self?: boolean; responseStatus?: string }>
  hangoutLink?: string
  description?: string
  status?: string
  htmlLink?: string
  conferenceData?: {
    entryPoints?: Array<{ entryPointType: string; uri: string; label?: string }>
  }
}

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

interface SavedMeeting {
  id: string
  title: string
  startedAt?: string | number | Date
  summary?: string | null
  transcript?: string | null
}

type Tab = 'calendar' | 'analyze'
type CalendarViewType = 'week' | 'month' | 'today'
type ProcessingStep = 'idle' | 'reading' | 'transcribing' | 'analyzing' | 'done' | 'error'

interface MeetingsViewProps {
  onOpenChat: (message: string) => void
}

/* ── Calendar helpers ── */

function getEventStart(ev: CalendarEvent): Date {
  return new Date(ev.start.dateTime ?? ev.start.date ?? '')
}
function getEventEnd(ev: CalendarEvent): Date {
  return new Date(ev.end.dateTime ?? ev.end.date ?? '')
}
function getDurationMinutes(ev: CalendarEvent): number {
  return Math.max(0, Math.round((getEventEnd(ev).getTime() - getEventStart(ev).getTime()) / 60000))
}
function formatDuration(mins: number): string {
  if (mins <= 0) return ''
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60); const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
function formatTime(ev: CalendarEvent): string {
  const d = getEventStart(ev)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function formatDate(ev: CalendarEvent): string {
  const d = getEventStart(ev)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1)
  if (d.toDateString() === now.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}
function getLiveElapsed(ev: CalendarEvent): string {
  const mins = Math.floor((Date.now() - getEventStart(ev).getTime()) / 60000)
  if (mins < 1) return 'just started'
  return `${mins}m elapsed`
}
function getMeetUrl(ev: CalendarEvent): string | null {
  if (ev.hangoutLink) return ev.hangoutLink
  return ev.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri ?? null
}
function getAttendeeText(ev: CalendarEvent): string {
  const attendees = (ev.attendees ?? []).filter(a => !a.self)
  if (attendees.length === 0) return ''
  const names = attendees.slice(0, 3).map(a => a.displayName?.split(' ')[0] ?? a.email.split('@')[0])
  const extra = attendees.length > 3 ? ` +${attendees.length - 3}` : ''
  return names.join(', ') + extra
}
function groupEvents(events: CalendarEvent[]) {
  const now = new Date()
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const live: CalendarEvent[] = [], today: CalendarEvent[] = [], upcoming: CalendarEvent[] = [], past: CalendarEvent[] = []
  for (const ev of events) {
    if (ev.status === 'cancelled') continue
    const start = getEventStart(ev); const end = getEventEnd(ev)
    if (isNaN(start.getTime())) continue
    if (start <= now && end >= now) live.push(ev)
    else if (start > now && start < todayEnd) today.push(ev)
    else if (start >= todayEnd) upcoming.push(ev)
    else past.push(ev)
  }
  return { live, today, upcoming, past: past.slice(0, 10) }
}
function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
function formatRecordingDate(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

/* ── Sub-components ── */

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn('px-4 py-2 text-sm transition-colors -mb-px border-b-2 flex items-center gap-2')}
      style={{
        color: active ? 'var(--foreground)' : 'var(--muted-foreground)',
        borderBottomColor: active ? 'var(--amber)' : 'transparent',
      }}
    >
      {children}
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted-foreground)' }}>
      {children}
    </p>
  )
}

function LiveBadge({ elapsed }: { elapsed: string }) {
  return (
    <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ background: 'var(--destructive)', color: '#fff' }}>
      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
      LIVE · {elapsed}
    </span>
  )
}

function ProcessingBar({ step, message }: { step: ProcessingStep; message: string }) {
  const steps: ProcessingStep[] = ['reading', 'transcribing', 'analyzing']
  const idx = steps.indexOf(step)
  return (
    <div className="rounded-xl p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
      <div className="flex items-center gap-3 mb-3">
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--amber)' }} />
        <span className="text-sm font-medium">{message}</span>
      </div>
      <div className="flex gap-2">
        {steps.map((s, i) => (
          <div key={s} className="flex-1 h-1 rounded-full transition-all duration-500"
            style={{ background: i <= idx ? 'var(--amber)' : 'var(--border)' }} />
        ))}
      </div>
      <div className="flex justify-between mt-1">
        {['Reading file', 'Transcribing', 'Analyzing'].map((label, i) => (
          <span key={label} className="text-xs" style={{ color: i <= idx ? 'var(--amber)' : 'var(--muted-foreground)' }}>
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

function ResultPanel({ result, title, onChat }: { result: MeetingResult; title?: string; onChat: (msg: string) => void }) {
  return (
    <div className="space-y-4">
      {title && (
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button
            onClick={() => onChat(`Give me more details about: ${title}`)}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors"
            style={{ background: 'var(--amber)', color: '#000' }}
          >
            <MessageSquare className="w-3 h-3" /> Ask AI
          </button>
        </div>
      )}

      {/* Summary */}
      <div className="rounded-xl p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
        <div className="flex items-center gap-2 mb-2">
          <FileText className="w-4 h-4" style={{ color: 'var(--amber)' }} />
          <span className="text-sm font-semibold">Summary</span>
        </div>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
          {result.summary}
        </p>
      </div>

      {/* Action Items */}
      {result.actionItems.length > 0 && (
        <div className="rounded-xl p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-4 h-4" style={{ color: 'var(--amber)' }} />
            <span className="text-sm font-semibold">Action Items</span>
            <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--amber)', color: '#000' }}>
              {result.actionItems.length}
            </span>
          </div>
          <div className="space-y-2">
            {result.actionItems.map((item, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: 'var(--amber)' }} />
                <div className="min-w-0">
                  <span>{item.task}</span>
                  {(item.owner || item.dueDate) && (
                    <span className="ml-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      {item.owner ? `— ${item.owner}` : ''}{item.dueDate ? ` · ${item.dueDate}` : ''}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Decisions */}
      {result.decisions.length > 0 && (
        <div className="rounded-xl p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4" style={{ color: 'var(--amber)' }} />
            <span className="text-sm font-semibold">Key Decisions</span>
          </div>
          <div className="space-y-2">
            {result.decisions.map((d, i) => (
              <div key={i} className="text-sm">
                <p className="font-medium">{d.decision}</p>
                {d.context && <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>{d.context}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Open Questions */}
      {result.openQuestions.length > 0 && (
        <div className="rounded-xl p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
          <div className="flex items-center gap-2 mb-3">
            <HelpCircle className="w-4 h-4" style={{ color: 'var(--muted-foreground)' }} />
            <span className="text-sm font-semibold">Open Questions</span>
          </div>
          <div className="space-y-1.5">
            {result.openQuestions.map((q, i) => (
              <p key={i} className="text-sm" style={{ color: 'var(--muted-foreground)' }}>? {q}</p>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-5 gap-2">
        <button
          onClick={() => onChat(`Here are the meeting notes:\n\nSummary: ${result.summary}\n\nAction items:\n${result.actionItems.map(a => `- ${a.task}${a.owner ? ` (${a.owner})` : ''}`).join('\n')}\n\nPlease help me follow up on these.`)}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
          style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
        >
          <MessageSquare className="w-4 h-4" /> Chat
        </button>
        <button
          onClick={async () => {
            await window.wos.meetings.copyMarkdown({ title: title ?? 'Meeting Notes', result })
            toast.success('Meeting notes copied')
          }}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
          style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
        >
          <Clipboard className="w-4 h-4" /> Copy
        </button>
        <button
          onClick={async () => {
            const res = await window.wos.meetings.exportMarkdown({ title: title ?? 'Meeting Notes', result })
            if (res.ok) toast.success('Meeting notes exported')
          }}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
          style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
        >
          <CloudDownload className="w-4 h-4" /> Export
        </button>
        <button
          onClick={() => toast.message('Open the transcript detail view to review the Gmail draft before sending.')}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
          style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
        >
          <Mail className="w-4 h-4" /> Email
        </button>
        <button
          onClick={() => toast.message('Open the transcript detail view to review the Slack draft before sending.')}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
          style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
        >
          <Hash className="w-4 h-4" /> Slack
        </button>
      </div>
    </div>
  )
}

/* ── EventCard ── */

function EventCard({
  event,
  isLive,
  onChat,
}: {
  event: CalendarEvent
  isLive?: boolean
  onChat: (msg: string) => void
}) {
  const meetUrl = getMeetUrl(event)
  const title = event.summary ?? 'Untitled Event'
  const duration = getDurationMinutes(event)
  const attendeeText = getAttendeeText(event)

  return (
    <div
      className="rounded-xl p-4 transition-colors"
      style={{
        border: `1px solid ${isLive ? 'rgba(239,68,68,0.5)' : 'var(--border)'}`,
        background: 'var(--card)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {isLive && (
              <span className="flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                LIVE
              </span>
            )}
            <h3 className="text-sm font-semibold truncate">{title}</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {isLive
                ? `Ends ${getEventEnd(event).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : `${formatTime(event)}${duration ? ` · ${formatDuration(duration)}` : ''}`}
            </span>
            {attendeeText && (
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {attendeeText}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onChat(`Tell me about this meeting: "${title}" on ${formatDate(event)}. Attendees: ${attendeeText || 'just me'}.`)}
            className="p-1.5 rounded-lg transition-colors wos-hover"
            style={{ color: 'var(--zinc-500)' }}
            title="Chat about this meeting"
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
          {meetUrl && (
            <a
              href={meetUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
              style={{ background: isLive ? '#ef4444' : 'var(--secondary)', color: isLive ? '#fff' : 'var(--foreground)', textDecoration: 'none' }}
            >
              <ExternalLink className="w-3 h-3" />
              {isLive ? 'Join Now' : 'Join'}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Main Component ── */

export function MeetingsView({ onOpenChat }: MeetingsViewProps) {
  const tab = useUIStore(s => s.meetingsTab) as Tab
  const setTab = useUIStore(s => s.setMeetingsTab) as (t: Tab) => void
  const calendarView = useUIStore(s => s.calendarView) as CalendarViewType
  const setCalendarView = useUIStore(s => s.setCalendarView) as (v: CalendarViewType) => void

  // Calendar tab state
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [googleConnected, setGoogleConnected] = useState(true)
  const [calendarDate, setCalendarDate] = useState(new Date())

  // Analyze tab state — Drive
  const [driveFolderId, setDriveFolderId] = useState<string | null>(null)
  const [driveRecordings, setDriveRecordings] = useState<DriveRecording[]>([])
  const [driveLoading, setDriveLoading] = useState(false)
  const [driveError, setDriveError] = useState<string | null>(null)
  const [selectedRecording, setSelectedRecording] = useState<DriveRecording | null>(null)

  // Analyze tab state — Upload
  const [dragActive, setDragActive] = useState(false)
  const [selectedFile, setSelectedFile] = useState<{ name: string; path: string; mimeType: string; size: number } | null>(null)
  const [savedMeetings, setSavedMeetings] = useState<SavedMeeting[]>([])
  const [meetingSearch, setMeetingSearch] = useState('')

  // Processing + results (shared between Drive and Upload)
  const [processingStep, setProcessingStep] = useState<ProcessingStep>('idle')
  const [processingMsg, setProcessingMsg] = useState('')
  const [processingError, setProcessingError] = useState<string | null>(null)
  const [result, setResult] = useState<MeetingResult | null>(null)
  const [resultTitle, setResultTitle] = useState<string | undefined>()

  const fileInputRef = useRef<HTMLInputElement>(null)

  /* ── Load calendar events ── */
  const loadEvents = useCallback(async () => {
    setEventsLoading(true)
    setEventsError(null)
    try {
      const res = await window.wos.meetings.listCalendarEvents()
      if (!res.connected) {
        setGoogleConnected(false)
        setEventsLoading(false)
        return
      }
      setGoogleConnected(true)
      setEvents(res.events as CalendarEvent[])
      if (res.error) setEventsError(res.error)
    } catch (err) {
      setEventsError(String(err))
    } finally {
      setEventsLoading(false)
    }
  }, [])

  /* ── Load Drive recordings ── */
  const loadDriveRecordings = useCallback(async () => {
    setDriveLoading(true)
    setDriveError(null)
    setDriveRecordings([])
    try {
      let fId = driveFolderId
      if (!fId) {
        const { folderId, error } = await window.wos.meetings.findDriveFolder()
        if (error) { setDriveError(error); setDriveLoading(false); return }
        if (!folderId) { setDriveError('No "Meet Recordings" folder found in Google Drive.'); setDriveLoading(false); return }
        fId = folderId
        setDriveFolderId(folderId)
      }
      const { recordings, error } = await window.wos.meetings.listDriveRecordings({ folderId: fId })
      if (error) { setDriveError(error); return }
      setDriveRecordings(recordings as DriveRecording[])
    } catch (err) {
      setDriveError(String(err))
    } finally {
      setDriveLoading(false)
    }
  }, [driveFolderId])

  const loadSavedMeetings = useCallback(async (query = meetingSearch) => {
    const { meetings, error } = await window.wos.meetings.listSaved({ query })
    if (!error) setSavedMeetings(meetings as SavedMeeting[])
  }, [meetingSearch])

  /* ── Effects ── */
  useEffect(() => { loadEvents() }, [loadEvents])

  useEffect(() => {
    const unsub = window.wos.meetings.onMeetingClosed((data) => {
      void loadSavedMeetings()
      setTab('analyze')
      if (data?.analyzed) toast.success('Meeting saved and summarized.')
      else toast.success('Meeting saved.')
    })
    const unsub2 = window.wos.meetings.onAnalysisError((data) => {
      if (data.error) toast.error(data.error)
    })
    return () => { unsub(); unsub2() }
  }, [loadSavedMeetings])

  const resetAnalysis = useCallback(() => {
    setProcessingStep('idle')
    setProcessingMsg('')
    setProcessingError(null)
    setResult(null)
    setResultTitle(undefined)
    setSelectedRecording(null)
    setSelectedFile(null)
  }, [])

  const runAnalysis = useCallback(async (transcript: string, title: string) => {
    setProcessingStep('analyzing')
    setProcessingMsg('Analyzing meeting with AI...')
    try {
      const { result: analysisResult, error } = await window.wos.meetings.analyze({ transcript, title })
      if (error) throw new Error(error)
      if (!analysisResult) throw new Error('No result returned')
      setResult(analysisResult as MeetingResult)
      setResultTitle(title)
      setProcessingStep('done')
      void loadSavedMeetings()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setProcessingError(msg)
      setProcessingStep('error')
    }
  }, [loadSavedMeetings])

  const handleAnalyzeDrive = useCallback(async (recording: DriveRecording) => {
    setSelectedRecording(recording)
    setResult(null)
    setProcessingError(null)
    const title = recording.displayName

    if (recording.hasTranscript && recording.transcriptFileId && recording.transcriptName) {
      setProcessingStep('reading')
      setProcessingMsg('Reading transcript from Drive...')
      try {
        const { transcript, error } = await window.wos.meetings.getDriveTranscript({
          fileId: recording.transcriptFileId,
          fileName: recording.transcriptName,
        })
        if (error) throw new Error(error)
        if (!transcript) throw new Error('Empty transcript')
        await runAnalysis(transcript, title)
      } catch (err) {
        setProcessingError(String(err))
        setProcessingStep('error')
      }
    } else {
      // Need to download video + transcribe
      setProcessingStep('transcribing')
      setProcessingMsg('Transcribing locally with Apple Speech... (this may take a moment)')
      try {
        const { transcript, error } = await window.wos.meetings.transcribeDriveVideo({
          fileId: recording.id,
          fileName: recording.name,
        })
        if (error) throw new Error(error)
        if (!transcript) throw new Error('Empty transcript')
        await runAnalysis(transcript, title)
      } catch (err) {
        setProcessingError(String(err))
        setProcessingStep('error')
      }
    }
  }, [runAnalysis])

  const handleFileSelect = useCallback((file: File) => {
    const filePath = window.wos.meetings.getPathForFile(file)
    if (!filePath) {
      setProcessingError('Could not read the file path from Electron. Try the Browse button instead.')
      setProcessingStep('error')
      return
    }
    setSelectedFile({ name: file.name, path: filePath, mimeType: file.type, size: file.size })
    setResult(null)
    setProcessingError(null)
    setProcessingStep('idle')
    setSelectedRecording(null)
  }, [])

  const handleAnalyzeFile = useCallback(async () => {
    if (!selectedFile) return
    setResult(null)
    setProcessingError(null)

    setProcessingStep('reading')
    setProcessingMsg('Reading file...')

    try {
      const { transcript, error, format } = await window.wos.meetings.processFile({
        filePath: selectedFile.path,
        fileName: selectedFile.name,
        mimeType: selectedFile.mimeType,
      })
      if (error) throw new Error(error)
      if (!transcript) throw new Error('Could not extract text from file')

      if (format === 'transcript') {
        setProcessingStep('analyzing')
      } else {
        setProcessingStep('transcribing')
        setProcessingMsg('Transcribing locally with Apple Speech...')
        // Small delay so UI updates before analyze call
        await new Promise(r => setTimeout(r, 100))
      }

      await runAnalysis(transcript, selectedFile.name.replace(/\.[^.]+$/, ''))
    } catch (err) {
      setProcessingError(String(err))
      setProcessingStep('error')
    }
  }, [selectedFile, runAnalysis])

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect])

  const handleBrowseFile = useCallback(async () => {
    const res = await window.wos.meetings.openFileDialog()
    if (res.error) {
      setProcessingError(res.error)
      setProcessingStep('error')
      return
    }
    if (res.file) {
      setSelectedFile(res.file)
      setResult(null)
      setProcessingError(null)
      setProcessingStep('idle')
      setSelectedRecording(null)
    }
  }, [])

  const grouped = groupEvents(events)
  const isProcessing = processingStep !== 'idle' && processingStep !== 'done' && processingStep !== 'error'

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--background)' }}>
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Calendar className="w-5 h-5" style={{ color: 'var(--amber)' }} />
              Meetings
            </h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
              View your calendar or analyze recordings and uploads.
            </p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 border-b" style={{ borderColor: 'var(--border)' }}>
          <TabButton active={tab === 'calendar'} onClick={() => setTab('calendar')}>
            <Calendar className="w-3.5 h-3.5" /> Calendar
          </TabButton>
          <TabButton active={tab === 'analyze'} onClick={() => setTab('analyze')}>
            <Mic className="w-3.5 h-3.5" /> Analyse
          </TabButton>
        </div>

        {/* ══════════════════ CALENDAR TAB ══════════════════ */}
        {tab === 'calendar' && (
          <CalendarTabView
            events={events}
            eventsLoading={eventsLoading}
            eventsError={eventsError}
            googleConnected={googleConnected}
            calendarView={calendarView}
            calendarDate={calendarDate}
            onViewChange={setCalendarView}
            onDateChange={setCalendarDate}
            onRefresh={loadEvents}
            onChat={onOpenChat}
            grouped={grouped}
          />
        )}

        {/* ══════════════════ ANALYSE TAB ══════════════════ */}
        {tab === 'analyze' && (
          <AnalyzeTab googleConnected={googleConnected} onOpenChat={onOpenChat} />
        )}
      </div>
    </div>
  )
}

/* ── Calendar Tab View ── */

function CalendarTabView({
  events, eventsLoading, eventsError, googleConnected,
  calendarView, calendarDate, onViewChange, onDateChange, onRefresh, onChat, grouped,
}: {
  events: CalendarEvent[]
  eventsLoading: boolean
  eventsError: string | null
  googleConnected: boolean
  calendarView: CalendarViewType
  calendarDate: Date
  onViewChange: (v: CalendarViewType) => void
  onDateChange: (d: Date) => void
  onRefresh: () => void
  onChat: (msg: string) => void
  grouped: ReturnType<typeof groupEvents>
}) {
  const today = new Date()

  const getWeekStart = (d: Date) => {
    const start = new Date(d)
    start.setDate(d.getDate() - d.getDay())
    start.setHours(0, 0, 0, 0)
    return start
  }

  const getWeekDays = (start: Date) => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return d
    })
  }

  const getMonthDays = (year: number, month: number) => {
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const days: (Date | null)[] = []
    for (let i = 0; i < firstDay.getDay(); i++) days.push(null)
    for (let i = 1; i <= lastDay.getDate(); i++) days.push(new Date(year, month, i))
    return days
  }

  const getEventsForDay = (day: Date) =>
    events.filter(ev => {
      const start = getEventStart(ev)
      return !isNaN(start.getTime()) && start.toDateString() === day.toDateString()
    })

  const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  const isToday = (d: Date) => isSameDay(d, today)

  const weekStart = getWeekStart(calendarDate)
  const weekDays = getWeekDays(weekStart)
  const [selectedDay, setSelectedDay] = useState<Date>(today)
  const selectedDayEvents = getEventsForDay(selectedDay)

  const navigate = (dir: -1 | 1) => {
    const next = new Date(calendarDate)
    if (calendarView === 'week') next.setDate(next.getDate() + dir * 7)
    else if (calendarView === 'month') next.setMonth(next.getMonth() + dir)
    onDateChange(next)
  }

  const weekLabel = `${weekDays[0].toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${weekDays[6].toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`
  const monthLabel = calendarDate.toLocaleDateString([], { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-4">
      {/* View controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: 'var(--secondary)' }}>
          {(['week', 'month', 'today'] as CalendarViewType[]).map(v => (
            <button
              key={v}
              onClick={() => { onViewChange(v); if (v === 'today') { onDateChange(today); setSelectedDay(today) } }}
              className="px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors"
              style={{
                background: calendarView === v ? 'var(--card)' : 'transparent',
                color: calendarView === v ? 'var(--foreground)' : 'var(--muted-foreground)',
                boxShadow: calendarView === v ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
              }}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {calendarView !== 'today' && (
            <>
              <button
                onClick={() => navigate(-1)}
                className="p-1 rounded wos-hover transition-colors"
                style={{ color: 'var(--muted-foreground)' }}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium min-w-[180px] text-center" style={{ color: 'var(--foreground)' }}>
                {calendarView === 'week' ? weekLabel : monthLabel}
              </span>
              <button
                onClick={() => navigate(1)}
                className="p-1 rounded wos-hover transition-colors"
                style={{ color: 'var(--muted-foreground)' }}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            onClick={onRefresh}
            disabled={eventsLoading}
            className="p-1 rounded wos-hover transition-colors"
            style={{ color: 'var(--muted-foreground)' }}
            title="Refresh"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', eventsLoading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Not connected empty state */}
      {!googleConnected && (
        <div className="rounded-xl p-8 flex flex-col items-center gap-4 text-center" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
          <WifiOff className="w-10 h-10" style={{ color: 'var(--muted-foreground)' }} />
          <div>
            <p className="font-semibold text-sm">Google Calendar not connected</p>
            <p className="text-xs mt-1.5" style={{ color: 'var(--muted-foreground)' }}>
              Connect Google Workspace in <strong>Settings → Connections</strong> to see your calendar.
            </p>
          </div>
        </div>
      )}

      {/* Loading */}
      {googleConnected && eventsLoading && (
        <div className="flex items-center gap-2 py-12 justify-center" style={{ color: 'var(--muted-foreground)' }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading calendar…</span>
        </div>
      )}

      {/* Error */}
      {eventsError && !eventsLoading && (
        <div className="rounded-xl p-4 flex items-center gap-2" style={{ border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--destructive)' }}>
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="text-sm">{eventsError}</span>
        </div>
      )}

      {googleConnected && !eventsLoading && (
        <>
          {/* ── WEEK VIEW ── */}
          {calendarView === 'week' && (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {/* Day columns header */}
              <div className="grid grid-cols-7" style={{ borderBottom: '1px solid var(--border)', background: 'var(--card)' }}>
                {weekDays.map((day, i) => (
                  <div
                    key={i}
                    className="px-2 py-3 text-center cursor-pointer wos-hover-sm transition-colors"
                    onClick={() => setSelectedDay(day)}
                  >
                    <div className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
                      {day.toLocaleDateString([], { weekday: 'short' })}
                    </div>
                    <div
                      className="text-sm font-semibold mt-0.5 w-7 h-7 flex items-center justify-center rounded-full mx-auto"
                      style={{
                        background: isToday(day) ? 'var(--amber)' : isSameDay(day, selectedDay) ? 'var(--secondary)' : 'transparent',
                        color: isToday(day) ? '#000' : 'var(--foreground)',
                      }}
                    >
                      {day.getDate()}
                    </div>
                    {/* Event dots */}
                    <div className="flex justify-center gap-0.5 mt-1">
                      {getEventsForDay(day).slice(0, 3).map((_, j) => (
                        <span key={j} className="w-1 h-1 rounded-full" style={{ background: 'var(--amber)' }} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {/* Selected day event list */}
              <div className="p-4" style={{ background: 'var(--background)' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: 'var(--muted-foreground)' }}>
                  {selectedDay.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                  {selectedDayEvents.length > 0 && ` — ${selectedDayEvents.length} meeting${selectedDayEvents.length !== 1 ? 's' : ''}`}
                </p>
                {selectedDayEvents.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>No meetings this day.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedDayEvents.map(ev => {
                      const now = new Date()
                      const start = getEventStart(ev); const end = getEventEnd(ev)
                      const isLive = start <= now && end >= now
                      return <EventCard key={ev.id} event={ev} isLive={isLive} onChat={onChat} />
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── MONTH VIEW ── */}
          {calendarView === 'month' && (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {/* Weekday header */}
              <div className="grid grid-cols-7" style={{ borderBottom: '1px solid var(--border)', background: 'var(--card)' }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <div key={d} className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
                    {d}
                  </div>
                ))}
              </div>
              {/* Days grid */}
              <div className="grid grid-cols-7" style={{ background: 'var(--background)' }}>
                {getMonthDays(calendarDate.getFullYear(), calendarDate.getMonth()).map((day, i) => {
                  if (!day) return <div key={i} className="min-h-[72px]" style={{ borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' }} />
                  const dayEvents = getEventsForDay(day)
                  const isSelected = isSameDay(day, selectedDay)
                  return (
                    <div
                      key={i}
                      onClick={() => setSelectedDay(day)}
                      className="min-h-[72px] p-1.5 cursor-pointer wos-hover-sm transition-colors"
                      style={{
                        borderBottom: '1px solid var(--border)',
                        borderRight: '1px solid var(--border)',
                        background: isSelected ? 'var(--card)' : undefined,
                      }}
                    >
                      <div
                        className="text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1"
                        style={{
                          background: isToday(day) ? 'var(--amber)' : 'transparent',
                          color: isToday(day) ? '#000' : 'var(--foreground)',
                        }}
                      >
                        {day.getDate()}
                      </div>
                      {dayEvents.slice(0, 2).map((ev, j) => (
                        <div
                          key={j}
                          className="truncate text-[10px] px-1 py-0.5 rounded mb-0.5"
                          style={{ background: 'var(--amber-muted)', color: 'var(--amber)' }}
                        >
                          {ev.summary ?? 'Event'}
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <div className="text-[10px]" style={{ color: 'var(--muted-foreground)' }}>+{dayEvents.length - 2} more</div>
                      )}
                    </div>
                  )
                })}
              </div>
              {/* Selected day details */}
              {selectedDayEvents.length > 0 && (
                <div className="p-4" style={{ borderTop: '1px solid var(--border)', background: 'var(--card)' }}>
                  <p className="text-xs font-semibold mb-3" style={{ color: 'var(--muted-foreground)' }}>
                    {selectedDay.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                  </p>
                  <div className="space-y-2">
                    {selectedDayEvents.map(ev => {
                      const now = new Date()
                      const start = getEventStart(ev); const end = getEventEnd(ev)
                      const isLive = start <= now && end >= now
                      return <EventCard key={ev.id} event={ev} isLive={isLive} onChat={onChat} />
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── TODAY VIEW ── */}
          {calendarView === 'today' && (
            <div className="space-y-3">
              <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                {today.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              {grouped.live.length > 0 && (
                <div>
                  <SectionLabel>🔴 Live Now</SectionLabel>
                  <div className="space-y-2">
                    {grouped.live.map(ev => <EventCard key={ev.id} event={ev} isLive onChat={onChat} />)}
                  </div>
                </div>
              )}
              {grouped.today.length > 0 && (
                <div>
                  <SectionLabel>Upcoming Today</SectionLabel>
                  <div className="space-y-2">
                    {grouped.today.map(ev => <EventCard key={ev.id} event={ev} onChat={onChat} />)}
                  </div>
                </div>
              )}
              {grouped.live.length === 0 && grouped.today.length === 0 && (
                <div className="rounded-xl p-8 flex flex-col items-center gap-3 text-center" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
                  <Calendar className="w-8 h-8" style={{ color: 'var(--muted-foreground)' }} />
                  <p className="text-sm font-medium">No more meetings today</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default MeetingsView
