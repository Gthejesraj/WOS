/**
 * Provider for WOS fine-tuned models.
 *
 * Primary path is an OpenAI-compatible URL (typically RunPod) that serves the HF
 * model IDs in HF_MODEL_IDS (e.g. thejesraj/wos-coding-32b).
 *
 * Optional same-model mirrors — when the primary fails (HTTP 410/404/503/502/504,
 * timeouts, obvious network errors), WOS retries **the same modelId** against a
 * second OpenAI-compatible base if you configure it (e.g. Hugging Face Space,
 * RunPod standby, LAN vLLM). This keeps behavior honest: logs show when a mirror
 * is used (`console.warn`); there is no “fake fine-tuned” path.
 *
 * Env (mirror / failover, optional):
 *   Per-slot: WOS_VLLM_CODING_MIRROR_URL, … (see OPENAI_COMPAT_MIRRORS below)
 *   Global (used when per-slot unset): WOS_VLLM_GLOBAL_MIRROR_URL — same OpenAI /v1 root for all wos-* tries
 * Primary URLs still use: WOS_VLLM_CODING_URL, WOS_VLLM_MEETING_URL, WOS_VLLM_BASE_URL
 *
 * API key order for primary + mirrors: prefers stored `hf` token, then RunPod (`runpod` / legacy `hf` slot).
 *
 * Further chain (different models — only after mirrors exhausted or absent):
 *   Anthropic (WOS_ANTHROPIC_FALLBACK_MODEL) → OpenAI (WOS_OPENAI_FALLBACK_MODEL)
 *
 * Override backend globally: WOS_VLLM_BACKEND=runpod|openai|anthropic
 */

import OpenAI from 'openai'
import { setTimeout as sleep } from 'node:timers/promises'
import type { ModelProvider, ModelRequest, StreamEvent, ModelInfo } from './types'
import { getDecryptedApiKeyOrNull } from './keystore'
import {
  streamAnthropicToolCalls,
  streamOpenAICompatToolCalls,
} from './chat-completion-streams'
import { streamHostedLastResort } from './hosted-fallback'

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

/** Optional OpenAI-compatible bases that serve the **same** HF_MODEL_IDS payload (second try only). */
const OPENAI_COMPAT_MIRRORS: Partial<Record<string, string>> = {
  'wos-coding':          process.env.WOS_VLLM_CODING_MIRROR_URL,
  'wos-meeting':         process.env.WOS_VLLM_MEETING_MIRROR_URL,
  'wos-main':            process.env.WOS_VLLM_BASE_MIRROR_URL,
  'wos-coding-mixtral':  process.env.WOS_VLLM_CODING_MIXTRAL_MIRROR_URL,
  'wos-meeting-mixtral': process.env.WOS_VLLM_MEETING_MIXTRAL_MIRROR_URL,
  'wos-main-mixtral':    process.env.WOS_VLLM_MAIN_MIXTRAL_MIRROR_URL,
  'wos-coding-gemma':    process.env.WOS_VLLM_CODING_GEMMA_MIRROR_URL,
  'wos-meeting-gemma':   process.env.WOS_VLLM_MEETING_GEMMA_MIRROR_URL,
  'wos-main-gemma':      process.env.WOS_VLLM_MAIN_GEMMA_MIRROR_URL,
  'wos-main-qwen35':     process.env.WOS_VLLM_MAIN_QWEN35_MIRROR_URL,
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

/** Extra same-key attempts after 502/503 (serverless cold boot). Env 0 disables. */
const PRIMARY_COLD_RETRY_MS = Number(process.env.WOS_PRIMARY_COLD_RETRY_MS ?? 4500)
const PRIMARY_COLD_RETRY_EXTRA = Math.max(0, Math.min(4, Number(process.env.WOS_PRIMARY_COLD_RETRY_COUNT ?? 1)))

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

function openAIHttpStatus(err: unknown): number | undefined {
  if (err instanceof OpenAI.APIError && typeof err.status === 'number') return err.status
  return undefined
}

// Errors that indicate the endpoint is permanently or temporarily gone / overloaded.
function isEndpointDown(err: unknown): boolean {
  const s = openAIHttpStatus(err)
  if (s === 404 || s === 410 || s === 503) return true
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return msg.includes('410') || msg.includes('404') || msg.includes('503') ||
    msg.includes('not found') || msg.includes('gone') || msg.includes('service unavailable')
}

/** Primary failed in a way that may succeed on another host with the same model id — skip auth/wrong-key paths. */
function shouldAttemptSameModelMirror(err: unknown): boolean {
  const s = openAIHttpStatus(err)
  if (s === 401 || s === 403) return false
  if (s === 408 || s === 429) return true
  if (typeof s === 'number' && s >= 500 && s <= 599) return true
  if (isEndpointDown(err)) return true
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return (
    msg.includes('500') || msg.includes('502') || msg.includes('504') ||
    msg.includes('520') || msg.includes('524') ||
    msg.includes('timeout') || msg.includes('timed out') ||
    msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('etimedout') ||
    msg.includes('fetch failed') || msg.includes('network error') ||
    msg.includes('rate limit') || msg.includes('overload') ||
    msg.includes('service unavailable') || msg.includes('bad gateway')
  )
}

/** True when outages / transport issues warrant Hosted (Claude/GPT) last resort — excludes auth. */
export function shouldAttemptHostedFallback(err: unknown): boolean {
  const s = openAIHttpStatus(err)
  if (s === 401 || s === 403) return false
  return shouldAttemptSameModelMirror(err) || isEndpointDown(err)
}

function mirrorUrlFor(modelKey: string): string | undefined {
  const per = OPENAI_COMPAT_MIRRORS[modelKey]?.trim()
  if (per) return per
  return process.env.WOS_VLLM_GLOBAL_MIRROR_URL?.trim()
}

function isColdStartHttp(err: unknown): boolean {
  const s = openAIHttpStatus(err)
  return s === 502 || s === 503
}

/**
 * Tries each API key with optional 502/503 cold-boot delays, then rotates keys on failure.
 */
export async function* streamOpenAICompatWithColdKeys(
  request: ModelRequest,
  baseURL: string,
  keysToTry: string[],
  modelId: string,
): AsyncGenerator<StreamEvent> {
  const delayMs = PRIMARY_COLD_RETRY_MS
  const maxExtra = PRIMARY_COLD_RETRY_EXTRA

  for (let ki = 0; ki < keysToTry.length; ki++) {
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          yield* streamOpenAICompatToolCalls(request, baseURL, keysToTry[ki], modelId)
          return
        } catch (e) {
          if ((request.signal as AbortSignal)?.aborted) return
          if (
            attempt < maxExtra &&
            delayMs > 0 &&
            isColdStartHttp(e)
          ) {
            await sleep(delayMs)
            continue
          }
          throw e
        }
      }
    } catch (e) {
      if ((request.signal as AbortSignal)?.aborted) return
      if (ki < keysToTry.length - 1) {
        console.warn(
          `[wos:vllm] OpenAI-compat call failed (${e instanceof Error ? e.message : String(e)}); trying next stored key.`,
        )
        continue
      }
      throw e
    }
  }
}

