import { EventEmitter } from 'node:events'
import { registry, type AutomationRow } from './registry'
import { runAutomation } from './runner'
import { broadcastAutomationError } from './delivery'

/**
 * A simple in-process event bus that automations of kind='hook' subscribe to.
 * Other parts of WOS can call `hooks.emit(eventName, payload)` to fire matching
 * automations.
 *
 * Built-in events emitted elsewhere (Phase 5 wires these):
 *   - app:connected      { app: string }
 *   - app:disconnected   { app: string }
 *   - meeting:ended      { meetingId: string }
 *   - automation:error   { id, error }
 */

interface HookConfig {
  event: string
  /** Optional JS predicate (string) evaluated against payload. */
  match?: string
}

class HookBus extends EventEmitter {
  private subs = new Map<string, (payload: unknown) => void>()

  subscribe(a: AutomationRow): void {
    const cfg = a.config as Partial<HookConfig>
    if (!cfg.event) return
    const handler = (payload: unknown) => {
      const fresh = registry.get(a.id)
      if (!fresh || !fresh.enabled) return
      if (cfg.match) {
        try {
          // eslint-disable-next-line no-new-func
          const fn = new Function('payload', `return (${cfg.match})`)
          if (!fn(payload)) return
        } catch { /* if predicate broken, skip */ return }
      }
      runAutomation(fresh, { trigger: { kind: 'hook', event: cfg.event, payload } })
        .then(r => { if (r.error) broadcastAutomationError(fresh, r.error, r.runId) })
        .catch(err => broadcastAutomationError(fresh, err instanceof Error ? err.message : String(err)))
    }
    this.on(cfg.event, handler)
    this.subs.set(a.id, handler)
  }

  unsubscribe(a: AutomationRow): void {
    const handler = this.subs.get(a.id)
    if (!handler) return
    const cfg = a.config as Partial<HookConfig>
    if (cfg.event) this.off(cfg.event, handler)
    this.subs.delete(a.id)
  }

  unsubscribeId(id: string): void {
    const handler = this.subs.get(id)
    if (!handler) return
    for (const e of this.eventNames()) {
      this.off(e as string, handler)
    }
    this.subs.delete(id)
  }

  subIds(): string[] {
    return Array.from(this.subs.keys())
  }
}

const bus = new HookBus()
bus.setMaxListeners(0)

/** Emit a hook event to all matching automations. Safe to call before service start (no-op). */
export function emitHook(event: string, payload: unknown = {}): void {
  bus.emit(event, payload)
}

export const hooksService = {
  start(): void {
    for (const a of registry.list({ kind: 'hook', enabled: true })) bus.subscribe(a)
  },
  stop(): void {
    for (const id of bus.subIds()) {
      bus.unsubscribeId(id)
    }
  },
  reload(id: string): void {
    bus.unsubscribeId(id)
    const a = registry.get(id)
    if (a && a.kind === 'hook' && a.enabled) bus.subscribe(a)
  },
  reloadAll(): void {
    this.stop()
    this.start()
  },
  emit: emitHook,
}
