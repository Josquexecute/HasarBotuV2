import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceCommandPort, WorkspaceProvisioningRecord } from '../../data'
import { WorkspaceProvisioningPanel } from './WorkspaceProvisioningPanel'

const planned: WorkspaceProvisioningRecord = {
  id: 'plan-1',
  caseId: 'case-1',
  storageRootKey: 'test-root',
  relativePath: '2026/Temmuz 2026/34ABC123',
  status: 'planned',
  requiredSubdirectories: ['EVRAK', 'HASAR', 'OLAY YERİ', 'ONARIM', 'DEĞER KAYBI'],
  lastErrorCode: null,
  canApprove: true,
  canRetry: false,
  approvedAt: null,
  readyAt: null,
  createdAt: '2026-07-14T09:00:00.000Z',
  updatedAt: '2026-07-14T09:00:00.000Z',
}

describe('WorkspaceProvisioningPanel', () => {
  it('planı ayrı preview olarak gösterir; yalnız açık ikinci tıklamada onaylar', async () => {
    const port: WorkspaceCommandPort = {
      listActiveRoots: vi.fn().mockResolvedValue([{ rootKey: 'test-root', label: 'Sentetik kök' }]),
      readCurrentPlan: vi.fn().mockResolvedValue(null),
      createPlan: vi.fn().mockResolvedValue(planned),
      approvePlan: vi.fn().mockResolvedValue({ ...planned, status: 'queued', canApprove: false }),
      readPlan: vi.fn().mockResolvedValue({ ...planned, status: 'ready', canApprove: false, readyAt: '2026-07-14T09:01:00.000Z' }),
    }
    render(<WorkspaceProvisioningPanel caseId="case-1" notificationDate="2026-07-14" onUnauthorized={vi.fn()} port={port} />)
    await screen.findByRole('option', { name: 'Sentetik kök' })
    await userEvent.click(screen.getByRole('button', { name: /Planı Hazırla/ }))
    expect(await screen.findByText('2026/Temmuz 2026/34ABC123')).toBeInTheDocument()
    expect(port.approvePlan).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /Onayla ve Oluştur/ }))
    expect(port.approvePlan).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Agent işlemi izleniyor…')).toBeInTheDocument()
  })

  it('tekrar tıklamayı busy durumunda engeller', async () => {
    let resolvePlan: ((value: WorkspaceProvisioningRecord) => void) | undefined
    const pending = new Promise<WorkspaceProvisioningRecord>((resolve) => { resolvePlan = resolve })
    const onUnauthorized = vi.fn()
    const port: WorkspaceCommandPort = {
      listActiveRoots: vi.fn().mockResolvedValue([{ rootKey: 'test-root', label: 'Sentetik kök' }]),
      readCurrentPlan: vi.fn().mockResolvedValue(null),
      createPlan: vi.fn().mockReturnValue(pending),
      approvePlan: vi.fn(),
      readPlan: vi.fn(),
    }
    render(<WorkspaceProvisioningPanel caseId="case-1" notificationDate="2026-07-14" onUnauthorized={onUnauthorized} port={port} />)
    const button = await screen.findByRole('button', { name: /Planı Hazırla/ })
    await userEvent.click(button)
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(port.createPlan).toHaveBeenCalledTimes(1)
    resolvePlan?.(planned)
    await waitFor(() => expect(screen.getByText(planned.relativePath)).toBeInTheDocument())
  })

  it('sayfa yenilendiğinde mevcut ready planını yeniden okuyup durumunu korur', async () => {
    const ready = { ...planned, status: 'ready' as const, canApprove: false, readyAt: '2026-07-14T09:01:00.000Z' }
    const port: WorkspaceCommandPort = {
      listActiveRoots: vi.fn().mockResolvedValue([{ rootKey: 'test-root', label: 'Sentetik kök' }]),
      readCurrentPlan: vi.fn().mockResolvedValue(ready),
      createPlan: vi.fn(),
      approvePlan: vi.fn(),
      readPlan: vi.fn(),
    }
    render(<WorkspaceProvisioningPanel caseId="case-1" notificationDate="2026-07-14" onUnauthorized={vi.fn()} port={port} />)
    expect(await screen.findByText('Hazır ve doğrulandı')).toBeInTheDocument()
    expect(screen.getByText(ready.relativePath)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Planı Hazırla/ })).not.toBeInTheDocument()
  })
})
