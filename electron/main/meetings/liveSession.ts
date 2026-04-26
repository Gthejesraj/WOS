import type { BrowserWindow } from 'electron'
import type { Page } from 'playwright'
import { analyzeTranscript } from './analyze'
import { openMeetPage } from './playwrightSession'
import { saveMeeting } from './store'
import { resolveAgent } from '../agent/settings'

/**
 * Live meeting orchestrator. v1 scope: captions-only.
 *
 * We previously also recorded the WebRTC audio stream as webm/Opus and tried
 * to feed it into Apple Speech as a fallback, but Apple Speech / SpeechAnalyzer
 * cannot decode webm/Opus directly, so the fallback path produced nothing but
 * a "WebRTC audio fallback failed" toast for every meeting. The user only
 * wants the post-meeting transcript and is OK with captions being the canonical
 * source — so we removed the audio path entirely. To re-introduce audio, the
 * tap would need to either (a) emit raw 16kHz PCM via AudioWorklet, or
 * (b) we'd bundle ffmpeg-static to transcode webm -> wav before handing to
 * the Swift helper.
 */

interface LiveCaption {
  text: string
  timestamp: number
}

interface LiveSession {
  url: string
  title: string
  startedAt: Date
  page: Page
  captions: LiveCaption[]
  finalized: boolean
}

let current: LiveSession | null = null
let mainWindow: BrowserWindow | null = null

export function setMeetingsWindow(win: BrowserWindow) {
  mainWindow = win
}

function emit(channel: string, payload?: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

export function getCurrentLiveSession() {
  return current
}

export async function startLiveSession(url: string, title: string) {
  if (current && !current.finalized) {
    throw new Error('Already in a meeting. Leave the current meeting before joining another.')
  }

  const startedAt = new Date()
  const captions: LiveCaption[] = []

  // Clear any stale error chip from a prior session.
  emit('meet:analysis-error', { error: null })

  const page = await openMeetPage(url, caption => {
    captions.push({ text: caption.text, timestamp: caption.timestamp })
    emit('meet:caption-update', caption)
  })

  current = {
    url,
    title,
    startedAt,
    page,
    captions,
    finalized: false,
  }
  page.on('close', () => {
    void finalizeLiveSession()
  })
  return current
}

export async function finalizeLiveSession() {
  const session = current
  if (!session || session.finalized) return null
  session.finalized = true
  current = null

  const endedAt = new Date()
  const agent = await resolveAgent('meeting')

  const transcript = session.captions
    .map(c => c.text)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()

  const durationSeconds = Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000)
  let analysis = null
  const autoSummarize = agent.config.autoSummarize !== false
  const wordCount = transcript.split(/\s+/).filter(Boolean).length
  if (autoSummarize && transcript && (durationSeconds >= 120 || wordCount >= 50)) {
    try {
      analysis = await analyzeTranscript(transcript, session.title)
    } catch (err) {
      emit('meet:analysis-error', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const id = saveMeeting({
    title: session.title,
    source: 'live',
    startedAt: session.startedAt,
    endedAt,
    transcript,
    sourceUri: session.url,
    analysis,
  })

  emit('meet:window-closed', { id, analyzed: Boolean(analysis), captionCount: session.captions.length })
  return { id, analysis }
}

export async function leaveLiveSession() {
  const session = current
  if (!session) return
  await session.page.close().catch(() => {})
  await finalizeLiveSession()
}
