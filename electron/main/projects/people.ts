/**
 * Project people CRUD.
 *
 * People are first-class citizens of a project: name, email, role, optional
 * link to an external app identity (Slack user id, GitHub login, etc.). Stored
 * in the dedicated `project_people` table — the legacy `metadata.people` blob
 * on the project row is no longer the primary surface but is preserved for
 * backwards compatibility (we mirror current people there on writes for any
 * older code paths or HTML export).
 */

import { randomUUID } from 'node:crypto'
import { runRaw, queryRaw, notifyWrite } from '../db'
import type { ProjectPersonRow, ProjectPersonInput } from './types'

type RawPerson = {
  id: string
  project_id: string
  name: string
  email: string | null
  role: string | null
  avatar_url: string | null
  source_app: string | null
  external_id: string | null
  notes: string | null
  created_at: number
  updated_at: number
}

function fromRow(r: RawPerson): ProjectPersonRow {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    email: r.email,
    role: r.role,
    avatarUrl: r.avatar_url,
    sourceApp: r.source_app,
    externalId: r.external_id,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function listPeople(projectId: string): ProjectPersonRow[] {
  const rows = queryRaw<RawPerson>(
    'SELECT * FROM project_people WHERE project_id = ? ORDER BY created_at ASC',
    [projectId]
  )
  return rows.map(fromRow)
}

export function addPerson(projectId: string, input: ProjectPersonInput): ProjectPersonRow {
  const id = randomUUID()
  const now = Date.now()
  runRaw(
    `INSERT INTO project_people (id, project_id, name, email, role, avatar_url, source_app, external_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      projectId,
      input.name.trim(),
      input.email?.trim() || null,
      input.role?.trim() || null,
      input.avatarUrl ?? null,
      input.sourceApp ?? 'manual',
      input.externalId ?? null,
      input.notes ?? null,
      now,
      now,
    ]
  )
  notifyWrite()
  const rows = queryRaw<RawPerson>('SELECT * FROM project_people WHERE id = ?', [id])
  return fromRow(rows[0]!)
}

export function updatePerson(personId: string, patch: Partial<ProjectPersonInput>): ProjectPersonRow | null {
  const existing = queryRaw<RawPerson>('SELECT * FROM project_people WHERE id = ?', [personId])
  if (existing.length === 0) return null
  const cur = existing[0]
  const next = {
    name: patch.name?.trim() ?? cur.name,
    email: patch.email !== undefined ? (patch.email?.trim() || null) : cur.email,
    role: patch.role !== undefined ? (patch.role?.trim() || null) : cur.role,
    avatar_url: patch.avatarUrl !== undefined ? patch.avatarUrl : cur.avatar_url,
    source_app: patch.sourceApp !== undefined ? patch.sourceApp : cur.source_app,
    external_id: patch.externalId !== undefined ? patch.externalId : cur.external_id,
    notes: patch.notes !== undefined ? patch.notes : cur.notes,
    updated_at: Date.now(),
  }
  runRaw(
    `UPDATE project_people
       SET name = ?, email = ?, role = ?, avatar_url = ?, source_app = ?, external_id = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [next.name, next.email, next.role, next.avatar_url, next.source_app, next.external_id, next.notes, next.updated_at, personId]
  )
  notifyWrite()
  const rows = queryRaw<RawPerson>('SELECT * FROM project_people WHERE id = ?', [personId])
  return fromRow(rows[0]!)
}

export function removePerson(personId: string): void {
  runRaw('DELETE FROM project_people WHERE id = ?', [personId])
  notifyWrite()
}
