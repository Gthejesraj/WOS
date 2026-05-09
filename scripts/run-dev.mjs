#!/usr/bin/env node
/**
 * Cross-platform dev launcher: unsets ELECTRON_RUN_AS_NODE and applies
 * generous defaults for RunPod/HF cold starts (overridable via env or .env).
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

// Mirror load-env early so defaults apply even before Electron loads main
for (const tryRoot of [process.cwd(), root]) {
  const envPath = path.join(tryRoot, '.env')
  if (!fs.existsSync(envPath)) continue
  const txt = fs.readFileSync(envPath, 'utf8')
  for (const line of txt.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1)
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && process.env[key] === undefined)
      process.env[key] = val
  }
  break
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

env.WOS_OPENAI_COMPAT_TIMEOUT_MS = env.WOS_OPENAI_COMPAT_TIMEOUT_MS || '420000'
env.WOS_ANTHROPIC_HTTP_TIMEOUT_MS = env.WOS_ANTHROPIC_HTTP_TIMEOUT_MS || env.WOS_OPENAI_COMPAT_TIMEOUT_MS
env.WOS_PRIMARY_COLD_RETRY_MS = env.WOS_PRIMARY_COLD_RETRY_MS || '5000'
env.WOS_PRIMARY_COLD_RETRY_COUNT = env.WOS_PRIMARY_COLD_RETRY_COUNT || '1'

const forge = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-forge.cmd' : 'electron-forge')
const child = spawn(forge, ['start', '--', '--no-deprecation'], {
  env,
  stdio: 'inherit',
  cwd: root,
  shell: process.platform === 'win32',
})

child.on('exit', (code, signal) => {
  if (signal) process.exit(1)
  process.exit(code ?? 0)
})
