import { describe, it, expect } from 'vitest'
import { isValidCron } from '../cron'

describe('automations / cron — isValidCron', () => {
  it('accepts standard 5-field expressions', () => {
    expect(isValidCron('* * * * *')).toBe(true)
    expect(isValidCron('0 9 * * 1-5')).toBe(true)
    expect(isValidCron('*/15 * * * *')).toBe(true)
    expect(isValidCron('30 8 1 * *')).toBe(true)
  })

  it('accepts 6-field expressions with seconds', () => {
    expect(isValidCron('0 * * * * *')).toBe(true)
    expect(isValidCron('30 0 9 * * 1-5')).toBe(true)
  })

  it('rejects malformed expressions', () => {
    expect(isValidCron('')).toBe(false)
    expect(isValidCron('not a cron')).toBe(false)
    expect(isValidCron('* * * *')).toBe(false)
    expect(isValidCron('60 * * * *')).toBe(false) // minute out of range
    expect(isValidCron('* 25 * * *')).toBe(false) // hour out of range
  })
})
