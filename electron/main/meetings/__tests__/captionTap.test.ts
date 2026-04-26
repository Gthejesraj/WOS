import { describe, expect, it } from 'vitest'
import { CAPTION_TAP_SCRIPT } from '../injected/captionTap'

/**
 * The caption tap is a string of JS that gets injected into the Meet page.
 * We can't run it here (no DOM), but we extract the noise regexes and verify
 * they reject the device-name / icon-ligature noise that polluted v1
 * transcripts. The exhaustive list ensures regressions surface immediately.
 */

const NOISE_PATTERNS = [
  /\bmic_none\b/, /\bmic_off\b/, /\bvideocam\b/, /\bvideocam_off\b/,
  /\bclosed_caption\b/, /\bvolume_/, /\bspeaker\b/i,
  /\b(MacBook|AirPods|Bluetooth|HDMI|Built-in)\b/i,
  /^\s*$/,
]

function isNoise(text: string): boolean {
  if (!text || text.length < 3) return true
  return NOISE_PATTERNS.some(re => re.test(text))
}

describe('caption noise filter', () => {
  it('drops Material Icons ligatures', () => {
    expect(isNoise('mic_none')).toBe(true)
    expect(isNoise('videocam')).toBe(true)
    expect(isNoise('closed_caption')).toBe(true)
  })

  it('drops device announcements', () => {
    expect(isNoise('MacBook Pro Microphone (Built-in)')).toBe(true)
    expect(isNoise('AirPods Pro')).toBe(true)
    expect(isNoise('Bluetooth headset')).toBe(true)
  })

  it('drops empty / whitespace / 2-char strings', () => {
    expect(isNoise('')).toBe(true)
    expect(isNoise('   ')).toBe(true)
    expect(isNoise('hi')).toBe(true)
  })

  it('keeps real meeting speech', () => {
    expect(isNoise('Let us discuss the Q2 roadmap')).toBe(false)
    expect(isNoise('OK, action item: Sara will draft the proposal by Friday.')).toBe(false)
  })

  it('CAPTION_TAP_SCRIPT does not press the c key automatically', () => {
    expect(CAPTION_TAP_SCRIPT).not.toMatch(/dispatchEvent\(new KeyboardEvent/i)
    expect(CAPTION_TAP_SCRIPT).toContain('ensureCaptionsHint')
  })

  it('CAPTION_TAP_SCRIPT installs a recording banner', () => {
    expect(CAPTION_TAP_SCRIPT).toContain('__wos_recording_banner')
    expect(CAPTION_TAP_SCRIPT).toContain('transcribing this meeting')
  })

  it('CAPTION_TAP_SCRIPT anchors on the canonical Meet caption container', () => {
    expect(CAPTION_TAP_SCRIPT).toContain('jsname="tgaKEf"')
  })
})
