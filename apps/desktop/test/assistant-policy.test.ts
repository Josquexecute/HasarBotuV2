import { describe, expect, it } from 'vitest'
import { ASSISTANT_SIZE, assistantGaze, assistantMenuBounds, clampAssistantPosition, isAssistantCommand, isAssistantMenuAction, parseAssistantPosition } from '../src/main/assistant-policy.js'

describe('desktop assistant geometry and commands', () => {
  it.each([{ x: 0,y: 0,width: 1366,height: 728 },{ x: -1536,y: -864,width: 1536,height: 824 },{ x: 0,y: 0,width: 320,height: 240 }])('keeps the menu within every monitor work area %j',(area) => {
    for (const position of [{ x: -9999,y: -9999 },{ x: 9999,y: 9999 }]) {
      const bounds = assistantMenuBounds(position,area)
      expect(bounds.x).toBeGreaterThanOrEqual(area.x);expect(bounds.y).toBeGreaterThanOrEqual(area.y)
      expect(bounds.x+bounds.width).toBeLessThanOrEqual(area.x+area.width);expect(bounds.y+bounds.height).toBeLessThanOrEqual(area.y+area.height)
    }
  })
  it('accepts fixed UI menu actions and rejects paths, commands and objects',() => {
    expect(isAssistantMenuAction('note')).toBe(true)
    for (const action of ['quit','https://example.invalid','exec','C:\\Windows',{},null]) expect(isAssistantMenuAction(action)).toBe(false)
  })
  it.each([
    { x: 0, y: 0, width: 1366, height: 728 },
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: -1536, y: -864, width: 1536, height: 824 },
  ])('keeps the complete control inside the work area %j', (area) => {
    expect(clampAssistantPosition({ x: -99999, y: -99999 }, area)).toEqual({ x: area.x + 8, y: area.y + 8 })
    expect(clampAssistantPosition({ x: 99999, y: 99999 }, area)).toEqual({ x: area.x + area.width - ASSISTANT_SIZE - 8, y: area.y + area.height - ASSISTANT_SIZE - 8 })
  })
  it('retains negative coordinates on a left-hand monitor', () => {
    expect(clampAssistantPosition({ x: -1400, y: 240 }, { x: -1920, y: 0, width: 1920, height: 1080 })).toEqual({ x: -1400, y: 240 })
  })
  it('keeps the larger character inside a small work area', () => {
    expect(clampAssistantPosition({ x: 999, y: 999 }, { x: 0, y: 0, width: 128, height: 128 })).toEqual({ x: 4, y: 4 })
  })
  it('publishes centered gaze and a bounded direction across negative monitors', () => {
    const position = { x: -1200, y: -800 }
    const center = { x: position.x + ASSISTANT_SIZE / 2, y: position.y + ASSISTANT_SIZE / 2 }
    expect(assistantGaze(center, position)).toEqual({ x: 0, y: 0 })
    expect(assistantGaze({ x: center.x - ASSISTANT_SIZE, y: center.y }, position)).toEqual({ x: -1, y: 0 })
    const diagonal = assistantGaze({ x: 999999, y: 999999 }, position)
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1)
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
  it.each(['press', 'drag', 'release', 'cancel', 'menu', 'activate', 'left', 'right', 'up', 'down'])('accepts the UI-only command %s', (value) => {
    expect(isAssistantCommand(value)).toBe(true)
  })
})
