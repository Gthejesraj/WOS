import { ipcMain, BrowserWindow } from 'electron'
import { transcribeStream, TranscriptionUnavailableError, type StreamingTranscriber, type TranscriptSegment } from '../transcription/appleSpeech'

interface Session {
  id: string
  webContentsId: number
  helper: StreamingTranscriber
}

const sessions = new Map<string, Session>()

function emitTo(webContentsId: number, channel: string, payload: unknown) {
  const wc = BrowserWindow.getAllWindows()
    .map(w => w.webContents)
    .find(w => w.id === webContentsId)
  if (wc && !wc.isDestroyed()) wc.send(channel, payload)
}

export function registerDictationHandlers() {
  ipcMain.handle('dictation:start', (event, { sessionId }: { sessionId: string }) => {
    if (sessions.has(sessionId)) {
      return { ok: false, error: 'Session already running' }
    }
    try {
      const helper = transcribeStream()
      const session: Session = { id: sessionId, webContentsId: event.sender.id, helper }

      helper.on('partial', (text: string) => {
        emitTo(session.webContentsId, 'dictation:event', { sessionId, type: 'partial', text })
      })
      helper.on('segment', (seg: TranscriptSegment) => {
        emitTo(session.webContentsId, 'dictation:event', { sessionId, type: 'segment', text: seg.text })
      })
      helper.on('error', (err: Error) => {
        emitTo(session.webContentsId, 'dictation:event', { sessionId, type: 'error', error: err.message })
        sessions.delete(sessionId)
      })

      sessions.set(sessionId, session)
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const unavailable = err instanceof TranscriptionUnavailableError
      return { ok: false, error: message, unavailable }
    }
  })

  ipcMain.handle('dictation:write', (_event, { sessionId, chunk }: { sessionId: string; chunk: ArrayBuffer | Uint8Array }) => {
    const s = sessions.get(sessionId)
    if (!s) return { ok: false, error: 'No such session' }
    try {
      const buf = chunk instanceof Uint8Array
        ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        : Buffer.from(chunk as ArrayBuffer)
      s.helper.write(buf)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('dictation:stop', async (_event, { sessionId }: { sessionId: string }) => {
    const s = sessions.get(sessionId)
    if (!s) return { ok: false, error: 'No such session' }
    sessions.delete(sessionId)
    try {
      const result = await s.helper.end()
      return { ok: true, text: result.text, segments: result.segments }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('dictation:cancel', (_event, { sessionId }: { sessionId: string }) => {
    const s = sessions.get(sessionId)
    if (!s) return { ok: false }
    sessions.delete(sessionId)
    try { s.helper.kill() } catch { /* ignore */ }
    return { ok: true }
  })
}
