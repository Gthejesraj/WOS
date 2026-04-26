import fs from 'node:fs'
import path from 'node:path'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { transcribeFile } from './appleSpeech'

export type InputFormat = 'transcript' | 'audio' | 'video' | 'document' | 'unknown'

export function detectFormat(filePath: string, mimeType?: string): InputFormat {
  const ext = path.extname(filePath).toLowerCase()
  if (['.vtt', '.srt', '.txt', '.md'].includes(ext)) return 'transcript'
  if (['.docx', '.pdf'].includes(ext)) return 'document'
  if (['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac', '.opus', '.aiff', '.aif'].includes(ext)) return 'audio'
  if (['.mp4', '.mov', '.mkv', '.avi', '.webm'].includes(ext)) return 'video'
  if (mimeType?.startsWith('audio/')) return 'audio'
  if (mimeType?.startsWith('video/')) return 'video'
  if (mimeType?.startsWith('text/')) return 'transcript'
  if (mimeType === 'application/pdf') return 'document'
  return 'unknown'
}

export function parseVtt(vttText: string): string {
  return vttText
    .split('\n')
    .filter(line => line && !line.startsWith('WEBVTT') && !line.match(/^\d+$/) && !line.match(/^\d{2}:\d{2}/))
    .map(line => line.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean)
    .join(' ')
}

export function parseSrt(srtText: string): string {
  return srtText
    .split('\n')
    .filter(line => line && !line.match(/^\d+$/) && !line.match(/^\d{2}:\d{2}/))
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ')
}

export async function extractTranscript(filePath: string, mimeType?: string): Promise<{ text: string; format: InputFormat }> {
  const format = detectFormat(filePath, mimeType)
  const ext = path.extname(filePath).toLowerCase()

  if (format === 'unknown') {
    throw new Error('Unsupported file format. Supported: mp3, m4a, wav, aiff, mp4, mov, webm, txt, vtt, srt, docx, pdf.')
  }

  if (format === 'transcript') {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const text = ext === '.vtt' ? parseVtt(raw) : ext === '.srt' ? parseSrt(raw) : raw
    return { text, format }
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath })
    return { text: result.value, format }
  }

  if (ext === '.pdf') {
    const buffer = fs.readFileSync(filePath)
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    try {
      const result = await parser.getText()
      return { text: result.text, format }
    } finally {
      await parser.destroy()
    }
  }

  const result = await transcribeFile(filePath)
  return { text: result.text, format }
}
