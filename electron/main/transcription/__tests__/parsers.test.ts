import { describe, expect, it } from 'vitest'
import { detectFormat, parseSrt, parseVtt } from '../index'

describe('transcription parsers', () => {
  describe('detectFormat', () => {
    it('classifies common audio extensions', () => {
      expect(detectFormat('clip.mp3')).toBe('audio')
      expect(detectFormat('clip.WAV')).toBe('audio')
      expect(detectFormat('clip.m4a')).toBe('audio')
      expect(detectFormat('clip.opus')).toBe('audio')
    })

    it('classifies common video extensions', () => {
      expect(detectFormat('meeting.mp4')).toBe('video')
      expect(detectFormat('meeting.mov')).toBe('video')
      expect(detectFormat('meeting.webm')).toBe('video')
    })

    it('classifies transcripts, documents, and unknown', () => {
      expect(detectFormat('notes.txt')).toBe('transcript')
      expect(detectFormat('notes.md')).toBe('transcript')
      expect(detectFormat('caps.vtt')).toBe('transcript')
      expect(detectFormat('caps.srt')).toBe('transcript')
      expect(detectFormat('paper.pdf')).toBe('document')
      expect(detectFormat('contract.docx')).toBe('document')
      expect(detectFormat('image.heic')).toBe('unknown')
    })

    it('falls back to mime type when extension is missing', () => {
      expect(detectFormat('blob', 'audio/webm')).toBe('audio')
      expect(detectFormat('blob', 'video/mp4')).toBe('video')
      expect(detectFormat('blob', 'text/plain')).toBe('transcript')
      expect(detectFormat('blob', 'application/pdf')).toBe('document')
    })
  })

  describe('parseVtt', () => {
    it('strips headers, indices, timecodes, and inline tags', () => {
      const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.500
Hello <c.speaker1>everyone</c>

2
00:00:04.000 --> 00:00:06.000
Welcome to the call`
      expect(parseVtt(vtt)).toBe('Hello everyone Welcome to the call')
    })
  })

  describe('parseSrt', () => {
    it('strips indices and timecodes', () => {
      const srt = `1
00:00:01,000 --> 00:00:03,500
Hello everyone

2
00:00:04,000 --> 00:00:06,000
Welcome to the call`
      expect(parseSrt(srt)).toBe('Hello everyone Welcome to the call')
    })
  })
})
