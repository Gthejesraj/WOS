import { create } from 'zustand'
import type { AgentEvent, Conversation, DisplayMessage, MessageBlock, FileAttachment } from '../types'
import { applyEvent, finalizeOrphanBlocks } from '../lib/blockAccumulator'
import { eventLog } from '../lib/eventLog'
import { toast } from 'sonner'
import { useWorkspaceStore } from './workspaceStore'

interface AgentStore {
  isStreaming: boolean
  activeConversationId: string | null
  conversations: Conversation[]
  currentMessages: DisplayMessage[]
  activeBranches: Record<string, number>  // branchGroupId → active branch index
  currentMode: string
  currentModel: string
  sessionTokens: { input: number; output: number }
  sendToken: number
  loadToken: number

  loadConversations: () => Promise<void>
  loadConversation: (id: string) => Promise<void>
  startNewConversation: (workspaceId?: string | null) => Promise<string>
  sendMessage: (text: string, attachments?: FileAttachment[]) => Promise<void>
  continueConversation: () => Promise<void>
  cancelAgent: () => void
  answerQuestion: (questionId: string, answer: string) => void
  grantPermission: (toolId: string, scope: 'allow' | 'allow-session') => void
  denyPermission: (toolId: string) => void
  deleteConversation: (id: string) => Promise<void>
  retryLastMessage: () => Promise<void>
  setMode: (mode: string) => Promise<void>
  setModel: (model: string) => Promise<void>
  setActiveConversationId: (id: string | null) => void
  setConversationWorkspace: (convId: string, workspaceId: string | null) => Promise<void>
  renameConversation: (convId: string, title: string) => Promise<void>
  editMessage: (messageId: string, newText: string) => Promise<void>
  switchBranch: (branchGroupId: string, newIndex: number) => void
}

let agentEventCleanup: (() => void) | null = null

