import { describe, it, expect } from 'vitest'
import { PermissionStore, canUseTool } from '../electron/main/agent/permissions'

describe('canUseTool — rule based', () => {
  it('allows safe tools by default', async () => {
    const s = new PermissionStore()
    expect((await canUseTool('Read', 'default', s)).decision).toBe('auto')
    expect((await canUseTool('Glob', 'default', s)).decision).toBe('auto')
    expect((await canUseTool('WebFetch', 'default', s)).decision).toBe('auto')
  })

  it('asks for writes by default', async () => {
    const s = new PermissionStore()
    expect((await canUseTool('Write', 'default', s)).decision).toBe('request')
    expect((await canUseTool('FileEdit', 'default', s)).decision).toBe('request')
    expect((await canUseTool('Bash', 'default', s, { command: 'ls' })).decision).toBe('request')
  })

  it('blocks dangerous bash patterns outright, even in yolo mode', async () => {
    const s = new PermissionStore()
    const r1 = await canUseTool('Bash', 'yolo', s, { command: 'rm -rf /' })
    expect(r1.decision).toBe('deny')
    const r2 = await canUseTool('Bash', 'yolo', s, { command: 'mkfs.ext4 /dev/sda' })
    expect(r2.decision).toBe('deny')
    const r3 = await canUseTool('Bash', 'yolo', s, { command: 'shutdown -h now' })
    expect(r3.decision).toBe('deny')
  })

  it('yolo auto-allows non-dangerous tools', async () => {
    const s = new PermissionStore()
    expect((await canUseTool('Bash', 'yolo', s, { command: 'ls -la' })).decision).toBe('auto')
    expect((await canUseTool('Write', 'yolo', s)).decision).toBe('auto')
  })

  it('plan mode auto-allows reads and defers tool effects', async () => {
    const s = new PermissionStore()
    expect((await canUseTool('Read', 'plan', s)).decision).toBe('auto')
    expect((await canUseTool('Write', 'plan', s)).decision).toBe('auto')
  })

  it('respects session grants for ask tools', async () => {
    const s = new PermissionStore()
    expect((await canUseTool('Write', 'default', s)).decision).toBe('request')
    s.addSessionGrant('Write')
    expect((await canUseTool('Write', 'default', s)).decision).toBe('auto')
  })

  it('respects custom rule overrides', async () => {
    const s = new PermissionStore()
    s.setRule('Bash', 'deny')
    const r = await canUseTool('Bash', 'default', s, { command: 'echo hi' })
    expect(r.decision).toBe('deny')

    s.setRule('Write', 'allow')
    expect((await canUseTool('Write', 'default', s)).decision).toBe('auto')
  })
})
