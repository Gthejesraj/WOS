/**
 * Project export utilities.
 *
 * Three flavours:
 *   - exportJson(projectId)     → fully-typed JSON brief
 *   - exportMarkdown(projectId) → human-readable brief (no external assets)
 *   - exportHtml(projectId)     → self-contained static status page
 *
 * All variants are read-only snapshots; they make no network requests and
 * inline every dependency they need.
 */

import {
  getProject,
  listResources,
  listActivity,
  listWidgets,
  listAlerts,
  listRisks,
  listDecisions,
  getLatestSummary,
} from './manager'
import { computeHealthAndRisk } from './intelligence'

export interface ProjectExportPayload {
  exportedAt: number
  project: ReturnType<typeof getProject>
  health: ReturnType<typeof computeHealthAndRisk>
  resources: ReturnType<typeof listResources>
  recentActivity: ReturnType<typeof listActivity>
  widgets: ReturnType<typeof listWidgets>
  alerts: ReturnType<typeof listAlerts>
  risks: ReturnType<typeof listRisks>
  decisions: ReturnType<typeof listDecisions>
  summaries: {
    status: ReturnType<typeof getLatestSummary>
    daily: ReturnType<typeof getLatestSummary>
    weekly: ReturnType<typeof getLatestSummary>
    standup: ReturnType<typeof getLatestSummary>
  }
}

