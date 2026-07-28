import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LaborWorkbookApplyJobPayload, LaborWorkbookPreviewJobPayload } from '@hasarbotu/contracts'
import { executeLaborWorkbookApply, executeLaborWorkbookPreview } from '../src/index.js'

const previewPayload = {
  kind: 'labor_workbook_preview' as const,
  operationId: '01900000-0000-7000-8000-000000000030',
  operationVersion: 1,
  storageRootKey: 'test-root',
  relativePath: 'İŞÇİLİK/2026-07.xlsx',
  expectedSourceSha256: null,
  signature: { headerRowIndex: 1, targetSheetName: 'Sayfa1' },
  changes: [{ cell: 'D2', newValue: '10.20.30' }],
} as unknown as LaborWorkbookPreviewJobPayload

const applyPayload = {
  ...previewPayload,
  kind: 'labor_workbook_apply' as const,
  expectedSourceSha256: 'a'.repeat(64),
  preview: {},
  approval: {
    confirmed: true,
    planHash: 'b'.repeat(64),
    approvedByUserId: '01900000-0000-7000-8000-000000000031',
    approvedAt: '2026-07-28T09:00:00.000Z',
  },
} as unknown as LaborWorkbookApplyJobPayload

describe('D4 fail-closed: işçilik çalışma kitabı yazımı kök sağlığına bağlıdır', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'hb-labor-root-health-'))
  })
  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('önizleme: kök erişilemezken çalışma kitabına HİÇ dokunmadan storage_unavailable döner', async () => {
    const rootAbsolute = join(base, 'yok-boyle-bir-klasor')
    const result = await executeLaborWorkbookPreview(rootAbsolute, previewPayload)
    expect(result).toEqual({ outcome: 'failed', errorCode: 'storage_unavailable' })
  })

  it('uygulama: kök erişilemezken Excel\'e yazma denemesi YAPILMADAN storage_unavailable döner', async () => {
    const rootAbsolute = join(base, 'yok-boyle-bir-klasor')
    const client = { reportLaborWorkbookAudit: async () => true } as unknown as Parameters<typeof executeLaborWorkbookApply>[3]
    const result = await executeLaborWorkbookApply(rootAbsolute, applyPayload, 'agent-1', client, 'job-1')
    expect(result).toEqual({ outcome: 'failed', errorCode: 'storage_unavailable' })
  })
})
