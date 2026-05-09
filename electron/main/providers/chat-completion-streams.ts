/**
 * Shared OpenAI-compat (tool-capable) and Anthropic chat streaming for model providers.
 * Long default HTTP timeout helps RunPod / HF Space cold starts during demos.
 */

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import type { ModelRequest, StreamEvent } from './types'

const OPENAI_COMPAT_TIMEOUT_MS = Number(process.env.WOS_OPENAI_COMPAT_TIMEOUT_MS ?? 420000)
const ANTHROPIC_TIMEOUT_MS = Number(process.env.WOS_ANTHROPIC_HTTP_TIMEOUT_MS ?? OPENAI_COMPAT_TIMEOUT_MS)

export async function* streamOpenAICompatToolCalls(
  request: ModelRequest,
  baseURL: string,
  apiKey: string,
  modelId: string,
): AsyncGenerator<StreamEvent> {
  const client = new OpenAI({
    baseURL,
    apiKey,
    timeout: OPENAI_COMPAT_TIMEOUT_MS > 0 ? OPENAI_COMPAT_TIMEOUT_MS : undefined,
  })

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

export async function* streamAnthropicToolCalls(
  request: ModelRequest,
  apiKey: string,
  model: string,
): AsyncGenerator<StreamEvent> {
  const client = new Anthropic({
    apiKey,
    timeout: ANTHROPIC_TIMEOUT_MS > 0 ? ANTHROPIC_TIMEOUT_MS : undefined,
  })

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
