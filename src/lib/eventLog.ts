import type { AgentEvent } from '../types'

const MAX_EVENTS = 2000

interface LoggedEvent {
  ts: number
  event: AgentEvent
}

class EventLog {
  private buffer: LoggedEvent[] = []
  private listeners = new Set<(evts: LoggedEvent[]) => void>()

  push(event: AgentEvent) {
    this.buffer.push({ ts: Date.now(), event })
    if (this.buffer.length > MAX_EVENTS) this.buffer.splice(0, this.buffer.length - MAX_EVENTS)
    for (const l of this.listeners) l(this.buffer)
  }

  clear() {
    this.buffer = []
    for (const l of this.listeners) l(this.buffer)
  }

  getAll(): ReadonlyArray<LoggedEvent> { return this.buffer }

  subscribe(cb: (evts: LoggedEvent[]) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  exportJson(): string {
    return JSON.stringify(this.buffer, null, 2)
  }
}

export const eventLog = new EventLog()
export type { LoggedEvent }
