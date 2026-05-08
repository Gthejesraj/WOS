/**
 * Provider for WOS fine-tuned models.
 * Supports three backend types, configurable per model:
 *
 *   runpod    — RunPod Serverless vLLM (OpenAI-compatible, scales to zero)
 *               Env: WOS_VLLM_CODING_URL, WOS_VLLM_MEETING_URL, WOS_VLLM_BASE_URL
 *               Key: stored 'hf' key slot (RunPod API key)
 *
 *   openai    — Standard OpenAI API or any OpenAI-compatible endpoint
 *               Key: stored 'openai' key slot
 *               Fallback model: WOS_OPENAI_FALLBACK_MODEL (default: gpt-4o-mini)
 *
 *   anthropic — Anthropic Claude (fallback when RunPod endpoint is down/deleted)
 *               Key: stored 'anthropic' key slot
 *               Fallback model: WOS_ANTHROPIC_FALLBACK_MODEL (default: claude-haiku-4-5-20251001)
 *
 * Priority: if RunPod returns 410/404/503, automatically falls back to
 * Anthropic (if key present) then OpenAI (if key present).
 *
 * Override backend globally: WOS_VLLM_BACKEND=runpod|openai|anthropic
 */

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import type { ModelProvider, ModelRequest, StreamEvent, ModelInfo } from './types'
import { getDecryptedApiKeyOrNull } from './keystore'

type Backend = 'runpod' | 'openai' | 'anthropic'

const GLOBAL_BACKEND = (process.env.WOS_VLLM_BACKEND as Backend | undefined)

// RunPod endpoints (OpenAI-compatible vLLM)
const EP = {
  CODING_QWEN:    'https://api.runpod.ai/v2/foc9m29xg2itck/openai/v1',
  MEETING_QWEN:   'https://api.runpod.ai/v2/qzln8txmmtq7jg/openai/v1',
  CODING_MIXTRAL: 'https://api.runpod.ai/v2/rh3e55ski95jjq/openai/v1',
  MEETING_MIXTRAL:'https://api.runpod.ai/v2/xer3urhk9sjqep/openai/v1',
  MAIN_MIXTRAL:   'https://api.runpod.ai/v2/ubbkuopyie0qeb/openai/v1',
  CODING_GEMMA:   'https://api.runpod.ai/v2/ifk10j77zi812p/openai/v1',
  MEETING_GEMMA:  'https://api.runpod.ai/v2/n5adqm1zxijylt/openai/v1',
  MAIN_QWEN35:    'https://api.runpod.ai/v2/ub6ui35qwzd9xs/openai/v1',
}

const RUNPOD_ENDPOINTS: Record<string, string> = {
  'wos-coding':          process.env.WOS_VLLM_CODING_URL  ?? EP.CODING_QWEN,
  'wos-meeting':         process.env.WOS_VLLM_MEETING_URL ?? EP.MEETING_QWEN,
  'wos-main':            process.env.WOS_VLLM_BASE_URL    ?? EP.MAIN_MIXTRAL,
  'wos-coding-mixtral':  EP.CODING_MIXTRAL,
  'wos-meeting-mixtral': EP.MEETING_MIXTRAL,
  'wos-main-mixtral':    EP.MAIN_MIXTRAL,
  'wos-coding-gemma':    EP.CODING_GEMMA,
  'wos-meeting-gemma':   EP.MEETING_GEMMA,
  'wos-main-gemma':      EP.MAIN_MIXTRAL,   // routes to Main Mixtral until Main Gemma is deployed
  'wos-main-qwen35':     EP.MAIN_QWEN35,
}

// HuggingFace model IDs passed in the request body to the vLLM server
const HF_MODEL_IDS: Record<string, string> = {
  'wos-coding':          'thejesraj/wos-coding-32b',
  'wos-meeting':         'thejesraj/wos-meeting-32b',
  'wos-main':            'thejesraj/wos-main-mixtral',
  'wos-coding-mixtral':  'thejesraj/wos-coding-mixtral',
  'wos-meeting-mixtral': 'thejesraj/wos-meeting-mixtral',
  'wos-main-mixtral':    'thejesraj/wos-main-mixtral',
  'wos-coding-gemma':    'thejesraj/wos-coding-gemma',
  'wos-meeting-gemma':   'thejesraj/wos-meeting-gemma',
  'wos-main-gemma':      'thejesraj/wos-main-mixtral',  // same endpoint, serves Mixtral for now
  'wos-main-qwen35':     'thejesraj/wos-main-qwen35',
  'qwen-baseline':       'Qwen/Qwen2.5-32B-Instruct',
}

// Fallback models when RunPod is unavailable
const ANTHROPIC_FALLBACK = process.env.WOS_ANTHROPIC_FALLBACK_MODEL ?? 'claude-haiku-4-5-20251001'
const OPENAI_FALLBACK     = process.env.WOS_OPENAI_FALLBACK_MODEL    ?? 'gpt-4o-mini'
const OPENAI_FALLBACK_URL = 'https://api.openai.com/v1'
const TOGETHER_URL        = 'https://api.together.xyz/v1'

