import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { LifecycleCommandError, type CaseLifecycleCommandPort, type LifecycleOperationRecord } from '../../data/caseLifecyclePort'
import type { CaseRecord } from '../../types/case'
import { CaseLifecycleModal } from './CaseLifecycleModal'

const item: CaseRecord = {
  caseId: 'case-1', plate: '34 ABC 123', officeNumber: '2026/21', noticeNumber: '—', claimNumber: '—',
  company: '—', type: 'Trafik', status: 'Açık', stage: 'Onarımda', missingDocuments: 0,
  assignee: '—', expert: '—', service: '—', followUp: '—', followUpTone: 'normal', lastAction: '—',
  vehicle: '—', insured: '—', estimatedDamage: 0, notes: [], version: 1, workflowStage: 'under_repair',
  lifecycleStatus: 'open',
}
const planned: LifecycleOperationRecord = {
  id: 'operation-1', caseId: 'case-1', operationType: 'close', status: 'approval_required', version: 1,
  source: { storageRootKey: 'test-root', relativePath: '2026/Temmuz 2026/34ABC123' },
  destination: { storageRootKey: 'test-root', relativePath: '2026/Temmuz 2026/KAPALI TEMMUZ 2026/34ABC123' },
  closeMode: 'normal', reason: null, targetWorkflowStage: 'closed', blockers: [], warnings: [], linkedFileOperation: null,
  failureReasonCode: null, canApprove: true, canCancel: true,
  requirementSummary: { documentRuleVersion: '2026.07.14.1', closureRuleVersion: '2026.07.14.2', serviceEligibility: null, valueLossSummary: {
    status: 'present', reason: 'Onaylı sonuç ve rapor mevcut.', ruleVersion: 'traffic-value-loss-closure/1.0.0',
    requiresHumanReview: false, assessmentVersion: 2, calculationRuleVersion: '2026.07.01.1',
    resultCode: 'calculable', amountMinor: 245_000, reportId: '018f3f4c-89ab-7def-8123-456789abcdef',
    reportGeneratedAt: '2026-07-16T10:00:00.000Z',
  }, missingCount: 0,
    controlRequiredCount: 0, requirements: [{ requirementCode: 'closure.expert_report', sourceType: 'document',
      canonicalType: 'expert_report', status: 'present', reason: 'Doğrulanmış ready metadata.', requiresHumanReview: false }] },
}

