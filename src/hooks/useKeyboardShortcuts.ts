import { useEffect } from 'react'

interface KeyboardShortcutHandlers {
  onNewConversation?: () => void
  onSettings?: () => void
  onCommandPalette?: () => void
  onCancel?: () => void
  onBack?: () => void
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey

      if (meta && e.key === 'n') {
        e.preventDefault()
        handlers.onNewConversation?.()
      }
      if (meta && e.key === ',') {
        e.preventDefault()
        handlers.onSettings?.()
      }
      if (meta && e.key === 'k') {
        e.preventDefault()
        handlers.onCommandPalette?.()
      }
      if (meta && e.key === 'w') {
        e.preventDefault()
        handlers.onBack?.()
      }
      if (e.key === 'Escape') {
        handlers.onCancel?.()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handlers])
}
