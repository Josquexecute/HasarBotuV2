import { describe, expect, it } from 'vitest'
import { moneyMinor } from './value-loss-calculator-form'

describe('calculator TL input', () => {
  it.each([['1.000.000,50',100000050], ['1000000.50',100000050], ['1 000 000,5',100000050], ['1.234',123400], ['1234',123400], ['0',0]])('parses %s without floating point rounding', (input, expected) => expect(moneyMinor(input)).toBe(expected))
  it.each(['', '-1', '1,234', 'abc', '1.2.3', '9007199254740992'])('rejects invalid or unsafe %s', input => expect(moneyMinor(input)).toBeNull())
})
