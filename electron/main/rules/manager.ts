import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { getDb, schema, notifyWrite } from '../db'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { userRulesDir, ensureDir, workspaceRulesDir } from '../paths'
import type { Tool } from '../tools'

export interface RuleRecord {
  id: string
  scope: 'user' | 'workspace'
  workspaceId?: string
  name: string
  description: string
  path: string
  alwaysApply: boolean
  globs: string[]
  body: string
  enabled: boolean
}

function parseRuleFile(p: string): { name: string; description: string; alwaysApply: boolean; globs: string[]; body: string } | null {
  try {
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = matter(raw)
    const data = parsed.data as Record<string, unknown>
    const rawGlobs = data.globs ?? []
    const globs = Array.isArray(rawGlobs)
      ? rawGlobs.map(String)
      : typeof rawGlobs === 'string'
        ? rawGlobs.split(',').map(s => s.trim()).filter(Boolean)
        : []
    return {
      name: (data.name as string) || path.basename(p).replace(/\.mdx?|\.mdc$/i, ''),
      description: (data.description as string) || '',
      alwaysApply: Boolean(data.alwaysApply ?? false),
      globs,
      body: parsed.content,
    }
  } catch (err) {
    console.error('[rules] parse error', p, err)
    return null
  }
}

function listRuleFiles(dir: string, exts: RegExp): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (!exts.test(entry.name)) continue
    out.push(path.join(dir, entry.name))
  }
  return out
}

export function scanRules(workspacePath: string | null, workspaceId: string | null = null): RuleRecord[] {
  ensureDir(userRulesDir())
  const db = getDb()
  const records: RuleRecord[] = []
  const now = new Date()
  const seenPaths = new Set<string>()

  const userFiles = listRuleFiles(userRulesDir(), /\.(md|mdx|mdc)$/i)
  for (const file of userFiles) {
    const parsed = parseRuleFile(file)
    if (!parsed) continue
    seenPaths.add(file)
    const existing = db.select().from(schema.rules).where(eq(schema.rules.path, file)).get()
    const id = existing?.id ?? randomUUID()
    if (existing) {
      db.update(schema.rules).set({
        name: parsed.name,
        description: parsed.description,
        alwaysApply: parsed.alwaysApply,
        globs: parsed.globs,
        body: parsed.body,
        updatedAt: now,
      }).where(eq(schema.rules.id, id)).run()
    } else {
      db.insert(schema.rules).values({
        id,
        scope: 'user',
        workspaceId: null,
        name: parsed.name,
        description: parsed.description,
        path: file,
        alwaysApply: parsed.alwaysApply,
        globs: parsed.globs,
        body: parsed.body,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }).run()
    }
    records.push({
      id,
      scope: 'user',
      name: parsed.name,
      description: parsed.description,
      path: file,
      alwaysApply: parsed.alwaysApply,
      globs: parsed.globs,
      body: parsed.body,
      enabled: existing?.enabled ?? true,
    })
  }

  const wsDir = workspaceRulesDir(workspacePath)
  if (wsDir && workspaceId) {
    const wsFiles = listRuleFiles(wsDir, /\.(mdc|md)$/i)
    for (const file of wsFiles) {
      const parsed = parseRuleFile(file)
      if (!parsed) continue
      seenPaths.add(file)
      const existing = db.select().from(schema.rules).where(eq(schema.rules.path, file)).get()
      const id = existing?.id ?? randomUUID()
      if (existing) {
        db.update(schema.rules).set({
          name: parsed.name,
          description: parsed.description,
          alwaysApply: parsed.alwaysApply,
          globs: parsed.globs,
          body: parsed.body,
          updatedAt: now,
        }).where(eq(schema.rules.id, id)).run()
      } else {
        db.insert(schema.rules).values({
          id,
          scope: 'workspace',
          workspaceId,
          name: parsed.name,
          description: parsed.description,
          path: file,
          alwaysApply: parsed.alwaysApply,
          globs: parsed.globs,
          body: parsed.body,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        }).run()
      }
      records.push({
        id,
        scope: 'workspace',
        workspaceId,
        name: parsed.name,
        description: parsed.description,
        path: file,
        alwaysApply: parsed.alwaysApply,
        globs: parsed.globs,
        body: parsed.body,
        enabled: existing?.enabled ?? true,
      })
    }
  }

  // Prune rows whose file is gone (but only within scopes we just scanned).
  const rows = db.select().from(schema.rules).all()
  for (const r of rows) {
    if (r.scope === 'user' && !seenPaths.has(r.path)) {
      db.delete(schema.rules).where(eq(schema.rules.id, r.id)).run()
    } else if (r.scope === 'workspace' && r.workspaceId === workspaceId && !seenPaths.has(r.path)) {
      db.delete(schema.rules).where(eq(schema.rules.id, r.id)).run()
    }
  }

  notifyWrite()
  return records
}

