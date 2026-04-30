import { cronService } from './cron'
import { heartbeatService } from './heartbeat'
import { hooksService, emitHook } from './hooks'
import { taskFlowService } from './taskFlow'
import { webhookService } from './webhooks'
import { registry } from './registry'
import { abortAllRuns, abortRunsForAutomation } from './runner'

/**
 * Single entry point used by the main process. Boots all primitive services
 * and exposes a `reload(id)` helper used after CRUD operations.
 */
let started = false

export const automationsRuntime = {
  start(): void {
    if (started) return
    cronService.start()
    heartbeatService.start()
    hooksService.start()
    taskFlowService.start()
    webhookService.start()
    started = true
    emitHook('automations:started', {})
  },
  stop(): void {
    if (!started) return
    cronService.stop()
    heartbeatService.stop()
    hooksService.stop()
    taskFlowService.stop()
    webhookService.stop()
    abortAllRuns()
    started = false
  },
  reload(id: string): void {
    // Cancel any in-flight run for this automation before re-scheduling so
    // an edit or disable-then-enable doesn't leave a zombie HTTP stream.
    abortRunsForAutomation(id)
    const a = registry.get(id)
    if (!a) {
      // Deletion path — ask each service to drop it.
      cronService.reload(id)
      heartbeatService.reload(id)
      hooksService.reload(id)
      taskFlowService.reload(id)
      webhookService.reload(id)
      return
    }
    switch (a.kind) {
      case 'cron': cronService.reload(id); break
      case 'heartbeat': heartbeatService.reload(id); break
      case 'hook': hooksService.reload(id); break
      case 'task_flow': taskFlowService.reload(id); break
      case 'webhook': webhookService.reload(id); break
      case 'standing_order': /* no scheduling */ break
    }
  },
  reloadAll(): void {
    cronService.reloadAll()
    heartbeatService.reloadAll()
    hooksService.reloadAll()
    taskFlowService.reloadAll()
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