export const useAgentStore = create<AgentStore>((set, get) => ({
  isStreaming: false,
  activeConversationId: null,
  conversations: [],
  currentMessages: [],
  activeBranches: {},
  currentMode: 'default',
  currentModel: 'gpt-4o',
  sessionTokens: { input: 0, output: 0 },
  sendToken: 0,
  loadToken: 0,

  loadConversations: async () => {
    try {
      const convs = await window.wos.getConversations() as Conversation[]
      set({ conversations: convs })
    } catch (err) {
      console.error('[wos:store] loadConversations failed', err)
    }
  },

  loadConversation: async (id: string) => {
    const token = get().loadToken + 1
    set({ loadToken: token })
    try {
      const messages = await window.wos.getMessages(id) as Array<{
        id: string
        role: string
        blocks: MessageBlock[]
        createdAt: string
        branchGroupId?: string | null
        branchIndex?: number | null
      }>

      const conv = await window.wos.getConversation(id) as Conversation

      // If a newer load started after us, or the user switched convs, ignore results
      if (get().loadToken !== token) return

      const displayMessages: DisplayMessage[] = messages.map((m, idx) => {
        const rawBlocks: MessageBlock[] = Array.isArray(m.blocks)
          ? m.blocks
          : JSON.parse(m.blocks as unknown as string)
        const isLatest = idx === messages.length - 1
        return {
          id: m.id,
          role: m.role as 'user' | 'assistant',
          blocks: finalizeOrphanBlocks(rawBlocks, { isLatestMessage: false }),
          createdAt: new Date(m.createdAt),
          branchGroupId: m.branchGroupId,
          branchIndex: m.branchIndex,
        }
      })

      // Build activeBranches: default to highest branch index per group
      const activeBranches: Record<string, number> = {}
      for (const m of displayMessages) {
        if (m.branchGroupId) {
          const cur = activeBranches[m.branchGroupId] ?? 0
          activeBranches[m.branchGroupId] = Math.max(cur, m.branchIndex ?? 0)
        }
      }

      // Only update activeConversationId if caller intent still matches
      set({
        activeConversationId: id,
        currentMessages: displayMessages,
        activeBranches,
        currentMode: conv?.mode ?? get().currentMode,
        currentModel: conv?.model ?? get().currentModel,
      })

      // Sync active workspace to match the loaded conversation's workspace
      if (conv?.workspaceId !== undefined) {
        void useWorkspaceStore.getState().setActiveWorkspace(conv.workspaceId)
      }
    } catch (err) {
      console.error('[wos:store] loadConversation failed', err)
      toast.error('Failed to load conversation')
    }
  },

  startNewConversation: async (workspaceId?: string | null) => {
    const { currentModel, currentMode } = get()
    const conv = await window.wos.createConversation({
      workspaceId: workspaceId ?? undefined,
      model: currentModel,
      mode: currentMode,
    }) as Conversation

    set(s => ({
      conversations: [conv, ...s.conversations],
      activeConversationId: conv.id,
      currentMessages: [],
    }))

    return conv.id
  },

  sendMessage: async (text: string, attachments = []) => {
    let { activeConversationId } = get()
    console.log('[wos:store] sendMessage called', { text: text.slice(0, 40), activeConversationId, isStreaming: get().isStreaming })
    if (!activeConversationId) {
      console.log('[wos:store] no active conversation — creating one')
      try {
        activeConversationId = await get().startNewConversation()
      } catch (err) {
        console.error('[wos:store] failed to auto-create conversation', err)
        toast.error('Failed to start conversation')
        return
      }
    }
    if (get().isStreaming) {
      console.warn('[wos:store] sendMessage ignored — already streaming')
      return
    }

    // Per-send token — late async events from prior sends will be ignored
    const sendToken = get().sendToken + 1
    const targetConvId = activeConversationId
    set({ sendToken })

    const { currentModel, currentMode } = get()
    try {
      await window.wos.updateConversation(targetConvId, {
        model: currentModel,
        mode: currentMode,
      })
    } catch (err) {
      console.error('[wos:store] failed to sync conversation settings', err)
      toast.error('Failed to update conversation settings')
      return
    }

    // Optimistically add user message to UI
    const userMsgId = `user-${Date.now()}`
    const userMsg: DisplayMessage = {
      id: userMsgId,
      role: 'user',
      blocks: [{ type: 'text', content: text }],
      createdAt: new Date(),
    }

    const assistantMsgId = `assistant-${Date.now()}`
    const assistantMsg: DisplayMessage = {
      id: assistantMsgId,
      role: 'assistant',
      blocks: [],
      createdAt: new Date(),
    }

    set(s => ({
      isStreaming: true,
      currentMessages: [...s.currentMessages, userMsg, assistantMsg],
    }))

    // Setup event listener — tear down prior one first
    if (agentEventCleanup) agentEventCleanup()
    agentEventCleanup = window.wos.onAgentEvent((event: unknown) => {
      const e = event as AgentEvent
      eventLog.push(e)
      if (typeof window !== 'undefined' && (window as unknown as { WOS_DEBUG?: boolean }).WOS_DEBUG) {
        console.log('[wos:event]', e.type, e)
      }
      // Ignore stale events if a newer send started or the user switched conversations
      if (get().sendToken !== sendToken) return
      if (get().activeConversationId !== targetConvId) return

      set(s => {
        const msgs = [...s.currentMessages]
        // Find the assistant message we optimistically created by id
        const idx = msgs.findIndex(m => m.id === assistantMsgId)
        if (idx < 0) return s

        const lastMsg = msgs[idx]
        if (lastMsg.role !== 'assistant') return s

        const newBlocks = applyEvent(lastMsg.blocks, e)
        msgs[idx] = { ...lastMsg, blocks: newBlocks }

        if (e.type === 'turn_complete' || e.type === 'error') {
          const nextTokens = e.type === 'turn_complete'
            ? {
                input: s.sessionTokens.input + (e.usage?.inputTokens ?? 0),
                output: s.sessionTokens.output + (e.usage?.outputTokens ?? 0),
              }
            : s.sessionTokens
          return { ...s, isStreaming: false, currentMessages: msgs, sessionTokens: nextTokens }
        }
        return { ...s, currentMessages: msgs }
      })
    })

    try {
      console.log('[wos:store] invoking IPC agent:send')
      const result = await window.wos.sendMessage({
        conversationId: targetConvId,
        message: text,
        attachments,
      }) as { success: boolean; error?: string }
      console.log('[wos:store] IPC agent:send returned', result)
      if (result && result.success === false) {
        toast.error(`Error: ${result.error ?? 'Unknown error'}`)
        if (get().sendToken === sendToken) set({ isStreaming: false })
      }
    } catch (err) {
      console.error('[wos:store] sendMessage IPC error', err)
      toast.error(`Error: ${(err as Error).message}`)
      if (get().sendToken === sendToken) set({ isStreaming: false })
    } finally {
      // Ensure spinner is never stuck on — but only for THIS send.
      if (get().sendToken === sendToken && get().isStreaming) {
        set({ isStreaming: false })
      }
      // Refresh sidebar list (titles, updatedAt) — cheap, no currentMessages clobber
      void get().loadConversations()
    }
  },

  continueConversation: async () => {
    const { activeConversationId } = get()
    if (!activeConversationId || get().isStreaming) return

    const sendToken = get().sendToken + 1
    const targetConvId = activeConversationId
    set({ sendToken })

    const { currentModel, currentMode } = get()
    try {
      await window.wos.updateConversation(targetConvId, {
        model: currentModel,
        mode: currentMode,
      })
    } catch (err) {
      console.error('[wos:store] failed to sync conversation settings', err)
      toast.error('Failed to update conversation settings')
      return
    }

    const assistantMsgId = `assistant-${Date.now()}`
    const assistantMsg: DisplayMessage = {
      id: assistantMsgId,
      role: 'assistant',
      blocks: [],
      createdAt: new Date(),
    }
    set(s => ({ isStreaming: true, currentMessages: [...s.currentMessages, assistantMsg] }))

    if (agentEventCleanup) agentEventCleanup()
    agentEventCleanup = window.wos.onAgentEvent((event: unknown) => {
      const e = event as AgentEvent
      eventLog.push(e)
      if (get().sendToken !== sendToken) return
      if (get().activeConversationId !== targetConvId) return

      set(s => {
        const msgs = [...s.currentMessages]
        const idx = msgs.findIndex(m => m.id === assistantMsgId)
        if (idx < 0) return s
        const lastMsg = msgs[idx]
        if (lastMsg.role !== 'assistant') return s
        const newBlocks = applyEvent(lastMsg.blocks, e)
        msgs[idx] = { ...lastMsg, blocks: newBlocks }
        if (e.type === 'turn_complete' || e.type === 'error') {
          const nextTokens = e.type === 'turn_complete'
            ? { input: s.sessionTokens.input + (e.usage?.inputTokens ?? 0), output: s.sessionTokens.output + (e.usage?.outputTokens ?? 0) }
            : s.sessionTokens
          return { ...s, isStreaming: false, currentMessages: msgs, sessionTokens: nextTokens }
        }
        return { ...s, currentMessages: msgs }
      })
    })

    try {
      const result = await window.wos.continueConversation(targetConvId) as { success: boolean; error?: string }
      if (result && result.success === false) {
        toast.error(`Error: ${result.error ?? 'Unknown error'}`)
        if (get().sendToken === sendToken) set({ isStreaming: false })
      }
    } catch (err) {
      console.error('[wos:store] continueConversation IPC error', err)
      toast.error(`Error: ${(err as Error).message}`)
      if (get().sendToken === sendToken) set({ isStreaming: false })
    } finally {
      if (get().sendToken === sendToken && get().isStreaming) set({ isStreaming: false })
      void get().loadConversations()
    }
  },

  cancelAgent: () => {
    window.wos.cancelAgent()
    set({ isStreaming: false })
  },

  answerQuestion: (questionId: string, answer: string) => {
    window.wos.answerQuestion(questionId, answer)
    // Update the ask_user block to show the answer
    set(s => ({
      currentMessages: s.currentMessages.map(m => ({
        ...m,
        blocks: m.blocks.map(b =>
          b.type === 'ask_user' && b.questionId === questionId
            ? { ...b, answer }
            : b
        ),
      })),
    }))
  },

  grantPermission: (toolId: string, scope: 'allow' | 'allow-session') => {
    window.wos.grantPermission(toolId, scope === 'allow' ? 'allow' : 'allow-session')
    set(s => ({
      currentMessages: s.currentMessages.map(m => ({
        ...m,
        blocks: m.blocks.map(b =>
          b.type === 'permission_request' && b.toolId === toolId
            ? { ...b, decision: 'allowed' as const }
            : b
        ),
      })),
    }))
  },

  denyPermission: (toolId: string) => {
    window.wos.grantPermission(toolId, 'deny')
    set(s => ({
      currentMessages: s.currentMessages.map(m => ({
        ...m,
        blocks: m.blocks.map(b =>
          b.type === 'permission_request' && b.toolId === toolId
            ? { ...b, decision: 'denied' as const }
            : b
        ),
      })),
    }))
  },

  deleteConversation: async (id: string) => {
    await window.wos.deleteConversation(id)
    set(s => {
      const next = s.conversations.filter(c => c.id !== id)
      const newActive = s.activeConversationId === id ? null : s.activeConversationId
      return {
        conversations: next,
        activeConversationId: newActive,
        currentMessages: newActive === null ? [] : s.currentMessages,
      }
    })
    toast.success('Conversation deleted')
  },

  retryLastMessage: async () => {
    const { currentMessages, sendMessage } = get()
    const lastUser = [...currentMessages].reverse().find(m => m.role === 'user')
    if (!lastUser) return
    const text = lastUser.blocks.find(b => b.type === 'text')?.content as string ?? ''
    if (text) await sendMessage(text)
  },

  setMode: async (mode: string) => {
    const { activeConversationId } = get()
    set(s => ({
      currentMode: mode,
      conversations: s.conversations.map(c =>
        c.id === activeConversationId ? { ...c, mode: mode as Conversation['mode'] } : c
      ),
    }))
    if (activeConversationId) {
      await window.wos.updateConversation(activeConversationId, { mode })
    }
  },

  setModel: async (model: string) => {
    const { activeConversationId } = get()
    set(s => ({
      currentModel: model,
      conversations: s.conversations.map(c =>
        c.id === activeConversationId ? { ...c, model } : c
      ),
    }))
    if (activeConversationId) {
      await window.wos.updateConversation(activeConversationId, { model })
    }
  },

  setActiveConversationId: (id) => {
    set({ activeConversationId: id })
  },

  setConversationWorkspace: async (convId, workspaceId) => {
    set(s => ({
      conversations: s.conversations.map(c =>
        c.id === convId ? { ...c, workspaceId } : c
      ),
    }))
    await window.wos.updateConversation(convId, { workspaceId })
  },

  renameConversation: async (convId, title) => {
    set(s => ({
      conversations: s.conversations.map(c =>
        c.id === convId ? { ...c, title } : c
      ),
    }))
    await window.wos.updateConversation(convId, { title })
  },

  editMessage: async (messageId, newText) => {
    const { activeConversationId } = get()
    if (!activeConversationId) return

    const r = await window.wos.editMessage(messageId, newText) as {
      success: boolean
      error?: string
      newMessageId?: string
      branchGroupId?: string
      branchIndex?: number
    }
    if (!r.success) { toast.error(`Edit failed: ${r.error}`); return }

    // Reload conversation to get updated messages with branch info
    await get().loadConversation(activeConversationId)

    // Switch to the new branch so it's visible
    if (r.branchGroupId && r.branchIndex !== undefined) {
      set(s => ({ activeBranches: { ...s.activeBranches, [r.branchGroupId!]: r.branchIndex! } }))
    }

    // Trigger agent response from the pre-saved edited user message
    void get().continueConversation()
  },

  switchBranch: (branchGroupId, newIndex) => {
    set(s => ({ activeBranches: { ...s.activeBranches, [branchGroupId]: newIndex } }))
  },
}))

// Expose store to window for debugging (always in dev, gated in prod)
if (typeof window !== 'undefined') {
  (window as unknown as { __wosStore__: typeof useAgentStore }).__wosStore__ = useAgentStore
}
