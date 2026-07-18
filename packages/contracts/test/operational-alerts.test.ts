import { describe, expect, it } from 'vitest'
import { OPERATIONAL_ALERTS_ROUTE, operationalAlertsResponseSchema } from '../src/index.js'

const alert = {
  dedupeKey: 'overdue_task:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222',
  type: 'overdue_task',
  severity: 'high',
  caseId: '11111111-1111-4111-8111-111111111111',
  plate: '34 MPA 764',
  officeNumber: '2026/12',
  summary: 'Süresi geçmiş görev: Eksik evrak takibi',
  sourceDate: '2026-07-10',
  caseDetailPath: '/dosyalar/11111111-1111-4111-8111-111111111111',
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'operational-alert/1.0.0',
    totalCount: 1,
    evaluatedAt: '2026-07-18T09:00:00.000Z',
    alerts: [alert],
    ...overrides,
  }
}

describe('operational alerts contracts', () => {
  it('salt okunur rota v1 altındadır', () => {
    expect(OPERATIONAL_ALERTS_ROUTE).toBe('/api/v1/operational-alerts')
  })

  it('geçerli yanıtı strict doğrular', () => {
    const parsed = operationalAlertsResponseSchema.parse(response())
    expect(parsed.alerts[0].dedupeKey).toBe(alert.dedupeKey)
    expect(parsed.totalCount).toBe(1)
  })

  it('boş uyarı listesi geçerli sonuçtur', () => {
    expect(operationalAlertsResponseSchema.parse(response({ totalCount: 0, alerts: [] })).alerts)
      .toEqual([])
  })

  it('bilinmeyen tür, önem seviyesi ve fazla anahtarı reddeder', () => {
    expect(() => operationalAlertsResponseSchema.parse(response({
      alerts: [{ ...alert, type: 'unknown' }],
    }))).toThrow()
    expect(() => operationalAlertsResponseSchema.parse(response({
      alerts: [{ ...alert, severity: 'critical' }],
    }))).toThrow()
    expect(() => operationalAlertsResponseSchema.parse(response({
      alerts: [{ ...alert, extra: 'x' }],
    }))).toThrow()
    expect(() => operationalAlertsResponseSchema.parse(response({ extra: 'x' }))).toThrow()
  })

  it('okundu/ertelendi gibi kullanıcı durumu alanı taşımaz', () => {
    expect(() => operationalAlertsResponseSchema.parse(response({
      alerts: [{ ...alert, isRead: false }],
    }))).toThrow()
    expect(() => operationalAlertsResponseSchema.parse(response({
      alerts: [{ ...alert, snoozedUntil: '2026-08-01' }],
    }))).toThrow()
  })

  it('dosya detay bağlantısı yalnız uygulama içi dosya yoluna izin verir', () => {
    for (const path of ['https://example.com/dosyalar/a', '/mevzuat/a', '/dosyalar/../gizli', '/dosyalar/']) {
      expect(() => operationalAlertsResponseSchema.parse(response({
        alerts: [{ ...alert, caseDetailPath: path }],
      }))).toThrow()
    }
  })

  it('geçersiz plaka, ofis numarası ve kaynak tarihi reddeder', () => {
    expect(() => operationalAlertsResponseSchema.parse(response({
      alerts: [{ ...alert, plate: '' }],
    }))).toThrow()
    expect(() => operationalAlertsResponseSchema.parse(response({
      alerts: [{ ...alert, officeNumber: '12/2026' }],
    }))).toThrow()
    expect(() => operationalAlertsResponseSchema.parse(response({
      alerts: [{ ...alert, sourceDate: '2026-07-10T00:00:00.000Z' }],
    }))).toThrow()
    expect(() => operationalAlertsResponseSchema.parse(response({
      alerts: [{ ...alert, sourceDate: '2026-02-31' }],
    }))).toThrow()
  })

  it('sürüm etiketi sabittir ve sayaç negatif olamaz', () => {
    expect(() => operationalAlertsResponseSchema.parse(response({ schemaVersion: 'operational-alert/9.9.9' })))
      .toThrow()
    expect(() => operationalAlertsResponseSchema.parse(response({ totalCount: -1 }))).toThrow()
  })
})
