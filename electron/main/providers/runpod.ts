/**
 * RunPod Serverless Provider
 *
 * User configures multiple RunPod "accounts", each with:
 *   - One API key (encrypted in apiKeys table as `runpod_<accountId>`)
 *   - One or more endpoints (URL + modelId), stored in settings table under `runpod_config`
 *
 * Each endpoint serves one fine-tuned model. The model ID at the endpoint is
 * fetched via OpenAI-compatible `GET /models`. Model IDs in the WOS app use
 * format `runpod:<endpointId>` to route to the correct URL.
 */

import OpenAI from 'openai'
import { eq } from 'drizzle-orm'
import type { ModelProvider, ModelRequest, StreamEvent, ModelInfo } from './types'
import { getDb, schema } from '../db'
import { encryptApiKey, decryptApiKey } from '../crypto'

export interface RunPodEndpoint {
  id: string         // stable UUID for routing — used as model ID suffix
  url: string        // full OpenAI-compatible base URL e.g. https://api.runpod.ai/v2/<id>/openai/v1
  modelId: string    // HF model ID served by this endpoint, e.g. thejesraj/wos-coding-32b
  label: string      // user-facing display name
  fetchedAt?: number // timestamp when modelId was last verified
}

export interface RunPodAccount {
  id: string
  name: string
  endpoints: RunPodEndpoint[]
}

export interface RunPodConfig {
  accounts: RunPodAccount[]
}

const SETTINGS_KEY = 'runpod_config'

// ── Default config: pre-populated with the WOS team's known endpoints ─────
// User just needs to enter the API keys for each account → models appear.
const DEFAULT_CONFIG: RunPodConfig = {
  accounts: [
    {
      id: 'mixtral',
      name: 'WOS Mixtral 8x7B',
      endpoints: [
        {
          id: 'ep_mixtral_main',
          url: 'https://api.runpod.ai/v2/zj4zvoccvf2h71/openai/v1',
          modelId: 'thejesraj/wos-main-mixtral',
          label: 'WOS Main (Mixtral 8x7B)',
        },
        {
          id: 'ep_mixtral_coding',
          url: 'https://api.runpod.ai/v2/tuudt2uyo64vcb/openai/v1',
          modelId: 'thejesraj/wos-coding-mixtral',
          label: 'WOS Coding (Mixtral 8x7B)',
        },
      ],
    },
    {
      id: 'qwen',
      name: 'WOS Qwen 2.5-32B',
      endpoints: [
        {
          id: 'ep_qwen_main',
          url: 'https://api.runpod.ai/v2/ub6ui35qwzd9xs/openai/v1',
          modelId: 'thejesraj/wos-main-32b',
          label: 'WOS Main (Qwen 2.5-32B)',
        },
        {
          id: 'ep_qwen_meeting',
          url: 'https://api.runpod.ai/v2/g593dspndb13v2/openai/v1',
          modelId: 'thejesraj/wos-meeting-32b',
          label: 'WOS Meeting (Qwen 2.5-32B)',
        },
        {
          id: 'ep_qwen_coding',
          url: 'https://api.runpod.ai/v2/zlqrwvers5t4pr/openai/v1',
          modelId: 'thejesraj/wos-coding-32b',
          label: 'WOS Coding (Qwen 2.5-32B)',
        },
      ],
    },
    {
      id: 'gemma',
      name: 'WOS Gemma 2-27B',
      endpoints: [
        {
          id: 'ep_gemma_main',
          url: 'https://api.runpod.ai/v2/rp2m876p2xqypq/openai/v1',
          modelId: 'thejesraj/wos-main-gemma',
          label: 'WOS Main (Gemma 2-27B)',
        },
        {
          id: 'ep_gemma_meeting',
          url: 'https://api.runpod.ai/v2/3nan6o5sq9m0an/openai/v1',
          modelId: 'thejesraj/wos-meeting-gemma',
          label: 'WOS Meeting (Gemma 2-27B)',
        },
        {
          id: 'ep_gemma_coding',
          url: 'https://api.runpod.ai/v2/87ge1g0xutohre/openai/v1',
          modelId: 'thejesraj/wos-coding-gemma',
          label: 'WOS Coding (Gemma 2-27B)',
        },
      ],
    },
  ],
}

// ── Config storage (settings table) ───────────────────────────────────────

export function getRunPodConfig(): RunPodConfig {
  const db = getDb()
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, SETTINGS_KEY)).get()
  if (!row) return DEFAULT_CONFIG
  try {
    const parsed = typeof row.value === 'string' ? JSON.parse(row.value as string) : row.value
    if (!parsed?.accounts) return DEFAULT_CONFIG
    return parsed as RunPodConfig
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveRunPodConfig(config: RunPodConfig): void {
  const db = getDb()
  db.insert(schema.settings)
    .values({ key: SETTINGS_KEY, value: JSON.stringify(config), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: JSON.stringify(config), updatedAt: new Date() },
    })
    .run()
}

// ── API key storage (apiKeys table, provider = `runpod_<accountId>`) ──────

function keystoreProvider(accountId: string): string {
  return `runpod_${accountId}`
}

