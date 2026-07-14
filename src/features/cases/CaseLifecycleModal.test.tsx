import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CaseLifecycleCommandPort, LifecycleOperationRecord } from '../../data'
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
  requirementSummary: { documentRuleVersion: '2026.07.14.1', closureRuleVersion: '2026.07.14.2', serviceEligibility: null, missingCount: 0,
    controlRequiredCount: 0, requirements: [{ requirementCode: 'closure.expert_report', sourceType: 'document',
      canonicalType: 'expert_report', status: 'present', reason: 'Doğrulanmış ready metadata.', requiresHumanReview: false }] },
}

describe('CaseLifecycleModal', () => {
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
    expect(screen.getByText('Mevcut')).toBeInTheDocument()
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
