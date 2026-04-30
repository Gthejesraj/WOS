import http, { IncomingMessage, ServerResponse } from 'node:http'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { spawn, ChildProcess } from 'node:child_process'
import { getDb, schema, notifyWrite } from '../db'
import { eq } from 'drizzle-orm'
import { registry, type AutomationRow } from './registry'
import { runAutomation } from './runner'
import { broadcastAutomationError } from './delivery'

interface WebhookConfig {
  /** URL slug: /hook/<slug> */
  slug: string
}

interface WebhookSettings {
  port: number
  tunnelProvider: 'cloudflared' | 'none'
}

let server: http.Server | null = null
let tunnel: ChildProcess | null = null
let publicBase: string | null = null
let settings: WebhookSettings = { port: 47817, tunnelProvider: 'none' }

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function timingEq(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!req.url || !req.url.startsWith('/hook/')) {
    res.writeHead(404).end('not found')
    return
  }
  const slug = req.url.slice('/hook/'.length).split('?')[0]
  const db = getDb()
  const wh = db.select().from(schema.automationWebhooks).where(eq(schema.automationWebhooks.slug, slug)).get()
  if (!wh) { res.writeHead(404).end('unknown hook'); return }

  const body = await readBody(req)
  const provided = (req.headers['x-wos-signature'] as string) || (req.headers['x-hub-signature-256'] as string) || ''
  const expected = 'sha256=' + createHmac('sha256', wh.secretHmac).update(body).digest('hex')
  if (!provided || !timingEq(provided, expected)) {
    res.writeHead(401).end('bad signature')
    return
  }

  const automation = registry.get(wh.automationId)
  if (!automation || !automation.enabled) {
    res.writeHead(503).end('disabled')
    return
  }

  let payload: unknown = body.toString('utf8')
  const ct = (req.headers['content-type'] || '').toLowerCase()
  if (ct.includes('application/json')) {
    try { payload = JSON.parse(body.toString('utf8') || 'null') } catch { /* fall back to raw */ }
  }

  db.update(schema.automationWebhooks).set({ lastSeenAt: new Date() }).where(eq(schema.automationWebhooks.slug, slug)).run()
  notifyWrite()

  res.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ accepted: true }))

  runAutomation(automation, { trigger: { kind: 'webhook', slug, headers: req.headers, payload } })
    .then(r => { if (r.error) broadcastAutomationError(automation, r.error, r.runId) })
    .catch(err => broadcastAutomationError(automation, err instanceof Error ? err.message : String(err)))
}

function startTunnel(port: number): void {
  if (settings.tunnelProvider !== 'cloudflared') return
  let child: ChildProcess
  try {
    child = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    // Synchronous spawn failures (rare, e.g. EACCES on the spawn syscall itself)
    if (process.env.WOS_DEBUG === '1') console.warn('[webhooks] cloudflared spawn failed', err)
    return
  }

  // CRITICAL: attach 'error' before any other code path so ENOENT (binary
  // missing from PATH) does not bubble up as an uncaughtException and crash
  // the main process. This is the documented Node.js pattern for spawn().
  child.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      console.warn('[webhooks] cloudflared binary not found on PATH — public webhook tunnel disabled. Install cloudflared or set automations.tunnelProvider="none" to silence.')
    } else {
      console.warn('[webhooks] cloudflared error', err.message)
    }
    tunnel = null
    publicBase = null
  })

  tunnel = child

  const onData = (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
    if (m && !publicBase) {
      publicBase = m[0]
      try {
        const db = getDb()
        const all = db.select().from(schema.automationWebhooks).all()
        for (const w of all) {
          db.update(schema.automationWebhooks)
            .set({ publicUrl: `${publicBase}/hook/${w.slug}` })
            .where(eq(schema.automationWebhooks.slug, w.slug))
            .run()
        }
        notifyWrite()
      } catch { /* ignore */ }
    }
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  child.stdout?.on('error', () => { /* ignore — handled by 'error' on child */ })
  child.stderr?.on('error', () => { /* ignore */ })
  child.on('exit', () => { tunnel = null; publicBase = null })
}

function stopTunnel(): void {
  if (tunnel) {
    try { tunnel.kill() } catch { /* ignore */ }
    tunnel = null
  }
  publicBase = null
}

/** Ensure a webhook row exists for this automation and return its (slug, secret, publicUrl). */
export function ensureWebhook(automation: AutomationRow): { slug: string; secret: string; localUrl: string; publicUrl: string | null } {
  const db = getDb()
  const cfg = automation.config as Partial<WebhookConfig>
  const existing = db.select().from(schema.automationWebhooks).where(eq(schema.automationWebhooks.automationId, automation.id)).get()
  if (existing) {
    return {
      slug: existing.slug,
      secret: existing.secretHmac,
      localUrl: `http://localhost:${settings.port}/hook/${existing.slug}`,
      publicUrl: existing.publicUrl ?? (publicBase ? `${publicBase}/hook/${existing.slug}` : null),
    }
  }
  const slug = (cfg.slug && /^[a-z0-9-]{3,40}$/i.test(cfg.slug))
    ? cfg.slug.toLowerCase()
    : randomBytes(8).toString('hex')
  const secret = randomBytes(24).toString('hex')
  db.insert(schema.automationWebhooks).values({
    automationId: automation.id,
    slug,
    secretHmac: secret,
    publicUrl: publicBase ? `${publicBase}/hook/${slug}` : null,
  } as unknown as typeof schema.automationWebhooks.$inferInsert).run()
  notifyWrite()
  return {
    slug,
    secret,
    localUrl: `http://localhost:${settings.port}/hook/${slug}`,
    publicUrl: publicBase ? `${publicBase}/hook/${slug}` : null,
  }
}

export const webhookService = {
  configure(s: Partial<WebhookSettings>): void {
    settings = { ...settings, ...s }
  },
  start(): void {
    if (server) return
    server = http.createServer((req, res) => {
      void handle(req, res).catch(err => {
        try { res.writeHead(500).end(String(err)) } catch { /* ignore */ }
      })
    })
    server.listen(settings.port, '127.0.0.1')
    // Pre-create webhooks for every kind=webhook automation so config/UI can show URLs.
    for (const a of registry.list({ kind: 'webhook' })) ensureWebhook(a)
    startTunnel(settings.port)
  },
  stop(): void {
    if (server) {
      try { server.close() } catch { /* ignore */ }
      server = null
    }
    stopTunnel()
  },
  reload(id: string): void {
    const a = registry.get(id)
    if (a && a.kind === 'webhook') ensureWebhook(a)
  },
  reloadAll(): void { /* webhooks are stateless aside from rows; no-op */ },
  ensureWebhook,
}
