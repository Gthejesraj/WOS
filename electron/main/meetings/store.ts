import { randomUUID } from 'node:crypto'
import { desc, eq, inArray } from 'drizzle-orm'
import { getDb, notifyWrite, queryRaw, schema } from '../db'

export interface MeetingAnalysis {
  summary?: string
  actionItems?: unknown[]
  decisions?: unknown[]
}

export type MeetingProcessingStatus = 'queued' | 'reading' | 'transcribing' | 'analyzing' | 'done' | 'error' | 'interrupted'

export interface SaveMeetingInput {
  id?: string
  title: string
  source: 'live' | 'upload' | 'calendar' | 'drive'
  startedAt?: Date
  endedAt?: Date | null
  transcript?: string | null
  sourceUri?: string | null
  analysis?: MeetingAnalysis | null
  processingStatus?: MeetingProcessingStatus
  processingMessage?: string | null
  processingProgress?: number | null
  lastError?: string | null
}

export function saveMeeting(input: SaveMeetingInput) {
  const db = getDb()
  const now = new Date()
  const startedAt = input.startedAt ?? now
  const endedAt = input.endedAt ?? null
  const duration = endedAt ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)) : null
  const id = input.id ?? randomUUID()
  const row = {
    id,
    title: input.title || 'Untitled Meeting',
    source: input.source,
    startedAt,
    endedAt,
    duration,
    transcript: input.transcript ?? null,
    summary: input.analysis?.summary ?? null,
    actionItemsJson: input.analysis?.actionItems ?? [],
    decisionsJson: input.analysis?.decisions ?? [],
    sourceUri: input.sourceUri ?? null,
    agentKey: 'meeting',
    processingStatus: input.processingStatus ?? (input.analysis ? 'done' : 'done'),
    processingMessage: input.processingMessage ?? null,
    processingProgress: input.processingProgress ?? (input.analysis ? 100 : 100),
    lastError: input.lastError ?? null,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(schema.meetings)
    .values(row)
    .onConflictDoUpdate({
      target: schema.meetings.id,
      set: {
        title: row.title,
        source: row.source,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        duration: row.duration,
        transcript: row.transcript,
        summary: row.summary,
        actionItemsJson: row.actionItemsJson,
        decisionsJson: row.decisionsJson,
        sourceUri: row.sourceUri,
        agentKey: row.agentKey,
        processingStatus: row.processingStatus,
        processingMessage: row.processingMessage,
        processingProgress: row.processingProgress,
        lastError: row.lastError,
        updatedAt: now,
      },
    })
    .run()
  notifyWrite()
  return id
}

export function listMeetings() {
  const db = getDb()
  return db.select().from(schema.meetings).orderBy(desc(schema.meetings.startedAt)).limit(100).all()
}

export function searchMeetings(query: string) {
  const q = query.trim()
  if (!q) return listMeetings()
  return queryRaw(`
    SELECT m.*
    FROM meetings_fts f
    JOIN meetings m ON m.rowid = f.rowid
    WHERE meetings_fts MATCH ?
    ORDER BY rank
    LIMIT 100
  `, [q])
}

export function deleteMeetings(ids: string[]) {
  if (ids.length === 0) return
  const db = getDb()
  db.delete(schema.meetings).where(inArray(schema.meetings.id, ids)).run()
  notifyWrite()
}

export function getMeeting(id: string) {
  const db = getDb()
  return db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).get()
}

export function updateMeetingStatus(
  id: string,
  status: MeetingProcessingStatus,
  message?: string | null,
  progress?: number | null,
  lastError?: string | null,
) {
  const db = getDb()
  db.update(schema.meetings)
    .set({
      processingStatus: status,
      processingMessage: message ?? null,
      processingProgress: progress ?? null,
      lastError: lastError ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.meetings.id, id))
    .run()
  notifyWrite()
}

export function renameMeeting(id: string, title: string) {
  const db = getDb()
  db.update(schema.meetings)
    .set({ title: title || 'Untitled Meeting', updatedAt: new Date() })
    .where(eq(schema.meetings.id, id))
    .run()
  notifyWrite()
}

export function createPendingMeeting(input: {
  title: string
  source: 'upload' | 'drive'
  sourceUri?: string | null
  status?: MeetingProcessingStatus
  message?: string | null
}) {
  return saveMeeting({
    title: input.title,
    source: input.source,
    sourceUri: input.sourceUri ?? null,
    transcript: null,
    analysis: null,
    processingStatus: input.status ?? 'queued',
    processingMessage: input.message ?? 'Queued',
    processingProgress: 5,
  })
}

export function addMeetingActivity(input: {
  meetingId?: string | null
  type: string
  status: 'success' | 'error' | 'info'
  label: string
  detail?: unknown
}) {
  const db = getDb()
  const row = {
    id: randomUUID(),
    meetingId: input.meetingId ?? null,
    type: input.type,
    status: input.status,
    label: input.label,
    detailJson: input.detail ?? null,
    createdAt: new Date(),
  }
  db.insert(schema.meetingActivity).values(row).run()
  notifyWrite()
  return row.id
}

export function listMeetingActivity(meetingId?: string | null, limit = 20) {
  if (meetingId) {
    return queryRaw(`
      SELECT id, meeting_id as meetingId, type, status, label, detail_json as detailJson, created_at as createdAt
      FROM meeting_activity
      WHERE meeting_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [meetingId, limit])
  }
  return queryRaw(`
    SELECT id, meeting_id as meetingId, type, status, label, detail_json as detailJson, created_at as createdAt
    FROM meeting_activity
    ORDER BY created_at DESC
    LIMIT ?
  `, [limit])
}
