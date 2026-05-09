/**
 * Honest last-resort chain after fine-tuned OpenAI-compatible endpoints fail:
 * Claude (Anthropic API) → then GPT-style model (OpenAI API). Not WOS checkpoints.
 */

import type { ModelRequest, StreamEvent } from './types'
import { getDecryptedApiKeyOrNull } from './keystore'
import { streamAnthropicToolCalls, streamOpenAICompatToolCalls } from './chat-completion-streams'

const ANTHROPIC_FALLBACK = process.env.WOS_ANTHROPIC_FALLBACK_MODEL ?? 'claude-haiku-4-5-20251001'
const OPENAI_FALLBACK_MODEL = process.env.WOS_OPENAI_FALLBACK_MODEL ?? 'gpt-4o-mini'
const OPENAI_FALLBACK_URL = 'https://api.openai.com/v1'

export async function* streamHostedLastResort(request: ModelRequest): AsyncGenerator<StreamEvent> {
  const anthropicKey = await getDecryptedApiKeyOrNull('anthropic')
  const openaiKey = await getDecryptedApiKeyOrNull('openai')

  const primaryErr: Error[] = []
  if (anthropicKey) {
    try {
      yield* streamAnthropicToolCalls(request, anthropicKey, ANTHROPIC_FALLBACK)
      return
    } catch (e) {
      primaryErr.push(e instanceof Error ? e : new Error(String(e)))
      console.warn(`[wos:fallback] Anthropic failover failed (${primaryErr.at(-1)?.message}); trying OpenAI if configured.`)
    }
  }

  if (openaiKey) {
    try {
      yield* streamOpenAICompatToolCalls(request, OPENAI_FALLBACK_URL, openaiKey, OPENAI_FALLBACK_MODEL)
      return
    } catch (e) {
      primaryErr.push(e instanceof Error ? e : new Error(String(e)))
    }
  }

  const tail = primaryErr.map(e => e.message).join(' | ')
  throw new Error(
    `Fine-tuned OpenAI-compat endpoint(s) failed and no usable hosted fallback succeeded. Last errors: ${tail}. ` +
      'Add Anthropic and/or OpenAI API keys under Settings.',
  )
}
