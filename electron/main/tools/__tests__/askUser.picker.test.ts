/**
 * Unit tests for AskUser tool – picker kind with snapshot cache wiring (a7).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AskUserExtras } from '../../../../src/types'
import type { ToolContext } from '../index'

// ─── Mock snapshot manager ─────────────────────────────────────────────────────
const mockGetSnapshot = vi.fn()

vi.mock('../../context/snapshotManager', () => ({
  getSnapshot: (appId: string, scope: string) => mockGetSnapshot(appId, scope),
}))

// ─── Import SUT after mocks ────────────────────────────────────────────────────
import { askUserTool } from '../askUser'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function findAskUserTool() {
  return askUserTool
}

function makeCtx(capturedExtras: { value?: AskUserExtras }) {
  return {
    onAskUser: vi.fn((_q: string, _id: string, _choices: string[] | undefined, extras: AskUserExtras) => {
      capturedExtras.value = extras
      return Promise.resolve('user-answer')
    }),
    onToolCall: vi.fn(),
    onError: vi.fn(),
    abortSignal: new AbortController().signal,
  } as unknown as ToolContext
}

const SLACK_CHANNELS_SNAP = {
  fetchedAt: Date.now() - 1000, // fresh
  data: [
    { id: 'C001', name: 'general' },
    { id: 'C002', name: 'engineering' },
  ],
}

const GITHUB_REPOS_SNAP = {
  fetchedAt: Date.now() - 2000, // fresh
  data: [
    { full_name: 'org/repo-a', description: 'Alpha repo' },
    { full_name: 'org/repo-b', description: 'Beta repo' },
  ],
}

const GOOGLE_CALENDARS_SNAP = {
  fetchedAt: Date.now() - 3000, // fresh
  data: [
    { id: 'cal@primary', summary: 'My Calendar', primary: true },
  ],
}

const STALE_SNAP = {
  fetchedAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago → stale
  data: [{ id: 'C999', name: 'archive' }],
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('AskUser tool – picker kind (a7)', () => {
  const tool = findAskUserTool()

  beforeEach(() => {
    mockGetSnapshot.mockReset()
  })

  it('returns picker choices for source=channel from slack snapshot', async () => {
    mockGetSnapshot.mockReturnValue(SLACK_CHANNELS_SNAP)
    const captured: { value?: AskUserExtras } = {}
    const ctx = makeCtx(captured)

    await tool.execute({ kind: 'picker', question: 'Pick a channel', source: 'channel' }, ctx as any)

    expect(captured.value?.pickerChoices).toHaveLength(2)
    expect(captured.value?.pickerChoices?.[0]).toMatchObject({ id: 'C001', label: 'general' })
    expect(captured.value?.pickerChoices?.[1]).toMatchObject({ id: 'C002', label: 'engineering' })
    expect(captured.value?.staleAt).toBeUndefined()
  })

  it('returns picker choices for source=repo from github snapshot', async () => {
    mockGetSnapshot.mockReturnValue(GITHUB_REPOS_SNAP)
    const captured: { value?: AskUserExtras } = {}
    const ctx = makeCtx(captured)

    await tool.execute({ kind: 'picker', question: 'Pick a repo', source: 'repo' }, ctx as any)

    expect(captured.value?.pickerChoices).toHaveLength(2)
    expect(captured.value?.pickerChoices?.[0]).toMatchObject({ id: 'org/repo-a', label: 'org/repo-a' })
  })

  it('returns picker choices for source=calendar from google snapshot', async () => {
    mockGetSnapshot.mockReturnValue(GOOGLE_CALENDARS_SNAP)
    const captured: { value?: AskUserExtras } = {}
    const ctx = makeCtx(captured)

    await tool.execute({ kind: 'picker', question: 'Pick a calendar', source: 'calendar' }, ctx as any)

    expect(captured.value?.pickerChoices).toHaveLength(1)
    expect(captured.value?.pickerChoices?.[0]).toMatchObject({ id: 'cal@primary', label: 'My Calendar' })
  })

  it('falls back to calendar for source=meeting and attaches a note', async () => {
    mockGetSnapshot.mockReturnValue(GOOGLE_CALENDARS_SNAP)
    const captured: { value?: AskUserExtras } = {}
    const ctx = makeCtx(captured)

    await tool.execute({ kind: 'picker', question: 'Pick a meeting', source: 'meeting' }, ctx as any)

    expect(captured.value?.pickerChoices).toHaveLength(1)
    expect(captured.value?.pickerChoices?.[0]._note).toContain('calendars')
  })

  it('sets staleAt when snapshot is older than 24 hours', async () => {
    mockGetSnapshot.mockReturnValue(STALE_SNAP)
    const captured: { value?: AskUserExtras } = {}
    const ctx = makeCtx(captured)

    await tool.execute({ kind: 'picker', question: 'Pick a channel', source: 'channel' }, ctx as any)

    expect(captured.value?.staleAt).toBe(STALE_SNAP.fetchedAt)
  })

  it('omits pickerChoices when snapshot returns null', async () => {
    mockGetSnapshot.mockReturnValue(null)
    const captured: { value?: AskUserExtras } = {}
    const ctx = makeCtx(captured)

    await tool.execute({ kind: 'picker', question: 'Pick a channel', source: 'channel' }, ctx as any)

    expect(captured.value?.pickerChoices).toBeUndefined()
  })

  it('omits pickerChoices when no source is provided (plain picker)', async () => {
    const captured: { value?: AskUserExtras } = {}
    const ctx = makeCtx(captured)

    await tool.execute({ kind: 'picker', question: 'Pick something' }, ctx as any)

    expect(captured.value?.pickerChoices).toBeUndefined()
    expect(mockGetSnapshot).not.toHaveBeenCalled()
  })

  it('does not attach pickerChoices for non-picker kinds', async () => {
    const captured: { value?: AskUserExtras } = {}
    const ctx = makeCtx(captured)

    await tool.execute({ kind: 'text', question: 'What is your name?' }, ctx as any)

    expect(captured.value?.pickerChoices).toBeUndefined()
    expect(mockGetSnapshot).not.toHaveBeenCalled()
  })

  it('returns the answer from onAskUser', async () => {
    mockGetSnapshot.mockReturnValue(SLACK_CHANNELS_SNAP)
    const ctx = makeCtx({})

    const result = await tool.execute(
      { kind: 'picker', question: 'Pick a channel', source: 'channel' },
      ctx as any,
    )

    expect(result.output).toBe('user-answer')
  })
})