export function listRules(workspaceId?: string | null): RuleRecord[] {
  const db = getDb()
  const rows = db.select().from(schema.rules).all()
  return rows
    .filter(r => r.scope === 'user' || (r.scope === 'workspace' && (!workspaceId || r.workspaceId === workspaceId)))
    .map(r => ({
      id: r.id,
      scope: r.scope as 'user' | 'workspace',
      workspaceId: r.workspaceId ?? undefined,
      name: r.name,
      description: r.description,
      path: r.path,
      alwaysApply: !!r.alwaysApply,
      globs: (r.globs as string[] | null) ?? [],
      body: r.body,
      enabled: !!r.enabled,
    }))
}

export function setRuleEnabled(id: string, enabled: boolean) {
  const db = getDb()
  db.update(schema.rules).set({ enabled, updatedAt: new Date() }).where(eq(schema.rules.id, id)).run()
  notifyWrite()
}

export function createRule(input: {
  scope: 'user' | 'workspace'
  name: string
  description?: string
  alwaysApply?: boolean
  globs?: string[]
  body: string
  workspacePath?: string | null
  workspaceId?: string | null
}): { id: string; path: string } {
  let dir: string
  let ext: string
  if (input.scope === 'user') {
    ensureDir(userRulesDir())
    dir = userRulesDir()
    ext = '.md'
  } else {
    if (!input.workspacePath) throw new Error('workspace rule requires workspacePath')
    dir = path.join(input.workspacePath, '.cursor', 'rules')
    ensureDir(dir)
    ext = '.mdc'
  }
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'rule'
  const fp = path.join(dir, `${slug}${ext}`)
  const frontmatter = [
    '---',
    `name: ${JSON.stringify(input.name)}`,
    `description: ${JSON.stringify(input.description ?? '')}`,
    `alwaysApply: ${Boolean(input.alwaysApply)}`,
    `globs: ${JSON.stringify(input.globs ?? [])}`,
    '---',
    '',
  ].join('\n')
  fs.writeFileSync(fp, frontmatter + input.body + '\n')

  const records = scanRules(input.workspacePath ?? null, input.workspaceId ?? null)
  const match = records.find(r => r.path === fp)
  return { id: match?.id ?? '', path: fp }
}

export function deleteRule(id: string) {
  const db = getDb()
  const row = db.select().from(schema.rules).where(eq(schema.rules.id, id)).get()
  if (!row) return
  try { fs.unlinkSync(row.path) } catch { /* ignore */ }
  db.delete(schema.rules).where(eq(schema.rules.id, id)).run()
  notifyWrite()
}

export function readRuleBody(id: string): { meta: Record<string, unknown>; body: string } | null {
  const db = getDb()
  const row = db.select().from(schema.rules).where(eq(schema.rules.id, id)).get()
  if (!row) return null
  if (!fs.existsSync(row.path)) return null
  const parsed = matter(fs.readFileSync(row.path, 'utf8'))
  return { meta: parsed.data, body: parsed.content }
}

/**
 * Build a system-prompt addendum from currently-enabled rules.
 *  - `alwaysApply: true` rule bodies are inlined directly.
 *  - Glob-scoped rules are advertised as one-liners so the agent can
 *    fetch them via `ReadRule` when relevant paths come up.
 */
export function buildRulesPromptSection(workspaceId: string | null): string {
  const rules = listRules(workspaceId).filter(r => r.enabled)
  if (rules.length === 0) return ''

  const always = rules.filter(r => r.alwaysApply && r.globs.length === 0)
  const conditional = rules.filter(r => !(r.alwaysApply && r.globs.length === 0))

  const sections: string[] = []
  if (always.length) {
    sections.push('## Active rules', '')
    for (const r of always) {
      sections.push(`### ${r.name}`, r.body.trim(), '')
    }
  }
  if (conditional.length) {
    sections.push('## Conditional rules (call `ReadRule` when a trigger fires)', '')
    for (const r of conditional) {
      const trig = r.globs.length ? ` matches: ${r.globs.join(', ')}` : r.alwaysApply ? ' alwaysApply' : ''
      sections.push(`- **${r.id.slice(0, 8)}** ${r.name} — ${r.description}${trig}`)
    }
  }
  return sections.join('\n')
}

export const readRuleTool: Tool = {
  name: 'ReadRule',
  description: 'Load a Rule body by id when a glob-scoped or conditional rule becomes relevant.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  async execute(input) {
    const { id } = input as { id: string }
    const rules = listRules()
    const match = rules.find(r => r.id === id || r.id.startsWith(id))
    if (!match) return { output: '', error: `No rule found for id "${id}"` }
    if (!match.enabled) return { output: '', error: `Rule "${match.name}" is disabled.` }
    const parsed = readRuleBody(match.id)
    if (!parsed) return { output: '', error: 'Rule file is missing on disk.' }
    return { output: `# ${match.name}\n\n${parsed.body}` }
  },
}