describe('CaseLifecycleModal', () => {
  it.each([
    ['source_evidence_missing', 'taşıma kanıtı yok veya uyuşmuyor'],
    ['source_missing', 'Kaynak klasör bulunamadı'],
    ['destination_exists', 'Hedef klasör zaten var'],
    ['storage_unavailable', 'Depolama bağlantısı mevcut değil'],
    ['destination_manifest_mismatch', 'içerik özeti kaynakla uyuşmuyor'],
    ['unknown_code', 'İşlem tamamlanamadı. Klasör ve işlem kayıtlarını kontrol edin.'],
  ])('explains %s without guessing or retrying a manual recovery', async (failureReasonCode, message) => {
    const operation = { ...planned, status: 'manual_recovery_required' as const, failureReasonCode, canApprove: false, canCancel: false }
    const port: CaseLifecycleCommandPort = {
      readLatestOperation: vi.fn().mockResolvedValue(operation), readLocationVersion: vi.fn().mockResolvedValue(1),
      planClose: vi.fn(), planReopen: vi.fn(), approve: vi.fn(), readOperation: vi.fn(), readCase: vi.fn(),
    }
    render(<CaseLifecycleModal item={item} port={port} onClose={vi.fn()} onUpdated={vi.fn()} onUnauthorized={vi.fn()} onReload={vi.fn()} />)
    expect(await screen.findByText(new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Onayla ve Kapat' })).not.toBeInTheDocument()
    expect(port.approve).not.toHaveBeenCalled()
  })
  it('lets an exhausted move create a fresh preview with current versions and a separate approval', async () => {
    const failure = { ...planned,status: 'failed',failureReasonCode: 'access_denied',linkedFileOperation: { id: 'file-1',status: 'failed' },canApprove: true } as const
    const port: CaseLifecycleCommandPort = {
      readLatestOperation: vi.fn().mockResolvedValue(failure),readLocationVersion: vi.fn().mockResolvedValue(2),
      readCase: vi.fn().mockResolvedValue({ ...item,version: 2 }),planClose: vi.fn().mockResolvedValue({ ...planned,id: 'fresh' }),
      planReopen: vi.fn(),approve: vi.fn(),readOperation: vi.fn(),
    }
    function View() {
      const [current,setCurrent] = useState(item)
      return <CaseLifecycleModal item={current} port={port} onClose={vi.fn()} onUpdated={vi.fn()} onUnauthorized={vi.fn()} onReload={setCurrent} />
    }
    render(<View />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Klasöre erişilemedi')
    await userEvent.click(screen.getByRole('button',{ name: 'Güncel Verilerle Yeniden Önizle' }))
    await userEvent.click(await screen.findByRole('button',{ name: 'Önizleme Oluştur' }))
    expect(port.planClose).toHaveBeenCalledWith(item.caseId,{ expectedCaseVersion: 2,expectedLocationVersion: 2,closeMode: 'normal',replaceFailedOperationId: failure.id })
    expect(await screen.findByRole('button',{ name: 'Onayla ve Kapat' })).toBeEnabled()
    expect(port.approve).not.toHaveBeenCalled()
  })
  it('reports an expired session when the final case refresh fails', async () => {
    vi.useFakeTimers()
    const onUnauthorized = vi.fn()
    const port: CaseLifecycleCommandPort = {
      readLatestOperation: vi.fn().mockResolvedValue({ ...planned, status: 'queued', canApprove: false }),
      readLocationVersion: vi.fn(), planClose: vi.fn(), planReopen: vi.fn(), approve: vi.fn(),
      readOperation: vi.fn().mockResolvedValue({ ...planned, status: 'closed', canApprove: false }),
      readCase: vi.fn().mockRejectedValue(new LifecycleCommandError('unauthorized', 'expired request')),
    }
    const view = render(<CaseLifecycleModal item={item} port={port} onClose={vi.fn()} onUpdated={vi.fn()} onUnauthorized={onUnauthorized} onReload={vi.fn()} />)
    try {
      await act(async () => {})
      await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
      expect(onUnauthorized).toHaveBeenCalledOnce()
      expect(screen.getByRole('alert')).toHaveTextContent('Oturumunuz sona erdi')
    } finally { view.unmount(); vi.useRealTimers() }
  })

  it.each(['resolved', 'unauthorized'] as const)('ignores a %s case refresh after the modal closes', async (outcome) => {
    vi.useFakeTimers()
    let resolveCase!: (value: CaseRecord) => void
    let rejectCase!: (error: unknown) => void
    const pendingCase = new Promise<CaseRecord>((resolve, reject) => { resolveCase = resolve; rejectCase = reject })
    const onUpdated = vi.fn(), onUnauthorized = vi.fn()
    const port: CaseLifecycleCommandPort = {
      readLatestOperation: vi.fn().mockResolvedValue({ ...planned, status: 'queued', canApprove: false }),
      readLocationVersion: vi.fn(), planClose: vi.fn(), planReopen: vi.fn(), approve: vi.fn(),
      readOperation: vi.fn().mockResolvedValue({ ...planned, status: 'closed', canApprove: false }),
      readCase: vi.fn().mockReturnValue(pendingCase),
    }
    const view = render(<CaseLifecycleModal item={item} port={port} onClose={vi.fn()} onUpdated={onUpdated} onUnauthorized={onUnauthorized} onReload={vi.fn()} />)
    try {
      await act(async () => {})
      await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
      expect(port.readCase).toHaveBeenCalledOnce()
      view.unmount()
      await act(async () => {
        if (outcome === 'resolved') resolveCase({ ...item, lifecycleStatus: 'closed' })
        else rejectCase(new LifecycleCommandError('unauthorized', 'expired request'))
      })
      expect(onUpdated).not.toHaveBeenCalled()
      expect(onUnauthorized).not.toHaveBeenCalled()
    } finally { view.unmount(); vi.useRealTimers() }
  })

  it('restores an existing operation after navigation and keeps tracking it', async () => {
    vi.useFakeTimers()
    const readOperation = vi.fn().mockResolvedValue({ ...planned, status: 'closed', canApprove: false })
    const onUpdated = vi.fn()
    const port: CaseLifecycleCommandPort = {
      readLatestOperation: vi.fn().mockResolvedValue({ ...planned, status: 'queued', canApprove: false }),
      readLocationVersion: vi.fn(), planClose: vi.fn(), planReopen: vi.fn(), approve: vi.fn(), readOperation,
      readCase: vi.fn().mockResolvedValue({ ...item, lifecycleStatus: 'closed', stage: 'Kapanış', workflowStage: 'closed' }),
    }
    const view = render(<CaseLifecycleModal item={item} port={port} onClose={vi.fn()} onUpdated={onUpdated} onUnauthorized={vi.fn()} onReload={vi.fn()} />)
    try {
      await act(async () => {})
      expect(screen.getByText('Sırada')).toBeInTheDocument()
      await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
      expect(screen.getByText('Dosya kapatıldı')).toBeInTheDocument()
      expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ lifecycleStatus: 'closed' }))
      expect(port.planClose).not.toHaveBeenCalled()
    } finally { view.unmount(); vi.useRealTimers() }
  })

  it('resumes a failed operation with its existing identity and entered reason', async () => {
    const failed = { ...planned, status: 'failed' as const, reason: 'Eksikler takip edilecek', closeMode: 'with_missing_requirements' as const, canApprove: true }
    const port: CaseLifecycleCommandPort = {
      readLatestOperation: vi.fn().mockResolvedValue(failed), readLocationVersion: vi.fn(), planClose: vi.fn(), planReopen: vi.fn(),
      approve: vi.fn().mockResolvedValue({ ...failed, status: 'queued', canApprove: false }), readOperation: vi.fn(), readCase: vi.fn(),
    }
    const view = render(<CaseLifecycleModal item={item} port={port} onClose={vi.fn()} onUpdated={vi.fn()} onUnauthorized={vi.fn()} onReload={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Taşımayı Yeniden Dene' }))
    expect(port.approve).toHaveBeenCalledWith(item.caseId, failed)
    expect(port.planClose).not.toHaveBeenCalled()
    view.unmount()
  })

  it.each([
    ['idempotency-key', 'İşlem bilgileri sunucuya eksik ulaştı.'],
    ['reason', 'En az 3 karakterlik bir gerekçe yazın'],
    ['expectedCaseVersion', 'Dosya veya klasör sürümü alınamadı.'],
  ])('explains the rejected %s field and retains the entered reason', async (field, message) => {
    const reason = 'Eksik belgeler daha sonra tamamlanacak.'
    const port: CaseLifecycleCommandPort = {
      readLatestOperation: vi.fn().mockResolvedValue(null), readLocationVersion: vi.fn().mockResolvedValue(1),
      planClose: vi.fn().mockRejectedValue(new LifecycleCommandError('validation', 'Private internal detail', 'validation_error', [field])),
      planReopen: vi.fn(), approve: vi.fn(), readOperation: vi.fn(), readCase: vi.fn(),
    }
    render(<CaseLifecycleModal item={item} port={port} onClose={vi.fn()} onUpdated={vi.fn()} onUnauthorized={vi.fn()} onReload={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Eksiklerle kapat'))
    await user.type(screen.getByLabelText('Gerekçe'), reason)
    await user.click(await screen.findByRole('button', { name: 'Önizleme Oluştur' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByLabelText('Gerekçe')).toHaveValue(reason)
    expect(screen.getByLabelText('Eksiklerle kapat')).toBeChecked()
    expect(screen.queryByText('Private internal detail')).not.toBeInTheDocument()
    expect(port.approve).not.toHaveBeenCalled()
  })

  it('keeps tracking after one minute and displays the eventual worker failure', async () => {
    vi.useFakeTimers()
    const readOperation = vi.fn().mockResolvedValue({ ...planned, status: 'moving', canApprove: false })
    const port: CaseLifecycleCommandPort = {
      readLatestOperation: vi.fn().mockResolvedValue(null), readLocationVersion: vi.fn().mockResolvedValue(1), planClose: vi.fn().mockResolvedValue(planned), planReopen: vi.fn(),
      approve: vi.fn().mockResolvedValue({ ...planned, status: 'queued', canApprove: false }), readOperation, readCase: vi.fn(),
    }
    const view = render(<CaseLifecycleModal item={item} port={port} onClose={vi.fn()} onUpdated={vi.fn()} onUnauthorized={vi.fn()} onReload={vi.fn()} />)
    try {
      await act(async () => {})
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Önizleme Oluştur' })) })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Onayla ve Kapat' })) })
      await act(async () => { await vi.advanceTimersByTimeAsync(66_000) })
      const calls = readOperation.mock.calls.length
      await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
      expect(readOperation.mock.calls.length).toBeGreaterThan(calls)
      readOperation.mockResolvedValue({ ...planned, status: 'failed', canApprove: false, failureReasonCode: 'case_not_fresh' })
      await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
      expect(screen.getByText('İşlem başarısız')).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('Klasörün güncelliği doğrulanamadı')
      const completedCalls = readOperation.mock.calls.length
      await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
      expect(readOperation).toHaveBeenCalledTimes(completedCalls)
    } finally { view.unmount(); vi.useRealTimers() }
  })

  it('refreshes a stale version without losing the missing-requirements mode or reason',async () => {
    const reason = 'Eksik evraklar takip edilerek kapanış istendi.'
    const port: CaseLifecycleCommandPort = {
      readLatestOperation: vi.fn().mockResolvedValue(null), readLocationVersion: vi.fn().mockResolvedValue(3),
      planClose: vi.fn().mockRejectedValueOnce(new LifecycleCommandError('conflict','synthetic','version_conflict')).mockResolvedValueOnce({ ...planned,closeMode: 'with_missing_requirements',reason }),
      planReopen: vi.fn(),approve: vi.fn(),readOperation: vi.fn(),readCase: vi.fn().mockResolvedValue({ ...item,version: 2 }),
    }
    const onClose = vi.fn()
    function Workspace() {
      const [current,setCurrent] = useState(item)
      return <CaseLifecycleModal item={current} port={port} onClose={onClose} onUpdated={vi.fn()} onUnauthorized={vi.fn()} onReload={setCurrent} />
    }
    render(<Workspace />)
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Eksiklerle kapat'))
    await user.type(screen.getByLabelText('Gerekçe'),reason)
    await user.click(await screen.findByRole('button',{ name: 'Önizleme Oluştur' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('seçiminiz ve gerekçeniz korunur')
    await user.click(screen.getByRole('button',{ name: 'Güncel Veriyi Yükle' }))
    await waitFor(() => expect(port.readCase).toHaveBeenCalledWith(item.caseId))
    expect(screen.getByLabelText('Eksiklerle kapat')).toBeChecked()
    expect(screen.getByLabelText('Gerekçe')).toHaveValue(reason)
    expect(onClose).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button',{ name: 'Önizleme Oluştur' }))
    await screen.findByRole('button',{ name: 'Onayla ve Kapat' })
    expect(port.planClose).toHaveBeenLastCalledWith(item.caseId,{ expectedCaseVersion: 2,expectedLocationVersion: 3,closeMode: 'with_missing_requirements',reason })
    expect(port.approve).not.toHaveBeenCalled()
  })
  it('reports invalid workspace and occupied targets without claiming the case version changed',async () => {
    const port: CaseLifecycleCommandPort = { readLatestOperation: vi.fn().mockResolvedValue(null), readLocationVersion: vi.fn().mockResolvedValue(1),planClose: vi.fn().mockRejectedValue(new LifecycleCommandError('conflict','internal detail','lifecycle_stale')),planReopen: vi.fn(),approve: vi.fn(),readOperation: vi.fn(),readCase: vi.fn() }
    render(<CaseLifecycleModal item={item} port={port} onClose={vi.fn()} onUpdated={vi.fn()} onUnauthorized={vi.fn()} onReload={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button',{ name: 'Önizleme Oluştur' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('klasör yapısıyla uyumlu değil')
    expect(screen.queryByRole('button',{ name: 'Güncel Veriyi Yükle' })).not.toBeInTheDocument()
    expect(screen.queryByText(/başka bir işlemle değişti/)).not.toBeInTheDocument()
  })
  it('close preview ve açık onaydan sonra server sonucuyla case kaydını yeniler', async () => {
    const user = userEvent.setup()
    const closed = { ...item, status: 'Kapalı' as const, stage: 'Kapanış' as const, lifecycleStatus: 'closed' as const, workflowStage: 'closed' as const, version: 2 }
    const port: CaseLifecycleCommandPort = {
      readLatestOperation: vi.fn().mockResolvedValue(null), readLocationVersion: vi.fn().mockResolvedValue(1),
      planClose: vi.fn().mockResolvedValue(planned),
      planReopen: vi.fn(),
      approve: vi.fn().mockResolvedValue({ ...planned, status: 'queued', version: 2, canApprove: false }),
      readOperation: vi.fn().mockResolvedValue({ ...planned, status: 'closed', version: 3, canApprove: false }),
      readCase: vi.fn().mockResolvedValue(closed),
    }
    const onUpdated = vi.fn()
    const { rerender } = render(<CaseLifecycleModal item={item} port={port} onClose={vi.fn()} onUpdated={onUpdated} onUnauthorized={vi.fn()} onReload={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Önizleme Oluştur' }))
    expect(await screen.findByText('2026.07.14.1 · 2026.07.14.2')).toBeInTheDocument()
    expect(screen.getAllByText('Mevcut')).toHaveLength(2)
    expect(screen.getByText('Değer Kaybı Kapanış Özeti')).toBeInTheDocument()
    expect(screen.getByText('Nihai ekspertiz raporu')).toBeInTheDocument()
    expect(screen.getByText('Hesaplanabilir')).toBeInTheDocument()
    expect(screen.queryByText('calculable')).not.toBeInTheDocument()
    expect(screen.getByText(/2\.450,00/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Onayla ve Kapat' }))
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(closed), { timeout: 2500 })
    expect(port.approve).toHaveBeenCalledTimes(1)
    rerender(<CaseLifecycleModal item={closed} port={port} onClose={vi.fn()} onUpdated={onUpdated} onUnauthorized={vi.fn()} onReload={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Dosyayı Kapat' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Dosyayı Yeniden Aç' })).not.toBeInTheDocument()
  })

  it('blocked normal close için approve göstermez', async () => {
    const user = userEvent.setup()
    const port: CaseLifecycleCommandPort = {
      readLatestOperation: vi.fn().mockResolvedValue(null), readLocationVersion: vi.fn().mockResolvedValue(1),
      planClose: vi.fn().mockResolvedValue({ ...planned, status: 'blocked', blockers: ['requirements_incomplete'], canApprove: false,
        requirementSummary: { ...planned.requirementSummary, missingCount: 1 } }),
      planReopen: vi.fn(), approve: vi.fn(), readOperation: vi.fn(), readCase: vi.fn(),
    }
    render(<CaseLifecycleModal item={item} port={port} onClose={vi.fn()} onUpdated={vi.fn()} onUnauthorized={vi.fn()} onReload={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Önizleme Oluştur' }))
    expect(await screen.findByText(/Normal kapanış eksik/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Onayla ve Kapat' })).not.toBeInTheDocument()
  })
})
