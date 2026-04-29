import { ipcMain } from 'electron'
import { getDb, schema, notifyWrite, runRaw } from '../db'
import { eq, desc, asc, gte, and } from 'drizzle-orm'
import { randomUUID } from 'crypto'

export function registerDbHandlers() {
  ipcMain.handle('db:conversations:list', () => {
    const db = getDb()
    return db
      .select()
      .from(schema.conversations)
      .orderBy(desc(schema.conversations.updatedAt))
      .all()
  })

  ipcMain.handle('db:conversations:get', (_event, id: string) => {
    const db = getDb()
    return db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).get()
  })

  ipcMain.handle('db:conversations:delete', (_event, id: string) => {
    const db = getDb()
    db.delete(schema.conversations).where(eq(schema.conversations.id, id)).run()
    notifyWrite()
    return { success: true }
  })

  ipcMain.handle('db:messages:list', (_event, conversationId: string) => {
    const db = getDb()
    return db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(asc(schema.messages.createdAt))
      .all()
  })

  ipcMain.handle('db:workspaces:list', () => {
    const db = getDb()
    return db.select().from(schema.workspaces).all()
  })

  // Edit a user message: tags the original message + all subsequent messages as branch 0,
  // then creates a new user message as branch 1 (or max+1) in the same group.
  // Returns the new message ID so the caller can trigger a new agent run.
  //
  // Hardened: returns a structured `{ code: 'NOT_FOUND' }` error so the renderer
  // can refetch and retry once before surfacing. Wraps all writes in a sql.js
  // transaction so a partial failure can't leave orphan branch tags. Also re-tags
  // any tail rows that arrived AFTER an earlier edit (those previously had a null
  // branchGroupId and were therefore invisible to the branch picker).
  ipcMain.handle('db:messages:edit', (_event, { messageId, newText }: { messageId: string; newText: string }) => {
    const db = getDb()
    const original = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get()
    if (!original) {
      return { success: false, code: 'NOT_FOUND', failingId: messageId, error: 'Message not found' }
    }

    runRaw('BEGIN')
    try {
      // Find all messages from this point onward in the conversation
      const tail = db
        .select()
        .from(schema.messages)
        .where(and(
          eq(schema.messages.conversationId, original.conversationId),
          gte(schema.messages.createdAt, original.createdAt),
        ))
        .orderBy(asc(schema.messages.createdAt))
        .all()

      // Find or create the branch group for this position
      const existingGroupId = original.branchGroupId
      const groupId = existingGroupId ?? randomUUID()
      const maxBranch = existingGroupId
        ? Math.max(0, ...tail.filter(m => m.branchGroupId === existingGroupId).map(m => m.branchIndex ?? 0))
        : 0
      const newBranchIndex = maxBranch + 1

      // Tag tail messages: every untagged tail row inherits the original branch (0)
      // when starting a fresh group; on subsequent edits, untagged late-arrivals
      // (e.g. assistant messages that landed mid-edit) inherit the *current active*
      // branch so they don't dangle as ghosts in the picker.
      const inheritIndex = existingGroupId ? maxBranch : 0
      for (const m of tail) {
        if (m.branchGroupId == null) {
          db.update(schema.messages)
            .set({ branchGroupId: groupId, branchIndex: inheritIndex })
            .where(eq(schema.messages.id, m.id))
            .run()
        }
      }

      // Insert the new edited user message
      const newId = randomUUID()
      db.insert(schema.messages).values({
        id: newId,
        conversationId: original.conversationId,
        role: 'user',
        blocks: JSON.stringify([{ type: 'text', content: newText }]),
        createdAt: new Date(original.createdAt.getTime() + 1),
        branchGroupId: groupId,
        branchIndex: newBranchIndex,
      }).run()

      runRaw('COMMIT')
      notifyWrite()
      return { success: true, newMessageId: newId, branchGroupId: groupId, branchIndex: newBranchIndex }
    } catch (err) {
      try { runRaw('ROLLBACK') } catch { /* nothing to roll back */ }
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, code: 'WRITE_FAILED', error: msg }
    }
  })

  // Get all branch indices for a given branch group
  ipcMain.handle('db:messages:branches', (_event, { conversationId, branchGroupId }: { conversationId: string; branchGroupId: string }) => {
    const db = getDb()
    const msgs = db
      .select()
      .from(schema.messages)
      .where(and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.branchGroupId, branchGroupId),
      ))
      .orderBy(asc(schema.messages.branchIndex), asc(schema.messages.createdAt))
      .all()

    // Group by branch index, each branch is: [userMsg, assistantMsg?]
    const branches: Record<number, typeof msgs> = {}
    for (const m of msgs) {
      const idx = m.branchIndex ?? 0
      if (!branches[idx]) branches[idx] = []
      branches[idx].push(m)
    }
    return branches
  })
}
