/**
 * Automations IPC handlers — thin wrapper around `automations/service`.
 * The same service is used by the automation agent's tools so the
 * UI-driven CRUD and the LLM-driven CRUD stay perfectly aligned.
 */
import { ipcMain } from 'electron'
import * as svc from '../automations/service'
import { authorAutomation } from '../automations/nlAuthor'
import { draftTurn, type DraftKind, type DraftMessage } from '../automations/draftAgent'

export function registerAutomationsHandlers() {
  // ----- Scheduled jobs -----
  ipcMain.handle('automations:scheduled:list', () => svc.listScheduled())
  ipcMain.handle('automations:scheduled:upsert', async (_e, job: svc.ScheduledJobInput) => svc.upsertScheduled(job))
  ipcMain.handle('automations:scheduled:delete', async (_e, { id }: { id: string }) => svc.deleteScheduled(id))
  ipcMain.handle('automations:scheduled:run-now', async (_e, { id }: { id: string }) => svc.runScheduledNow(id))
  ipcMain.handle('automations:scheduled:runs', (_e, { jobId }: { jobId?: string }) => svc.listScheduledRuns(jobId))

  // ----- Hooks -----
  ipcMain.handle('automations:hooks:list', () => svc.listHooks())
  ipcMain.handle('automations:hooks:upsert', async (_e, hook: svc.HookInput) => svc.upsertHook(hook))
  ipcMain.handle('automations:hooks:delete', async (_e, { id }: { id: string }) => svc.deleteHook(id))
  ipcMain.handle('automations:hooks:runs', (_e, { hookId }: { hookId?: string }) => svc.listHookRuns(hookId))

  // ----- Standing Orders -----
  ipcMain.handle('automations:standing:list', () => svc.listStandingOrders())
  ipcMain.handle('automations:standing:upsert', async (_e, order: svc.StandingOrderInput) => svc.upsertStandingOrder(order))
  ipcMain.handle('automations:standing:delete', async (_e, { id }: { id: string }) => svc.deleteStandingOrder(id))

  // ----- Tasks ledger -----
  ipcMain.handle('automations:tasks:list', (_e, filter: { status?: string; type?: string }) => svc.listTasks(filter ?? {}))
  ipcMain.handle('automations:tasks:steps', (_e, { taskId }: { taskId: string }) => svc.getTaskSteps(taskId))

  // ----- Natural-language authoring (heuristic draft for the UI) -----
  ipcMain.handle('automations:author', async (_e, { kind, prompt }: { kind: string; prompt: string }) => {
    try {
      const draft = await authorAutomation(kind, prompt)
      return { ok: true, draft }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ----- LLM-driven conversational drafting (one turn at a time) -----
  ipcMain.handle('automations:draft:turn', async (_e, payload: { kind: DraftKind; messages: DraftMessage[] }) => {
    return draftTurn(payload?.kind, payload?.messages ?? [])
  })
}