export function saveAccountApiKey(accountId: string, apiKey: string): void {
  const db = getDb()
  const { encrypted, iv } = encryptApiKey(apiKey)
  const now = new Date()
  db.insert(schema.apiKeys)
    .values({ provider: keystoreProvider(accountId), encryptedKey: encrypted, iv, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.apiKeys.provider,
      set: { encryptedKey: encrypted, iv, updatedAt: now },
    })
    .run()
}

export function getAccountApiKey(accountId: string): string | null {
  const db = getDb()
  const row = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.provider, keystoreProvider(accountId))).get()
  if (!row) return null
  try {
    return decryptApiKey(row.encryptedKey, row.iv)
  } catch {
    return null
  }
}

export function deleteAccountApiKey(accountId: string): void {
  const db = getDb()
  db.delete(schema.apiKeys).where(eq(schema.apiKeys.provider, keystoreProvider(accountId))).run()
}

export function getAccountKeyPresence(): Record<string, boolean> {
  const config = getRunPodConfig()
  const presence: Record<string, boolean> = {}
  for (const acc of config.accounts) {
    presence[acc.id] = getAccountApiKey(acc.id) !== null
  }
  return presence
}

// ── Endpoint probing ───────────────────────────────────────────────────────

/**
 * Probes a RunPod endpoint URL for the served model ID via GET /models.
 * Returns the first model ID returned by the endpoint.
 */
export async function probeEndpoint(url: string, apiKey: string): Promise<{ ok: true; modelId: string } | { ok: false; error: string }> {
  try {
    const cleanUrl = url.replace(/\/$/, '')
    const response = await fetch(`${cleanUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(180000), // 180s — RunPod cold start can take 1-3min on 27-32B models
    })
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` }
    }
    const data = await response.json() as { data?: Array<{ id: string }> }
    const modelId = data?.data?.[0]?.id
    if (!modelId) {
      return { ok: false, error: 'No model returned from endpoint /models' }
    }
    return { ok: true, modelId }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Convenience: derive a friendly label from a HuggingFace model ID.
 *   thejesraj/wos-coding-32b → WOS Coding (Qwen 2.5-32B)
 *   thejesraj/wos-meeting-mixtral → WOS Meeting (Mixtral 8x7B)
 */
export function deriveLabel(modelId: string): string {
  const lower = modelId.toLowerCase()
  let task = 'Model'
  if (lower.includes('coding')) task = 'Coding'
  else if (lower.includes('meeting')) task = 'Meeting'
  else if (lower.includes('main')) task = 'Main'

  let arch = ''
  if (lower.includes('mixtral')) arch = 'Mixtral 8x7B'
  else if (lower.includes('gemma')) arch = 'Gemma 2-27B'
  else if (lower.includes('32b') || lower.includes('qwen')) arch = 'Qwen 2.5-32B'

  if (lower.startsWith('thejesraj/')) {
    return `WOS ${task}${arch ? ` (${arch})` : ''}`
  }
  return modelId
}

// ── Provider implementation ────────────────────────────────────────────────

export class RunPodProvider implements ModelProvider {
  /**
   * Resolve a `runpod:<endpointId>` model identifier to (account, endpoint).
   */
  private resolveModel(model: string): { account: RunPodAccount; endpoint: RunPodEndpoint } | null {
    const endpointId = model.startsWith('runpod:') ? model.slice('runpod:'.length) : model
    const config = getRunPodConfig()
    for (const account of config.accounts) {
      const endpoint = account.endpoints.find(e => e.id === endpointId)
      if (endpoint) return { account, endpoint }
    }
    return null
  }

  async *stream(request: ModelRequest): AsyncGenerator<StreamEvent> {
    if ((request.signal as AbortSignal)?.aborted) return

    const resolved = this.resolveModel(request.model)
    if (!resolved) {
      throw new Error(
        `RunPod model not found: ${request.model}. ` +
        `Add the endpoint in Settings → RunPod.`
      )
    }
    const { account, endpoint } = resolved

    const apiKey = request.apiKeyOverride ?? getAccountApiKey(account.id)
    if (!apiKey) {
      throw new Error(
        `No RunPod API key for account "${account.name}". ` +
        `Add it in Settings → RunPod.`
      )
    }

    const client = new OpenAI({ baseURL: endpoint.url, apiKey })

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
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>,
      },
    }))

    const toolCallArgs: Record<string, string> = {}
    const toolCallNames: Record<string, string> = {}

    const stream = await client.chat.completions.create({
      model: endpoint.modelId,
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

  /**
   * Returns all configured RunPod endpoints as ModelInfo entries.
   * Endpoints whose account lacks an API key are still listed (UI can flag them).
   */
  async fetchModels(_apiKey?: string): Promise<ModelInfo[]> {
    return getAllRunPodModels()
  }
}

export function getAllRunPodModels(): ModelInfo[] {
  const config = getRunPodConfig()
  const models: ModelInfo[] = []
  for (const account of config.accounts) {
    for (const ep of account.endpoints) {
      models.push({
        id: `runpod:${ep.id}`,
        name: ep.label || deriveLabel(ep.modelId),
        provider: 'runpod',
        description: `${account.name} · ${ep.modelId}`,
      })
    }
  }
  return models
}