export const WOS_FINE_TUNED_MODELS: ModelInfo[] = [
  // Qwen 2.5-32B
  { id: 'wos-coding',          name: 'WOS Coding (Qwen 2.5-32B)',   provider: 'wos' as any },
  { id: 'wos-meeting',         name: 'WOS Meeting (Qwen 2.5-32B)',  provider: 'wos' as any },
  { id: 'wos-main',            name: 'WOS Main (Qwen 2.5-32B)',     provider: 'wos' as any },
  // Mixtral 8x7B
  { id: 'wos-coding-mixtral',  name: 'WOS Coding (Mixtral 8x7B)',   provider: 'wos' as any },
  { id: 'wos-meeting-mixtral', name: 'WOS Meeting (Mixtral 8x7B)',  provider: 'wos' as any },
  { id: 'wos-main-mixtral',    name: 'WOS Main (Mixtral 8x7B)',     provider: 'wos' as any },
  // Gemma 2-27B
  { id: 'wos-coding-gemma',    name: 'WOS Coding (Gemma 2-27B)',    provider: 'wos' as any },
  { id: 'wos-meeting-gemma',   name: 'WOS Meeting (Gemma 2-27B)',   provider: 'wos' as any },
  { id: 'wos-main-gemma',      name: 'WOS Main (Gemma 2-27B)',      provider: 'wos' as any },
  { id: 'wos-main-qwen35',     name: 'WOS Main (Qwen3 5B)',         provider: 'wos' as any },
  // Baseline
  { id: 'qwen-baseline',       name: 'Qwen2.5-32B Instruct (Baseline)', provider: 'wos' as any },
]

// Errors that indicate the endpoint is permanently or temporarily gone.
function isEndpointDown(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  // 410 Gone, 404 Not Found, 503 Service Unavailable
  return msg.includes('410') || msg.includes('404') || msg.includes('503') ||
    msg.includes('not found') || msg.includes('gone') || msg.includes('service unavailable')
}

export class VLLMProvider implements ModelProvider {

  // ── RunPod / OpenAI-compatible streaming ─────────────────────────────────

