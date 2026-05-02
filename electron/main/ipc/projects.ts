import { ipcMain, shell } from 'electron'
import {
  listProjects,
  getProject,
  getProjectBySlug,
  findProjectsByName,
  createProject,
  updateProject,
  deleteProject,
  setProjectStatus,
  setProjectPinned,
  listResources,
  addResource,
  removeResource,
  listActivity,
  recordActivity,
  listWidgets,
  addWidget,
  updateWidget,
  removeWidget,
  getLatestSummary,
  recordSummary,
  listAlerts,
  addAlert,
  removeAlert,
  setAlertEnabled,
  listRisks,
  addRisk,
  removeRisk,
  updateRisk,
  listDecisions,
  addDecision,
  removeDecision,
  updateDecision,
  listMetric,
  recordMetric,
  listPeople,
  addPerson,
  updatePerson,
  removePerson,
} from '../projects'
import { listCatalogue } from '../projects/resources'
import { refreshResource } from '../projects/refresh'
import { getOpenLinks } from '../projects/links'
import { getNativeSnapshot } from '../projects/nativeSnapshots'
import { getSnapshot, refreshSnapshot } from '../context/snapshotManager'
import { findResourceById } from '../projects/manager'
import {
  generateSummary,
  computeHealthAndRisk,
  evaluateAlerts,
  type SummaryKind,
} from '../projects/intelligence'
import { exportJson, exportMarkdown, exportHtml } from '../projects/exporter'

