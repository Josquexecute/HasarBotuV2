import { describe, expect, it } from 'vitest'
import {
  CASE_WORKSPACE_SUBDIRECTORIES,
  buildCaseWorkspaceBasePath,
  buildCompletedCaseWorkspacePath,
  selectAvailableCaseWorkspacePath,
} from '../src/index.js'

describe('case workspace path planning', () => {
  it('yeni ihbarı yılın eksik dosyalar klasöründe başlatır', () => {
    expect(buildCaseWorkspaceBasePath('2026-07-14', '34 ABC 123')).toEqual({
      ok: true,
      relativePath: '2026 OFİS/_EKSİK DOSYALAR/34ABC123',
    })
    expect(CASE_WORKSPACE_SUBDIRECTORIES).toEqual(['EVRAK', 'HASAR', 'OLAY YERİ', 'ONARIM', 'DEĞER KAYBI'])
  })

  it('aynı ay/plaka için ilk boş soneki deterministik seçer', () => {
    const base = '2026 OFİS/_EKSİK DOSYALAR/34ABC123'
    expect(selectAvailableCaseWorkspacePath(base, [base])).toEqual({ ok: true, relativePath: `${base} - 2` })
    expect(selectAvailableCaseWorkspacePath(base, [base, `${base} - 2`])).toEqual({
      ok: true,
      relativePath: `${base} - 3`,
    })
  })

  it.each([
    ['2026-10-19', '72ABA951', '2026 OFİS/_EKSİK DOSYALAR/72ABA951'],
    ['2027-01-01', '06 ABC 123', '2027 OFİS/_EKSİK DOSYALAR/06ABC123'],
  ])('ofis envanteri kapsamını korur: %s', (date, plate, relativePath) => {
    expect(buildCaseWorkspaceBasePath(date, plate)).toEqual({ ok: true, relativePath })
  })

  it('geçersiz tarih ve plaka için yol üretmez', () => {
    expect(buildCaseWorkspaceBasePath('2026-02-30', '34 ABC 123')).toEqual({
      ok: false,
      error: 'invalid_notification_date',
    })
    expect(buildCaseWorkspaceBasePath('2026-07-14', '')).toEqual({ ok: false, error: 'invalid_plate' })
  })

  it.each(['', ' - 2', ' - 10', ' - 100'])('ay klasörüne geçerken özgün klasör adını korur: %s', suffix => {
    expect(buildCompletedCaseWorkspacePath('2026-10-19', `2026 OFİS/_EKSİK DOSYALAR/34ABC123${suffix}`))
      .toEqual({ ok: true, relativePath: `2026 OFİS/Ekim 2026/34ABC123${suffix}` })
  })

  it('belirsiz veya geçersiz hedef üretmez', () => {
    for (const date of [null, '2026-02-30', '2027-10-19']) expect(buildCompletedCaseWorkspacePath(date, '2026 OFİS/_EKSİK DOSYALAR/34ABC123').ok).toBe(false)
    for (const path of ['2026 OFİS/Ekim 2026/34ABC123', '2026 OFİS/_EKSİK DOSYALAR/../34ABC123', '2026 OFİS/_EKSİK DOSYALAR/34ABC123/EVRAK']) expect(buildCompletedCaseWorkspacePath('2026-10-19', path).ok).toBe(false)
  })
})
