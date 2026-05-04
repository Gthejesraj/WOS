/**
 * Provider for locally-hosted / HuggingFace-hosted fine-tuned WOS models.
 * Uses the standard OpenAI Chat Completions API (/v1/chat/completions)
 * which is supported by vLLM, Ollama, HF Inference Endpoints, and llama.cpp server.
 *
 * Environment variables (set in WOS settings or .env):
 *   WOS_VLLM_CODING_URL  — HF Inference Endpoint URL for wos-coding
 *   WOS_VLLM_MEETING_URL — HF Inference Endpoint URL for wos-meeting
 *   WOS_VLLM_BASE_URL    — fallback URL for wos-main or any unspecified model
 *   WOS_VLLM_API_KEY     — "EMPTY" for local vLLM, HF token for Inference Endpoints
 */

import OpenAI from 'openai'
import type { ModelProvider, ModelRequest, StreamEvent, ModelInfo } from './types'
import { getDecryptedApiKeyOrNull } from './keystore'

const DEFAULT_API_KEY = process.env.WOS_VLLM_API_KEY ?? process.env.HF_TOKEN ?? 'EMPTY'

// Per-model endpoint URLs — each HF Inference Endpoint serves one model
const MODEL_ENDPOINTS: Record<string, string> = {
  'wos-coding':     process.env.WOS_VLLM_CODING_URL  ?? 'https://p03k6q2lfue3u1d3.us-east-2.aws.endpoints.huggingface.cloud/v1',
  'wos-meeting':    process.env.WOS_VLLM_MEETING_URL ?? 'https://qbef9esuybzn0coj.us-east-2.aws.endpoints.huggingface.cloud/v1',
  'wos-main':       process.env.WOS_VLLM_BASE_URL    ?? '',
  'qwen-baseline':  'https://api.together.xyz/v1',
}

const HF_MODEL_IDS: Record<string, string> = {
  'wos-coding':     'thejesraj/wos-coding-32b',
  'wos-meeting':    'thejesraj/wos-meeting-32b',
  'wos-main':       'thejesraj/wos-main-32b',
  'qwen-baseline':  'Qwen/Qwen2.5-32B-Instruct',
}

function getEndpointForModel(modelId: string): string {
  return MODEL_ENDPOINTS[modelId] || process.env.WOS_VLLM_BASE_URL || MODEL_ENDPOINTS['wos-coding']
}

function getHFModelId(modelId: string): string {
  return HF_MODEL_IDS[modelId] ?? modelId
}

export const WOS_FINE_TUNED_MODELS: ModelInfo[] = [
  { id: 'qwen-baseline', name: 'Qwen2.5-32B-Instruct (Baseline)', provider: 'wos' as any },
  { id: 'wos-main',      name: 'WOS Main (fine-tuned)',            provider: 'wos' as any },
  { id: 'wos-meeting',   name: 'WOS Meeting (fine-tuned)',         provider: 'wos' as any },
  { id: 'wos-coding',    name: 'WOS Coding (fine-tuned)',          provider: 'wos' as any },
]

export class VLLMProvider implements ModelProvider {
  private fallbackApiKey: string

  constructor(_baseURL?: string, apiKey?: string) {
    this.fallbackApiKey = apiKey ?? DEFAULT_API_KEY
  }

  private async resolveApiKey(modelId: string): Promise<string> {
    if (modelId === 'qwen-baseline') {
      return (await getDecryptedApiKeyOrNull('together')) ?? this.fallbackApiKey
    }
    return (await getDecryptedApiKeyOrNull('hf')) ?? this.fallbackApiKey
  }

  private getClientWithKey(modelId: string, apiKey: string) {
    return new OpenAI({ baseURL: getEndpointForModel(modelId), apiKey })
  }

  // kept for fetchModels backward compat
  private getClient(modelId?: string) {
    return new OpenAI({ baseURL: getEndpointForModel(modelId ?? 'wos-coding'), apiKey: this.fallbackApiKey })
  }

  private formatMessages(messages: ModelRequest['messages']) {
    return messages.map(m => {
      if (typeof m.content === 'string') {
        return { role: m.role as 'user' | 'assistant' | 'system', content: m.content }
      }
      // Flatten block content to plain text for local models
      const blocks = m.content as Array<{ type: string; text?: string }>
      const text = blocks
        .filter(b => b.type === 'text' && b.text)
        .map(b => b.text!)
        .join('\n')
      return { role: m.role as 'user' | 'assistant' | 'system', content: text }
    })
  }

  private formatTools(tools: ModelRequest['tools']): OpenAI.ChatCompletionTool[] {
    return tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>,
      },
    }))
  }

  async *stream(request: ModelRequest): AsyncGenerator<StreamEvent> {
    const apiKey = await this.resolveApiKey(request.model)
    const client = this.getClientWithKey(request.model, apiKey)

    const messages: OpenAI.ChatCompletionMessageParam[] = []
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt })
    }
    messages.push(...this.formatMessages(request.messages))

    const modelId = getHFModelId(request.model)

    const toolCallArgs: Record<string, string> = {}
    const toolCallNames: Record<string, string> = {}
    let inputTokens = 0
    let outputTokens = 0

    try {
      const stream = await client.chat.completions.create({
        model: modelId,
        messages,
        tools: request.tools.length > 0 ? this.formatTools(request.tools) : undefined,
        stream: true,
        max_tokens: request.maxTokens ?? 4096,
        temperature: 0.7,
        stream_options: { include_usage: true },
      }, { signal: request.signal })

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta
        if (!delta) {
          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens
            outputTokens = chunk.usage.completion_tokens
          }
          continue
        }

        if (delta.content) {
          yield { type: 'text_delta', content: delta.content }
        }

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
            yield {
              type: 'tool_use_start',
              id,
              name: toolCallNames[id] ?? 'unknown',
              input: parsedInput,
            }
          }
        }
      }

      const hasToolCalls = Object.keys(toolCallNames).length > 0
      yield {
        type: 'message_stop',
        stopReason: hasToolCalls ? 'tool_use' : 'end_turn',
        usage: { inputTokens, outputTokens },
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
      throw err
    }
  }

  async fetchModels(): Promise<ModelInfo[]> {
    try {
      const client = this.getClient()
      const models = await client.models.list()
      return models.data.map(m => ({
        id: m.id,
        name: m.id,
        provider: 'wos' as any,
      }))
    } catch {
      return WOS_FINE_TUNED_MODELS
    }
  }
}
