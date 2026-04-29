import { afterEach, describe, expect, it } from 'vitest'
import {
  clearHooks,
  emitNotification,
  registerHooks,
  runBeforeSubagent,
  runOnConnect,
  runOnDisconnect,
  runOnError,
  runPostToolUse,
  runPreToolUse,
} from '../manager'

afterEach(() => clearHooks())

describe('hooks manager', () => {
  it('PreToolUse: handlers can mutate args', async () => {
    registerHooks('test', {
      PreToolUse: (_n, args) => ({ args: { ...(args as object), tagged: true } }),
    })
    const out = await runPreToolUse('bash', { cmd: 'ls' })
    expect(out.block).toBe(false)
    expect(out.args).toEqual({ cmd: 'ls', tagged: true })
  })

  it('PreToolUse: handlers can block the call', async () => {
    registerHooks('test', {
      PreToolUse: () => ({ block: true, reason: 'forbidden' }),
    })
    const out = await runPreToolUse('bash', { cmd: 'rm -rf /' })
    expect(out.block).toBe(true)
    expect(out.reason).toBe('forbidden')
  })

  it('PostToolUse: handlers can mutate result', async () => {
    registerHooks('test', {
      PostToolUse: (_n, _a, result) => ({ result: { ...(result as object), audited: 1 } }),
    })
    const out = await runPostToolUse('bash', {}, { ok: true })
    expect(out).toEqual({ ok: true, audited: 1 })
  })

  it('OnConnect / OnDisconnect / Notification: best-effort fan-out', async () => {
    const calls: string[] = []
    registerHooks('a', {
      OnConnect: (id) => { calls.push(`connect:${id}`) },
      OnDisconnect: (id) => { calls.push(`disc:${id}`) },
      Notification: (_l, msg) => { calls.push(`notif:${msg}`) },
    })
    registerHooks('b', {
      OnConnect: () => { throw new Error('boom') },
    })
    await runOnConnect('slack', { token: 'x' })
    await runOnDisconnect('slack')
    await emitNotification('info', 'hi')
    expect(calls).toEqual(['connect:slack', 'disc:slack', 'notif:hi'])
  })

  it('OnError: first handler that returns handled wins', async () => {
    registerHooks('a', { OnError: () => ({ handled: false }) })
    registerHooks('b', { OnError: () => ({ handled: true, result: { fallback: true } }) })
    registerHooks('c', { OnError: () => { throw new Error('should not run after handled') } })
    const out = await runOnError('bash', new Error('x'))
    expect(out.handled).toBe(true)
    expect(out.result).toEqual({ fallback: true })
  })

  it('BeforeSubagent: can block', async () => {
    registerHooks('test', {
      BeforeSubagent: (name) => name === 'meeting' ? { block: true, reason: 'disabled' } : undefined,
    })
    const out = await runBeforeSubagent('meeting', { description: 'x', prompt: 'y' })
    expect(out.block).toBe(true)
    expect(out.reason).toBe('disabled')
  })
})
