import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { getDb, schema, notifyWrite } from '../db'
import { eq } from 'drizzle-orm'
import { encryptApiKey, decryptApiKey } from '../crypto'
import { randomUUID } from 'crypto'
import type { Tool } from '../tools'
import { mcpConfigPath } from '../paths'
import fs from 'fs'

export interface McpServerRecord {
  id: string
  name: string
  transport: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  enabled: boolean
  toolPrefix?: string
  status: 'idle' | 'connecting' | 'connected' | 'error'
  lastError?: string
  tools?: Array<{ name: string; description: string; inputSchema: object }>
}

interface LiveConnection {
  client: Client
  transport: unknown
  tools: Array<{ name: string; description: string; inputSchema: object }>
}

const live = new Map<string, LiveConnection>()
const recordCache = new Map<string, McpServerRecord>()

function rowToRecord(row: typeof schema.mcpServers.$inferSelect): McpServerRecord {
  let env: Record<string, string> | undefined
  if (row.envEncrypted && row.envIv) {
    try { env = JSON.parse(decryptApiKey(row.envEncrypted, row.envIv)) } catch { env = undefined }
  }
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as 'stdio' | 'http' | 'sse',
    command: row.command ?? undefined,
    args: (row.argsJson as string[] | null) ?? undefined,
    url: row.url ?? undefined,
    env,
    enabled: !!row.enabled,
    toolPrefix: row.toolPrefix ?? undefined,
    status: recordCache.get(row.id)?.status ?? 'idle',
    lastError: recordCache.get(row.id)?.lastError,
    tools: recordCache.get(row.id)?.tools,
  }
}

export function listServers(): McpServerRecord[] {
  const db = getDb()
  const rows = db.select().from(schema.mcpServers).all()
  return rows.map(rowToRecord)
}

export function getServer(id: string): McpServerRecord | null {
  const db = getDb()
  const row = db.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, id)).get()
  return row ? rowToRecord(row) : null
}

export function addServer(input: {
  id?: string
  name: string
  transport: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  enabled?: boolean
  toolPrefix?: string
}): string {
  const db = getDb()
  const id = input.id ?? randomUUID()
  const now = new Date()
  let envEncrypted: string | null = null
  let envIv: string | null = null
  if (input.env && Object.keys(input.env).length > 0) {
    const { encrypted, iv } = encryptApiKey(JSON.stringify(input.env))
    envEncrypted = encrypted
    envIv = iv
  }
  db.insert(schema.mcpServers).values({
    id,
    name: input.name,
    transport: input.transport,
    command: input.command ?? null,
    argsJson: input.args ?? null,
    url: input.url ?? null,
    envEncrypted,
    envIv,
    enabled: input.enabled ?? true,
    toolPrefix: input.toolPrefix ?? sanitizePrefix(input.name),
    createdAt: now,
    updatedAt: now,
  }).run()
  notifyWrite()
  syncMcpJson()
  return id
}

export function removeServer(id: string) {
  const db = getDb()
  void disconnect(id)
  db.delete(schema.mcpServers).where(eq(schema.mcpServers.id, id)).run()
  notifyWrite()
  syncMcpJson()
}

export function setServerEnabled(id: string, enabled: boolean) {
  const db = getDb()
  db.update(schema.mcpServers).set({ enabled, updatedAt: new Date() }).where(eq(schema.mcpServers.id, id)).run()
  notifyWrite()
  if (!enabled) void disconnect(id)
  syncMcpJson()
}

function sanitizePrefix(name: string): string {
  return name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()
}

function statusFor(id: string): McpServerRecord['status'] {
  return recordCache.get(id)?.status ?? 'idle'
}

function setStatus(id: string, status: McpServerRecord['status'], lastError?: string) {
  const prev = recordCache.get(id) ?? ({ id } as McpServerRecord)
  recordCache.set(id, { ...prev, id, status, lastError, ...(prev.tools ? { tools: prev.tools } : {}) } as McpServerRecord)
}

async function buildTransport(rec: McpServerRecord) {
  if (rec.transport === 'stdio') {
    if (!rec.command) throw new Error('stdio transport requires command')
    return new StdioClientTransport({
      command: rec.command,
      args: rec.args ?? [],
      env: { ...process.env, ...(rec.env ?? {}) } as Record<string, string>,
    })
  }
  if (rec.transport === 'sse') {
    if (!rec.url) throw new Error('sse transport requires url')
    return new SSEClientTransport(new URL(rec.url))
  }
  // http (Streamable HTTP)
  if (!rec.url) throw new Error('http transport requires url')
  return new StreamableHTTPClientTransport(new URL(rec.url))
}

