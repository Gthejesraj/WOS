import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { getConnection } from '../apps/manager'
import * as googleApi from '../apps/google/api'
import { getFreshToken } from '../apps/google/api'
import type { GoogleCreds } from '../apps/google/api'
import { slackCall } from '../apps/slack/api'
import { analyzeTranscript } from '../meetings/analyze'
import {
  addMeetingActivity,
  createPendingMeeting,
  deleteMeetings,
  listMeetingActivity,
  listMeetings,
  renameMeeting,
  saveMeeting,
  searchMeetings,
  updateMeetingStatus,
} from '../meetings/store'
import type { MeetingProcessingStatus } from '../meetings/store'
import { extractTranscript, parseSrt, parseVtt } from '../transcription'
import { finalizeLiveSession, leaveLiveSession, setMeetingsWindow, startLiveSession } from '../meetings/liveSession'
import { openChromeInstallPage, openGoogleSignIn } from '../meetings/playwrightSession'

/* ── helpers ── */

function setMainWindowForMeetings(win: BrowserWindow) {
  setMeetingsWindow(win)
}

async function getGoogleCreds(): Promise<{ creds: GoogleCreds; connected: boolean } | { error: string; connected: false }> {
  const conn = getConnection('google')
  if (!conn || !conn.enabled) return { error: 'Google not connected', connected: false }
  return { creds: conn.creds as unknown as GoogleCreds, connected: true }
}

async function searchDriveFiles(creds: GoogleCreds, query: string) {
  const token = await getFreshToken(creds)
  const q = encodeURIComponent(query)
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)&pageSize=100&orderBy=modifiedTime+desc`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Drive search failed: ${res.status}`)
  const data = await res.json() as { files: Array<{ id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; webViewLink?: string }> }
  return data.files ?? []
}

async function downloadDriveText(creds: GoogleCreds, fileId: string): Promise<string> {
  const token = await getFreshToken(creds)
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`)
  return res.text()
}

async function downloadDriveToTemp(creds: GoogleCreds, fileId: string, fileName: string): Promise<string> {
  const token = await getFreshToken(creds)
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Drive binary download failed: ${res.status}`)
  const ab = await res.arrayBuffer()
  const safeName = fileName.replace(/[^\w.\- ]+/g, '_')
  const filePath = path.join(os.tmpdir(), `wos-${Date.now()}-${safeName}`)
  fs.writeFileSync(filePath, Buffer.from(ab))
  return filePath
}

function toMarkdown(title: string, result: {
  summary?: string
  actionItems?: Array<{ owner?: string | null; task?: string; dueDate?: string | null }>
  decisions?: Array<{ decision?: string; context?: string | null }>
  openQuestions?: string[]
}) {
  const lines = [`# ${title || 'Meeting Notes'}`, '']
  if (result.summary) lines.push('## Summary', result.summary, '')
  if (result.actionItems?.length) {
    lines.push('## Action Items')
    for (const item of result.actionItems) {
      lines.push(`- ${item.task ?? ''}${item.owner ? ` (${item.owner})` : ''}${item.dueDate ? ` — due ${item.dueDate}` : ''}`)
    }
    lines.push('')
  }
  if (result.decisions?.length) {
    lines.push('## Decisions')
    for (const item of result.decisions) {
      lines.push(`- ${item.decision ?? ''}${item.context ? ` — ${item.context}` : ''}`)
    }
    lines.push('')
  }
  if (result.openQuestions?.length) {
    lines.push('## Open Questions', ...result.openQuestions.map(q => `- ${q}`), '')
  }
  return lines.join('\n')
}

function getSlackToken(): string {
  const conn = getConnection('slack')
  const creds = conn?.creds as { botToken?: string; userToken?: string } | undefined
  return creds?.botToken || creds?.userToken || ''
}

