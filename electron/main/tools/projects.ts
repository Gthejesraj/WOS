import type { Tool } from './index'
import {
  listProjects,
  getProject,
  getProjectBySlug,
  findProjectsByName,
  listResources,
  listActivity,
  listRisks,
  listDecisions,
  getLatestSummary,
} from '../projects/manager'
import { generateSummary, computeHealthAndRisk } from '../projects/intelligence'

function resolveProject(idOrName: string): { id: string; name: string } | null {
  const direct = getProject(idOrName) ?? getProjectBySlug(idOrName)
  if (direct) return { id: direct.id, name: direct.name }
  const matches = findProjectsByName(idOrName)
  if (matches.length === 1) return { id: matches[0].id, name: matches[0].name }
  return null
}

export const projectTools: Tool[] = [
  {
    name: 'wos_projects_list',
    description: 'List all WOS projects (id, name, slug, status, owner, healthScore, riskLevel). Use to discover projects before drilling into one.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        includeArchived: { type: 'boolean', description: 'Include archived projects (default false).' },
      },
    },
    async execute(input) {
      const includeArchived = (input as { includeArchived?: boolean } | undefined)?.includeArchived ?? false
      return { output: listProjects({ includeArchived }) }
    },
  },
  {
    name: 'wos_projects_find',
    description: 'Fuzzy-find projects by name fragment. Use when the user mentions a project by partial name.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    async execute(input) {
      return { output: findProjectsByName((input as { query: string }).query) }
    },
  },
  {
    name: 'wos_projects_get',
    description: 'Fetch a single project by id, slug, or unambiguous name match.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { idOrName: { type: 'string' } },
      required: ['idOrName'],
    },
    async execute(input) {
      const ref = resolveProject((input as { idOrName: string }).idOrName)
      if (!ref) return { output: {}, error: 'Project not found or ambiguous.' }
      return { output: getProject(ref.id) ?? {} }
    },
  },
  {
    name: 'wos_projects_activity',
    description: 'Recent normalized activity for a project (cross-app feed).',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        idOrName: { type: 'string' },
        since: { type: 'number', description: 'Unix ms; only activity newer than this.' },
        limit: { type: 'number', description: 'Max rows (default 50).' },
      },
      required: ['idOrName'],
    },
    async execute(input) {
      const args = input as { idOrName: string; since?: number; limit?: number }
      const ref = resolveProject(args.idOrName)
      if (!ref) return { output: [], error: 'Project not found.' }
      return { output: listActivity(ref.id, { since: args.since, limit: args.limit ?? 50 }) }
    },
  },
  {
    name: 'wos_projects_resources',
    description: 'Linked resources for a project (Slack channels, GitHub repos, Jira projects, etc.).',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { idOrName: { type: 'string' } },
      required: ['idOrName'],
    },
    async execute(input) {
      const ref = resolveProject((input as { idOrName: string }).idOrName)
      if (!ref) return { output: [], error: 'Project not found.' }
      return { output: listResources(ref.id) }
    },
  },
  {
    name: 'wos_projects_risks',
    description: 'Open risks tracked against a project.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { idOrName: { type: 'string' } },
      required: ['idOrName'],
    },
    async execute(input) {
      const ref = resolveProject((input as { idOrName: string }).idOrName)
      if (!ref) return { output: [], error: 'Project not found.' }
      return { output: listRisks(ref.id) }
    },
  },
  {
    name: 'wos_projects_decisions',
    description: 'Decisions log for a project.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { idOrName: { type: 'string' } },
      required: ['idOrName'],
    },
    async execute(input) {
      const ref = resolveProject((input as { idOrName: string }).idOrName)
      if (!ref) return { output: [], error: 'Project not found.' }
      return { output: listDecisions(ref.id) }
    },
  },
  {
    name: 'wos_projects_summary',
    description: 'Get the latest cached AI summary for a project (kind: daily | weekly | status | standup).',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        idOrName: { type: 'string' },
        kind: { type: 'string', enum: ['daily', 'weekly', 'status', 'standup'], description: "Summary kind. Default 'status'." },
      },
      required: ['idOrName'],
    },
    async execute(input) {
      const args = input as { idOrName: string; kind?: 'daily' | 'weekly' | 'status' | 'standup' }
      const ref = resolveProject(args.idOrName)
      if (!ref) return { output: {}, error: 'Project not found.' }
      return { output: getLatestSummary(ref.id, args.kind ?? 'status') ?? {} }
    },
  },
  {
    name: 'wos_projects_generate_summary',
    description: 'Regenerate an AI summary for a project (uses default model unless overridden on the project).',
    inputSchema: {
      type: 'object',
      properties: {
        idOrName: { type: 'string' },
        kind: { type: 'string', enum: ['daily', 'weekly', 'status', 'standup'], description: "Default 'status'." },
      },
      required: ['idOrName'],
    },
    async execute(input) {
      const args = input as { idOrName: string; kind?: 'daily' | 'weekly' | 'status' | 'standup' }
      const ref = resolveProject(args.idOrName)
      if (!ref) return { output: {}, error: 'Project not found.' }
      const result = await generateSummary(ref.id, args.kind ?? 'status')
      return { output: result }
    },
  },
  {
    name: 'wos_projects_health',
    description: 'Recompute and return the health score, risk level, and contributing signals for a project.',
    inputSchema: {
      type: 'object',
      properties: { idOrName: { type: 'string' } },
      required: ['idOrName'],
    },
    async execute(input) {
      const ref = resolveProject((input as { idOrName: string }).idOrName)
      if (!ref) return { output: {}, error: 'Project not found.' }
      return { output: computeHealthAndRisk(ref.id) }
    },
  },
]
