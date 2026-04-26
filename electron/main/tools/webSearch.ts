import type { Tool, ToolContext, ToolResult } from './index'

interface WebSearchInput {
  query: string
}

interface SearchResult {
  title: string
  url: string
  description: string
}

async function searchDuckDuckGo(query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const response = await fetch(searchUrl, {
    signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; WOS/0.1)',
      Accept: 'text/html',
    },
  })

  const html = await response.text()
  const results: SearchResult[] = []

  // Extract result blocks
  const resultPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = resultPattern.exec(html)) !== null && results.length < 5) {
    const url = match[1]
    const rawTitle = match[2].replace(/<[^>]+>/g, '').trim()
    if (url && rawTitle && !url.includes('duckduckgo')) {
      results.push({ url, title: rawTitle, description: '' })
    }
  }

  return results
}

export const webSearchTool: Tool = {
  name: 'WebSearch',
  description: 'Search the web for information. Returns top results with titles, URLs, and descriptions.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  },
  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { query } = input as WebSearchInput

    try {
      const results = await searchDuckDuckGo(query, ctx.signal)

      if (results.length === 0) {
        return { output: `No results found for: ${query}` }
      }

      const formatted = results.map((r, i) =>
        `${i + 1}. **${r.title}**\n   ${r.url}${r.description ? `\n   ${r.description}` : ''}`
      ).join('\n\n')

      return { output: `Search results for "${query}":\n\n${formatted}` }
    } catch (err) {
      return { output: `Search failed: ${(err as Error).message}`, error: (err as Error).message }
    }
  },
}
