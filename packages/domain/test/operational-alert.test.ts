import { describe, expect, it } from 'vitest'

import {
  MAX_OPERATIONAL_ALERTS,
  MAX_OPERATIONAL_ALERT_SUMMARY_LENGTH,
  OPERATIONAL_ALERT_SEVERITIES,
  OPERATIONAL_ALERT_TYPES,
  buildMissingDocumentAlert,
  buildOverdueFollowUpAlert,
  buildOverdueTaskAlert,
  collectOperationalAlerts,
  normalizeOperationalAlerts,
  requirementLabel,
  type MissingDocumentFact,
  type OperationalAlert,
  type OverdueFollowUpFact,
  type OverdueTaskFact,
} from '../src/operational-alert.js'

const AS_OF = '2026-07-18'

function taskFact(overrides: Partial<OverdueTaskFact> = {}): OverdueTaskFact {
  return {
    caseId: '11111111-1111-4111-8111-111111111111',
    plate: '34MPA764',
    officeNumber: '2026/12',
    taskId: '22222222-2222-4222-8222-222222222222',
    title: 'Eksik evrak takibi',
    priority: 'normal',
    dueDate: '2026-07-10',
    ...overrides,
  }
}

function followUpFact(overrides: Partial<OverdueFollowUpFact> = {}): OverdueFollowUpFact {
  return {
    caseId: '11111111-1111-4111-8111-111111111111',
    plate: '34MPA764',
    officeNumber: '2026/12',
    followUpDate: '2026-07-01',
    ...overrides,
  }
}

function documentFact(overrides: Partial<MissingDocumentFact> = {}): MissingDocumentFact {
  return {
    caseId: '11111111-1111-4111-8111-111111111111',
    plate: '34MPA764',
    officeNumber: '2026/12',
    requirementCode: 'traffic_victim_policy',
    evaluatedDate: AS_OF,
    ...overrides,
  }
}

describe('operational alert sabitleri', () => {
  it('tür ve önem seviyeleri bu dilimde sabittir', () => {
    expect(OPERATIONAL_ALERT_TYPES).toEqual([
      'overdue_task',
      'overdue_follow_up',
      'missing_required_document',
    ])
    expect(OPERATIONAL_ALERT_SEVERITIES).toEqual(['high', 'medium', 'low'])
  })
})

describe('buildOverdueTaskAlert', () => {
  it('yalnız süresi geçmiş görev için uyarı üretir', () => {
    expect(buildOverdueTaskAlert(taskFact({ dueDate: AS_OF }), AS_OF)).toBeNull()
    expect(buildOverdueTaskAlert(taskFact({ dueDate: '2026-07-19' }), AS_OF)).toBeNull()
    expect(buildOverdueTaskAlert(taskFact({ dueDate: '2026-09-01' }), AS_OF)).toBeNull()
    expect(buildOverdueTaskAlert(taskFact(), AS_OF)).not.toBeNull()
  })

  it('görev önceliğini önem seviyesine eşler', () => {
    expect(buildOverdueTaskAlert(taskFact({ priority: 'high' }), AS_OF)?.severity).toBe('high')
    expect(buildOverdueTaskAlert(taskFact({ priority: 'normal' }), AS_OF)?.severity).toBe('medium')
    expect(buildOverdueTaskAlert(taskFact({ priority: 'low' }), AS_OF)?.severity).toBe('low')
  })

  it('dosya kimliği, plaka, kaynak tarih ve detay bağlantısı taşır', () => {
    const alert = buildOverdueTaskAlert(taskFact(), AS_OF)
    expect(alert).toMatchObject({
      dedupeKey: 'overdue_task:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222',
      type: 'overdue_task',
      caseId: '11111111-1111-4111-8111-111111111111',
      plate: '34MPA764',
      officeNumber: '2026/12',
      summary: 'Süresi geçmiş görev: Eksik evrak takibi',
      sourceDate: '2026-07-10',
      caseDetailPath: '/dosyalar/11111111-1111-4111-8111-111111111111',
    })
  })

  it('görev başlığını tek satıra indirger ve sınırlar', () => {
    const alert = buildOverdueTaskAlert(taskFact({ title: ` Servis\n\t ile   görüş ${'x'.repeat(400)}` }), AS_OF)
    expect(alert?.summary.length).toBe(MAX_OPERATIONAL_ALERT_SUMMARY_LENGTH)
    expect(alert?.summary.startsWith('Süresi geçmiş görev: Servis ile görüş x')).toBe(true)
  })

  it('boş başlıkta genel açıklama kullanır', () => {
    expect(buildOverdueTaskAlert(taskFact({ title: '   ' }), AS_OF)?.summary).toBe('Süresi geçmiş görev')
  })
})

describe('buildOverdueFollowUpAlert', () => {
  it('yalnız geçmiş takip tarihi için uyarı üretir', () => {
    expect(buildOverdueFollowUpAlert(followUpFact({ followUpDate: AS_OF }), AS_OF)).toBeNull()
    expect(buildOverdueFollowUpAlert(followUpFact({ followUpDate: '2026-07-20' }), AS_OF)).toBeNull()
    expect(buildOverdueFollowUpAlert(followUpFact(), AS_OF)).toMatchObject({
      dedupeKey: 'overdue_follow_up:11111111-1111-4111-8111-111111111111',
      type: 'overdue_follow_up',
      severity: 'medium',
      summary: 'Takip tarihi geçti',
      sourceDate: '2026-07-01',
    })
  })
})

