import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initDatabase } from '../../db'
import { app } from 'electron'
import {
  addMeetingActivity,
  createPendingMeeting,
  deleteMeetings,
  getMeeting,
  listMeetingActivity,
  listMeetings,
  saveMeeting,
  searchMeetings,
  updateMeetingStatus,
} from '../store'

const userData = (app as unknown as { getPath: (name: string) => string }).getPath('userData')

beforeAll(async () => {
  fs.mkdirSync(userData, { recursive: true })
  // Ensure a clean slate per test run
  const dbPath = path.join(userData, 'wos.db')
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath)
  await initDatabase()
})

afterAll(() => {
  const dbPath = path.join(userData, 'wos.db')
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath)
})

beforeEach(() => {
  // Wipe meetings between tests for determinism
  const ids = listMeetings().map((m: { id: string }) => m.id)
  if (ids.length) deleteMeetings(ids)
})

describe('meetings store', () => {
  it('round-trips a saved meeting', () => {
    const id = saveMeeting({
      title: 'Sprint planning',
      source: 'live',
      startedAt: new Date('2026-04-24T10:00:00Z'),
      endedAt: new Date('2026-04-24T10:45:00Z'),
      transcript: 'Discussed Q3 roadmap and shipping the Meetings tab.',
      analysis: { summary: 'Plan finalized', actionItems: [], decisions: [] },
    })
    expect(id).toBeTypeOf('string')
    const fetched = getMeeting(id)
    expect(fetched).toBeTruthy()
    expect((fetched as { title: string }).title).toBe('Sprint planning')
  })

  it('list returns most recent first', () => {
    saveMeeting({ title: 'Older', source: 'upload', startedAt: new Date('2026-04-20T00:00:00Z') })
    saveMeeting({ title: 'Newer', source: 'upload', startedAt: new Date('2026-04-23T00:00:00Z') })
    const rows = listMeetings() as Array<{ title: string }>
    expect(rows[0].title).toBe('Newer')
    expect(rows[1].title).toBe('Older')
  })

  it('search finds a transcript term (LIKE-fallback or FTS)', () => {
    saveMeeting({ title: 'Engineering sync', source: 'live', transcript: 'We agreed to ship the captioning refactor by Friday.' })
    saveMeeting({ title: 'Marketing brief', source: 'upload', transcript: 'Launch copy review.' })
    const hits = searchMeetings('captioning') as Array<{ title: string }>
    expect(hits.length).toBe(1)
    expect(hits[0].title).toBe('Engineering sync')
  })

  it('delete removes rows', () => {
    const id = saveMeeting({ title: 'Throwaway', source: 'upload' })
    expect(getMeeting(id)).toBeTruthy()
    deleteMeetings([id])
    expect(getMeeting(id)).toBeUndefined()
  })

  it('tracks background processing status and activity', () => {
    const id = createPendingMeeting({ title: 'Queued upload', source: 'upload', sourceUri: '/tmp/queued.txt' })
    let fetched = getMeeting(id) as {
      processingStatus: string
      processingMessage: string | null
      processingProgress: number | null
    }
    expect(fetched.processingStatus).toBe('queued')

    updateMeetingStatus(id, 'analyzing', 'Analyzing with Meeting Agent', 80)
    fetched = getMeeting(id) as { processingStatus: string; processingMessage: string | null; processingProgress: number | null }
    expect(fetched.processingStatus).toBe('analyzing')
    expect(fetched.processingProgress).toBe(80)

    addMeetingActivity({ meetingId: id, type: 'analysis', status: 'success', label: 'Analysis ready' })
    const activity = listMeetingActivity(id) as Array<{ label: string }>
    expect(activity[0].label).toBe('Analysis ready')
  })
})
