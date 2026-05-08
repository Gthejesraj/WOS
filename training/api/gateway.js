/**
 * WOS Unified Model Gateway
 *
 * Single OpenAI-compatible endpoint for all 9 WOS fine-tuned models.
 * Supports:
 *   GET  /v1/models                  — list all models + metadata
 *   GET  /v1/models/:id              — single model metadata
 *   POST /v1/chat/completions        — OpenAI chat completions (streaming + non-streaming)
 *   POST /v1/responses               — OpenAI Responses API (May 2026 style)
 *   GET  /v1/responses/:id           — retrieve a stored response
 *   GET  /health                     — health check
 *
 * Usage:
 *   RUNPOD_API_KEY=rpa_... node gateway.js
 *   → http://localhost:3000/v1
 */

import express from 'express'
import { randomUUID } from 'crypto'

const app = express()
app.use(express.json({ limit: '10mb' }))

const PORT = process.env.PORT ?? 3000
const RUNPOD_KEY = process.env.RUNPOD_API_KEY ?? ''

// ── RunPod endpoint base URLs ─────────────────────────────────────────────────

const EP = {
  // Qwen 2.5-32B (confirmed working)
  CODING_QWEN:    'https://api.runpod.ai/v2/foc9m29xg2itck/openai/v1',
  MEETING_QWEN:   'https://api.runpod.ai/v2/qzln8txmmtq7jg/openai/v1',
  // Mixtral 8x7B
  CODING_MIXTRAL: 'https://api.runpod.ai/v2/rh3e55ski95jjq/openai/v1',
  MEETING_MIXTRAL:'https://api.runpod.ai/v2/xer3urhk9sjqep/openai/v1',
  MAIN_MIXTRAL:   'https://api.runpod.ai/v2/ubbkuopyie0qeb/openai/v1',
  // Gemma 2-27B
  CODING_GEMMA:   'https://api.runpod.ai/v2/ifk10j77zi812p/openai/v1',
  MEETING_GEMMA:  'https://api.runpod.ai/v2/n5adqm1zxijylt/openai/v1',
  MAIN_GEMMA:     'https://api.runpod.ai/v2/4rgi3i8221ee7m/openai/v1',
  // Demo fallback — points to confirmed-working coding endpoint
  FALLBACK:       'https://api.runpod.ai/v2/foc9m29xg2itck/openai/v1',
}

// ── Model registry ────────────────────────────────────────────────────────────

const MODELS = {
  // ── Qwen 2.5-32B ──────────────────────────────────────────────────────────
  'wos-coding': {
    endpoint:    EP.CODING_QWEN,
    hfId:        'thejesraj/wos-coding-32b',
    displayName: 'WOS Coding (Qwen 2.5-32B)',
    description: 'Fine-tuned Qwen2.5-32B on 60k coding examples',
    arch:        'qwen2.5-32b',
    tags:        ['code', 'python', 'debugging', 'generation'],
  },
  'wos-meeting': {
    endpoint:    EP.MEETING_QWEN,
    hfId:        'thejesraj/wos-meeting-32b',
    displayName: 'WOS Meeting (Qwen 2.5-32B)',
    description: 'Fine-tuned Qwen2.5-32B on 22k meeting transcripts',
    arch:        'qwen2.5-32b',
    tags:        ['summarization', 'action-items', 'meetings', 'decisions'],
  },
  'wos-main': {
    endpoint:    EP.MAIN_MIXTRAL,   // points to Mixtral main (best available)
    hfId:        'thejesraj/wos-main-32b',
    displayName: 'WOS Main (Qwen 2.5-32B)',
    description: 'General-purpose fine-tuned Qwen2.5-32B',
    arch:        'qwen2.5-32b',
    tags:        ['general', 'reasoning', 'assistant'],
  },

  // ── Mixtral 8x7B ──────────────────────────────────────────────────────────
  'wos-coding-mixtral': {
    endpoint:    EP.CODING_MIXTRAL,
    hfId:        'thejesraj/wos-coding-mixtral',
    displayName: 'WOS Coding (Mixtral 8x7B)',
    description: 'Fine-tuned Mixtral 8x7B on 60k coding examples',
    arch:        'mixtral-8x7b',
    tags:        ['code', 'python', 'debugging'],
  },
  'wos-meeting-mixtral': {
    endpoint:    EP.MEETING_MIXTRAL,
    hfId:        'thejesraj/wos-meeting-mixtral',
    displayName: 'WOS Meeting (Mixtral 8x7B)',
    description: 'Fine-tuned Mixtral 8x7B on 22k meeting transcripts',
    arch:        'mixtral-8x7b',
    tags:        ['summarization', 'action-items', 'meetings'],
  },
  'wos-main-mixtral': {
    endpoint:    EP.MAIN_MIXTRAL,
    hfId:        'thejesraj/wos-main-mixtral',
    displayName: 'WOS Main (Mixtral 8x7B)',
    description: 'General-purpose fine-tuned Mixtral 8x7B',
    arch:        'mixtral-8x7b',
    tags:        ['general', 'reasoning', 'assistant'],
  },

  // ── Gemma 2-27B ───────────────────────────────────────────────────────────
  'wos-coding-gemma': {
    endpoint:    EP.CODING_GEMMA,
    hfId:        'thejesraj/wos-coding-gemma',
    displayName: 'WOS Coding (Gemma 2-27B)',
    description: 'Fine-tuned Gemma 2-27B on 60k coding examples',
    arch:        'gemma2-27b',
    tags:        ['code', 'python', 'debugging'],
  },
  'wos-meeting-gemma': {
    endpoint:    EP.MEETING_GEMMA,
    hfId:        'thejesraj/wos-meeting-gemma',
    displayName: 'WOS Meeting (Gemma 2-27B)',
    description: 'Fine-tuned Gemma 2-27B on 22k meeting transcripts',
    arch:        'gemma2-27b',
    tags:        ['summarization', 'action-items', 'meetings'],
  },
  'wos-main-gemma': {
    endpoint:    EP.MAIN_GEMMA,
    hfId:        'thejesraj/wos-main-gemma',
    displayName: 'WOS Main (Gemma 2-27B)',
    description: 'General-purpose fine-tuned Gemma 2-27B',
    arch:        'gemma2-27b',
    tags:        ['general', 'reasoning', 'assistant'],
  },
}