  private async *streamOpenAICompatible(
    request: ModelRequest,
    baseURL: string,
    apiKey: string,
    modelId: string,
  ): AsyncGenerator<StreamEvent> {
    const client = new OpenAI({ baseURL, apiKey })

    const messages: OpenAI.ChatCompletionMessageParam[] = []
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt })
    }
    messages.push(...request.messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: typeof m.content === 'string'
        ? m.content
        : (m.content as Array<{ type: string; text?: string }>)
            .filter(b => b.type === 'text' && b.text)
            .map(b => b.text!)
            .join('\n'),
    })))

    const tools: OpenAI.ChatCompletionTool[] = request.tools.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema as Record<string, unknown> },
    }))

    const toolCallArgs: Record<string, string> = {}
    const toolCallNames: Record<string, string> = {}

    const stream = await client.chat.completions.create({
      model: modelId,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
      max_tokens: request.maxTokens ?? 4096,
      temperature: 0.7,
      stream_options: { include_usage: true },
    }, { signal: request.signal })

    let inputTokens = 0
    let outputTokens = 0

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (!delta) {
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens
          outputTokens = chunk.usage.completion_tokens
        }
        continue
      }

      if (delta.content) yield { type: 'text_delta', content: delta.content }

      for (const tc of delta.tool_calls ?? []) {
        const id = tc.id ?? String(tc.index)
        if (tc.function?.name) {
          toolCallNames[id] = tc.function.name
          toolCallArgs[id] = ''
          yield { type: 'tool_preparing', id, name: tc.function.name }
        }
        if (tc.function?.arguments) {
          toolCallArgs[id] = (toolCallArgs[id] ?? '') + tc.function.arguments
          yield { type: 'tool_arg_delta', id, delta: tc.function.arguments }
        }
      }

      const finishReason = chunk.choices[0]?.finish_reason
      if (finishReason === 'tool_calls') {
        for (const [id, args] of Object.entries(toolCallArgs)) {
          let parsedInput: unknown = {}
          try { parsedInput = JSON.parse(args) } catch { parsedInput = {} }
          yield { type: 'tool_use_start', id, name: toolCallNames[id] ?? 'unknown', input: parsedInput }
        }
      }
    }

    const hasToolCalls = Object.keys(toolCallNames).length > 0
    yield {
      type: 'message_stop',
      stopReason: hasToolCalls ? 'tool_use' : 'end_turn',
      usage: { inputTokens, outputTokens },
    }
  }

  // ── Anthropic streaming ───────────────────────────────────────────────────

  private async *streamAnthropic(
    request: ModelRequest,
    apiKey: string,
    model: string,
  ): AsyncGenerator<StreamEvent> {
    const client = new Anthropic({ apiKey })

    const messages: Anthropic.MessageParam[] = request.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : m.content as Anthropic.ContentBlockParam[],
    }))

    const tools: Anthropic.Tool[] = request.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }))

    const toolAccumulators = new Map<number, string>()
    const toolInfo = new Map<number, { id: string; name: string }>()
    let inputTokens = 0
    let outputTokens = 0

    const stream = client.messages.stream({
      model,
      system: request.systemPrompt || undefined,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      max_tokens: request.maxTokens ?? 4096,
    }, { signal: request.signal })

    for await (const event of stream) {
      switch (event.type) {
        case 'message_start':
          inputTokens = event.message.usage.input_tokens
          break
        case 'content_block_start':
          if (event.content_block.type === 'tool_use') {
            toolInfo.set(event.index, { id: event.content_block.id, name: event.content_block.name })
            toolAccumulators.set(event.index, '')
            yield { type: 'tool_preparing', id: event.content_block.id, name: event.content_block.name }
          }
          break
        case 'content_block_delta':
          if (event.delta.type === 'text_delta') {
            yield { type: 'text_delta', content: event.delta.text }
          } else if (event.delta.type === 'input_json_delta') {
            const cur = toolAccumulators.get(event.index) ?? ''
            toolAccumulators.set(event.index, cur + event.delta.partial_json)
            const info = toolInfo.get(event.index)
            if (info) yield { type: 'tool_arg_delta', id: info.id, delta: event.delta.partial_json }
          }
          break
        case 'content_block_stop': {
          const info = toolInfo.get(event.index)
          if (info) {
            const jsonStr = toolAccumulators.get(event.index) ?? '{}'
            let parsedInput: unknown = {}
            try { parsedInput = JSON.parse(jsonStr) } catch { parsedInput = {} }
            yield { type: 'tool_use_start', id: info.id, name: info.name, input: parsedInput }
          }
          break
        }
        case 'message_delta':
          if (typeof event.usage?.output_tokens === 'number') outputTokens = event.usage.output_tokens
          if (event.delta?.stop_reason) {
            yield {
              type: 'message_stop',
              stopReason: event.delta.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
              usage: { inputTokens, outputTokens },
            }
          }
          break
      }
    }
  }

  // ── Main stream dispatcher ────────────────────────────────────────────────

  async *stream(request: ModelRequest): AsyncGenerator<StreamEvent> {
    if ((request.signal as AbortSignal)?.aborted) return

    const modelKey = request.model

    // qwen-baseline always routes to Together AI (OpenAI-compatible)
    if (modelKey === 'qwen-baseline') {
      const apiKey = (await getDecryptedApiKeyOrNull('together')) ?? 'EMPTY'
      yield* this.streamOpenAICompatible(request, TOGETHER_URL, apiKey, HF_MODEL_IDS['qwen-baseline'])
      return
    }

    const backend: Backend = GLOBAL_BACKEND ?? 'runpod'

    if (backend === 'anthropic') {
      yield* this.tryAnthropic(request)
      return
    }

    if (backend === 'openai') {
      yield* this.tryOpenAI(request)
      return
    }

    // RunPod first, then auto-fallback on 410/404/503
    try {
      const runpodKey = (await getDecryptedApiKeyOrNull('runpod' as any))
        ?? (await getDecryptedApiKeyOrNull('hf'))
        ?? 'EMPTY'
      const endpoint = RUNPOD_ENDPOINTS[modelKey] ?? RUNPOD_ENDPOINTS['wos-coding']
      const modelId  = HF_MODEL_IDS[modelKey] ?? modelKey
      yield* this.streamOpenAICompatible(request, endpoint, runpodKey, modelId)
    } catch (err) {
      if ((request.signal as AbortSignal)?.aborted) return
      if (!isEndpointDown(err)) throw err

      // RunPod is down — try Anthropic, then OpenAI
      const anthropicKey = await getDecryptedApiKeyOrNull('anthropic')
      if (anthropicKey) {
        yield* this.streamAnthropic(request, anthropicKey, ANTHROPIC_FALLBACK)
        return
      }

      const openaiKey = await getDecryptedApiKeyOrNull('openai')
      if (openaiKey) {
        yield* this.streamOpenAICompatible(request, OPENAI_FALLBACK_URL, openaiKey, OPENAI_FALLBACK)
        return
      }

      throw new Error(
        `WOS endpoint unavailable (${(err as Error).message}). ` +
        'Add an Anthropic or OpenAI API key in Settings to enable automatic fallback.'
      )
    }
  }

  private async *tryAnthropic(request: ModelRequest): AsyncGenerator<StreamEvent> {
    const key = (await getDecryptedApiKeyOrNull('anthropic')) ?? request.apiKeyOverride
    if (!key) throw new Error('No Anthropic API key configured. Add one in Settings → API Keys.')
    yield* this.streamAnthropic(request, key, ANTHROPIC_FALLBACK)
  }

  private async *tryOpenAI(request: ModelRequest): AsyncGenerator<StreamEvent> {
    const key = await getDecryptedApiKeyOrNull('openai')
    if (!key) throw new Error('No OpenAI API key configured. Add one in Settings → API Keys.')
    yield* this.streamOpenAICompatible(request, OPENAI_FALLBACK_URL, key, OPENAI_FALLBACK)
  }

  async fetchModels(): Promise<ModelInfo[]> {
    return WOS_FINE_TUNED_MODELS
  }
}
