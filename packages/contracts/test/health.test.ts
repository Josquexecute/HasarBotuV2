import { describe, expect, it } from 'vitest'
import { HEALTH_STATUSES, healthResponseSchema } from '../src/index.js'

describe('health yaniti sozlesmesi', () => {
  const valid = {
    status: 'ok',
    service: 'hasarbotu-api',
    version: '0.1.0-ui-baseline',
    checkedAt: '2026-07-11T09:00:00Z',
  }

  it('gecerli health yanitini kabul eder', () => {
    expect(healthResponseSchema.safeParse(valid).success).toBe(true)
    expect(healthResponseSchema.safeParse({ ...valid, status: 'degraded' }).success).toBe(true)
  })

  it('status yalniz ok/degraded olabilir', () => {
    expect(HEALTH_STATUSES).toEqual(['ok', 'degraded'])
    expect(healthResponseSchema.safeParse({ ...valid, status: 'unavailable' }).success).toBe(false)
    expect(healthResponseSchema.safeParse({ ...valid, status: 'fine' }).success).toBe(false)
  })

  it('gecersiz checkedAt ve bos service/version reddedilir', () => {
    expect(healthResponseSchema.safeParse({ ...valid, checkedAt: '2026-07-11' }).success).toBe(false)
    expect(healthResponseSchema.safeParse({ ...valid, service: '' }).success).toBe(false)
    expect(healthResponseSchema.safeParse({ ...valid, version: '' }).success).toBe(false)
  })

  it('strict: bilinmeyen alan reddedilir', () => {
    expect(healthResponseSchema.safeParse({ ...valid, uptime: 5 }).success).toBe(false)
  })
})
