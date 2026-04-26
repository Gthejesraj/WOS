import { app } from 'electron'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface TranscriptSegment {
  speaker?: string | null
  start?: number | null
  end?: number | null
  text: string
}

export interface TranscriptionResult {
  segments: TranscriptSegment[]
  text: string
}

export class TranscriptionUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranscriptionUnavailableError'
  }
}

function macOsMajorVersion(): number | null {
  if (process.platform !== 'darwin') return null
  // os.release() on darwin returns the Darwin kernel version, not the marketing
  // macOS number. macOS 26 (Tahoe) ships Darwin 25.x; macOS 14 = Darwin 23 etc.
  const darwin = parseInt(os.release().split('.')[0] ?? '0', 10)
  if (!Number.isFinite(darwin) || darwin === 0) return null
  return darwin + 1
}

function ensurePlatformSupported(): void {
  if (process.platform !== 'darwin') {
    throw new TranscriptionUnavailableError(
      'Local Apple Speech transcription requires macOS. Upload a transcript file (.txt/.vtt/.srt/.docx/.pdf) instead.'
    )
  }
  const major = macOsMajorVersion()
  if (major !== null && major < 26) {
    throw new TranscriptionUnavailableError(
      `Apple Speech on-device transcription requires macOS 26 or newer (this machine is running macOS ${major}). Upload a transcript file (.txt/.vtt/.srt/.docx/.pdf) instead.`
    )
  }
}

function getHelperPath(): string {
  const candidates: Array<string | undefined> = [
    process.env.WOS_TRANSCRIBE_HELPER,
    app.isPackaged
      ? path.join(process.resourcesPath, 'wos-transcribe')
      : undefined,
    // Dev: relative to the project root via cwd.
    !app.isPackaged ? path.join(process.cwd(), 'resources', 'wos-transcribe') : undefined,
    // Dev/test fallback: relative to this module's location, walks out of
    // .vite/build/ to find the repo's resources/ folder regardless of cwd.
    path.join(__dirname, '..', '..', 'resources', 'wos-transcribe'),
    path.join(__dirname, '..', '..', '..', 'resources', 'wos-transcribe'),
    path.join(process.cwd(), 'electron', 'main', 'transcription', 'swift-helper', '.build', 'release', 'wos-transcribe'),
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {
      /* ignore */
    }
  }

  throw new TranscriptionUnavailableError(
    'Local Apple Speech helper is not installed. Build electron/main/transcription/swift-helper/wos-transcribe.swift on macOS 26+ and place the signed binary at resources/wos-transcribe.'
  )
}

export function transcribeFile(filePath: string): Promise<TranscriptionResult> {
  return new Promise((resolve, reject) => {
    let helper: string
    try {
      ensurePlatformSupported()
      helper = getHelperPath()
    } catch (err) {
      reject(err)
      return
    }

    const child = spawn(helper, ['file', filePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Apple Speech helper exited with code ${code}`))
        return
      }
      try {
        const parsed = JSON.parse(stdout) as { segments?: TranscriptSegment[] }
        const segments = Array.isArray(parsed.segments) ? parsed.segments : []
        const text = segments.map(s => s.text).filter(Boolean).join('\n')
        resolve({ segments, text })
      } catch (err) {
        reject(new Error(`Apple Speech helper returned invalid JSON: ${(err as Error).message}`))
      }
    })
  })
}

export interface StreamingTranscriber extends EventEmitter {
  write(chunk: Buffer): void
  end(): Promise<TranscriptionResult>
  kill(): void
}

/**
 * Spawn `wos-transcribe stream` and pipe raw audio bytes into stdin.
 * The helper emits NDJSON: `{"partial":true,"text":"..."}` and a final
 * `{"final":true,"segments":[...]}`. The returned EventEmitter fires:
 *   - 'partial' (text: string)
 *   - 'segment' (segment: TranscriptSegment)
 *   - 'error'   (err: Error)
 */
export function transcribeStream(): StreamingTranscriber {
  const emitter = new EventEmitter() as StreamingTranscriber
  let helper: string
  try {
    ensurePlatformSupported()
    helper = getHelperPath()
  } catch (err) {
    // Defer: the consumer has already attached listeners synchronously.
    queueMicrotask(() => emitter.emit('error', err as Error))
    emitter.write = () => { /* noop */ }
    emitter.end = () => Promise.reject(err)
    emitter.kill = () => { /* noop */ }
    return emitter
  }

  const child = spawn(helper, ['stream'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const segments: TranscriptSegment[] = []
  let stderr = ''
  let buffer = ''

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { stderr += chunk })
  child.stdout.on('data', chunk => {
    buffer += chunk
    let nl = buffer.indexOf('\n')
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      nl = buffer.indexOf('\n')
      if (!line) continue
      try {
        const evt = JSON.parse(line) as
          | { partial: true; text: string }
          | { final: true; segments?: TranscriptSegment[] }
          | { segment: TranscriptSegment }
        if ('partial' in evt && evt.partial) {
          emitter.emit('partial', evt.text)
        } else if ('segment' in evt) {
          segments.push(evt.segment)
          emitter.emit('segment', evt.segment)
        } else if ('final' in evt && evt.final && Array.isArray(evt.segments)) {
          for (const s of evt.segments) {
            segments.push(s)
            emitter.emit('segment', s)
          }
        }
      } catch {
        /* ignore malformed lines */
      }
    }
  })
  child.on('error', err => emitter.emit('error', err))

  emitter.write = (chunk: Buffer) => {
    if (!child.stdin.destroyed) child.stdin.write(chunk)
  }
  emitter.kill = () => {
    try { child.kill('SIGTERM') } catch { /* ignore */ }
  }
  emitter.end = () => new Promise((resolve, reject) => {
    child.once('close', code => {
      if (code !== 0 && segments.length === 0) {
        reject(new Error(stderr.trim() || `Apple Speech stream exited with code ${code}`))
        return
      }
      const text = segments.map(s => s.text).filter(Boolean).join('\n')
      resolve({ segments, text })
    })
    try { child.stdin.end() } catch { /* ignore */ }
  })

  return emitter
}