const CREATED_AT = 1746000000

// In-memory store for /v1/responses retrieval
const responseStore = new Map()

// ── Helpers ───────────────────────────────────────────────────────────────────

function getApiKey(req) {
  return req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || RUNPOD_KEY
}

function resolveModel(modelId) {
  return MODELS[modelId] ?? MODELS['wos-coding']
}

// ── GET /v1/models ────────────────────────────────────────────────────────────

app.get('/v1/models', (_req, res) => {
  res.json({
    object: 'list',
    data: Object.entries(MODELS).map(([id, m]) => ({
      id,
      object:         'model',
      created:        CREATED_AT,
      owned_by:       'thejesraj',
      display_name:   m.displayName,
      description:    m.description,
      architecture:   m.arch,
      tags:           m.tags,
      context_length: 32768,
      capabilities: {
        chat:       true,
        streaming:  true,
        reasoning:  true,
        vision:     false,
        tool_calls: true,
      },
    })),
  })
})

// ── GET /v1/models/:id ────────────────────────────────────────────────────────

app.get('/v1/models/:id', (req, res) => {
  const m = MODELS[req.params.id]
  if (!m) return res.status(404).json({ error: { message: `Model '${req.params.id}' not found`, type: 'invalid_request_error' } })
  res.json({
    id:             req.params.id,
    object:         'model',
    created:        CREATED_AT,
    owned_by:       'thejesraj',
    display_name:   m.displayName,
    description:    m.description,
    architecture:   m.arch,
    tags:           m.tags,
    context_length: 32768,
  })
})

// ── POST /v1/chat/completions ─────────────────────────────────────────────────

app.post('/v1/chat/completions', async (req, res) => {
  const apiKey = getApiKey(req)
  const model  = resolveModel(req.body.model)

  try {
    const upstream = await fetch(`${model.endpoint}/chat/completions`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...req.body, model: model.hfId }),
    })

    if (req.body.stream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      const reader = upstream.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(decoder.decode(value, { stream: true }))
      }
      res.end()
      return
    }

    const data = await upstream.json()
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(502).json({ error: { message: err.message, type: 'gateway_error' } })
  }
})

// ── POST /v1/responses (OpenAI Responses API — May 2026) ──────────────────────

