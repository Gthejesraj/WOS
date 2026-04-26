import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { getDb, schema, notifyWrite } from '../db'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { skillsDir, ensureDir } from '../paths'
import type { Tool } from '../tools'

export interface SkillRecord {
  id: string
  source: 'user' | 'workspace'
  name: string
  description: string
  path: string
  enabled: boolean
  triggers: string[]
}

function parseSkill(dir: string): { name: string; description: string; triggers: string[]; body: string } | null {
  const p = path.join(dir, 'SKILL.md')
  if (!fs.existsSync(p)) return null
  try {
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = matter(raw)
    const data = parsed.data as Record<string, unknown>
    const rawTriggers = data.triggers ?? data.keywords ?? []
    const triggers = Array.isArray(rawTriggers)
      ? rawTriggers.map(String)
      : typeof rawTriggers === 'string'
        ? rawTriggers.split(',').map(s => s.trim()).filter(Boolean)
        : []
    return {
      name: (data.name as string) || path.basename(dir),
      description: (data.description as string) || '',
      triggers,
      body: parsed.content,
    }
  } catch (err) {
    console.error('[skills] parse error', p, err)
    return null
  }
}

function listSkillDirs(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = path.join(rootDir, entry.name)
    if (fs.existsSync(path.join(full, 'SKILL.md'))) out.push(full)
  }
  return out
}

export function scanSkills(): SkillRecord[] {
  ensureDir(skillsDir())
  const db = getDb()
  const records: SkillRecord[] = []
  const dirs = listSkillDirs(skillsDir())

  // Upsert each found skill; keep existing `enabled` state.
  const now = new Date()
  for (const dir of dirs) {
    const parsed = parseSkill(dir)
    if (!parsed) continue
    const existing = db.select().from(schema.skills).where(eq(schema.skills.path, dir)).get()
    const id = existing?.id ?? randomUUID()
    const enabled = existing?.enabled ?? true
    if (existing) {
      db.update(schema.skills).set({
        name: parsed.name,
        description: parsed.description,
        triggersJson: parsed.triggers,
        updatedAt: now,
      }).where(eq(schema.skills.id, id)).run()
    } else {
      db.insert(schema.skills).values({
        id,
        source: 'user',
        name: parsed.name,
        description: parsed.description,
        path: dir,
        enabled: true,
        triggersJson: parsed.triggers,
        createdAt: now,
        updatedAt: now,
      }).run()
    }
    records.push({
      id,
      source: 'user',
      name: parsed.name,
      description: parsed.description,
      path: dir,
      enabled,
      triggers: parsed.triggers,
    })
  }

  // Prune rows whose folder is gone.
  const presentPaths = new Set(dirs)
  for (const row of db.select().from(schema.skills).all()) {
    if (!presentPaths.has(row.path)) {
      db.delete(schema.skills).where(eq(schema.skills.id, row.id)).run()
    }
  }
  notifyWrite()
  return records
}

export function listSkills(): SkillRecord[] {
  const db = getDb()
  return db.select().from(schema.skills).all().map(r => ({
    id: r.id,
    source: r.source as 'user' | 'workspace',
    name: r.name,
    description: r.description,
    path: r.path,
    enabled: !!r.enabled,
    triggers: (r.triggersJson as string[] | null) ?? [],
  }))
}

export function setSkillEnabled(id: string, enabled: boolean) {
  const db = getDb()
  db.update(schema.skills).set({ enabled, updatedAt: new Date() }).where(eq(schema.skills.id, id)).run()
  notifyWrite()
}

export function readSkillBody(id: string): { meta: Record<string, unknown>; body: string } | null {
  const db = getDb()
  const row = db.select().from(schema.skills).where(eq(schema.skills.id, id)).get()
  if (!row) return null
  const p = path.join(row.path, 'SKILL.md')
  if (!fs.existsSync(p)) return null
  const parsed = matter(fs.readFileSync(p, 'utf8'))
  return { meta: parsed.data, body: parsed.content }
}

export function createSkill(input: {
  name: string
  description?: string
  body: string
  triggers?: string[]
}): { id: string; dir: string } {
  ensureDir(skillsDir())
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'skill'
  const dir = path.join(skillsDir(), slug)
  ensureDir(dir)
  const frontmatter = [
    '---',
    `name: ${JSON.stringify(input.name)}`,
    `description: ${JSON.stringify(input.description ?? '')}`,
    `triggers: ${JSON.stringify(input.triggers ?? [])}`,
    '---',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(dir, 'SKILL.md'), frontmatter + input.body + '\n')
  const records = scanSkills()
  const row = records.find(r => r.path === dir)
  return { id: row?.id ?? '', dir }
}

export function deleteSkill(id: string) {
  const db = getDb()
  const row = db.select().from(schema.skills).where(eq(schema.skills.id, id)).get()
  if (!row) return
  try {
    fs.rmSync(row.path, { recursive: true, force: true })
  } catch (err) {
    console.error('[skills] failed to rm folder', err)
  }
  db.delete(schema.skills).where(eq(schema.skills.id, id)).run()
  notifyWrite()
}

/**
 * Compact index inserted into the system prompt so the model knows what
 * skills exist and what triggers them. Actual skill bodies are pulled via
 * the ReadSkill tool.
 */
export function buildSkillIndex(): string {
  const skills = listSkills().filter(s => s.enabled)
  if (skills.length === 0) return ''
  const lines = ['## Available skills', '', 'Call the `ReadSkill` tool with an id below when one of the triggers matches.', '']
  for (const s of skills) {
    const trig = s.triggers.length ? ` [triggers: ${s.triggers.join(', ')}]` : ''
    lines.push(`- **${s.id.slice(0, 8)}** — ${s.name}: ${s.description}${trig}`)
  }
  return lines.join('\n')
}

/** Built-in tool that lets the agent pull a full SKILL.md body on demand. */
export const readSkillTool: Tool = {
  name: 'ReadSkill',
  description: 'Load a Skill by id (first 8 chars of UUID). Returns its SKILL.md body.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Skill id (first 8 chars are enough).' } },
    required: ['id'],
  },
  async execute(input) {
    const { id } = input as { id: string }
    const skills = listSkills()
    const match = skills.find(s => s.id === id || s.id.startsWith(id))
    if (!match) return { output: '', error: `No skill found for id "${id}"` }
    if (!match.enabled) return { output: '', error: `Skill "${match.name}" is disabled.` }
    const parsed = readSkillBody(match.id)
    if (!parsed) return { output: '', error: 'Skill file is missing on disk.' }
    return { output: `# ${match.name}\n\n${parsed.body}` }
  },
}
