import type { ConversationMessage, ContentBlock } from '../providers/types'
import { getProvider } from '../providers'

const KEEP_HEAD_TURNS = 1  // Always keep the first user message (original context)
const KEEP_TAIL_TURNS = 6  // Always keep the most recent N messages

/**
 * PRUNE: Removes tool_result pairs from the middle of the conversation,
 * keeping the first user message and last KEEP_TAIL_TURNS messages.
 * Fast — no LLM call needed.
 */
export function pruneHistory(
  history: ConversationMessage[],
): { pruned: ConversationMessage[]; removedCount: number } {
  if (history.length <= KEEP_HEAD_TURNS + KEEP_TAIL_TURNS) {
    return { pruned: history, removedCount: 0 }
  }

  const head = history.slice(0, KEEP_HEAD_TURNS)
  const tail = history.slice(-KEEP_TAIL_TURNS)
  const middle = history.slice(KEEP_HEAD_TURNS, -KEEP_TAIL_TURNS)

  const prunedMiddle = middle.map(m => {
    if (m.role === 'user' && Array.isArray(m.content)) {
      const blocks = m.content as ContentBlock[]
      const withoutResults = blocks.filter(b => b.type !== 'tool_result')
      if (withoutResults.length === 0) return null
      return { role: m.role, content: withoutResults } satisfies ConversationMessage
    }
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      const blocks = m.content as ContentBlock[]
      const textOnly = blocks.filter(b => b.type === 'text')
      if (textOnly.length === 0) return null
      return { role: m.role, content: textOnly } satisfies ConversationMessage
    }
    return m
  }).filter((m): m is ConversationMessage => m !== null)

  const pruned = [...head, ...prunedMiddle, ...tail]
  return { pruned, removedCount: history.length - pruned.length }
}

/**
 * SUMMARIZE: Asks the LLM to summarize the middle of the conversation,
 * then replaces it with a single summary message. More aggressive but
 * requires an API call.
 */
export async function summarizeHistory(
  history: ConversationMessage[],
  model: string,
  signal: AbortSignal,
  apiKeyOverride?: string,
): Promise<{ summarized: ConversationMessage[]; summary: string }> {
  if (history.length <= KEEP_HEAD_TURNS + KEEP_TAIL_TURNS) {
    return { summarized: history, summary: '' }
  }

  const head = history.slice(0, KEEP_HEAD_TURNS)
  const tail = history.slice(-KEEP_TAIL_TURNS)
  const middle = history.slice(KEEP_HEAD_TURNS, -KEEP_TAIL_TURNS)

  const middleText = middle.map(m => {
    const role = m.role.toUpperCase()
    let text = ''
    if (typeof m.content === 'string') {
      text = m.content
    } else if (Array.isArray(m.content)) {
      text = (m.content as ContentBlock[])
        .filter(b => b.type === 'text')
        .map(b => b.text ?? '')
        .join('\n')
    }
    return `${role}: ${text.slice(0, 500)}`
  }).join('\n\n')

  const summaryPrompt: ConversationMessage[] = [
    {
      role: 'user',
      content: `Summarize the following conversation history in 3-5 sentences, preserving key decisions, facts, and context needed to continue the conversation:\n\n${middleText}`,
    },
  ]

  let summary = ''
  try {
    const provider = getProvider(model)
    const stream = provider.stream({
      model,
      messages: summaryPrompt,
      tools: [],
      systemPrompt: 'You are a helpful assistant that summarizes conversations concisely.',
      apiKeyOverride,
      signal,
    })

    for await (const event of stream) {
      if (event.type === 'text_delta') summary += event.content
      if (event.type === 'message_stop') break
    }
  } catch {
    const { pruned } = pruneHistory(history)
    return { summarized: pruned, summary: '[Summarization failed — conversation pruned]' }
  }

  const summaryMessage: ConversationMessage = {
    role: 'user',
    content: `[Previous conversation summary]: ${summary.trim()}`,
  }

  const summarized = [...head, summaryMessage, ...tail]
  return { summarized, summary: summary.trim() }
}
