import React from 'react'

interface Props {
  children: React.ReactNode
  fallback?: (error: Error, reset: () => void) => React.ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[wos:errorBoundary]', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)
    return (
      <div className="p-6 m-4 rounded-lg border border-red-500/40 bg-red-500/5 text-[#ddd] text-sm">
        <div className="font-semibold text-red-400 mb-2">Something broke in the UI</div>
        <pre className="text-xs text-red-300/80 whitespace-pre-wrap break-words mb-3">
          {error.message}
        </pre>
        <button
          onClick={this.reset}
          className="px-3 py-1.5 rounded text-xs bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/40"
        >
          Try again
        </button>
      </div>
    )
  }
}
