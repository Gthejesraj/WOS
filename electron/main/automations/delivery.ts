import { Notification, BrowserWindow, app } from 'electron'
import { randomUUID } from 'node:crypto'
import { getDb, schema, notifyWrite } from '../db'
import type { AutomationRow } from './registry'

function focusOnAutomation(automationId: string, runId?: string): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  win.show()
  win.focus()
  if (process.platform === 'darwin') app.dock?.show()
  try { win.webContents.send('shortcut:open-automations', { automationId, runId }) } catch { /* ignore */ }
}

/**
 * Per-automation result delivery.
 *   - silent:   nothing
 *   - notify:   native OS notification
 *   - chat:     post a system message into resultTarget (conversation id)
 *   - external: hand off to a tool (slack, email, …) — config-driven, opaque here
 *
 * Errors always trigger a native notification + push 'automation:error'
 * IPC event so the renderer can render a banner.
 */
export async function deliverResult(automation: AutomationRow, output: string, runId?: string): Promise<void> {
  const text = (output || '').trim()
  if (!text) return

  switch (automation.resultDelivery) {
    case 'silent':
      return
    case 'notify':
      if (Notification.isSupported()) {
        const n = new Notification({
          title: `Automation: ${automation.name}`,
          body: text.slice(0, 240),
          silent: false,
        })
        n.on('click', () => focusOnAutomation(automation.id, runId))
        n.show()
      }
      broadcast('automation:result', { id: automation.id, runId: runId ?? null, name: automation.name, output: text })
      return
    case 'chat': {
      const target = automation.resultTarget
      if (!target) return
      try {
        const db = getDb()
        db.insert(schema.messages).values({
          id: randomUUID(),
          conversationId: target,
          role: 'assistant',
          blocks: JSON.stringify([
            { type: 'text', content: `🤖 **${automation.name}** ran:\n\n${text}` },
          ]),
          createdAt: new Date(),
        }).run()
        notifyWrite()
        broadcast('chat:updated', { conversationId: target })
      } catch (err) {
        if (process.env.WOS_DEBUG === '1') console.warn('[delivery] chat post failed', err)
      }
      return
    }
    case 'external':
      // Reserved: external delivery is handled by tools the automation itself calls
      // (e.g. slack_post). Nothing to do here — agent already invoked them.
      return
  }
}

export function broadcastAutomationError(automation: AutomationRow, error: string, runId?: string): void {
  if (Notification.isSupported()) {
    const n = new Notification({
      title: `Automation failed: ${automation.name}`,
      body: error.slice(0, 240),
      silent: false,
    })
    n.on('click', () => focusOnAutomation(automation.id, runId))
    n.show()
  }
  broadcast('automation:error', { id: automation.id, runId: runId ?? null, name: automation.name, error })
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try { win.webContents.send(channel, payload) } catch { /* ignore */ }
  }
}
