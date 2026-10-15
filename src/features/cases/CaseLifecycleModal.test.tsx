import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { LifecycleCommandError, type CaseLifecycleCommandPort, type LifecycleOperationRecord } from '../../data/caseLifecyclePort'
import type { CaseRecord } from '../../types/case'
import { CaseLifecycleModal } from './CaseLifecycleModal'

const item: CaseRecord = {
  caseId: 'case-1', plate: '34 ABC 123', officeNumber: '2026/21', noticeNumber: '—', claimNumber: '—',
  company: '—', type: 'Trafik', status: 'Açık', stage: 'Kapanmaya Hazır', missingDocuments: 0,
  assignee: '—', expert: '—', service: '—', followUp: '—', followUpTone: 'normal', lastAction: '—',
  vehicle: '—', insured: '—', estimatedDamage: 0, notes: [], version: 1, workflowStage: 'ready_to_close',
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
  it('refreshes a stale version without losing the missing-requirements mode or reason',async () => {
    const reason = 'Eksik evraklar takip edilerek kapanış istendi.'
    const port: CaseLifecycleCommandPort = {
      readLocationVersion: vi.fn().mockResolvedValue(3),
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
    await user.click(screen.getByRole('button',{ name: 'Önizleme Oluştur' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('seçiminiz ve gerekçeniz korunur')
    await user.click(screen.getByRole('button',{ name: 'Güncel Veriyi Yükle' }))
    await waitFor(() => expect(port.readCase).toHaveBeenCalledWith(item.caseId))
    expect(screen.getByLabelText('Eksiklerle kapat')).toBeChecked()
    expect(screen.getByLabelText('Gerekçe')).toHaveValue(reason)
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button',{ name: 'Önizleme Oluştur' }))
    await screen.findByRole('button',{ name: 'Onayla ve Kapat' })
    expect(port.planClose).toHaveBeenLastCalledWith(item.caseId,{ expectedCaseVersion: 2,expectedLocationVersion: 3,closeMode: 'with_missing_requirements',reason })
    expect(port.approve).not.toHaveBeenCalled()
  })
  it('reports invalid workspace and occupied targets without claiming the case version changed',async () => {
    const port: CaseLifecycleCommandPort = { readLocationVersion: vi.fn().mockResolvedValue(1),planClose: vi.fn().mockRejectedValue(new LifecycleCommandError('conflict','internal detail','lifecycle_stale')),planReopen: vi.fn(),approve: vi.fn(),readOperation: vi.fn(),readCase: vi.fn() }
    render(<CaseLifecycleModal item={item} port={port} onClose={vi.fn()} onUpdated={vi.fn()} onUnauthorized={vi.fn()} onReload={vi.fn()} />)
    await userEvent.click(screen.getByRole('button',{ name: 'Önizleme Oluştur' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('klasör yapısıyla uyumlu değil')
    expect(screen.queryByRole('button',{ name: 'Güncel Veriyi Yükle' })).not.toBeInTheDocument()
    expect(screen.queryByText(/başka bir işlemle değişti/)).not.toBeInTheDocument()
  })
  it('close preview ve açık onaydan sonra server sonucuyla case kaydını yeniler', async () => {
    const user = userEvent.setup()
    const closed = { ...item, status: 'Kapalı' as const, stage: 'Kapalı' as const, lifecycleStatus: 'closed' as const, workflowStage: 'closed' as const, version: 2 }
    const port: CaseLifecycleCommandPort = {
      readLocationVersion: vi.fn().mockResolvedValue(1),
      planClose: vi.fn().mockResolvedValue(planned),
      planReopen: vi.fn(),
      approve: vi.fn().mockResolvedValue({ ...planned, status: 'queued', version: 2, canApprove: false }),
      readOperation: vi.fn().mockResolvedValue({ ...planned, status: 'closed', version: 3, canApprove: false }),
      readCase: vi.fn().mockResolvedValue(closed),
    }
    const onUpdated = vi.fn()
    const { rerender } = render(<CaseLifecycleModal item={item} port={port} onClose={vi.fn()} onUpdated={onUpdated} onUnauthorized={vi.fn()} onReload={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Önizleme Oluştur' }))
    expect(await screen.findByText('2026.07.14.1 · 2026.07.14.2')).toBeInTheDocument()
    expect(screen.getAllByText('Mevcut')).toHaveLength(2)
    expect(screen.getByText('Değer Kaybı Kapanış Özeti')).toBeInTheDocument()
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
      readLocationVersion: vi.fn().mockResolvedValue(1),
      planClose: vi.fn().mockResolvedValue({ ...planned, status: 'blocked', blockers: ['requirements_incomplete'], canApprove: false,
        requirementSummary: { ...planned.requirementSummary, missingCount: 1 } }),
      planReopen: vi.fn(), approve: vi.fn(), readOperation: vi.fn(), readCase: vi.fn(),
    }
    render(<CaseLifecycleModal item={item} port={port} onClose={vi.fn()} onUpdated={vi.fn()} onUnauthorized={vi.fn()} onReload={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Önizleme Oluştur' }))
    expect(await screen.findByText(/Normal kapanış eksik/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Onayla ve Kapat' })).not.toBeInTheDocument()
  })
})
