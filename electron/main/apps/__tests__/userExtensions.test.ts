import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('userExtensions', () => {
  let tmpHome: string
  let prevHome: string | undefined

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-user-ext-'))
    prevHome = process.env.WOS_HOME
    process.env.WOS_HOME = tmpHome
    vi.resetModules()
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.WOS_HOME
    else process.env.WOS_HOME = prevHome
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it('reads markdown skills under ~/.wos/apps/<id>/skills/', async () => {
    const dir = path.join(tmpHome, 'apps', 'github', 'skills')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'review-pr.md'),
      '---\ndescription: Review a PR carefully\n---\n\nDo the thing.'
    )
    fs.writeFileSync(
      path.join(dir, 'with-id.md'),
      '---\nid: custom-id\ndescription: Has explicit id\n---\nbody'
    )

    const mod = await import('../userExtensions')
    const skills = mod.getUserAppSkills('github', { refresh: true })
    expect(skills).toHaveLength(2)
    const reviewPr = skills.find(s => s.id === 'review-pr')
    expect(reviewPr?.description).toBe('Review a PR carefully')
    expect(reviewPr?.body.trim()).toBe('Do the thing.')
    expect(skills.find(s => s.id === 'custom-id')?.description).toBe('Has explicit id')
  })

  it('returns empty array when no extensions exist', async () => {
    const mod = await import('../userExtensions')
    expect(mod.getUserAppSkills('nonexistent', { refresh: true })).toEqual([])
  })

  it('caches skills until refresh:true is passed', async () => {
    const dir = path.join(tmpHome, 'apps', 'slack', 'skills')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'a.md'), '---\ndescription: A\n---\nx')
    const mod = await import('../userExtensions')
    expect(mod.getUserAppSkills('slack', { refresh: true })).toHaveLength(1)

    fs.writeFileSync(path.join(dir, 'b.md'), '---\ndescription: B\n---\ny')
    expect(mod.getUserAppSkills('slack')).toHaveLength(1)
    expect(mod.getUserAppSkills('slack', { refresh: true })).toHaveLength(2)
  })
})
