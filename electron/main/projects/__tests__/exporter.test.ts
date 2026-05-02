/**
 * Smoke tests for the project exporters. We mock the manager + intelligence
 * to avoid the DB and assert on the produced strings/payloads.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../manager', () => ({
  getProject: () => ({
    id: 'p1', name: 'Atlas', slug: 'atlas', icon: '🅰️', color: '#fa0',
    status: 'active', ownerEmail: 'y@x', description: 'mobile app', summary: 'looking good',
    healthScore: 82, riskLevel: 'low', modelOverride: null, pinned: true,
    metadata: null, createdAt: 1, updatedAt: 2, archivedAt: null,
  }),
  listResources: () => [
    { id: 'r1', projectId: 'p1', kind: 'github:repo', ref: 'a/b', label: 'a/b', description: null, addedAt: 1, lastFetchedAt: null, refreshIntervalSec: null },
  ],
  listActivity: () => [
    { id: 'a1', projectId: 'p1', sourceApp: 'github', sourceKind: 'pr', ts: 1700000000000, actor: 'me', title: 'PR #1', url: 'https://x', payload: null, dedupeKey: 'k' },
  ],
  listWidgets: () => [],
  listAlerts: () => [],
  listRisks: () => [],
  listDecisions: () => [],
  getLatestSummary: () => null,
}))

vi.mock('../intelligence', () => ({
  computeHealthAndRisk: () => ({ healthScore: 82, riskLevel: 'low', signals: [] }),
}))

import { exportJson, exportMarkdown, exportHtml } from '../exporter'

describe('projects/exporter', () => {
  it('exportJson returns a parseable, structured payload', () => {
    const json = exportJson('p1')
    const obj = JSON.parse(json)
    expect(obj.project.name).toBe('Atlas')
    expect(obj.health.healthScore).toBe(82)
    expect(Array.isArray(obj.resources)).toBe(true)
    expect(Array.isArray(obj.recentActivity)).toBe(true)
  })

  it('exportMarkdown includes the project name and a header', () => {
    const md = exportMarkdown('p1')
    expect(md).toContain('Atlas')
    expect(md).toMatch(/^#/m)
  })

  it('exportHtml is a self-contained document with no external requests', () => {
    const html = exportHtml('p1')
    expect(html).toContain('<!doctype html>')
    expect(html.toLowerCase()).toContain('atlas')
    // No external scripts or stylesheets — must be self-contained.
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/i)
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/i)
  })

  it('throws if the project does not exist', () => {
    // Reset the module + remock with null project
    vi.resetModules()
    vi.doMock('../manager', () => ({
      getProject: () => null,
      listResources: () => [], listActivity: () => [], listWidgets: () => [],
      listAlerts: () => [], listRisks: () => [], listDecisions: () => [],
      getLatestSummary: () => null,
    }))
    vi.doMock('../intelligence', () => ({ computeHealthAndRisk: () => ({ healthScore: 0, riskLevel: 'low', signals: [] }) }))
    return import('../exporter').then(mod => {
      expect(() => mod.exportJson('missing')).toThrow(/not found/i)
    })
  })
})
