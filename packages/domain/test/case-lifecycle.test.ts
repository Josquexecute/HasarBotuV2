import { describe, expect, it } from 'vitest'
import { buildClosedCaseWorkspacePath, buildClosedImportedCaseWorkspacePath, buildOpenImportedCaseWorkspacePath, evaluateClosureRequirements, isOpenWorkflowStage } from '../src/index.js'

describe('case lifecycle domain', () => {
  it('uses the verified imported office month without fabricating a notification date or merging insurer labels',() => {
    expect(buildClosedImportedCaseWorkspacePath(null,'2026 OFİS/Ekim 2026/27TST025')).toEqual({ ok: true,value: '2026 OFİS/Ekim 2026/KAPALI DOSYALAR/27TST025' })
    expect(buildClosedImportedCaseWorkspacePath(null,'2026 OFİS/Ekim2026/27TST025')).toEqual({ ok: true,value: '2026 OFİS/Ekim2026/KAPALI DOSYALAR/27TST025' })
    expect(buildClosedImportedCaseWorkspacePath(null,'2026 OFİS/AXA/EKİM 2026/34ABC123-AXA SİGORTA')).toEqual({ ok: true,value: '2026 OFİS/AXA/EKİM 2026/KAPALI DOSYALAR/34ABC123-AXA SİGORTA' })
    expect(buildClosedImportedCaseWorkspacePath('2026-07-14','2026 OFİS/Ekim 2026/27TST025')).toEqual({ ok: true,value: '2026 OFİS/Ekim 2026/KAPALI DOSYALAR/27TST025' })
  })
  it('does not guess the month for pending folders or accept traversal and unknown archive paths',() => {
    expect(buildClosedImportedCaseWorkspacePath(null,'2026 OFİS/_EKSİK DOSYALAR/27TST025')).toEqual({ ok: false,code: 'notification_date_required' })
    expect(buildClosedImportedCaseWorkspacePath('2026-10-15','2026 OFİS/_EKSİK DOSYALAR/27TST025')).toEqual({ ok: true,value: '2026 OFİS/Ekim 2026/KAPALI DOSYALAR/27TST025' })
    for (const path of ['../2026 OFİS/Ekim 2026/27TST025','2026 OFİS/Arşiv/27TST025','2026 OFİS/Ekim 2026/KAPALI ARŞİV/27TST025','2026 OFİS/Ekim 2025/27TST025']) expect(buildClosedImportedCaseWorkspacePath(null,path).ok).toBe(false)
  })
  it('verifies a manually archived import in place and recovers its original month for reopening',() => {
    for (const marker of ['KAPALI DOSYALAR','KAPALI EKİM 2026']) {
      const closed = `2026 OFİS/Ekim 2026/${marker}/27TST025`
      expect(buildClosedImportedCaseWorkspacePath(null,closed)).toEqual({ ok: true,value: closed })
      expect(buildOpenImportedCaseWorkspacePath(closed)).toEqual({ ok: true,value: '2026 OFİS/Ekim 2026/27TST025' })
    }
    expect(buildOpenImportedCaseWorkspacePath('2026 OFİS/Ekim 2026/27TST025').ok).toBe(false)
  })
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
      serviceEligibility: null,
    })
    expect(evaluation.requirements.find((item) => item.requirementCode === 'closure.expert_report')?.status).toBe('present')
    expect(evaluation.requirements.find((item) => item.requirementCode === 'closure.preliminary_report')?.status).toBe('control_required')
    expect(evaluation.requirements.find((item) => item.requirementCode === 'closure.invoice')?.status).toBe('not_applicable')
    expect(evaluation).toEqual(evaluateClosureRequirements({
      documents: [pending, ready], repairPhotos: [], hasService: false, serviceEligibility: null,
    }))
  })

  it('closed acik workflow asamasi degildir', () => {
    expect(isOpenWorkflowStage('new_notification')).toBe(true)
    expect(isOpenWorkflowStage('closed')).toBe(false)
  })
})
