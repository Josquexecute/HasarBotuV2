import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { LaborExcelProfileCandidateRecord, LaborExcelProjectionRecord } from '../../data/laborExcelProfilePort'
import type { LaborWorkbookApplyDataPort, LaborWorkbookApplyResponseRecord } from '../../data/laborWorkbookApplyPort'
import { LaborWorkbookApplyPanel } from './LaborWorkbookApplyPanel'

const profile: LaborExcelProfileCandidateRecord = {
  profileId: 'profile-1',
  profileVersion: 1,
  name: 'Sentetik',
  scope: 'generic',
  insurerId: null,
  insurerName: null,
  targetSheet: 'İşçilik',
  identityChecks: { plate: false, officeNumber: false },
  columns: [{ key: 'bodywork', label: 'Kaporta' }],
  mapping: {
    bodywork: 'bodywork',
    mechanical: null,
    electrical: null,
    upholstery_lock: null,
    glass: null,
    calibration: null,
    repair: null,
    paint: null,
  },
  unmappedCategories: [],
  writable: true,
}

const projection: LaborExcelProjectionRecord = {
  caseId: 'case-1',
  applicationId: 'application-1',
  profileId: 'profile-1',
  profileVersion: 1,
  columns: profile.columns,
  lines: [{
    lineOrdinal: 1,
    description: 'Ön tampon',
    status: 'projected',
    reviewRequired: false,
    cells: { bodywork: 12_550 },
    unmappedAmountMinor: 0,
    totalMinor: 12_550,
  }],
  columnTotals: { bodywork: 12_550 },
  projectedLineCount: 1,
  manualEntryLineCount: 0,
  reviewRequiredLineCount: 0,
  unmappedTotalMinor: 0,
  written: false,
}

const previewReady: LaborWorkbookApplyResponseRecord = {
  permissions: { canPreview: true, canApprove: true },
  operation: {
    id: 'operation-1',
    caseId: 'case-1',
    applicationId: 'application-1',
    revisionId: 'revision-1',
    revisionVersion: 2,
    profileId: 'profile-1',
    workbookReference: '34TEST34/EVRAK/ISCILIK.xlsx',
    sheetName: 'İşçilik',
    status: 'preview_ready',
    version: 2,
    approvedRevisionSnapshotHash: 'a'.repeat(64),
    sourceWorkbookHash: 'b'.repeat(64),
    planHash: 'c'.repeat(64),
    resultWorkbookHash: null,
    backupReference: null,
    previousTotalMinor: 10_000,
    newTotalMinor: 12_550,
    changedRowCount: 1,
    unchangedRowCount: 0,
    controlRequiredRowCount: 0,
    rows: [{
      lineOrdinal: 1,
      rowNumber: 2,
      cell: 'D2',
      sourceRowHash: 'd'.repeat(64),
      partCode: 'PRC-001',
      partName: 'Ön tampon',
      operationType: 'Onarım',
      previousValue: '100.00',
      newValue: '125.50',
      valueSource: 'approved_final',
      manuallyModified: true,
      matchConfidence: 'exact_source_row',
      conflictCodes: [],
    }],
    jobId: 'job-preview',
    safeErrorCode: null,
  },
}

describe('LaborWorkbookApplyPanel', () => {
  it('zorunlu workbook ve source-row bilgisi olmadan preview çağırmaz', async () => {
    const port: LaborWorkbookApplyDataPort = {
      preview: vi.fn(),
      approve: vi.fn(),
      get: vi.fn(),
    }
    render(
      <LaborWorkbookApplyPanel
        caseId="case-1"
        applicationId="application-1"
        profile={profile}
        projection={projection}
        port={port}
      />,
    )
    expect(screen.getByRole('button', {
      name: 'Değişiklik Önizlemesi Oluştur',
    })).toBeDisabled()
    expect(port.preview).not.toHaveBeenCalled()
  })

  it('satır önizlemesini gösterir ve açık onaydan sonra File Agent job onayı verir', async () => {
    const approve = vi.fn().mockResolvedValue({
      ...previewReady,
      operation: { ...previewReady.operation, status: 'approved', version: 3 },
    })
    const port: LaborWorkbookApplyDataPort = {
      preview: vi.fn().mockResolvedValue(previewReady),
      approve,
      get: vi.fn(),
    }
    const user = userEvent.setup()
    render(
      <LaborWorkbookApplyPanel
        caseId="case-1"
        applicationId="application-1"
        profile={profile}
        projection={projection}
        port={port}
      />,
    )
    await user.type(
      screen.getByLabelText('Vaka klasörüne göre workbook yolu'),
      'EVRAK/ISCILIK.xlsx',
    )
    await user.type(screen.getByLabelText('Beklenen başlık'), 'İşçilik')
    await user.type(screen.getByLabelText('1. kalem workbook satırı'), '2')
    await user.click(screen.getByRole('button', {
      name: 'Değişiklik Önizlemesi Oluştur',
    }))
    expect((await screen.findAllByText('D2')).length).toBeGreaterThan(0)
    expect(screen.getByText(/kullanıcı düzeltmesi/)).toBeInTheDocument()
    const approveButton = screen.getByRole('button', {
      name: /Onayla ve File Agent Job’ını Başlat/,
    })
    expect(approveButton).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(approveButton)
    expect(approve).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Durum: approved')).toBeInTheDocument()
  })

  it('control_required sonucunda onay eylemini göstermez', async () => {
    const port: LaborWorkbookApplyDataPort = {
      preview: vi.fn().mockResolvedValue({
        ...previewReady,
        operation: {
          ...previewReady.operation,
          status: 'control_required',
          controlRequiredRowCount: 1,
          safeErrorCode: 'SOURCE_ROW_VALUE_INVALID',
        },
      }),
      approve: vi.fn(),
      get: vi.fn(),
    }
    const user = userEvent.setup()
    render(
      <LaborWorkbookApplyPanel
        caseId="case-1"
        applicationId="application-1"
        profile={profile}
        projection={projection}
        port={port}
      />,
    )
    await user.type(
      screen.getByLabelText('Vaka klasörüne göre workbook yolu'),
      'EVRAK/ISCILIK.xlsx',
    )
    await user.type(screen.getByLabelText('Beklenen başlık'), 'İşçilik')
    await user.type(screen.getByLabelText('1. kalem workbook satırı'), '2')
    await user.click(screen.getByRole('button', {
      name: 'Değişiklik Önizlemesi Oluştur',
    }))
    expect(await screen.findByText(/SOURCE_ROW_VALUE_INVALID/)).toBeInTheDocument()
    expect(screen.queryByRole('button', {
      name: /Onayla ve File Agent Job’ını Başlat/,
    })).not.toBeInTheDocument()
  })
})
