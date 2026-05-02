/**
 * Public entrypoint for the Projects feature.
 *
 * Re-exports the manager API plus a small bootstrap. IPC handlers and the
 * subagent import from this module so module ordering stays predictable.
 */

export * from './manager'
export * as resources from './resources'
export type { CatalogueEntry } from './resources'
export { listCatalogue, findEntryByKind } from './resources'
export { listPeople, addPerson, updatePerson, removePerson } from './people'
export type {
  ProjectStatus,
  ProjectRiskLevel,
  AlertSeverity,
  ProjectRow,
  ProjectInput,
  ProjectResourceRow,
  ProjectResourceInput,
  ProjectActivityRow,
  ProjectWidgetRow,
  ProjectSummaryRow,
  ProjectAlertRow,
  ProjectRiskRow,
  ProjectDecisionRow,
  ProjectMetricSample,
  ProjectPersonRow,
  ProjectPersonInput,
  ProjectPersonSource,
} from './types'

import { startProjectRefreshLoop } from './refresh'

let started = false
export function initProjects(): void {
  if (started) return
  started = true
  startProjectRefreshLoop()
}
