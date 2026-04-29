import { ipcMain, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import { agentRunner } from '../agent/runner'
import { getDb, schema, notifyWrite } from '../db'
import { eq, asc } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { emitHook } from '../automations/hookBus'

export function registerAgentHandlers(_win: BrowserWindow) {
  ipcMain.handle(
    'agent:send',
    async (
      event,
      {
        conversationId,
        message,
        attachments = [],
      }: {
        conversationId: string
        message: string
        attachments?: Array<{ name: string; content: string }>
      }
    ) => {
      try {
        void emitHook('message:received', { conversationId, message })
        await agentRunner.run(conversationId, message, attachments, event.sender)
        return { success: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        void emitHook('agent:error', { conversationId, message: msg })
        // Also surface an error event to the UI so the streaming spinner is
        // cleared and a visible error block appears in the current chat.
        if (!event.sender.isDestroyed()) {
          event.sender.send('agent:event', { type: 'error', message: msg, retryable: false })
          event.sender.send('agent:event', { type: 'turn_complete', usage: { inputTokens: 0, outputTokens: 0 } })
        }
        return { success: false, error: msg }
      }
    }
  )

  ipcMain.handle('agent:cancel', () => {
    agentRunner.cancel()
    return { success: true }
  })

  ipcMain.handle(
    'agent:continue',
    async (event, { conversationId }: { conversationId: string }) => {
      try {
        await agentRunner.continue(conversationId, event.sender)
        return { success: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!event.sender.isDestroyed()) {
          event.sender.send('agent:event', { type: 'error', message: msg, retryable: false })
          event.sender.send('agent:event', { type: 'turn_complete', usage: { inputTokens: 0, outputTokens: 0 } })
        }
        return { success: false, error: msg }
      }
    }
  )

  ipcMain.handle(
    'agent:answer',
    (_event, { questionId, answer }: { questionId: string; answer: string }) => {
      agentRunner.resolveAnswer(questionId, answer)
      return { success: true }
    }
  )

  ipcMain.handle(
    'agent:permission',
    (
      _event,
      {
        toolId,
        decision,
      }: { toolId: string; decision: 'allow' | 'allow-session' | 'deny' }
    ) => {
      agentRunner.resolveAnswer(toolId, decision)
      return { success: true }
    }
  )

  ipcMain.handle(
    'agent:create-conversation',
    async (_event, { workspaceId, model, mode }: { workspaceId?: string; model?: string; mode?: string }) => {
      const db = getDb()

      // Get defaults from settings
      const modelSetting = db.select().from(schema.settings).where(eq(schema.settings.key, 'defaultModel')).get()
      const modeSetting = db.select().from(schema.settings).where(eq(schema.settings.key, 'defaultMode')).get()

      const defaultModel = (modelSetting?.value as string)?.replace(/^"|"$/g, '') || ''
      const defaultMode = (modeSetting?.value as string)?.replace(/^"|"$/g, '') ?? 'default'

      const id = randomUUID()
      const now = new Date()
      db.insert(schema.conversations).values({
        id,
        title: 'New Conversation',
        workspaceId: workspaceId ?? null,
        model: model ?? defaultModel,
        mode: mode ?? defaultMode,
        createdAt: now,
        updatedAt: now,
      }).run()
      notifyWrite()

      void emitHook('conversation:new', { conversationId: id })

      return {
        id,
        title: 'New Conversation',
        workspaceId: workspaceId ?? null,
        model: model ?? defaultModel,
        mode: mode ?? defaultMode,
        createdAt: now,
        updatedAt: now,
        tokenCount: 0,
        contextLimit: 200000,
        isCompacted: false,
      }
    }
  )

  ipcMain.handle(
    'agent:update-conversation',
    async (_event, { conversationId, updates }: { conversationId: string; updates: Record<string, unknown> }) => {
      const db = getDb()
      db.update(schema.conversations)
        .set({ ...updates, updatedAt: new Date() } as unknown as Partial<typeof schema.conversations.$inferInsert>)
        .where(eq(schema.conversations.id, conversationId))
        .run()
      notifyWrite()
      return { success: true }
    }
  )

  // Export a conversation to Markdown via a save dialog.
  ipcMain.handle(
    'agent:export-conversation',
    async (_event, { conversationId }: { conversationId: string }) => {
      const db = getDb()
      const conv = db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, conversationId))
        .get()
      if (!conv) return { ok: false, error: 'Conversation not found' }
      const messages = db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId))
        .orderBy(asc(schema.messages.createdAt))
        .all()

      const lines: string[] = []
      lines.push(`# ${conv.title || 'Conversation'}`)
      lines.push('')
      lines.push(`_Exported ${new Date().toISOString()} • model: ${conv.model || 'unknown'} • mode: ${conv.mode || 'default'}_`)
      lines.push('')
      for (const m of messages) {
        const role = m.role === 'user' ? '👤 User' : m.role === 'assistant' ? '🤖 Assistant' : `🔧 ${m.role}`
        lines.push(`## ${role}`)
        lines.push('')
        let body = ''
        const blocks = m.blocks
        if (typeof blocks === 'string') {
          body = blocks
        } else if (Array.isArray(blocks)) {
          for (const block of blocks as Array<Record<string, unknown>>) {
            if (block.type === 'text') body += String(block.content ?? '') + '\n'
            else if (block.type === 'reasoning') body += `_(reasoning)_\n${String(block.content ?? '')}\n`
            else if (block.type === 'tool_use') body += `\n\`tool: ${String(block.toolName ?? '')}\`\n`
            else if (block.type === 'ask_user') body += `\n> ❓ ${String(block.question ?? '')}\n`
          }
        }
        lines.push(body.trim())
        lines.push('')
      }

      const chosen = await dialog.showSaveDialog({
        defaultPath: `${(conv.title || 'conversation').replace(/[^a-z0-9-]+/gi, '-')}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })
      if (chosen.canceled || !chosen.filePath) return { ok: false, canceled: true }
      fs.writeFileSync(chosen.filePath, lines.join('\n'), 'utf-8')
      return { ok: true, path: chosen.filePath }
    }
  )
}
