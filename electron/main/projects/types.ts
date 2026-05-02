/**
 * Public types for the Projects feature.
 *
 * Renderer + IPC use these wire-shape types. Backend modules (manager,
 * resources, refresh, etc.) operate on the same shapes.
 */

export type ProjectStatus = 'draft' | 'active' | 'paused' | 'shipped' | 'archived'
export type ProjectRiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type AlertSeverity = 'all' | 'important' | 'off'

export interface ProjectRow {
  id: string
  name: string
  slug: string
  icon: string | null
  color: string | null
  status: ProjectStatus
  ownerEmail: string | null
  description: string | null
  summary: string | null
  healthScore: number | null
  riskLevel: ProjectRiskLevel | null
  modelOverride: string | null
  pinned: boolean
  metadata: Record<string, unknown> | null
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface ProjectResourceRow {
  id: string
  projectId: string
  kind: string
  ref: unknown
  label: string
  description: string | null
  addedAt: number
  lastFetchedAt: number | null
  refreshIntervalSec: number | null
}

export interface ProjectActivityRow {
  id: string
  projectId: string
  sourceApp: string
  sourceKind: string
  ts: number
  actor: string | null
  title: string
  url: string | null
  payload: unknown
  dedupeKey: string
}

export interface ProjectWidgetRow {
  id: string
  projectId: string
  tab: string
  widgetKind: string
  config: Record<string, unknown> | null
  x: number
  y: number
  w: number
  h: number
  hidden: boolean
  sort: number
}

export interface ProjectSummaryRow {
  id: string
  projectId: string
  kind: string
  body: string
  modelUsed: string | null
  generatedAt: number
  sourceFingerprint: string | null
}

export interface ProjectAlertRow {
  id: string
  projectId: string
  ruleKind: string
  config: Record<string, unknown> | null
  enabled: boolean
  severity: AlertSeverity
  lastFiredAt: number | null
}

export interface ProjectRiskRow {
  id: string
  projectId: string
  title: string
  description: string | null
  severity: ProjectRiskLevel
  status: 'open' | 'mitigating' | 'resolved' | 'accepted'
  owner: string | null
  mitigation: string | null
  createdAt: number
  resolvedAt: number | null
}

export interface ProjectDecisionRow {
  id: string
  projectId: string
  title: string
  body: string | null
  decidedAt: number
  decidedBy: string | null
  linkedActivityId: string | null
}

export interface ProjectMetricSample {
  metricKey: string
  ts: number
  value: number
  unit: string | null
}

export interface ProjectInput {
  name: string
  slug?: string
  icon?: string | null
  color?: string | null
  status?: ProjectStatus
  ownerEmail?: string | null
  description?: string | null
  modelOverride?: string | null
  pinned?: boolean
  metadata?: Record<string, unknown> | null
}

export interface ProjectResourceInput {
  kind: string
  ref: unknown
  label: string
  description?: string | null
  refreshIntervalSec?: number | null
}

export type ProjectPersonSource = 'manual' | 'slack' | 'github' | 'jira' | 'google'

export interface ProjectPersonRow {
  id: string
  projectId: string
  name: string
  email: string | null
  role: string | null
  avatarUrl: string | null
  sourceApp: ProjectPersonSource | string | null
  externalId: string | null
  notes: string | null
  createdAt: number
  updatedAt: number
}

export interface ProjectPersonInput {
  name: string
  email?: string | null
  role?: string | null
  avatarUrl?: string | null
  sourceApp?: ProjectPersonSource | string | null
  externalId?: string | null
  notes?: string | null
}