function gatherExport(projectId: string): ProjectExportPayload {
  const project = getProject(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  return {
    exportedAt: Date.now(),
    project,
    health: computeHealthAndRisk(projectId),
    resources: listResources(projectId),
    recentActivity: listActivity(projectId, { limit: 200 }),
    widgets: listWidgets(projectId),
    alerts: listAlerts(projectId),
    risks: listRisks(projectId),
    decisions: listDecisions(projectId),
    summaries: {
      status: getLatestSummary(projectId, 'status'),
      daily: getLatestSummary(projectId, 'daily'),
      weekly: getLatestSummary(projectId, 'weekly'),
      standup: getLatestSummary(projectId, 'standup'),
    },
  }
}

export function exportJson(projectId: string): string {
  return JSON.stringify(gatherExport(projectId), null, 2)
}

function escapeMd(s: string | null | undefined): string {
  if (!s) return ''
  return String(s).replace(/\|/g, '\\|')
}

function fmtTs(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toISOString()
}

export function exportMarkdown(projectId: string): string {
  const data = gatherExport(projectId)
  const p = data.project!
  const lines: string[] = []
  lines.push(`# ${p.icon ?? ''} ${p.name}`.trim())
  lines.push('')
  if (p.summary) {
    lines.push(p.summary)
    lines.push('')
  }
  lines.push(`- **Status:** ${p.status}`)
  lines.push(`- **Owner:** ${p.ownerEmail ?? '—'}`)
  lines.push(`- **Health:** ${data.health.healthScore} / 100 (risk: ${data.health.riskLevel})`)
  lines.push(`- **Updated:** ${fmtTs(p.updatedAt)}`)
  lines.push(`- **Exported:** ${fmtTs(data.exportedAt)}`)
  lines.push('')

  const status = data.summaries.status?.body
  if (status) {
    lines.push('## Status summary')
    lines.push('')
    lines.push(status)
    lines.push('')
  }

  if (data.risks.length) {
    lines.push('## Risks')
    lines.push('')
    lines.push('| Severity | Status | Title | Owner |')
    lines.push('|---|---|---|---|')
    for (const r of data.risks) {
      lines.push(`| ${r.severity} | ${r.status} | ${escapeMd(r.title)} | ${escapeMd(r.owner)} |`)
    }
    lines.push('')
  }

  if (data.decisions.length) {
    lines.push('## Decisions')
    lines.push('')
    for (const d of data.decisions) {
      lines.push(`- **${escapeMd(d.title)}** — ${fmtTs(d.decidedAt)}`)
      if (d.body) lines.push(`  ${d.body.replace(/\n/g, '\n  ')}`)
    }
    lines.push('')
  }

  lines.push('## Resources')
  lines.push('')
  if (data.resources.length === 0) {
    lines.push('_No linked resources yet._')
  } else {
    for (const r of data.resources) {
      lines.push(`- \`${r.kind}\` — ${escapeMd(r.label)}`)
    }
  }
  lines.push('')

  lines.push('## Recent activity (latest 50)')
  lines.push('')
  const recent = data.recentActivity.slice(0, 50)
  if (recent.length === 0) {
    lines.push('_No activity recorded._')
  } else {
    for (const a of recent) {
      const who = a.actor ? ` — ${escapeMd(a.actor)}` : ''
      lines.push(`- [${fmtTs(a.ts)}] **${a.sourceApp}/${a.sourceKind}**${who}: ${escapeMd(a.title)}`)
    }
  }
  lines.push('')

  return lines.join('\n')
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function exportHtml(projectId: string): string {
  const data = gatherExport(projectId)
  const p = data.project!
  const accent = p.color || '#6366f1'

  const resourcesHtml = data.resources.length
    ? data.resources.map(r => `<li><code>${escapeHtml(r.kind)}</code> — ${escapeHtml(r.label)}</li>`).join('')
    : '<li><em>No linked resources.</em></li>'

  const risksHtml = data.risks.length
    ? `<table>
         <thead><tr><th>Severity</th><th>Status</th><th>Title</th><th>Owner</th></tr></thead>
         <tbody>${data.risks.map(r => `<tr><td>${escapeHtml(r.severity)}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.owner)}</td></tr>`).join('')}</tbody>
       </table>`
    : '<p><em>No tracked risks.</em></p>'

  const decisionsHtml = data.decisions.length
    ? `<ul>${data.decisions.map(d => `<li><strong>${escapeHtml(d.title)}</strong> — ${fmtTs(d.decidedAt)}${d.body ? `<br><span class="muted">${escapeHtml(d.body)}</span>` : ''}</li>`).join('')}</ul>`
    : '<p><em>No decisions recorded.</em></p>'

  const recent = data.recentActivity.slice(0, 100)
  const activityHtml = recent.length
    ? `<ul class="activity">${recent.map(a => `<li><span class="ts">${fmtTs(a.ts)}</span> <span class="badge">${escapeHtml(a.sourceApp)}/${escapeHtml(a.sourceKind)}</span> ${escapeHtml(a.title)}${a.actor ? `<span class="muted"> — ${escapeHtml(a.actor)}</span>` : ''}</li>`).join('')}</ul>`
    : '<p><em>No activity recorded.</em></p>'

  const status = data.summaries.status?.body
  const statusHtml = status ? `<section><h2>Status summary</h2><pre>${escapeHtml(status)}</pre></section>` : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(p.name)} — Project status</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  body { font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; margin: 0; background: #0b0d10; color: #e4e6eb; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 32px 24px 64px; }
  header { padding: 28px 24px; border-radius: 18px; background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 30%, #1a1d22), #15171b); margin-bottom: 28px; border: 1px solid #2a2d33; }
  header h1 { margin: 0 0 8px; font-size: 28px; }
  header .meta { color: #aab1bb; font-size: 13px; }
  section { background: #15171b; border: 1px solid #2a2d33; border-radius: 14px; padding: 20px 22px; margin-bottom: 18px; }
  section h2 { margin-top: 0; font-size: 18px; color: var(--accent); }
  pre { background: #0e1014; border: 1px solid #2a2d33; padding: 12px; border-radius: 8px; white-space: pre-wrap; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2a2d33; }
  th { color: #aab1bb; font-weight: 600; }
  ul { padding-left: 20px; }
  ul.activity { list-style: none; padding: 0; }
  ul.activity li { padding: 8px 0; border-bottom: 1px solid #1f2226; }
  ul.activity li:last-child { border-bottom: 0; }
  .ts { color: #6b7079; font-family: ui-monospace, monospace; font-size: 12px; margin-right: 8px; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; background: #1f2226; color: #aab1bb; font-size: 11px; margin-right: 6px; }
  .muted { color: #6b7079; }
  .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; background: #1f2226; color: #d4d6db; margin-right: 6px; }
  .pill.accent { background: var(--accent); color: #0b0d10; font-weight: 600; }
  code { background: #1f2226; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  footer { color: #6b7079; font-size: 12px; text-align: center; margin-top: 28px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${escapeHtml(p.icon)} ${escapeHtml(p.name)}</h1>
    ${p.summary ? `<p>${escapeHtml(p.summary)}</p>` : ''}
    <div class="meta">
      <span class="pill accent">${escapeHtml(p.status)}</span>
      <span class="pill">Health ${data.health.healthScore}/100</span>
      <span class="pill">Risk: ${escapeHtml(data.health.riskLevel)}</span>
      ${p.ownerEmail ? `<span class="pill">${escapeHtml(p.ownerEmail)}</span>` : ''}
      <span class="pill">Updated ${fmtTs(p.updatedAt)}</span>
    </div>
  </header>

  ${statusHtml}

  <section>
    <h2>Resources</h2>
    <ul>${resourcesHtml}</ul>
  </section>

  <section>
    <h2>Risks</h2>
    ${risksHtml}
  </section>

  <section>
    <h2>Decisions</h2>
    ${decisionsHtml}
  </section>

  <section>
    <h2>Recent activity</h2>
    ${activityHtml}
  </section>

  <footer>
    Generated by WOS · ${fmtTs(data.exportedAt)} · static snapshot, no network requests
  </footer>
</div>
</body>
</html>`
}
