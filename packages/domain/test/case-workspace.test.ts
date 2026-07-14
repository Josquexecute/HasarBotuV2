import { describe, expect, it } from 'vitest'
import {
  CASE_WORKSPACE_SUBDIRECTORIES,
  buildCaseWorkspaceBasePath,
  selectAvailableCaseWorkspacePath,
} from '../src/index.js'

describe('case workspace path planning', () => {
  it('notificationDate ve plakadan Türkçe ay içeren göreli yolu üretir', () => {
    expect(buildCaseWorkspaceBasePath('2026-07-14', '34 ABC 123')).toEqual({
      ok: true,
      relativePath: '2026/Temmuz 2026/34ABC123',
    })
    expect(CASE_WORKSPACE_SUBDIRECTORIES).toEqual(['EVRAK', 'HASAR', 'OLAY YERİ', 'ONARIM', 'DEĞER KAYBI'])
  })

  it('aynı ay/plaka için ilk boş soneki deterministik seçer', () => {
    const base = '2026/Temmuz 2026/34ABC123'
    expect(selectAvailableCaseWorkspacePath(base, [base])).toEqual({ ok: true, relativePath: `${base} - 2` })
    expect(selectAvailableCaseWorkspacePath(base, [base, `${base} - 2`])).toEqual({
      ok: true,
      relativePath: `${base} - 3`,
    })
  })

  it('geçersiz tarih ve plaka için yol üretmez', () => {
    expect(buildCaseWorkspaceBasePath('2026-02-30', '34 ABC 123')).toEqual({
      ok: false,
      error: 'invalid_notification_date',
    })
    expect(buildCaseWorkspaceBasePath('2026-07-14', '')).toEqual({ ok: false, error: 'invalid_plate' })
  })
})
