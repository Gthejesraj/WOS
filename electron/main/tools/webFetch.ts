import type { Tool, ToolContext, ToolResult } from './index'

interface WebFetchInput {
  url: string
  prompt?: string
}

function htmlToText(html: string): string {
  // Remove script/style blocks
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Truncate to reasonable limit
  return text.slice(0, 20000)
}

export const webFetchTool: Tool = {
  name: 'WebFetch',
  description: 'Fetch a URL and return its content as text. Useful for reading documentation, articles, and web pages.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
      prompt: { type: 'string', description: 'What to extract from the page (for context)' },
    },
    required: ['url'],
  },
  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { url } = input as WebFetchInput

    const response = await fetch(url, {
      signal: ctx.signal,
      headers: {
        'User-Agent': 'WOS/0.1 (AI Agent)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    if (!response.ok) {
      return { output: `HTTP ${response.status}: ${response.statusText}`, error: `HTTP ${response.status}` }
    }

    const contentType = response.headers.get('content-type') ?? ''
    const text = await response.text()

    if (contentType.includes('text/html')) {
      return { output: htmlToText(text) }
    }

    // Plain text / JSON / other
    return { output: text.slice(0, 20000) }
  },
}
