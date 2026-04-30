import { registry } from './registry'

/**
 * Standing orders are markdown rules injected into the WOS main agent's
 * system prompt at runtime. Each enabled `standing_order` automation
 * contributes its prompt to the appended fragment.
 */
export function buildStandingOrdersFragment(): string {
  const rules = registry.list({ kind: 'standing_order', enabled: true })
  if (rules.length === 0) return ''
  const items = rules
    .map(r => `- **${r.name}** — ${r.prompt.trim()}`)
    .join('\n')
  return `\n\n## Standing Orders\nThese are user-defined rules that always apply:\n${items}\n`
}
