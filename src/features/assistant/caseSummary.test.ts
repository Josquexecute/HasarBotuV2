import { describe, expect, it } from 'vitest'
import { mockCases } from '../../mocks/cases'
import { notificationDate, serviceMobile } from './caseSummary'

describe('verified service mobile', () => {
  it.each(['0532 123 45 67', '5321234567', '+90 (532) 123-45-67', '0090 532 123 45 67', '905321234567'])('accepts the recorded mobile %s', phone => {
    expect(serviceMobile({ ...mockCases[0]!, serviceDetails: { name: 'Servis', phone, address: null } })).toBe('0532 123 45 67')
  })
  it.each([null, '', '0212 123 45 67', '+90 312 123 45 67', '0850 123 45 67', '0532 123 45', 'Telefon: 05321234567', '05321234567 / 05421234567', '+44 7700 900123'])('never labels missing, ambiguous or non-mobile data as mobile: %s', phone => {
    expect(serviceMobile({ ...mockCases[0]!, serviceDetails: { name: 'Servis', phone, address: null } })).toBeNull()
  })
  it('keeps an explicitly empty contact authoritative instead of using a directory number', () => {
    const item = { ...mockCases[0]!, serviceId: 'service-a', serviceProfile: { id: 'service-a', phone: '05321234567' } } as typeof mockCases[number]
    expect(serviceMobile(item)).toBe('0532 123 45 67')
    expect(serviceMobile({ ...item, serviceDetails: null })).toBeNull()
    expect(serviceMobile({ ...item, serviceDetails: { name: 'Servis', phone: null, address: null } })).toBeNull()
    expect(serviceMobile({ ...item, serviceId: 'service-b' })).toBeNull()
  })
  it('formats the recorded local date without timezone conversion', () => {
    expect(notificationDate('2026-11-04')).toBe('04.11.2026')
    expect(notificationDate(null)).toBe('—')
    expect(notificationDate(undefined)).toBe('—')
  })
})
