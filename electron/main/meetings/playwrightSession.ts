import { app, shell } from 'electron'
import path from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { CAPTION_TAP_SCRIPT } from './injected/captionTap'

/**
 * Persistent Playwright context against the user's installed Chrome.
 *
 * We deliberately:
 *   - DO NOT use puppeteer-extra-plugin-stealth. As of April 2026 Google
 *     fingerprints the plugin's side-effects and is *more* likely to flag
 *     accounts that use it. The stealth dance has become a liability.
 *   - DO NOT pass `--disable-blink-features=AutomationControlled`. That
 *     flag itself is a fingerprint Google looks for.
 *
 * Instead we lean on a real Chrome binary + a long-lived user-data dir, and
 * ask the user to sign in once. Cookies and Drive permissions persist across
 * launches the same way they would in their daily Chrome profile.
 */

let context: BrowserContext | null = null

function profileDir(): string {
  return path.join(app.getPath('userData'), 'meet-profile')
}

function chromeInstallMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/chrome|channel/i.test(msg)) {
    return 'Google Chrome is required for Meet. Install Chrome from google.com/chrome and try again.'
  }
  return msg
}

export async function getMeetContext(): Promise<BrowserContext> {
  if (context) return context
  try {
    context = await chromium.launchPersistentContext(profileDir(), {
      channel: 'chrome',
      headless: false,
      viewport: { width: 1280, height: 800 },
      // No anti-automation flags. We rely on the user being signed in to a
      // real Chrome profile. Adding `--use-fake-ui-for-media-stream` here
      // would only matter if we were capturing camera/mic — we aren't.
      args: [],
    })
    context.on('close', () => { context = null })
    return context
  } catch (err) {
    throw new Error(chromeInstallMessage(err))
  }
}

export async function openGoogleSignIn(): Promise<Page> {
  const ctx = await getMeetContext()
  const page = await ctx.newPage()
  await page.goto('https://accounts.google.com', { waitUntil: 'domcontentloaded' })
  return page
}

export async function openMeetPage(
  url: string,
  onCaption: (caption: { text: string; timestamp: number; url?: string }) => void,
): Promise<Page> {
  const ctx = await getMeetContext()
  const page = await ctx.newPage()
  await page.exposeBinding('wosCaption', (_source, payload) => {
    const data = payload as { text?: string; timestamp?: number; url?: string }
    if (data.text) onCaption({ text: data.text, timestamp: data.timestamp ?? Date.now(), url: data.url })
  })
  await page.addInitScript({ content: CAPTION_TAP_SCRIPT })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  return page
}

export async function closeMeetContext(): Promise<void> {
  const ctx = context
  context = null
  await ctx?.close().catch(() => {})
}

export async function openChromeInstallPage() {
  await shell.openExternal('https://www.google.com/chrome/')
}
