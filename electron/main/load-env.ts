/**
 * Load repo-root `.env` into `process.env` before other main-process modules read env.
 * Does not overwrite variables already set in the shell. Used for local demos only.
 */

import fs from 'node:fs'
import path from 'node:path'

function stripQuotes(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    return v.slice(1, -1)
  return v
}

export function loadLocalEnvEarly(): void {
  const roots = [
    process.cwd(),
    path.resolve(__dirname, '..', '..'),
    path.resolve(__dirname, '..', '..', '..'),
  ]
  const seen = new Set<string>()
  for (const root of roots) {
    const envPath = path.join(root, '.env')
    if (seen.has(envPath)) continue
    seen.add(envPath)
    if (!fs.existsSync(envPath)) continue
    try {
      const txt = fs.readFileSync(envPath, 'utf8')
      for (const line of txt.split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const eq = line.indexOf('=')
        if (eq <= 0) continue
        const key = line.slice(0, eq).trim()
        let val = stripQuotes(line.slice(eq + 1).trim())
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && process.env[key] === undefined)
          process.env[key] = val
      }
      console.log('[main] loaded', envPath)
      return
    } catch {
      /* ignore malformed .env */
    }
  }
}