describe('buildMissingDocumentAlert', () => {
  it('gereksinim kodunu Türkçe etikete çevirir', () => {
    expect(buildMissingDocumentAlert(documentFact())).toMatchObject({
      dedupeKey: 'missing_required_document:11111111-1111-4111-8111-111111111111:traffic_victim_policy',
      type: 'missing_required_document',
      severity: 'high',
      summary: 'Eksik zorunlu evrak: Mağdur trafik poliçesi',
      sourceDate: AS_OF,
    })
  })

  it('bilinmeyen kodda kodun kendisini gösterir', () => {
    expect(requirementLabel('unknown_code')).toBe('unknown_code')
    expect(buildMissingDocumentAlert(documentFact({ requirementCode: 'unknown_code' })).summary)
      .toBe('Eksik zorunlu evrak: unknown_code')
  })
})

describe('normalizeOperationalAlerts', () => {
  const base: OperationalAlert = {
    dedupeKey: 'a',
    type: 'overdue_task',
    severity: 'medium',
    caseId: 'case-a',
    plate: '34AAA111',
    officeNumber: '2026/1',
    summary: 'x',
    sourceDate: '2026-07-10',
    caseDetailPath: '/dosyalar/case-a',
  }

  it('aynı dosya ve aynı sebep için mükerrer uyarı üretmez', () => {
    const result = normalizeOperationalAlerts([base, { ...base, summary: 'y' }, { ...base, dedupeKey: 'b' }])
    expect(result).toHaveLength(2)
    expect(result.map((alert) => alert.dedupeKey)).toEqual(['a', 'b'])
    expect(result[0]?.summary).toBe('x')
  })

  it('önem, kaynak tarih, dosya ve anahtar sırasıyla deterministik sıralar', () => {
    const result = normalizeOperationalAlerts([
      { ...base, dedupeKey: 'low', severity: 'low', sourceDate: '2026-01-01' },
      { ...base, dedupeKey: 'medium-new', severity: 'medium', sourceDate: '2026-07-15' },
      { ...base, dedupeKey: 'medium-old', severity: 'medium', sourceDate: '2026-02-01' },
      { ...base, dedupeKey: 'high', severity: 'high', sourceDate: '2026-07-17' },
    ])
    expect(result.map((alert) => alert.dedupeKey)).toEqual(['high', 'medium-old', 'medium-new', 'low'])
  })

  it('eşit önem ve tarihte dosya ve anahtara göre kararlı kalır', () => {
    const result = normalizeOperationalAlerts([
      { ...base, dedupeKey: 'z', caseId: 'case-b' },
      { ...base, dedupeKey: 'y', caseId: 'case-a' },
      { ...base, dedupeKey: 'x', caseId: 'case-a' },
    ])
    expect(result.map((alert) => alert.dedupeKey)).toEqual(['x', 'y', 'z'])
  })

  it('üst sınırı aşan uyarıları kırpar', () => {
    const many = Array.from({ length: MAX_OPERATIONAL_ALERTS + 25 }, (_unused, index) => ({
      ...base,
      dedupeKey: `key-${String(index).padStart(4, '0')}`,
    }))
    expect(normalizeOperationalAlerts(many)).toHaveLength(MAX_OPERATIONAL_ALERTS)
  })
})

describe('collectOperationalAlerts', () => {
  it('üç kaynağı birleştirir ve süresi gelmemiş kayıtları dışarıda bırakır', () => {
    const result = collectOperationalAlerts(
      {
        overdueTasks: [
          taskFact({ taskId: 'task-1', priority: 'high', dueDate: '2026-07-05' }),
          taskFact({ taskId: 'task-2', dueDate: '2026-08-01' }),
        ],
        overdueFollowUps: [followUpFact(), followUpFact({ caseId: 'case-b', followUpDate: '2026-12-01' })],
        missingDocuments: [documentFact(), documentFact({ requirementCode: 'accident_report' })],
      },
      AS_OF,
    )
    // high önem: görevin kaynak tarihi (07-05) evrak değerlendirme tarihinden (07-18) eski.
    expect(result.map((alert) => alert.dedupeKey)).toEqual([
      'overdue_task:11111111-1111-4111-8111-111111111111:task-1',
      'missing_required_document:11111111-1111-4111-8111-111111111111:accident_report',
      'missing_required_document:11111111-1111-4111-8111-111111111111:traffic_victim_policy',
      'overdue_follow_up:11111111-1111-4111-8111-111111111111',
    ])
  })

  it('aynı girdi için her zaman aynı sonucu verir', () => {
    const facts = {
      overdueTasks: [taskFact({ taskId: 'task-1' }), taskFact({ taskId: 'task-1' })],
      overdueFollowUps: [followUpFact(), followUpFact()],
      missingDocuments: [documentFact(), documentFact()],
    }
    expect(collectOperationalAlerts(facts, AS_OF)).toEqual(collectOperationalAlerts(facts, AS_OF))
    expect(collectOperationalAlerts(facts, AS_OF)).toHaveLength(3)
  })

  it('kaynak yoksa boş liste döner', () => {
    expect(collectOperationalAlerts(
      { overdueTasks: [], overdueFollowUps: [], missingDocuments: [] },
      AS_OF,
    )).toEqual([])
  })
})
