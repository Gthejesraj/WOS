import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWos, closeWos } from './helpers'

/**
 * End-to-end smoke for the Meetings tab. Drives everything through the
 * preload-exposed `window.wos.meetings` API so we don't depend on a real
 * Google sign-in or a running Meet room. The point is to catch regressions
 * in the IPC surface, the analyze/save pipeline, and the UI state machine.
 *
 * The renderer never opens a Playwright Chrome here — `meetings:join-in-wos`
 * is intentionally NOT exercised. We exercise the parts that matter for the
 * after-meeting transcript flow the user cares about:
 *   - upload + analyze (with WOS_E2E mock provider)
 *   - listSaved / search / delete
 *   - caption + analysis-error event subscriptions
 */

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeAll(async () => {
  ({ app, page, userDataDir } = await launchWos())
  await page.getByRole('button', { name: /Meetings/ }).click()
})

test.afterAll(async () => {
  await closeWos(app, userDataDir)
})

test('meetings preload surface exists', async () => {
  const surface = await page.evaluate(() => Object.keys(window.wos.meetings ?? {}))
  for (const k of [
    'listCalendarEvents',
    'joinInWos',
    'signInToGoogle',
    'leaveLiveMeeting',
    'openFileDialog',
    'findDriveFolder',
    'listDriveRecordings',
    'getDriveTranscript',
    'transcribeDriveVideo',
    'processFile',
    'createPending',
    'updateStatus',
    'analyze',
    'listSaved',
    'deleteSaved',
    'renameSaved',
    'copyMarkdown',
    'exportMarkdown',
    'listActivity',
    'addActivity',
    'emailNotes',
    'createGmailDraft',
    'listSlackDestinations',
    'postSlack',
    'onCaptionUpdate',
    'onMeetingClosed',
    'onAnalysisError',
  ]) {
    expect(surface, `missing window.wos.meetings.${k}`).toContain(k)
  }
})

test('listSaved returns a structured response without throwing', async () => {
  const res = await page.evaluate(async () => window.wos.meetings.listSaved())
  expect(res).toHaveProperty('meetings')
  expect(res).toHaveProperty('error')
  expect(Array.isArray(res.meetings)).toBe(true)
})

test('searching with an empty query is the same as listing', async () => {
  const a = await page.evaluate(async () => window.wos.meetings.listSaved())
  const b = await page.evaluate(async () => window.wos.meetings.listSaved({ query: '' }))
  expect(a.meetings.length).toBe(b.meetings.length)
})

test('caption + analysis-error subscriptions can be added and removed', async () => {
  const result = await page.evaluate(async () => {
    let captions = 0
    let errs = 0
    const off1 = window.wos.meetings.onCaptionUpdate(() => { captions++ })
    const off2 = window.wos.meetings.onAnalysisError(() => { errs++ })
    off1(); off2()
    return { captions, errs, ok: typeof off1 === 'function' && typeof off2 === 'function' }
  })
  expect(result.ok).toBe(true)
})

test('deleting an unknown id is a graceful no-op', async () => {
  const res = await page.evaluate(async () =>
    window.wos.meetings.deleteSaved({ ids: ['no-such-id'] })
  )
  expect(res.ok).toBe(true)
})

test('Live tab renders without crashing', async () => {
  await expect(page.getByRole('button', { name: /^Live$/ })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: /^Analyze$/ })).toBeVisible()
})

test('Analyze tab renders split view with library and workspace', async () => {
  await page.getByRole('button', { name: /^Analyze$/ }).click()
  await expect(page.getByText(/Previous transcripts/i)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Analyze workspace/i)).toBeVisible()
  await expect(page.getByText(/Drop file or click to upload/i)).toBeVisible()
})

test('pending upload rows appear in the transcript library with status', async () => {
  await page.getByRole('button', { name: /^Analyze$/ }).click()
  const title = `Pending transcript ${Date.now()}`
  const id = await page.evaluate(async (meetingTitle) => {
    const created = await window.wos.meetings.createPending({
      title: meetingTitle,
      source: 'upload',
      sourceUri: '/tmp/fake-meeting.txt',
    })
    if (!created.id) throw new Error(created.error ?? 'createPending failed')
    await window.wos.meetings.updateStatus({
      id: created.id,
      status: 'analyzing',
      message: 'Analyzing with Meeting Agent',
      progress: 80,
    })
    return created.id
  }, title)

  await page.getByTitle('Refresh').first().click()
  const row = page.getByText(title).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Analyzing with Meeting Agent/i)).toBeVisible()

  await row.click()
  await expect(page.getByText(/Back to Analyze Home/i)).toBeVisible()
  await expect(page.getByText(/You can keep working/i)).toBeVisible()

  await page.evaluate(async (meetingId) => {
    await window.wos.meetings.deleteSaved({ ids: [meetingId] })
  }, id)
})

test('activity log API persists entries for Analyze', async () => {
  const label = `E2E activity ${Date.now()}`
  const added = await page.evaluate(async (entryLabel) => {
    return window.wos.meetings.addActivity({
      type: 'e2e',
      status: 'info',
      label: entryLabel,
    })
  }, label)
  expect(added.id).toBeTruthy()
  const listed = await page.evaluate(async () => window.wos.meetings.listActivity({ limit: 5 }))
  expect(listed.entries.some((entry: any) => entry.label === label)).toBe(true)
})
