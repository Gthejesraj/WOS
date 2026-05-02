/**
 * Unit tests for the projects refresh event normaliser.
 *
 * `extractEvents` is the heart of the smart-cadence refresh loop — it must
 * gracefully turn assorted app-fetcher payload shapes into a uniform list
 * of activity rows for the dedupe-keyed insert.
 */
import { describe, it, expect, vi } from 'vitest'

// Avoid importing the manager (and thus DB) by mocking it.
vi.mock('../manager', () => ({
  listProjects: () => [],
  listResources: () => [],
  markResourceFetched: () => {},
  recordActivity: () => null,
}))
vi.mock('../resources', () => ({ findEntryByKind: () => null }))
vi.mock('../../apps/manager', () => ({ getApp: () => null, getConnection: () => null }))

import { __test } from '../refresh'
const { extractEvents } = __test

describe('refresh.extractEvents', () => {
  it('handles plain arrays', () => {
    const out = extractEvents([
      { ts: 1700000000, title: 'hello', actor: 'me', url: 'https://x' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.title).toBe('hello')
    expect(out[0]!.actor).toBe('me')
  })

  it('unwraps {events:[]} and {items:[]}', () => {
    const a = extractEvents({ events: [{ title: 'a', ts: 1700000001 }] })
    const b = extractEvents({ items: [{ title: 'b', ts: 1700000002 }] })
    expect(a).toHaveLength(1); expect(a[0]!.title).toBe('a')
    expect(b).toHaveLength(1); expect(b[0]!.title).toBe('b')
  })

  it('drops events without a title', () => {
    const out = extractEvents([
      { ts: 1700000000 },
      { ts: 1700000001, title: 'kept' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.title).toBe('kept')
  })

  it('promotes seconds-precision ts to ms', () => {
    const out = extractEvents([{ ts: 1_700_000_000, title: 'sec' }])
    expect(out[0]!.ts).toBe(1_700_000_000_000)
  })

  it('keeps ms-precision ts as-is', () => {
    const out = extractEvents([{ ts: 1_700_000_000_000, title: 'ms' }])
    expect(out[0]!.ts).toBe(1_700_000_000_000)
  })

  it('falls back to alternate field names', () => {
    const out = extractEvents([
      { timestamp: 1700000000, summary: 'alt-fields', from: 'kira', html_url: 'https://h' },
    ])
    expect(out[0]!.title).toBe('alt-fields')
    expect(out[0]!.actor).toBe('kira')
    expect(out[0]!.url).toBe('https://h')
  })

  it('synthesises a stable dedupe key when no id is provided', () => {
    const out1 = extractEvents([{ ts: 1700000000, title: 'pizza' }])
    const out2 = extractEvents([{ ts: 1700000000, title: 'pizza' }])
    expect(out1[0]!.dedupeKey).toBe(out2[0]!.dedupeKey)
  })

  it('returns an empty list for unrecognised payload shapes', () => {
    expect(extractEvents(null)).toEqual([])
    expect(extractEvents(42)).toEqual([])
    expect(extractEvents({ totally: 'random' })).toEqual([])
  })
})
