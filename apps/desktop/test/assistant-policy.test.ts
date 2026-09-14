import { describe, expect, it } from 'vitest'
import { clampAssistantPosition, isAssistantCommand, parseAssistantPosition } from '../src/main/assistant-policy.js'

describe('desktop assistant geometry and commands', () => {
  it.each([
    { x: 0, y: 0, width: 1366, height: 728 },
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: -1536, y: -864, width: 1536, height: 824 },
  ])('keeps the complete control inside the work area %j', (area) => {
    expect(clampAssistantPosition({ x: -99999, y: -99999 }, area)).toEqual({ x: area.x + 8, y: area.y + 8 })
    expect(clampAssistantPosition({ x: 99999, y: 99999 }, area)).toEqual({ x: area.x + area.width - 72, y: area.y + area.height - 72 })
  })
  it('retains negative coordinates on a left-hand monitor', () => {
    expect(clampAssistantPosition({ x: -1400, y: 240 }, { x: -1920, y: 0, width: 1920, height: 1080 })).toEqual({ x: -1400, y: 240 })
  })
  it('recovers a disconnected monitor position onto the remaining work area', () => {
    expect(clampAssistantPosition({ x: -1800, y: -900 }, { x: 0, y: 0, width: 1366, height: 728 })).toEqual({ x: 8, y: 8 })
  })
  it.each([null, {}, { x: '2', y: 2 }, { x: NaN, y: 2 }, { x: Infinity, y: 2 }, { x: 2.5, y: 2 }, { x: 2, y: Number.MAX_VALUE }])('rejects malformed saved position %j', (value) => {
    expect(parseAssistantPosition(value)).toBeUndefined()
  })
  it('accepts only integer position data', () => {
    expect(parseAssistantPosition({ x: -1200, y: 80, url: 'https://example.invalid' })).toEqual({ x: -1200, y: 80 })
  })
  it.each(['exec', 'https://example.invalid', 'C:\\Windows', {}, null])('rejects an unknown command %j', (value) => {
    expect(isAssistantCommand(value)).toBe(false)
  })
  it.each(['press', 'drag', 'release', 'cancel', 'menu', 'left', 'right', 'up', 'down'])('accepts the UI-only command %s', (value) => {
    expect(isAssistantCommand(value)).toBe(true)
  })
})
