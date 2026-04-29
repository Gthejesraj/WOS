import { describe, it, expect, vi } from 'vitest'
import { askUserTool } from '../askUser'
import type { ToolContext } from '../index'

function makeCtx(answer = 'ok') {
  const calls: { question: string; questionId: string; choices?: string[]; extras?: unknown }[] = []
  const ctx: Partial<ToolContext> = {
    onAskUser: vi.fn(async (question, questionId, choices, extras) => {
      calls.push({ question, questionId, choices, extras })
      return answer
    }),
  }
  return { ctx: ctx as ToolContext, calls }
}

describe('askUser tool — render-component protocol', () => {
  it('defaults kind to "text" when no choices and no kind given', async () => {
    const { ctx, calls } = makeCtx()
    await askUserTool.execute({ question: 'name?' }, ctx)
    expect(calls[0].extras).toMatchObject({ kind: 'text' })
  })

  it('defaults kind to "choice" when choices provided', async () => {
    const { ctx, calls } = makeCtx()
    await askUserTool.execute({ question: 'a or b?', choices: ['a', 'b'] }, ctx)
    expect(calls[0].extras).toMatchObject({ kind: 'choice' })
    expect(calls[0].choices).toEqual(['a', 'b'])
  })

  it('threads kind=fileDrop with accept[] through to onAskUser', async () => {
    const { ctx, calls } = makeCtx('[]')
    await askUserTool.execute(
      { question: 'drop a file', kind: 'fileDrop', accept: ['.txt', '.vtt'] },
      ctx,
    )
    expect(calls[0].extras).toMatchObject({ kind: 'fileDrop', accept: ['.txt', '.vtt'] })
  })

  it('threads kind=confirm', async () => {
    const { ctx, calls } = makeCtx('yes')
    const r = await askUserTool.execute({ question: 'sure?', kind: 'confirm' }, ctx)
    expect(calls[0].extras).toMatchObject({ kind: 'confirm' })
    expect(r.output).toBe('yes')
  })

  it('threads kind=form with fields', async () => {
    const { ctx, calls } = makeCtx('{"a":"b"}')
    await askUserTool.execute(
      {
        question: 'fill in',
        kind: 'form',
        fields: [{ key: 'a', label: 'A', type: 'text', required: true }],
      },
      ctx,
    )
    expect(calls[0].extras).toMatchObject({
      kind: 'form',
      fields: [{ key: 'a', label: 'A', type: 'text', required: true }],
    })
  })

  it('threads kind=picker with source + multi', async () => {
    const { ctx, calls } = makeCtx('chan-1')
    await askUserTool.execute(
      { question: 'which channel?', kind: 'picker', source: 'channel', multi: false },
      ctx,
    )
    expect(calls[0].extras).toMatchObject({ kind: 'picker', source: 'channel', multi: false })
  })
})
