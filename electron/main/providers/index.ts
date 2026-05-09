import { OpenAIProvider } from './openai'
import { AnthropicProvider } from './anthropic'
import { VLLMProvider, WOS_FINE_TUNED_MODELS } from './vllm'
import { RunPodProvider, getAllRunPodModels } from './runpod'
import type { ModelProvider, ModelInfo } from './types'
import { enrichModel } from './capabilities'

const providers: Record<string, ModelProvider> = {
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
  wos: new VLLMProvider(),
  runpod: new RunPodProvider(),
}

export function getProvider(model: string): ModelProvider {
  return providers[getProviderNameForModel(model)]
}

export function getProviderNameForModel(model: string): 'openai' | 'anthropic' | 'wos' | 'runpod' {
  if (model.startsWith('runpod:')) return 'runpod'
  if (model.startsWith('claude')) return 'anthropic'
  if (model.startsWith('wos-')) return 'wos'
  if (model.startsWith('qwen-')) return 'wos'
  if (
    model.startsWith('gpt-') ||
    model.startsWith('o1') ||
    model.startsWith('o2') ||
    model.startsWith('o3') ||
    model.startsWith('o4') ||
    model.startsWith('chatgpt')
  ) return 'openai'
  // Default to OpenAI for unknown
  return 'openai'
}

export function getProviderByName(name: 'openai' | 'anthropic' | 'wos' | 'runpod'): ModelProvider {
  return providers[name]
}

export const FALLBACK_MODELS: ModelInfo[] = ([
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', provider: 'anthropic' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai' },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', provider: 'openai' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
  { id: 'o3', name: 'o3', provider: 'openai' },
  { id: 'o4-mini', name: 'o4-mini', provider: 'openai' },
  // WOS fine-tuned models (served via vLLM or HF Inference Endpoints)
  ...WOS_FINE_TUNED_MODELS,
] as ModelInfo[]).map(enrichModel)

/**
 * RunPod models live in the user's saved config (settings DB). The UI
 * should fetch them separately via `runpod:get-models` so the list reflects
 * any account/endpoint changes the user has made.
 */
export function getRunPodFallbackModels(): ModelInfo[] {
  return getAllRunPodModels().map(enrichModel)
}

export { providers }
export type { ModelProvider, ModelInfo }