export class VLLMProvider implements ModelProvider {

  // ── Main stream dispatcher ────────────────────────────────────────────────

  async *stream(request: ModelRequest): AsyncGenerator<StreamEvent> {
    if ((request.signal as AbortSignal)?.aborted) return

    const modelKey = request.model

    // qwen-baseline routes to Together AI; on outage, same hosted last-resort chain as WOS models.
    if (modelKey === 'qwen-baseline') {
      const apiKey = (await getDecryptedApiKeyOrNull('together')) ?? 'EMPTY'
      try {
        yield* streamOpenAICompatToolCalls(request, TOGETHER_URL, apiKey, HF_MODEL_IDS['qwen-baseline'])
        return
      } catch (err) {
        if ((request.signal as AbortSignal)?.aborted) return
        if (shouldAttemptHostedFallback(err)) {
          yield* streamHostedLastResort(request)
          return
        }
        throw err
      }
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

    const modelId = HF_MODEL_IDS[modelKey] ?? modelKey
    const primaryEndpoint = RUNPOD_ENDPOINTS[modelKey] ?? RUNPOD_ENDPOINTS['wos-coding']
    const mirrorEndpoint = mirrorUrlFor(modelKey)

    const hfKey = await getDecryptedApiKeyOrNull('hf')
    const rpKey = await getDecryptedApiKeyOrNull('runpod' as any)
    const keyOrder = [...new Set([hfKey, rpKey].filter(Boolean))] as string[]
    const keysToTry = keyOrder.length ? keyOrder : ['EMPTY']

    let err: unknown
    try {
      yield* streamOpenAICompatWithColdKeys(request, primaryEndpoint, keysToTry, modelId)
      return
    } catch (e) {
      err = e
    }

    // Same HF model ID on mirror / global mirror URL
    if (mirrorEndpoint && shouldAttemptSameModelMirror(err)) {
      console.warn(
        `[wos:vllm] Primary failed (${err instanceof Error ? err.message : String(err)}); ` +
          `retrying model ${modelId} on mirror URL.`,
      )
      try {
        yield* streamOpenAICompatWithColdKeys(request, mirrorEndpoint, keysToTry, modelId)
        return
      } catch (eM) {
        err = eM
        console.warn(
          `[wos:vllm] Mirror failed (${err instanceof Error ? err.message : String(err)}); using hosted fallback if configured.`,
        )
      }
    }

    if (!shouldAttemptHostedFallback(err)) throw err

    yield* streamHostedLastResort(request)
  }

  private async *tryAnthropic(request: ModelRequest): AsyncGenerator<StreamEvent> {
    const key = (await getDecryptedApiKeyOrNull('anthropic')) ?? request.apiKeyOverride
    if (!key) throw new Error('No Anthropic API key configured. Add one in Settings → API Keys.')
    yield* streamAnthropicToolCalls(request, key, ANTHROPIC_FALLBACK)
  }

  private async *tryOpenAI(request: ModelRequest): AsyncGenerator<StreamEvent> {
    const key = await getDecryptedApiKeyOrNull('openai')
    if (!key) throw new Error('No OpenAI API key configured. Add one in Settings → API Keys.')
    yield* streamOpenAICompatToolCalls(request, OPENAI_FALLBACK_URL, key, OPENAI_FALLBACK)
  }

  async fetchModels(): Promise<ModelInfo[]> {
    return WOS_FINE_TUNED_MODELS
  }
}