export function registerProjectsHandlers(): void {
  // ── shell.openExternal bridge ─────────────────────────────────────────
  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (typeof url !== 'string' || !/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      throw new Error('Invalid URL')
    }
    await shell.openExternal(url)
    return { ok: true }
  })

  // ── catalogue ─────────────────────────────────────────────────────────
  ipcMain.handle('projects:catalogue', (_e, args?: { onlyConnected?: boolean }) => {
    return listCatalogue({ onlyConnected: args?.onlyConnected ?? false })
  })

  // ── snapshots & quick-links ───────────────────────────────────────────
  ipcMain.handle('projects:appSnapshot', (_e, args: { appId: string; scope: string }) => {
    const snap = getSnapshot(args.appId, args.scope)
    if (!snap) return null
    const STALE_MS = 30 * 60 * 1000
    return {
      appId: snap.appId,
      scope: snap.scope,
      data: snap.data,
      fetchedAt: snap.fetchedAt,
      stale: Date.now() - snap.fetchedAt > STALE_MS,
    }
  })

  ipcMain.handle('projects:appSnapshotRefresh', async (_e, args: { appId: string; scope?: string }) => {
    await refreshSnapshot(args.appId, args.scope)
    if (args.scope) {
      const snap = getSnapshot(args.appId, args.scope)
      return snap ? {
        appId: snap.appId,
        scope: snap.scope,
        data: snap.data,
        fetchedAt: snap.fetchedAt,
        stale: false,
      } : null
    }
    return { ok: true }
  })

  ipcMain.handle('projects:nativeSnapshot', (_e, args: { scope: string }) => {
    return getNativeSnapshot(args.scope)
  })

  ipcMain.handle('projects:searchGmailContacts', async (_e, args: { query: string }) => {
    const { getConnection } = await import('../apps/manager')
    const conn = getConnection('google')
    if (!conn?.enabled) return []
    const { searchGmailContacts } = await import('../apps/google/api')
    return searchGmailContacts(conn.creds as unknown as Parameters<typeof searchGmailContacts>[0], args.query)
  })

  ipcMain.handle('projects:openLinks', (_e, args: { resourceId: string }) => {
    const r = findResourceById(args.resourceId)
    if (!r) return []
    return getOpenLinks(r)
  })

  // ── projects CRUD ─────────────────────────────────────────────────────
  ipcMain.handle('projects:list', (_e, args?: { includeArchived?: boolean }) => {
    return listProjects(args ?? {})
  })

  ipcMain.handle('projects:get', (_e, args: { id: string }) => getProject(args.id))
  ipcMain.handle('projects:getBySlug', (_e, args: { slug: string }) => getProjectBySlug(args.slug))
  ipcMain.handle('projects:find', (_e, args: { q: string }) => findProjectsByName(args.q))

  ipcMain.handle('projects:create', (_e, input: Parameters<typeof createProject>[0]) =>
    createProject(input))

  ipcMain.handle(
    'projects:update',
    (_e, args: { id: string; patch: Parameters<typeof updateProject>[1] }) =>
      updateProject(args.id, args.patch),
  )

  ipcMain.handle('projects:delete', (_e, args: { id: string }) => {
    deleteProject(args.id)
    return { ok: true }
  })

  ipcMain.handle('projects:setStatus', (_e, args: { id: string; status: 'draft' | 'active' | 'paused' | 'shipped' | 'archived' }) =>
    setProjectStatus(args.id, args.status))

  ipcMain.handle('projects:setPinned', (_e, args: { id: string; pinned: boolean }) =>
    setProjectPinned(args.id, args.pinned))

  // ── resources ─────────────────────────────────────────────────────────
  ipcMain.handle('projects:listResources', (_e, args: { projectId: string }) =>
    listResources(args.projectId))

  ipcMain.handle('projects:addResource', (_e, args: { projectId: string; input: Parameters<typeof addResource>[1] }) =>
    addResource(args.projectId, args.input))

  ipcMain.handle('projects:removeResource', (_e, args: { resourceId: string }) => {
    removeResource(args.resourceId)
    return { ok: true }
  })

  ipcMain.handle('projects:refreshResource', async (_e, args: { resourceId: string }) => {
    await refreshResource(args.resourceId)
    return { ok: true }
  })

  // ── activity ──────────────────────────────────────────────────────────
  ipcMain.handle('projects:activity', (_e, args: { projectId: string; since?: number; limit?: number }) =>
    listActivity(args.projectId, { since: args.since, limit: args.limit }))

  ipcMain.handle('projects:recordActivity', (_e, args: Parameters<typeof recordActivity>[0]) =>
    recordActivity(args))

  // ── widgets ───────────────────────────────────────────────────────────
  ipcMain.handle('projects:listWidgets', (_e, args: { projectId: string }) =>
    listWidgets(args.projectId))

  ipcMain.handle('projects:addWidget', (_e, args: { projectId: string; input: Parameters<typeof addWidget>[1] }) =>
    addWidget(args.projectId, args.input))

  ipcMain.handle('projects:updateWidget', (_e, args: { widgetId: string; patch: Parameters<typeof updateWidget>[1] }) => {
    updateWidget(args.widgetId, args.patch)
    return { ok: true }
  })

  ipcMain.handle('projects:removeWidget', (_e, args: { widgetId: string }) => {
    removeWidget(args.widgetId)
    return { ok: true }
  })

  // ── summaries ─────────────────────────────────────────────────────────
  ipcMain.handle('projects:getSummary', (_e, args: { projectId: string; kind: string }) =>
    getLatestSummary(args.projectId, args.kind))

  ipcMain.handle('projects:recordSummary', (_e, args: Parameters<typeof recordSummary>[0]) =>
    recordSummary(args))

  ipcMain.handle('projects:generateSummary', async (_e, args: { projectId: string; kind: SummaryKind }) =>
    generateSummary(args.projectId, args.kind))

  // ── alerts ────────────────────────────────────────────────────────────
  ipcMain.handle('projects:listAlerts', (_e, args: { projectId: string }) =>
    listAlerts(args.projectId))

  ipcMain.handle('projects:addAlert', (_e, args: { projectId: string; input: Parameters<typeof addAlert>[1] }) =>
    addAlert(args.projectId, args.input))

  ipcMain.handle('projects:removeAlert', (_e, args: { alertId: string }) => {
    removeAlert(args.alertId)
    return { ok: true }
  })

  ipcMain.handle('projects:setAlertEnabled', (_e, args: { alertId: string; enabled: boolean }) => {
    setAlertEnabled(args.alertId, args.enabled)
    return { ok: true }
  })

  ipcMain.handle('projects:evaluateAlerts', async (_e, args: { projectId: string }) =>
    evaluateAlerts(args.projectId))

  // ── risks / decisions ────────────────────────────────────────────────
  ipcMain.handle('projects:listRisks', (_e, args: { projectId: string }) =>
    listRisks(args.projectId))

  ipcMain.handle('projects:addRisk', (_e, args: { projectId: string; input: Parameters<typeof addRisk>[1] }) =>
    addRisk(args.projectId, args.input))

  ipcMain.handle('projects:removeRisk', (_e, args: { riskId: string }) => {
    removeRisk(args.riskId)
    return { ok: true }
  })

  ipcMain.handle('projects:listDecisions', (_e, args: { projectId: string }) =>
    listDecisions(args.projectId))

  ipcMain.handle('projects:addDecision', (_e, args: { projectId: string; input: Parameters<typeof addDecision>[1] }) =>
    addDecision(args.projectId, args.input))

  ipcMain.handle('projects:removeDecision', (_e, args: { decisionId: string }) => {
    removeDecision(args.decisionId)
    return { ok: true }
  })

  ipcMain.handle('projects:updateRisk', (_e, args: { riskId: string; patch: Parameters<typeof updateRisk>[1] }) =>
    updateRisk(args.riskId, args.patch))

  ipcMain.handle('projects:updateDecision', (_e, args: { decisionId: string; patch: Parameters<typeof updateDecision>[1] }) =>
    updateDecision(args.decisionId, args.patch))

  // ── metrics + health ─────────────────────────────────────────────────
  ipcMain.handle('projects:listMetric', (_e, args: { projectId: string; metricKey: string; since?: number; limit?: number }) =>
    listMetric(args.projectId, args.metricKey, { since: args.since, limit: args.limit }))

  ipcMain.handle('projects:recordMetric', (_e, args: { projectId: string; sample: Parameters<typeof recordMetric>[1] }) => {
    recordMetric(args.projectId, args.sample)
    return { ok: true }
  })

  ipcMain.handle('projects:computeHealth', (_e, args: { projectId: string }) =>
    computeHealthAndRisk(args.projectId))

  // ── export ────────────────────────────────────────────────────────────
  ipcMain.handle('projects:exportJson', (_e, args: { projectId: string }) =>
    exportJson(args.projectId))
  ipcMain.handle('projects:exportMarkdown', (_e, args: { projectId: string }) =>
    exportMarkdown(args.projectId))
  ipcMain.handle('projects:exportHtml', (_e, args: { projectId: string }) =>
    exportHtml(args.projectId))

  // ── people ────────────────────────────────────────────────────────────
  ipcMain.handle('projects:listPeople', (_e, args: { projectId: string }) =>
    listPeople(args.projectId))

  ipcMain.handle('projects:addPerson', (_e, args: { projectId: string; input: Parameters<typeof addPerson>[1] }) =>
    addPerson(args.projectId, args.input))

  ipcMain.handle('projects:updatePerson', (_e, args: { personId: string; patch: Parameters<typeof updatePerson>[1] }) =>
    updatePerson(args.personId, args.patch))

  ipcMain.handle('projects:removePerson', (_e, args: { personId: string }) => {
    removePerson(args.personId)
    return { ok: true }
  })
}
