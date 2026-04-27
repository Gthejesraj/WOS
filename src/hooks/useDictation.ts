import { useCallback, useEffect, useRef, useState } from 'react'

const WORKLET_SOURCE = `
class PCM16Processor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._inRate = sampleRate
    this._outRate = 16000
    this._ratio = this._inRate / this._outRate
    this._frame = 0
  }
  process(inputs) {
    const input = inputs[0]
    if (!input || !input[0]) return true
    const channel = input[0]
    const out = []
    for (let i = 0; i < channel.length; i++) {
      this._frame += 1
      if (this._frame >= this._ratio) {
        this._frame -= this._ratio
        let s = channel[i]
        if (s > 1) s = 1
        if (s < -1) s = -1
        out.push(s < 0 ? s * 0x8000 : s * 0x7fff)
      }
    }
    if (out.length > 0) {
      const buf = new ArrayBuffer(out.length * 2)
      const view = new DataView(buf)
      for (let i = 0; i < out.length; i++) view.setInt16(i * 2, out[i] | 0, true)
      this.port.postMessage(buf, [buf])
    }
    return true
  }
}
registerProcessor('pcm16-processor', PCM16Processor)
`

export type DictationState = 'idle' | 'starting' | 'listening' | 'finalizing' | 'error'

interface UseDictationOptions {
  onPartial?: (text: string) => void
  /** Final transcript chunk; should be inserted at the cursor. */
  onSegment?: (text: string) => void
  onError?: (message: string, unavailable: boolean) => void
}

interface AudioRefs {
  stream: MediaStream | null
  context: AudioContext | null
  source: MediaStreamAudioSourceNode | null
  worklet: AudioWorkletNode | null
  workletUrl: string | null
}

export function useDictation(opts: UseDictationOptions = {}) {
  const [state, setState] = useState<DictationState>('idle')
  const sessionIdRef = useRef<string | null>(null)
  const audioRef = useRef<AudioRefs>({ stream: null, context: null, source: null, worklet: null, workletUrl: null })
  const optsRef = useRef(opts)
  optsRef.current = opts

  const teardownAudio = useCallback(async () => {
    const a = audioRef.current
    try { a.worklet?.disconnect() } catch { /* ignore */ }
    try { a.source?.disconnect() } catch { /* ignore */ }
    if (a.stream) {
      for (const track of a.stream.getTracks()) {
        try { track.stop() } catch { /* ignore */ }
      }
    }
    if (a.context) {
      try { await a.context.close() } catch { /* ignore */ }
    }
    if (a.workletUrl) {
      try { URL.revokeObjectURL(a.workletUrl) } catch { /* ignore */ }
    }
    audioRef.current = { stream: null, context: null, source: null, worklet: null, workletUrl: null }
  }, [])

  // Subscribe to dictation events once.
  useEffect(() => {
    const off = window.wos?.dictation?.onEvent?.((evt) => {
      if (evt.sessionId !== sessionIdRef.current) return
      if (evt.type === 'partial') {
        optsRef.current.onPartial?.(evt.text ?? '')
      } else if (evt.type === 'segment') {
        optsRef.current.onSegment?.(evt.text ?? '')
      } else if (evt.type === 'error') {
        optsRef.current.onError?.(evt.error ?? 'Dictation failed', false)
        setState('error')
      }
    })
    return () => { off?.() }
  }, [])

  const start = useCallback(async () => {
    if (state === 'listening' || state === 'starting') return
    setState('starting')

    const sessionId = `dict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    sessionIdRef.current = sessionId

    const startResult = await window.wos.dictation.start(sessionId)
    if (!startResult.ok) {
      sessionIdRef.current = null
      setState('error')
      optsRef.current.onError?.(startResult.error ?? 'Dictation unavailable', startResult.unavailable === true)
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
    } catch (err) {
      await window.wos.dictation.cancel(sessionId).catch(() => {})
      sessionIdRef.current = null
      setState('error')
      optsRef.current.onError?.(err instanceof Error ? err.message : 'Microphone permission denied', false)
      return
    }

    const ctx: AudioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    try {
      await ctx.audioWorklet.addModule(url)
    } catch (err) {
      URL.revokeObjectURL(url)
      try { ctx.close() } catch { /* ignore */ }
      stream.getTracks().forEach(t => t.stop())
      await window.wos.dictation.cancel(sessionId).catch(() => {})
      sessionIdRef.current = null
      setState('error')
      optsRef.current.onError?.(err instanceof Error ? err.message : 'Failed to load audio worklet', false)
      return
    }

    const source = ctx.createMediaStreamSource(stream)
    const worklet = new AudioWorkletNode(ctx, 'pcm16-processor')
    worklet.port.onmessage = (evt: MessageEvent<ArrayBuffer>) => {
      const sid = sessionIdRef.current
      if (!sid) return
      window.wos.dictation.write(sid, new Uint8Array(evt.data)).catch(() => { /* ignore */ })
    }
    source.connect(worklet)
    // Don't connect to ctx.destination → no audio playback.

    audioRef.current = { stream, context: ctx, source, worklet, workletUrl: url }
    setState('listening')
  }, [state])

  const stop = useCallback(async () => {
    const sid = sessionIdRef.current
    if (!sid) {
      setState('idle')
      return
    }
    setState('finalizing')
    await teardownAudio()
    await window.wos.dictation.stop(sid).catch(() => {})
    sessionIdRef.current = null
    setState('idle')
  }, [teardownAudio])

  const cancel = useCallback(async () => {
    const sid = sessionIdRef.current
    await teardownAudio()
    if (sid) {
      await window.wos.dictation.cancel(sid).catch(() => {})
    }
    sessionIdRef.current = null
    setState('idle')
  }, [teardownAudio])

  const toggle = useCallback(async () => {
    if (state === 'listening' || state === 'starting') await stop()
    else await start()
  }, [state, start, stop])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      const sid = sessionIdRef.current
      if (sid) {
        window.wos?.dictation?.cancel?.(sid).catch(() => {})
      }
      teardownAudio().catch(() => {})
    }
  }, [teardownAudio])

  return { state, start, stop, cancel, toggle }
}
