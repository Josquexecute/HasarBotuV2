import { expect, it } from 'vitest'
import { AssistantFeedbackState } from '../src/main/assistant-feedback.js'
import { assistantEdge } from '../src/main/assistant-policy.js'

it('keeps work active until all windows finish and rejects unmatched or duplicate completions', () => {
  const feedback = new AssistantFeedbackState()
  const activity = (sender: number, id: string, phase: string, message?: string) => feedback.accept(sender, { type: 'activity', id, phase, message })
  activity(1, 'first', 'start'); activity(1, 'second', 'start'); activity(2, 'first', 'start')
  expect(activity(1, 'first', 'start')).toEqual([])
  expect(activity(3, 'first', 'finish')).toEqual([])
  activity(1, 'first', 'finish')
  expect(feedback.working).toBe(true)
  feedback.clear(1)
  expect(feedback.working).toBe(true)
  expect(activity(2, 'first', 'fail', 'Belge yüklenemedi')).toEqual([{ type: 'working', active: false }, { type: 'error', active: true }])
  expect(feedback.error).toBe('Belge yüklenemedi')
  expect(feedback.working).toBe(false)
  expect(activity(2, 'first', 'finish')).toEqual([])
  expect(feedback.accept(1, { type: 'completed' }).at(-1)).toEqual({ type: 'celebrate' })
  expect(feedback.error).toBeUndefined()
})

it('bounds pending work and rejects malformed payloads without affecting state', () => {
  const feedback = new AssistantFeedbackState()
  for (const value of [null, {}, { type: 'exec' }, { type: 'activity', id: '../file', phase: 'start' }, { type: 'activity', id: 'valid', phase: {} }]) expect(feedback.accept(1, value)).toEqual([])
  for (let index = 0; index < 65; index++) feedback.accept(1, { type: 'activity', id: String(index), phase: 'start' })
  expect(feedback.accept(1, { type: 'activity', id: '64', phase: 'finish' })).toEqual([])
  expect(feedback.accept(1, { type: 'activity', id: '0', phase: 'fail', message: 'x'.repeat(501) })).toEqual([])
  feedback.clear(1)
  expect(feedback.working).toBe(false)
})

it('detects edges in DIP on negative monitors without moving the control', () => {
  const area = { x: -1920, y: -200, width: 1920, height: 1080 }
  expect(assistantEdge({ x: -1912, y: 30 }, area)).toBe(-1)
  expect(assistantEdge({ x: -128, y: 30 }, area)).toBe(1)
  expect(assistantEdge({ x: -600, y: 30 }, area)).toBe(0)
})
