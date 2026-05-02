import { scheduleService } from './schedule'
import { hooksService, emitHook } from './hooks'
import { webhookService } from './webhooks'
import { registry } from './registry'
import { abortAllRuns, abortRunsForAutomation } from './runner'

/**
 * Single entry point used by the main process. Boots the three automation
 * primitives — schedule (at|every|cron), hook, webhook — and exposes a
 * `reload(id)` helper used after CRUD operations.
 */
let started = false

export const automationsRuntime = {
  start(): void {
    if (started) return
    scheduleService.start()
    hooksService.start()
    webhookService.start()
    started = true
    emitHook('automations:started', {})
  },
  stop(): void {
    if (!started) return
    scheduleService.stop()
    hooksService.stop()
    webhookService.stop()
    abortAllRuns()
    started = false
  },
  reload(id: string): void {
    abortRunsForAutomation(id)
    const a = registry.get(id)
    if (!a) {
      scheduleService.reload(id)
      hooksService.reload(id)
      webhookService.reload(id)
      return
    }
    switch (a.kind) {
      case 'schedule': scheduleService.reload(id); break
      case 'hook': hooksService.reload(id); break
      case 'webhook': webhookService.reload(id); break
    }
  },
  reloadAll(): void {
    scheduleService.reloadAll()
    hooksService.reloadAll()
    webhookService.reloadAll()
  },
  configure(opts: { webhookPort?: number; tunnelProvider?: 'cloudflared' | 'none' }): void {
    if (opts.webhookPort || opts.tunnelProvider) {
      webhookService.configure({
        port: opts.webhookPort ?? 47817,
        tunnelProvider: opts.tunnelProvider ?? 'none',
      })
    }
  },
}

export { emitHook }
