import { describe, expect, it } from 'vitest'
import {
  canTransitionCaseTask,
  classifyCaseTaskDueDate,
} from '../src/index.js'

describe('case operations domain', () => {
  it('yalnız açık görevin tamamlanmasına veya iptaline izin verir', () => {
    expect(canTransitionCaseTask({ from: 'open', to: 'completed' })).toBe(true)
    expect(canTransitionCaseTask({ from: 'open', to: 'cancelled' })).toBe(true)
    expect(canTransitionCaseTask({ from: 'completed', to: 'cancelled' })).toBe(false)
    expect(canTransitionCaseTask({ from: 'cancelled', to: 'completed' })).toBe(false)
  })

  it('LocalDate görev tarihini timezone kullanmadan sınıflandırır', () => {
    expect(classifyCaseTaskDueDate('2026-07-15', '2026-07-16')).toBe('overdue')
    expect(classifyCaseTaskDueDate('2026-07-16', '2026-07-16')).toBe('today')
    expect(classifyCaseTaskDueDate('2026-07-23', '2026-07-16')).toBe('upcoming')
    expect(classifyCaseTaskDueDate('2026-07-24', '2026-07-16')).toBe('scheduled')
  })
})
