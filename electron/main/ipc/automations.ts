import { ipcMain } from 'electron'
import { registry, type AutomationKind, type ResultDelivery } from '../automations/registry'
import { audit } from '../automations/audit'
import { runAutomation } from '../automations/runner'
import { automationsRuntime } from '../automations'
import { ensureWebhook } from '../automations/webhooks'
import { refreshTrayMenu } from '../tray'

export function registerAutomationsHandlers(): void {
  ipcMain.handle('automations:list', (_evt, args?: { kind?: AutomationKind; enabled?: boolean }) => {
    return registry.list(args)
  })

  ipcMain.handle('automations:get', (_evt, args: { id: string }) => {
    return registry.get(args.id)
  })

  ipcMain.handle(
    'automations:upsert',
    (_evt, input: {
      id?: string
      kind: AutomationKind
      name: string
      description?: string | null
      enabled?: boolean
      prompt?: string
      toolsAllow?: string[]
      config?: Record<string, unknown>
      resultDelivery?: ResultDelivery
      resultTarget?: string | null
    }) => {
      const row = registry.upsert(input)
      automationsRuntime.reload(row.id)
      refreshTrayMenu()
      return row
    },
  )

  ipcMain.handle('automations:toggle', (_evt, args: { id: string; enabled: boolean }) => {
    const row = registry.toggle(args.id, args.enabled)
    if (row) automationsRuntime.reload(args.id)
    refreshTrayMenu()
    return row
  })

  ipcMain.handle('automations:delete', (_evt, args: { id: string }) => {
    registry.delete(args.id)
    automationsRuntime.reload(args.id)
    refreshTrayMenu()
    return { ok: true }
  })

  ipcMain.handle('automations:runNow', async (_evt, args: { id: string; dryRun?: boolean }) => {
    const a = registry.get(args.id)
    if (!a) return { ok: false, error: `Automation ${args.id} not found.` }
    const r = await runAutomation(a, { dryRun: !!args.dryRun, trigger: { kind: 'manual' } })
    return { ok: !r.error, runId: r.runId, output: r.output, error: r.error ?? null }
  })

  ipcMain.handle('automations:runs', (_evt, args?: { id?: string; limit?: number }) => {
    return audit.list(args?.id, args?.limit ?? 100)
  })

  ipcMain.handle('automations:webhookInfo', (_evt, args: { id: string }) => {
    const a = registry.get(args.id)
    if (!a || a.kind !== 'webhook') return null
    return ensureWebhook(a)
  })

  ipcMain.handle('automations:reloadAll', () => {
    automationsRuntime.reloadAll()
    refreshTrayMenu()
    return { ok: true }
  })
}
