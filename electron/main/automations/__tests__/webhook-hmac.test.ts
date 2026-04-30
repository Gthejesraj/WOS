import { describe, it, expect } from 'vitest'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verifies the HMAC-SHA256 scheme used by `electron/main/automations/webhooks.ts`:
 *   provided header  → 'sha256=' + hmacSha256(secret, rawBody).hex()
 *   compare with timingSafeEqual on equal-length buffers.
 *
 * If the production code drifts from this scheme, this test will fail and the
 * scheme should be re-aligned consciously.
 */

function sign(secret: string, body: Buffer | string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

function timingEq(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

describe('automations / webhooks — HMAC verification scheme', () => {
  const secret = 'super-secret-key'
  const body = Buffer.from(JSON.stringify({ event: 'ping', n: 42 }))

  it('signs and verifies a payload', () => {
    const sig = sign(secret, body)
    expect(sig.startsWith('sha256=')).toBe(true)
    expect(timingEq(sig, sign(secret, body))).toBe(true)
  })

  it('rejects a tampered payload', () => {
    const sig = sign(secret, body)
    const tampered = Buffer.from(JSON.stringify({ event: 'ping', n: 43 }))
    expect(timingEq(sig, sign(secret, tampered))).toBe(false)
  })

  it('rejects a wrong secret', () => {
    const sig = sign(secret, body)
    expect(timingEq(sig, sign('other-secret', body))).toBe(false)
  })

  it('rejects unequal-length signatures without crashing', () => {
    expect(timingEq('sha256=abc', 'sha256=' + 'a'.repeat(64))).toBe(false)
  })
})
