import { describe,expect,it } from 'vitest'
import { toOfficeDate } from '../src/index.js'
describe('office calendar',() => {
  it.each([['2026-10-12T20:59:59.999Z','2026-10-12'],['2026-10-12T21:00:00.000Z','2026-10-13'],['2026-10-13','2026-10-13']])('resolves %s to %s',(input,expected) => {
    expect(toOfficeDate(input)).toBe(expected)
  })
})