async function listSlackDestinations(token: string) {
  const out: Array<{ id: string; name: string; type: string; isPrivate?: boolean; isIm?: boolean }> = []
  let cursor = ''
  do {
    const res = await slackCall<{
      channels: Array<{ id: string; name?: string; is_private?: boolean; is_im?: boolean; is_mpim?: boolean; user?: string }>
      response_metadata?: { next_cursor?: string }
    }>('conversations.list', token, {
      types: 'public_channel,private_channel,mpim,im',
      limit: 200,
      cursor,
    }, { isForm: true })
    for (const ch of res.channels ?? []) {
      const type = ch.is_im ? 'dm' : ch.is_mpim ? 'group-dm' : ch.is_private ? 'private-channel' : 'channel'
      out.push({
        id: ch.id,
        name: ch.name || ch.user || ch.id,
        type,
        isPrivate: Boolean(ch.is_private),
        isIm: Boolean(ch.is_im || ch.is_mpim),
      })
    }
    cursor = res.response_metadata?.next_cursor ?? ''
  } while (cursor)
  return out
}

/* ── IPC Handlers ── */

export { setMainWindowForMeetings }

export function registerMeetingsHandlers() {
  ipcMain.handle('meetings:calendar:list', async () => {
    const g = await getGoogleCreds()
    if ('error' in g) return { events: [], error: null, connected: false }

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

    try {
      const data = await googleApi.listCalendarEvents(g.creds, todayStart.toISOString(), tomorrowStart.toISOString(), 100)
      return { events: data.items ?? [], error: null, connected: true }
    } catch (err) {
      return { events: [], error: String(err), connected: true }
    }
  })

  ipcMain.handle('meetings:google:sign-in', async () => {
    try {
      await openGoogleSignIn()
      return { ok: true }
    } catch (err) {
      await openChromeInstallPage().catch(() => {})
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('meetings:join-in-wos', async (_e, { url, title }: { url: string; title: string }) => {
    try {
      await startLiveSession(url, title)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('meetings:leave-live', async () => {
    try {
      await leaveLiveSession()
      await finalizeLiveSession()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('meetings:dialog:open-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Meeting files', extensions: ['mp3', 'm4a', 'wav', 'aiff', 'mp4', 'mov', 'webm', 'txt', 'vtt', 'srt', 'docx', 'pdf'] },
      ],
    })
    if (result.canceled || !result.filePaths[0]) return { file: null }
    const filePath = result.filePaths[0]
    const stat = fs.statSync(filePath)
    return {
      file: {
        name: path.basename(filePath),
        path: filePath,
        mimeType: '',
        size: stat.size,
      },
    }
  })

  ipcMain.handle('meetings:drive:find-folder', async () => {
    const g = await getGoogleCreds()
    if ('error' in g) return { folderId: null, error: g.error }

    try {
      const files = await searchDriveFiles(
        g.creds,
        "name='Meet Recordings' and mimeType='application/vnd.google-apps.folder' and trashed=false"
      )
      const folder = files[0]
      return { folderId: folder?.id ?? null, error: null }
    } catch (err) {
      return { folderId: null, error: String(err) }
    }
  })

  ipcMain.handle('meetings:drive:list-recordings', async (_e, { folderId }: { folderId: string }) => {
    const g = await getGoogleCreds()
    if ('error' in g) return { recordings: [], error: g.error }

    try {
      const videos = await searchDriveFiles(g.creds, `'${folderId}' in parents and mimeType='video/mp4' and trashed=false`)
      const vtts = await searchDriveFiles(g.creds, `'${folderId}' in parents and (mimeType='text/vtt' or name contains '.vtt' or name contains '.srt') and trashed=false`)
      const recordings = videos.map(video => {
        const baseName = video.name.replace(/\.mp4$/, '')
        const transcript = vtts.find(v => v.name.startsWith(baseName) || v.name.includes(baseName.slice(0, 20)))
        return {
          id: video.id,
          name: video.name,
          displayName: baseName,
          date: video.modifiedTime ?? '',
          mimeType: video.mimeType,
          size: video.size ? parseInt(video.size, 10) : 0,
          webViewLink: video.webViewLink,
          hasTranscript: !!transcript,
          transcriptFileId: transcript?.id,
          transcriptName: transcript?.name,
        }
      })
      return { recordings, error: null }
    } catch (err) {
      return { recordings: [], error: String(err) }
    }
  })

  ipcMain.handle('meetings:drive:get-transcript', async (_e, { fileId, fileName }: { fileId: string; fileName: string }) => {
    const g = await getGoogleCreds()
    if ('error' in g) return { transcript: null, error: g.error }

    try {
      const raw = await downloadDriveText(g.creds, fileId)
      const ext = path.extname(fileName).toLowerCase()
      const transcript = ext === '.vtt' ? parseVtt(raw) : ext === '.srt' ? parseSrt(raw) : raw
      return { transcript, error: null }
    } catch (err) {
      return { transcript: null, error: String(err) }
    }
  })

  ipcMain.handle('meetings:drive:transcribe-video', async (_e, { fileId, fileName }: { fileId: string; fileName: string }) => {
    const g = await getGoogleCreds()
    if ('error' in g) return { transcript: null, error: g.error }

    let tempPath: string | null = null
    try {
      tempPath = await downloadDriveToTemp(g.creds, fileId, fileName)
      const { text } = await extractTranscript(tempPath)
      return { transcript: text, error: null }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { transcript: null, error: message }
    } finally {
      if (tempPath) fs.rmSync(tempPath, { force: true })
    }
  })

  ipcMain.handle('meetings:process-file', async (_e, { filePath, fileName: _fileName, mimeType }: { filePath: string; fileName: string; mimeType: string }) => {
    try {
      const { text, format } = await extractTranscript(filePath, mimeType)
      if (!text.trim()) return { transcript: null, error: 'No speech or text was detected in this file.', format }
      return { transcript: text, error: null, format }
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      if (name === 'TranscriptionUnavailableError') {
        return { transcript: null, error: (err as Error).message }
      }
      return { transcript: null, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('meetings:create-pending', async (_e, { title, source, sourceUri }: { title: string; source: 'upload' | 'drive'; sourceUri?: string | null }) => {
    try {
      const id = createPendingMeeting({ title, source, sourceUri, status: 'queued', message: 'Queued' })
      addMeetingActivity({ meetingId: id, type: 'created', status: 'info', label: `Queued ${title}` })
      return { id, error: null }
    } catch (err) {
      return { id: null, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('meetings:update-status', async (_e, {
    id,
    status,
    message,
    progress,
    lastError,
  }: { id: string; status: MeetingProcessingStatus; message?: string | null; progress?: number | null; lastError?: string | null }) => {
    try {
      updateMeetingStatus(id, status, message, progress, lastError)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('meetings:activity:list', async (_e, { meetingId, limit }: { meetingId?: string | null; limit?: number } = {}) => {
    try {
      return { entries: listMeetingActivity(meetingId, limit ?? 20), error: null }
    } catch (err) {
      return { entries: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('meetings:activity:add', async (_e, input: { meetingId?: string | null; type: string; status: 'success' | 'error' | 'info'; label: string; detail?: unknown }) => {
    try {
      const id = addMeetingActivity(input)
      return { id, error: null }
    } catch (err) {
      return { id: null, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('meetings:analyze', async (_e, { id, transcript, title, source, sourceUri }: { id?: string; transcript: string; title?: string; source?: 'upload' | 'drive' | 'live'; sourceUri?: string | null }) => {
    try {
      if (id) updateMeetingStatus(id, 'analyzing', 'Analyzing with Meeting Agent', 80, null)
      const result = await analyzeTranscript(transcript, title)
      const savedId = saveMeeting({
        id,
        title: title ?? 'Uploaded Meeting',
        source: source ?? 'upload',
        transcript,
        sourceUri: sourceUri ?? null,
        analysis: result,
        processingStatus: 'done',
        processingMessage: 'Summary ready',
        processingProgress: 100,
        lastError: null,
      })
      addMeetingActivity({ meetingId: savedId, type: 'analysis', status: 'success', label: `Analyzed ${title ?? 'Uploaded Meeting'}` })
      return { id: savedId, result, error: null }
    } catch (err) {
      if (id) {
        const msg = err instanceof Error ? err.message : String(err)
        updateMeetingStatus(id, 'error', 'Needs retry', 100, msg)
        addMeetingActivity({ meetingId: id, type: 'analysis', status: 'error', label: `Analysis failed: ${msg}` })
      }
      return { result: null, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('meetings:list', (_e, { query }: { query?: string } = {}) => {
    try {
      const meetings = query?.trim() ? searchMeetings(query) : listMeetings()
      return { meetings, error: null }
    } catch (err) {
      return { meetings: [], error: String(err) }
    }
  })

  ipcMain.handle('meetings:delete', (_e, { ids }: { ids: string[] }) => {
    try {
      deleteMeetings(ids)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('meetings:rename', (_e, { id, title }: { id: string; title: string }) => {
    try {
      renameMeeting(id, title)
      addMeetingActivity({ meetingId: id, type: 'rename', status: 'success', label: `Renamed meeting to ${title}` })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('meetings:copy-markdown', (_e, { title, result }: { title: string; result: Record<string, unknown> }) => {
    clipboard.writeText(toMarkdown(title, result))
    return { ok: true }
  })

  ipcMain.handle('meetings:email-notes', async (_e, { to, cc, subject, body, title, result, meetingId }: { to: string; cc?: string; subject?: string; body?: string; title?: string; result?: Record<string, unknown>; meetingId?: string | null }) => {
    const g = await getGoogleCreds()
    if ('error' in g) return { ok: false, error: g.error }
    try {
      const resolvedTitle = title || 'Untitled Meeting'
      const sent = await googleApi.sendMessage(g.creds, to, subject || `Meeting notes: ${resolvedTitle}`, body || toMarkdown(resolvedTitle, result ?? {}), cc)
      addMeetingActivity({ meetingId, type: 'gmail', status: 'success', label: `Sent email to ${to}`, detail: { id: (sent as { id?: string }).id, subject } })
      return { ok: true, id: (sent as { id?: string }).id }
    } catch (err) {
      addMeetingActivity({ meetingId, type: 'gmail', status: 'error', label: `Email failed: ${err instanceof Error ? err.message : String(err)}` })
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('meetings:gmail-draft', async (_e, { to, subject, body, meetingId }: { to: string; subject: string; body: string; meetingId?: string | null }) => {
    const g = await getGoogleCreds()
    if ('error' in g) return { ok: false, error: g.error }
    try {
      const draft = await googleApi.createDraft(g.creds, to, subject, body)
      addMeetingActivity({ meetingId, type: 'gmail-draft', status: 'success', label: `Saved Gmail draft to ${to}`, detail: draft })
      return { ok: true, draft }
    } catch (err) {
      addMeetingActivity({ meetingId, type: 'gmail-draft', status: 'error', label: `Gmail draft failed: ${err instanceof Error ? err.message : String(err)}` })
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('meetings:slack:destinations', async () => {
    const token = getSlackToken()
    if (!token) return { destinations: [], error: 'Slack is not connected or has no bot/user token configured.' }
    try {
      return { destinations: await listSlackDestinations(token), error: null }
    } catch (err) {
      return { destinations: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('meetings:slack-post', async (_e, { channel, text, title, result, meetingId }: { channel: string; text?: string; title?: string; result?: Record<string, unknown>; meetingId?: string | null }) => {
    const token = getSlackToken()
    if (!token) return { ok: false, error: 'Slack is not connected or has no bot/user token configured.' }
    try {
      const body = text || toMarkdown(title || 'Meeting Notes', result ?? {})
      const res = await slackCall<{ ts: string; channel: string }>('chat.postMessage', token, {
        channel,
        text: body,
      })
      addMeetingActivity({ meetingId, type: 'slack', status: 'success', label: `Sent to Slack ${res.channel}`, detail: { channel: res.channel, ts: res.ts } })
      return { ok: true, ts: res.ts, channel: res.channel }
    } catch (err) {
      addMeetingActivity({ meetingId, type: 'slack', status: 'error', label: `Slack failed: ${err instanceof Error ? err.message : String(err)}` })
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('meetings:export-markdown', async (_e, { title, result }: { title: string; result: Record<string, unknown> }) => {
    const chosen = await dialog.showSaveDialog({
      defaultPath: `${title || 'meeting-notes'}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (chosen.canceled || !chosen.filePath) return { ok: false, canceled: true }
    fs.writeFileSync(chosen.filePath, toMarkdown(title, result), 'utf-8')
    return { ok: true, path: chosen.filePath }
  })

  ipcMain.handle('meetings:open-external', async (_e, { url }: { url: string }) => {
    await shell.openExternal(url)
    return { ok: true }
  })
}
