import { ipcMain } from 'electron'
import { getDb, schema, notifyWrite } from '../db'
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
  ipcMain.handle('db:messages:edit', (_event, { messageId, newText }: { messageId: string; newText: string }) => {
    const db = getDb()
    const original = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get()
    if (!original) return { success: false, error: 'Message not found' }

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

    // Tag all tail messages as branch 0 (original) if not already in a group
    if (!existingGroupId) {
      for (const m of tail) {
        db.update(schema.messages)
          .set({ branchGroupId: groupId, branchIndex: 0 })
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
    notifyWrite()

    return { success: true, newMessageId: newId, branchGroupId: groupId, branchIndex: newBranchIndex }
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
