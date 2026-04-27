import React, { useEffect, useRef } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { toast } from 'sonner'
import { useDictation } from '../../../hooks/useDictation'
import { cn } from '../../../lib/utils'

interface MicButtonProps {
  /** Insert a final transcript chunk at the textarea's caret position. */
  onCommitText: (text: string) => void
  /** Optional partial-update callback. Replaces the previous partial. */
  onPartial?: (text: string) => void
  className?: string
  /** Increase the visual size; default fits in 6×6 composer slot. */
  size?: 'sm' | 'md'
}

const MAC_OS_HINT = 'Apple Speech dictation requires macOS 26 or newer.'

export function MicButton({ onCommitText, onPartial, className, size = 'sm' }: MicButtonProps) {
  const onCommitRef = useRef(onCommitText)
  const onPartialRef = useRef(onPartial)
  onCommitRef.current = onCommitText
  onPartialRef.current = onPartial

  const { state, toggle, cancel } = useDictation({
    onPartial: text => onPartialRef.current?.(text),
    onSegment: text => onCommitRef.current(text),
    onError: (msg, unavailable) => {
      toast.error(unavailable ? MAC_OS_HINT : `Dictation error: ${msg}`)
    },
  })

  // ESC cancels.
  useEffect(() => {
    if (state !== 'listening' && state !== 'starting') return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, cancel])

  const active = state === 'listening' || state === 'starting'
  const finalizing = state === 'finalizing'
  const erred = state === 'error'

  const px = size === 'md' ? 13 : 11
  const dimensions = size === 'md' ? 'w-7 h-7' : 'w-6 h-6'

  return (
    <button
      type="button"
      onClick={() => toggle()}
      title={active ? 'Stop dictation (Esc to cancel)' : finalizing ? 'Finalizing…' : 'Dictate (Apple Speech)'}
      aria-label={active ? 'Stop dictation' : 'Start dictation'}
      aria-pressed={active}
      className={cn(
        dimensions,
        'rounded-full flex items-center justify-center transition-all relative',
        active ? 'wos-mic-active' : 'wos-hover',
        className,
      )}
      style={{
        color: active ? '#fff' : erred ? 'var(--destructive, #ef4444)' : 'var(--muted-foreground)',
        background: active ? '#ef4444' : undefined,
      }}
    >
      {erred ? <MicOff size={px} /> : <Mic size={px} />}
      {active && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ boxShadow: '0 0 0 0 rgba(239,68,68,0.6)', animation: 'wos-mic-pulse 1.4s ease-out infinite' }}
        />
      )}
    </button>
  )
}
