import { describe, it, expect } from 'vitest'
import { applyEvent } from '../src/lib/blockAccumulator'
import type { MessageBlock } from '../src/types'

describe('blockAccumulator', () => {
  it('appends text deltas into a single block', () => {
    let blocks: MessageBlock[] = []
    blocks = applyEvent(blocks, { type: 'text_delta', content: 'Hel' })
    blocks = applyEvent(blocks, { type: 'text_delta', content: 'lo' })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({ type: 'text', content: 'Hello' })
  })

  it('accumulates reasoning deltas into a single reasoning block', () => {
    let blocks: MessageBlock[] = []
    blocks = applyEvent(blocks, { type: 'reasoning_delta', content: 'think ' })
    blocks = applyEvent(blocks, { type: 'reasoning_delta', content: 'more' })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'reasoning', content: 'think more', done: false })
  })

  it('auto-closes open reasoning block when text starts (auto-collapse UX)', () => {
    let blocks: MessageBlock[] = []
    blocks = applyEvent(blocks, { type: 'reasoning_delta', content: 'planning…' })
    blocks = applyEvent(blocks, { type: 'text_delta', content: 'Here is the answer' })
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ type: 'reasoning', done: true, collapsed: true })
    expect(blocks[1]).toMatchObject({ type: 'text', content: 'Here is the answer' })
  })

  it('does not re-open a done reasoning block for late deltas', () => {
    let blocks: MessageBlock[] = []
    blocks = applyEvent(blocks, { type: 'reasoning_delta', content: 'a' })
    blocks = applyEvent(blocks, { type: 'text_delta', content: 'X' })
    // late reasoning delta after text started - should start a *new* reasoning block, not append
    blocks = applyEvent(blocks, { type: 'reasoning_delta', content: 'b' })
    expect(blocks.filter(b => b.type === 'reasoning')).toHaveLength(2)
  })

  it('creates tool_use block on tool_preparing and streams partialArgs on tool_arg_delta', () => {
    let blocks: MessageBlock[] = []
    blocks = applyEvent(blocks, { type: 'tool_preparing', toolName: 'Bash', toolId: 't1' })
    blocks = applyEvent(blocks, { type: 'tool_arg_delta', toolId: 't1', delta: '{"cmd":' })
    blocks = applyEvent(blocks, { type: 'tool_arg_delta', toolId: 't1', delta: '"ls"}' })
    const tool = blocks.find(b => b.type === 'tool_use')
    expect(tool).toMatchObject({
      type: 'tool_use',
      toolName: 'Bash',
      toolId: 't1',
      status: 'preparing',
      partialArgs: '{"cmd":"ls"}',
    })
  })

  it('upgrades preparing tool_use to running on tool_use_start', () => {
    let blocks: MessageBlock[] = []
    blocks = applyEvent(blocks, { type: 'tool_preparing', toolName: 'Bash', toolId: 't1' })
    blocks = applyEvent(blocks, { type: 'tool_arg_delta', toolId: 't1', delta: '{"command":"ls"}' })
    blocks = applyEvent(blocks, {
      type: 'tool_use_start',
      toolName: 'Bash',
      toolId: 't1',
      input: { command: 'ls' },
    })
    const tool = blocks.find(b => b.type === 'tool_use')
    expect(tool).toMatchObject({
      type: 'tool_use',
      status: 'running',
      input: { command: 'ls' },
    })
  })

  it('marks any still-open reasoning block done on turn_complete', () => {
    let blocks: MessageBlock[] = []
    blocks = applyEvent(blocks, { type: 'reasoning_delta', content: 'thinking' })
    blocks = applyEvent(blocks, {
      type: 'turn_complete',
      usage: { inputTokens: 1, outputTokens: 1 },
      reason: 'end_turn',
    })
    expect(blocks[0]).toMatchObject({ type: 'reasoning', done: true, collapsed: true })
  })

  it('appends stdout/stderr deltas onto the matching tool_use block', () => {
    let blocks: MessageBlock[] = []
    blocks = applyEvent(blocks, { type: 'tool_use_start', toolName: 'Bash', toolId: 't2', input: { command: 'echo hi' } })
    blocks = applyEvent(blocks, { type: 'tool_stdout_delta', toolId: 't2', delta: 'hel' })
    blocks = applyEvent(blocks, { type: 'tool_stdout_delta', toolId: 't2', delta: 'lo\n' })
    blocks = applyEvent(blocks, { type: 'tool_stderr_delta', toolId: 't2', delta: 'warn: x' })
    const tool = blocks.find(b => b.type === 'tool_use')
    expect(tool).toMatchObject({
      type: 'tool_use',
      toolId: 't2',
      stdout: 'hello\n',
      stderr: 'warn: x',
    })
  })
})
