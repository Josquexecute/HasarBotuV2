import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useNavigate } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { NotificationsPage } from './NotificationsPage'
import { mockCases } from '../../mocks/cases'
import { DATA_SOURCE_STORAGE_KEY } from '../../data/ports'
import type { OperationalAlertDataPort } from '../../data/operationalAlertPort'

const { getCase } = vi.hoisted(() => ({ getCase: vi.fn() }))
vi.mock('../../data/httpAdapter', () => ({ createHttpCasesAdapter: () => ({ getCase }) }))
vi.mock('./TrackingInbox', () => ({ TrackingInbox: ({ caseId }: { caseId?: string }) => <p>Inbox {caseId ?? 'all'}</p> }))
vi.mock('../tracking/TrackingWorkspace', () => ({ TrackingWorkspace: ({ caseId }: { caseId?: string }) => <p>Tracking {caseId ?? 'all'}</p> }))
beforeEach(() => { localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api'); getCase.mockReset() })
function setup(port?: OperationalAlertDataPort) {
  function Screen() {
    const navigate = useNavigate()
    return <><button onClick={() => navigate('/bildirimler?caseId=case-b')}>Select B</button><NotificationsPage port={port} /></>
  }
  return render(<MemoryRouter initialEntries={['/bildirimler?caseId=case-a']}><Screen /></MemoryRouter>)
}
it('passes one case to all sections, scopes read-all and can return to general notifications', async () => {
  getCase.mockResolvedValue({ ...mockCases[0], caseId: 'case-a', plate: '34 SCOPE 01' })
  const port = { list: vi.fn(async () => ({ schemaVersion: 'operational-alert/1.0.0' as const, evaluatedAt: '2026-10-18T00:00:00Z', totalCount: 1, alerts: [{ dedupeKey: 'scope', type: 'overdue_task' as const, severity: 'high' as const, caseId: 'case-a', plate: '34 SCOPE 01', officeNumber: '2026/1', summary: 'Selected alert', sourceDate: '2026-10-17', caseDetailPath: '/dosyalar/case-a' }] })), markAllRead: vi.fn(async () => {}) }
  setup(port)
  await screen.findByText('Selected alert')
  expect(port.list).toHaveBeenCalledWith(['case-a'])
  await userEvent.click(screen.getByRole('button', { name: 'Tümünü Okundu İşaretle' }))
  expect(port.markAllRead).toHaveBeenCalledWith(['case-a'])
  await userEvent.click(screen.getByRole('button', { name: 'Gelen kutusu' }))
  expect(await screen.findByText('Inbox case-a')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Tramer ve e-posta' }))
  expect(await screen.findByText('Tracking case-a')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Tüm dosyaların bildirimleri' }))
  expect(await screen.findByText('Tracking all')).toBeInTheDocument()
})
it('hides the prior case while another selection loads and fails closed on lookup errors', async () => {
  getCase.mockResolvedValueOnce({ ...mockCases[0], caseId: 'case-a', plate: '34 SCOPE 01' })
  setup()
  await screen.findByText('Inbox case-a')
  let fail!: (error: Error) => void
  getCase.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  await userEvent.click(screen.getByRole('button', { name: 'Select B' }))
  expect(screen.queryByText('Inbox case-a')).not.toBeInTheDocument()
  expect(screen.queryByText('34 SCOPE 01')).not.toBeInTheDocument()
  await waitFor(() => expect(getCase).toHaveBeenCalledWith('case-b'))
  await act(async () => fail(new Error('not found')))
  expect(await screen.findByRole('alert')).toHaveTextContent('Seçili dosya alınamadı')
  expect(screen.queryByText('Inbox all')).not.toBeInTheDocument()
  getCase.mockResolvedValueOnce({ ...mockCases[0], caseId: 'case-b', plate: '34 SCOPE 02' })
  await userEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }))
  expect(await screen.findByText('Inbox case-b')).toBeInTheDocument()
})
