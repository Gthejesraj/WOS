/**
 * Unit tests for the context scheduler.
 *
 * Uses vi.useFakeTimers() to advance time without real delays.
 * Mocks snapshotManager and apps/manager to avoid DB dependencies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockRefreshSnapshot = vi.fn().mockResolvedValue(undefined)

vi.mock('../../context/snapshotManager', () => ({
  refreshSnapshot: (...args: unknown[]) => mockRefreshSnapshot(...args),
}))

const mockListConnections = vi.fn()

vi.mock('../../apps/manager', () => ({
  listConnections: () => mockListConnections(),
}))

// ─── Import SUT after mocks ────────────────────────────────────────────────────
import {
  startContextScheduler,
  stopContextScheduler,
  scheduleAppOnConnect,
  clearAppScheduleOnDisconnect,
} from '../scheduler'

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('contextScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockRefreshSnapshot.mockClear()
    mockListConnections.mockReturnValue([])
    // Always stop before each test to reset internal handle map
    stopContextScheduler()
  })

  afterEach(() => {
    stopContextScheduler()
    vi.useRealTimers()
  })

  it('registers no intervals when no apps are connected', async () => {
    mockListConnections.mockReturnValue([])
    startContextScheduler()
    // Advance well past all intervals — nothing should be called
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 1000)
    expect(mockRefreshSnapshot).not.toHaveBeenCalled()
  })

  it('schedules slack.channels refresh at 30-minute intervals', async () => {
    mockListConnections.mockReturnValue([{ appId: 'slack', enabled: true, creds: {}, metadata: null }])
    startContextScheduler()

    // Before 30 min — no call
    await vi.advanceTimersByTimeAsync(29 * 60 * 1000)
    expect(mockRefreshSnapshot).not.toHaveBeenCalledWith('slack', 'channels')

    // At 30 min — first channels call
    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(mockRefreshSnapshot).toHaveBeenCalledWith('slack', 'channels')
  })

  it('schedules slack.users refresh at 60-minute intervals', async () => {
    mockListConnections.mockReturnValue([{ appId: 'slack', enabled: true, creds: {}, metadata: null }])
    startContextScheduler()

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(mockRefreshSnapshot).toHaveBeenCalledWith('slack', 'users')
  })

  it('schedules google.calendars refresh at 5-minute intervals', async () => {
    mockListConnections.mockReturnValue([{ appId: 'google', enabled: true, creds: {}, metadata: null }])
    startContextScheduler()

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(mockRefreshSnapshot).toHaveBeenCalledWith('google', 'calendars')

    // Fires again at 10 min
    mockRefreshSnapshot.mockClear()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(mockRefreshSnapshot).toHaveBeenCalledWith('google', 'calendars')
  })

  it('fires multiple intervals for the same app', async () => {
    mockListConnections.mockReturnValue([{ appId: 'slack', enabled: true, creds: {}, metadata: null }])
    startContextScheduler()

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

    const callArgs = mockRefreshSnapshot.mock.calls.map(c => c[1])
    expect(callArgs).toContain('channels')
    expect(callArgs).toContain('users')
  })

  it('stopContextScheduler clears all intervals', async () => {
    mockListConnections.mockReturnValue([{ appId: 'google', enabled: true, creds: {}, metadata: null }])
    startContextScheduler()
    stopContextScheduler()

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(mockRefreshSnapshot).not.toHaveBeenCalled()
  })

  it('scheduleAppOnConnect registers intervals for a newly connected app', async () => {
    // Start with no apps
    mockListConnections.mockReturnValue([])
    startContextScheduler()

    // Connect github
    scheduleAppOnConnect('github')

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(mockRefreshSnapshot).toHaveBeenCalledWith('github', 'repos')
  })

  it('clearAppScheduleOnDisconnect stops intervals for that app only', async () => {
    mockListConnections.mockReturnValue([
      { appId: 'slack', enabled: true, creds: {}, metadata: null },
      { appId: 'github', enabled: true, creds: {}, metadata: null },
    ])
    startContextScheduler()

    // Disconnect slack
    clearAppScheduleOnDisconnect('slack')

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

    const calledApps = mockRefreshSnapshot.mock.calls.map(c => c[0])
    expect(calledApps).not.toContain('slack')
    expect(calledApps).toContain('github')
  })

  it('skips disabled connections', async () => {
    mockListConnections.mockReturnValue([
      { appId: 'jira', enabled: false, creds: {}, metadata: null },
    ])
    startContextScheduler()

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(mockRefreshSnapshot).not.toHaveBeenCalled()
  })
})