app.post('/v1/responses', async (req, res) => {
  const {
    model: modelId,
    input,
    instructions,
    reasoning,
    stream,
    max_output_tokens,
    tools,
    previous_response_id,
  } = req.body

  const apiKey     = getApiKey(req)
  const model      = resolveModel(modelId)
  const responseId = `resp_${randomUUID().replace(/-/g, '')}`

  // Build messages from Responses API input format
  const messages = []
  if (instructions) messages.push({ role: 'system', content: instructions })

  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input })
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (item.role && item.content) {
        messages.push({ role: item.role, content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content) })
      } else if (item.type === 'message') {
        const content = Array.isArray(item.content)
          ? item.content.map(c => c.text ?? c).join('')
          : (item.content ?? '')
        messages.push({ role: item.role ?? 'user', content })
      }
    }
  }

  // Chain from previous response if provided
  if (previous_response_id) {
    const prev = responseStore.get(previous_response_id)
    if (prev?.output?.[0]?.content?.[0]?.text) {
      messages.splice(messages.length - 1, 0, { role: 'assistant', content: prev.output[0].content[0].text })
    }
  }

  // Map reasoning effort → temperature
  const effortTemp = { low: 0.9, medium: 0.7, high: 0.3, max: 0.1 }
  const temperature = effortTemp[reasoning?.effort ?? 'medium'] ?? 0.7

  try {
    const upstream = await fetch(`${model.endpoint}/chat/completions`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       model.hfId,
        messages,
        stream:      !!stream,
        max_tokens:  max_output_tokens ?? 4096,
        temperature,
        tools:       tools?.length ? tools : undefined,
      }),
    })

    // ── Streaming ────────────────────────────────────────────────────────────
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      res.write(`data: ${JSON.stringify({
        type: 'response.created',
        response: { id: responseId, object: 'response', model: modelId, status: 'in_progress', output: [] },
      })}\n\n`)

      res.write(`data: ${JSON.stringify({
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: `msg_${randomUUID().replace(/-/g, '')}`, role: 'assistant', content: [] },
      })}\n\n`)

      res.write(`data: ${JSON.stringify({
        type: 'response.content_part.added',
        output_index: 0, content_index: 0,
        part: { type: 'output_text', text: '' },
      })}\n\n`)

      const reader  = upstream.body.getReader()
      const decoder = new TextDecoder()
      let fullText  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
          try {
            const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content
            if (delta) {
              fullText += delta
              res.write(`data: ${JSON.stringify({
                type: 'response.output_text.delta',
                output_index: 0, content_index: 0, delta,
              })}\n\n`)
            }
          } catch { /* skip malformed */ }
        }
      }

      const finalResponse = {
        id: responseId, object: 'response', model: modelId, status: 'completed',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: fullText }] }],
      }
      responseStore.set(responseId, finalResponse)
      res.write(`data: ${JSON.stringify({ type: 'response.output_text.done', output_index: 0, content_index: 0, text: fullText })}\n\n`)
      res.write(`data: ${JSON.stringify({ type: 'response.completed', response: finalResponse })}\n\n`)
      res.end()
      return
    }

    // ── Non-streaming ─────────────────────────────────────────────────────────
    const data  = await upstream.json()
    const text  = data.choices?.[0]?.message?.content ?? ''
    const usage = data.usage ?? {}

    const response = {
      id:     responseId,
      object: 'response',
      model:  modelId,
      status: 'completed',
      output: [{
        type:    'message',
        id:      `msg_${randomUUID().replace(/-/g, '')}`,
        role:    'assistant',
        content: [{ type: 'output_text', text }],
      }],
      usage: {
        input_tokens:  usage.prompt_tokens     ?? 0,
        output_tokens: usage.completion_tokens ?? 0,
        total_tokens:  usage.total_tokens      ?? 0,
      },
    }

    responseStore.set(responseId, response)
    res.json(response)
  } catch (err) {
    res.status(502).json({ error: { message: err.message, type: 'gateway_error' } })
  }
})

// ── GET /v1/responses/:id ─────────────────────────────────────────────────────

app.get('/v1/responses/:id', (req, res) => {
  const r = responseStore.get(req.params.id)
  if (!r) return res.status(404).json({ error: { message: `Response '${req.params.id}' not found`, type: 'invalid_request_error' } })
  res.json(r)
})

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', models: Object.keys(MODELS), count: Object.keys(MODELS).length })
})

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\nWOS Unified Gateway  →  http://localhost:${PORT}`)
  console.log(`\nModels (${Object.keys(MODELS).length}):`)
  Object.entries(MODELS).forEach(([id, m]) => console.log(`  • ${id.padEnd(22)} ${m.arch}`))
  console.log(`\nEndpoints:`)
  console.log(`  GET  /v1/models`)
  console.log(`  POST /v1/chat/completions`)
  console.log(`  POST /v1/responses`)
  console.log(`  GET  /v1/responses/:id`)
  if (!RUNPOD_KEY) console.warn(`\n⚠  RUNPOD_API_KEY not set — pass via Authorization header\n`)
})
