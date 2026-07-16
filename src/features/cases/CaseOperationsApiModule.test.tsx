import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  CaseCommandPort,
  CaseOperationsPort,
  CaseReferenceDataPort,
} from '../../data'
import { CaseOperationsError } from '../../data'
import { mockCases } from '../../mocks/cases'
import { CaseOperationsApiModule } from './CaseOperationsApiModule'

const CASE_ID = '019f7000-0000-7000-8000-000000000001'
const USER_ID = '019f7000-0000-7000-8000-000000000002'
const TASK_ID = '019f7000-0000-7000-8000-000000000003'
const item = {
  ...mockCases[0],
  caseId: CASE_ID,
  version: 1,
  lifecycleStatus: 'open' as const,
  responsibleUserId: USER_ID,
  followUpDate: '2026-07-18',
}
const note = {
  id: CASE_ID,
  noteType: 'contact' as const,
  subject: 'Servis',
  body: 'Sentetik servis görüşmesi.',
  createdByUserId: USER_ID,
  createdByDisplayName: 'Sentetik Kullanıcı',
  createdAt: '2026-07-16T10:00:00.000Z',
}
const task = {
  id: TASK_ID,
  title: 'Servis formunu al',
  priority: 'high' as const,
  status: 'open' as const,
  assignedUserId: USER_ID,
  assignedUserDisplayName: 'Sentetik Kullanıcı',
  dueDate: '2026-07-15',
  dueStatus: 'overdue' as const,
  resolutionNote: null,
  resolvedByUserId: null,
  resolvedByDisplayName: null,
  resolvedAt: null,
  version: 1,
  createdByUserId: USER_ID,
  createdByDisplayName: 'Sentetik Kullanıcı',
  createdAt: '2026-07-16T10:00:00.000Z',
  updatedAt: '2026-07-16T10:00:00.000Z',
}
const workspace = {
  caseId: CASE_ID,
  asOfDate: '2026-07-16',
  notes: [note],
  tasks: [task],
  followUpHistory: [{
    id: 'history-1',
    previousFollowUpDate: null,
    newFollowUpDate: '2026-07-18',
    source: 'case_create' as const,
    caseVersion: 1,
    actorUserId: USER_ID,
    actorDisplayName: 'Sentetik Kullanıcı',
    changedAt: '2026-07-16T09:00:00.000Z',
  }],
  permissions: { canWrite: true, canCompleteTasks: true },
}

function references(): CaseReferenceDataPort {
  return {
    getCaseReferences: vi.fn().mockResolvedValue({
      insurers: [],
      services: [],
      experts: [],
      users: [{ id: USER_ID, displayName: 'Sentetik Kullanıcı' }],
    }),
  }
}

describe('Case Operations gerçek API modülü', () => {
  it('not, görev, zorunlu sonuç ve takip tarihi akışlarını kullanıcı kontrollü çalıştırır', async () => {
    const operations: CaseOperationsPort = {
      load: vi.fn().mockResolvedValue(workspace),
      createNote: vi.fn().mockResolvedValue(note),
      createTask: vi.fn().mockResolvedValue(task),
      completeTask: vi.fn().mockResolvedValue({ ...task, status: 'completed', version: 2, resolutionNote: 'Görev tamamlandı.', resolvedByUserId: USER_ID, resolvedByDisplayName: 'Sentetik Kullanıcı', resolvedAt: '2026-07-16T11:00:00.000Z' }),
      cancelTask: vi.fn(),
    }
    const commands: CaseCommandPort = {
      createCase: vi.fn(),
      updateCase: vi.fn().mockResolvedValue({ ...item, version: 2, followUpDate: '2026-07-22' }),
    }
    const user = userEvent.setup()
    const onUpdated = vi.fn()
    render(
      <CaseOperationsApiModule
        item={item}
        source="api"
        onUnauthorized={vi.fn()}
        onUpdated={onUpdated}
        onReloadCase={vi.fn()}
        operationsPort={operations}
        commandPort={commands}
        referencePort={references()}
      />,
    )
    await waitFor(() => expect(screen.getByText('Sentetik servis görüşmesi.')).toBeInTheDocument())
    expect(screen.getByText('Servis formunu al')).toBeInTheDocument()
    expect(screen.getByText('Gecikmiş')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Not'), 'Yeni sentetik not.')
    await user.click(screen.getByRole('button', { name: /Notu Ekle/ }))
    await waitFor(() => expect(operations.createNote).toHaveBeenCalledWith(CASE_ID, expect.objectContaining({ body: 'Yeni sentetik not.' })))

    await user.type(screen.getByLabelText('Görev'), 'Yeni görev')
    await user.click(screen.getByRole('button', { name: /Görev Oluştur/ }))
    await waitFor(() => expect(operations.createTask).toHaveBeenCalledWith(CASE_ID, expect.objectContaining({ title: 'Yeni görev', assignedUserId: USER_ID })))

    await user.click(screen.getByRole('button', { name: /Tamamla/ }))
    await user.click(screen.getByRole('button', { name: 'Onayla' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Görev sonucu notu zorunludur.')
    await user.type(screen.getByLabelText('Görev sonucu'), 'Görev tamamlandı.')
    await user.click(screen.getByRole('button', { name: 'Onayla' }))
    await waitFor(() => expect(operations.completeTask).toHaveBeenCalledWith(CASE_ID, TASK_ID, 1, 'Görev tamamlandı.'))

    const followUp = screen.getByLabelText('Yeni takip tarihi')
    await user.clear(followUp)
    await user.type(followUp, '2026-07-22')
    await user.click(screen.getByRole('button', { name: /Takibi Kaydet/ }))
    await waitFor(() => expect(commands.updateCase).toHaveBeenCalledWith(CASE_ID, {
      expectedVersion: 1,
      followUpDate: '2026-07-22',
    }))
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ version: 2, followUpDate: '2026-07-22' }))
  })

  it('API kesintisinde mock not/görev göstermeden güvenli hata ve retry sunar', async () => {
    const operations: CaseOperationsPort = {
      load: vi.fn().mockRejectedValue(new CaseOperationsError('unavailable', 'network')),
      createNote: vi.fn(),
      createTask: vi.fn(),
      completeTask: vi.fn(),
      cancelTask: vi.fn(),
    }
    render(
      <CaseOperationsApiModule
        item={item}
        source="api"
        onUnauthorized={vi.fn()}
        onUpdated={vi.fn()}
        onReloadCase={vi.fn()}
        operationsPort={operations}
        commandPort={{ createCase: vi.fn(), updateCase: vi.fn() }}
        referencePort={references()}
      />,
    )
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('mock kayıt gösterilmedi'))
    expect(screen.queryByText(/Ön panel ve sol şasi/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Yeniden dene/ })).toBeInTheDocument()
  })
})
