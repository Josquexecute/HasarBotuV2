import { describe, expect, it } from 'vitest'
import { assistantAppearanceSchema, DEFAULT_ASSISTANT_APPEARANCE } from '../src/v1/assistant-appearance.js'

describe('Touch eye color preferences', () => {
  it('accepts old preferences, automatic eyes and full palette colors', () => {
    expect(assistantAppearanceSchema.parse(DEFAULT_ASSISTANT_APPEARANCE)).toEqual(DEFAULT_ASSISTANT_APPEARANCE)
    for (const eyeColor of [null, '#000000', '#ffffff', '#12abEF']) {
      expect(assistantAppearanceSchema.parse({ ...DEFAULT_ASSISTANT_APPEARANCE, eyeColor }).eyeColor).toBe(eyeColor)
    }
  })
  it('rejects invalid colors and injected content', () => {
    for (const eyeColor of ['#fff', 'red', '#12345678', 'url(file:///private)', 42]) {
      expect(assistantAppearanceSchema.safeParse({ ...DEFAULT_ASSISTANT_APPEARANCE, eyeColor }).success).toBe(false)
    }
  })
})
