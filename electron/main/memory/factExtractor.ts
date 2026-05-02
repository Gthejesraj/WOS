/**
 * Extracts memorable facts from a completed agent turn using a lightweight
 * LLM call. Facts are stored via memoryService for future recall.
 */
import { getProvider } from '../providers'
import { writeMemory } from './memoryService'

const EXTRACT_SYSTEM = `Extract key facts worth remembering from this conversation turn.
Return ONLY a JSON array of strings. Each fact should be concise (under 20 words).
Focus on: user preferences, project names/details, tech stack, decisions made, recurring needs.
Ignore: tool outputs, file contents, ephemeral data, instructions already in system prompt.
Return [] if nothing noteworthy.`

export interface ExtractedFact {
  content: string
  tags: string[]
  importance: 1 | 2 | 3
}

/** Extract and persist facts from a completed turn's text content. */
export async function extractAndStoreFacts(
  userMessage: string,
  assistantResponse: string,
  model: string,
  apiKeyOverride?: string,
): Promise<void> {
  // Skip very short exchanges
  const combined = `${userMessage} ${assistantResponse}`
  if (combined.trim().length < 100) return

  const turnSummary = [
    userMessage.length > 300 ? userMessage.slice(0, 300) + '…' : userMessage,
    assistantResponse.length > 500 ? assistantResponse.slice(0, 500) + '…' : assistantResponse,
  ].join('\n\nAssistant: ')

  try {
    const provider = getProvider(model)
    let raw = ''

    const stream = provider.stream({
      model,
      messages: [{ role: 'user', content: `User: ${turnSummary}` }],
      tools: [],
      systemPrompt: EXTRACT_SYSTEM,
      apiKeyOverride,
      maxTokens: 256,
    } as Parameters<typeof provider.stream>[0])

    for await (const event of stream) {
      if (event.type === 'text_delta') raw += event.content
      if (event.type === 'message_stop') break
    }

    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return

    const facts = JSON.parse(jsonMatch[0]) as unknown[]
    for (const fact of facts) {
      if (typeof fact === 'string' && fact.trim().length > 5) {
        writeMemory(fact.trim(), [], 1, 'auto')
      }
    }
  } catch {
    // Fact extraction is non-fatal — silently skip
  }
}
