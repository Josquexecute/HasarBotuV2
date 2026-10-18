import { describe, expect, it, vi } from 'vitest'
import { createHttpValueLossCalculatorAdapter } from './valueLossCalculatorPort'
import type { ValueLossCalculatorRequest } from '@hasarbotu/contracts'

describe('calculator HTTP adapter', () => {
  it('sends a calculation request with the active account and validates its response', async () => {
    const result = { amountMinor: 50_000, ruleVersion: 'test', calculationMethod: 'real_market_analysis', issues: [] }
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }))
    const input = { marketValueMinor: 10_000 } as ValueLossCalculatorRequest
    expect(await createHttpValueLossCalculatorAdapter({ fetchImpl }).calculate('case/1',input)).toEqual(result)
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/cases/case%2F1/traffic-value-loss/calculate', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify(input) }))
  })
  it.each([[401,'unauthorized'],[403,'forbidden'],[400,'validation'],[404,'not_found'],[503,'unavailable']])('maps HTTP %s without exposing raw server content', async (status,kind) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('Private diagnostic detail', { status: Number(status) }))
    await expect(createHttpValueLossCalculatorAdapter({ fetchImpl }).calculate('case-1',{} as ValueLossCalculatorRequest)).rejects.toMatchObject({ kind, message: 'Calculator request failed' })
  })
  it('rejects malformed success responses instead of inventing a result', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ amountMinor: -1 }), { status: 200 }))
    await expect(createHttpValueLossCalculatorAdapter({ fetchImpl }).calculate('case-1',{} as ValueLossCalculatorRequest)).rejects.toMatchObject({ kind: 'unavailable' })
  })
})
