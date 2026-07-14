import { describe, expect, it } from 'vitest'
import { buildClosedCaseWorkspacePath, evaluateClosureRequirements, isOpenWorkflowStage } from '../src/index.js'

describe('case lifecycle domain', () => {
  it('notificationDate ile uyumlu acik yolu deterministik kapali ay yoluna cevirir', () => {
    expect(buildClosedCaseWorkspacePath('2026-07-14', '2026/Temmuz 2026/34MPA764')).toEqual({
      ok: true,
      value: '2026/Temmuz 2026/KAPALI TEMMUZ 2026/34MPA764',
    })
    expect(buildClosedCaseWorkspacePath('2026-08-01', '2026/Temmuz 2026/34MPA764')).toEqual({
      ok: false,
      code: 'location_date_mismatch',
    })
    expect(buildClosedCaseWorkspacePath(null, '2026/Temmuz 2026/34MPA764')).toEqual({
      ok: false,
      code: 'notification_date_required',
    })
  })

  it('yalniz fiziksel dogrulamasi tamamlanmis ready metadata present sayilir', () => {
    const ready = { id: 'ready-1', canonicalType: 'expert_report', status: 'ready' as const,
      hashVerified: true, sizeVerified: true, verifiedAt: '2026-07-14T10:00:00.000Z' }
    const pending = { id: 'pending-1', canonicalType: 'preliminary_report', status: 'pending' as const,
      hashVerified: false, sizeVerified: false, verifiedAt: null }
    const evaluation = evaluateClosureRequirements({
      documents: [pending, ready],
      repairPhotos: [],
      hasService: false,
      isAuthorizedService: false,
    })
    expect(evaluation.requirements.find((item) => item.requirementCode === 'closure.expert_report')?.status).toBe('present')
    expect(evaluation.requirements.find((item) => item.requirementCode === 'closure.preliminary_report')?.status).toBe('control_required')
    expect(evaluation.requirements.find((item) => item.requirementCode === 'closure.invoice')?.status).toBe('not_applicable')
    expect(evaluation).toEqual(evaluateClosureRequirements({
      documents: [pending, ready], repairPhotos: [], hasService: false, isAuthorizedService: false,
    }))
  })

  it('closed acik workflow asamasi degildir', () => {
    expect(isOpenWorkflowStage('new_notification')).toBe(true)
    expect(isOpenWorkflowStage('closed')).toBe(false)
  })
})