export async function connect(id: string): Promise<LiveConnection> {
  const existing = live.get(id)
  if (existing) return existing

  const rec = getServer(id)
  if (!rec) throw new Error(`MCP server not found: ${id}`)
  if (!rec.enabled) throw new Error(`MCP server is disabled: ${rec.name}`)

  setStatus(id, 'connecting')
  try {
    const transport = await buildTransport(rec)
    const client = new Client({ name: 'wos', version: '0.1.0' }, { capabilities: {} })
    await client.connect(transport)
    const toolsRes = await client.listTools()
    const tools = toolsRes.tools.map(t => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema ?? { type: 'object' }) as object,
    }))
    const conn: LiveConnection = { client, transport, tools }
    live.set(id, conn)
    const prev = recordCache.get(id) ?? ({ id } as McpServerRecord)
    recordCache.set(id, { ...prev, id, status: 'connected', tools, lastError: undefined } as McpServerRecord)
    return conn
  } catch (err) {
    const msg = (err as Error).message
    setStatus(id, 'error', msg)
    throw err
  }
}

export async function disconnect(id: string) {
  const conn = live.get(id)
  if (!conn) return
  try { await conn.client.close() } catch { /* ignore */ }
  live.delete(id)
  setStatus(id, 'idle')
}

export async function disconnectAll() {
  for (const id of [...live.keys()]) await disconnect(id)
}

export async function listTools(id: string): Promise<Array<{ name: string; description: string }>> {
  const conn = await connect(id)
  return conn.tools.map(t => ({ name: t.name, description: t.description }))
}

export async function testConnection(id: string): Promise<{ ok: boolean; toolCount?: number; error?: string }> {
  try {
    const conn = await connect(id)
    return { ok: true, toolCount: conn.tools.length }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Build WOS tool wrappers for every enabled MCP server. Tools are named
 * `mcp__<serverPrefix>__<toolName>` so they namespace cleanly in the provider
 * tool list. Connections are lazy — the first call triggers `connect()`.
 */
export function buildMcpTools(): Tool[] {
  const out: Tool[] = []
  const servers = listServers().filter(s => s.enabled)
  for (const rec of servers) {
    const prefix = rec.toolPrefix ?? sanitizePrefix(rec.name)
    // If we don't have the tool list yet, expose a single discovery tool so
    // the agent can prompt us (user) to connect. Once connected, we expose
    // per-tool wrappers on subsequent loop iterations.
    const cached = recordCache.get(rec.id)
    const tools = cached?.tools
    if (!tools) {
      // Not yet connected — skip, but kick off a lazy connect so the next
      // queryLoop iteration has them. We don't await to avoid blocking.
      void connect(rec.id).catch(() => {/* status set to error already */})
      continue
    }
    for (const t of tools) {
      const toolName = `mcp__${prefix}__${t.name}`
      out.push({
        name: toolName,
        description: `[${rec.name}] ${t.description}`,
        inputSchema: t.inputSchema,
        async execute(input) {
          const conn = await connect(rec.id)
          const res = await conn.client.callTool({ name: t.name, arguments: input as Record<string, unknown> })
          // Flatten CallToolResult content into a string
          const chunks: string[] = []
          const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? []
          for (const c of content) {
            if (c.type === 'text' && typeof c.text === 'string') chunks.push(c.text)
          }
          const isError = (res as { isError?: boolean }).isError
          if (isError) return { output: chunks.join('\n') || '(mcp error)', error: 'MCP tool returned an error.' }
          return { output: chunks.join('\n') || '(empty result)' }
        },
      })
    }
  }
  return out
}

/** Mirror the DB config into ~/.wos/mcp.json for human-readable inspection. */
export function syncMcpJson() {
  try {
    const servers = listServers().map(s => ({
      id: s.id,
      name: s.name,
      transport: s.transport,
      command: s.command,
      args: s.args,
      url: s.url,
      enabled: s.enabled,
      toolPrefix: s.toolPrefix,
      // env omitted to avoid writing secrets to disk
    }))
    fs.writeFileSync(mcpConfigPath(), JSON.stringify(servers, null, 2))
  } catch (err) {
    console.error('[mcp] failed to write mcp.json', err)
  }
}
