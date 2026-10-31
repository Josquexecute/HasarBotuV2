import { afterEach,expect,it,vi } from 'vitest'
import { cleanup,render,screen,waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { TrackingSnapshot } from '@hasarbotu/contracts'
import { TrackingWorkspace } from './TrackingWorkspace'

afterEach(() => { cleanup();vi.restoreAllMocks() })
const base: TrackingSnapshot = { tramer: [],documents: [],notifications: [],mailConnections: [],reviews: [],users: [],history: [],services: [],canManage: true,googleEnabled: false,automaticSbmEnabled: false }
it('bounds mail forms and rows, preserves drafts and requires a verified outcome before applying',async () => {
  const data = structuredClone(base)
  data.reviews = Array.from({ length: 82 },(_,i) => ({ id: String(i),applicationNumber: '000'+i,resultText: 'Raw mail '+i,reason: 'ambiguous_result',email: 'mail@example.test',receivedAt: '2026-10-29T08:00:00Z' }))
  const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(async () => Response.json(data))
  const { container } = render(<MemoryRouter><TrackingWorkspace view="center" /></MemoryRouter>)
  await userEvent.click(await screen.findByRole('button',{ name: 'E-posta kontrolü 82' }))
  expect(container.querySelectorAll('.tracking-list__row')).toHaveLength(25)
  expect(screen.getAllByLabelText('Sonuç ve kontrol gerekçesi')).toHaveLength(1)
  expect(screen.getByLabelText('Doğrulanan sonuç')).toHaveValue('')
  expect(container.querySelector('.tracking-raw')).not.toHaveAttribute('open')
  await userEvent.type(screen.getByLabelText('Sonuç ve kontrol gerekçesi'),'Kontrol taslağı')
  expect(screen.getByRole('button',{ name: 'Doğruladığım sonucu uygula' })).toBeDisabled()
  await userEvent.click(container.querySelectorAll('.tracking-list__row')[1]!)
  expect(screen.getByLabelText('Sonuç ve kontrol gerekçesi')).toHaveValue('')
  await userEvent.click(container.querySelectorAll('.tracking-list__row')[0]!)
  expect(screen.getByLabelText('Sonuç ve kontrol gerekçesi')).toHaveValue('Kontrol taslağı')
  await userEvent.selectOptions(screen.getByLabelText('Doğrulanan sonuç'),'cancelled')
  expect(screen.getByRole('button',{ name: 'Doğruladığım sonucu uygula' })).toBeEnabled()
  await userEvent.click(screen.getByRole('button',{ name: 'Sonraki' }))
  expect(container.querySelectorAll('.tracking-list__row')).toHaveLength(25)
  await userEvent.type(screen.getByLabelText('Takip kayıtlarında ara'),'00081')
  expect(container.querySelectorAll('.tracking-list__row')).toHaveLength(1)
  expect(screen.getByLabelText('Kontrol edilen başvuru numarası')).toHaveValue('00081')
  expect(fetch.mock.calls.every(([,options]) => options?.method !== 'POST')).toBe(true)
  expect(fetch.mock.calls[0]?.[0]).toBe('/api/v1/tracking?includeCompleted=true&includeNotifications=false')
})
it('refreshes once and keeps connection errors visible in the collapsed account summary',async () => {
  const data = { ...base,mailConnections: [{ id: 'mail',email: 'mail@example.test',status: 'permission_required' as const,lastSuccessAt: null,lastError: 'Google izni yenilenmeli.' }] }
  const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(async () => Response.json(data))
  render(<MemoryRouter><TrackingWorkspace view="center" /></MemoryRouter>)
  await screen.findByText(/Bağlantı kontrolü gerekiyor/)
  await userEvent.click(screen.getByRole('button',{ name: 'Yenile' }))
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/tracking'))).toHaveLength(2))
})
