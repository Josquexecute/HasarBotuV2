import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'
import { NotificationPreferencesEditor } from './NotificationPreferencesEditor'

afterEach(() => vi.unstubAllGlobals())
it('saves account-scoped popup, sound and assistant preferences and reports failures', async () => {
  const id = '01900000-0000-7000-8000-000000000001'
  const data = { userId: id,version: 0,preferences: { showPopups: true,playSound: true,assistantReaction: true } }
  const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(data)))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...data,version: 1,preferences: { showPopups: false,playSound: false,assistantReaction: false } })))
    .mockResolvedValueOnce(new Response('{}',{ status: 409 }))
  vi.stubGlobal('fetch',fetchImpl)
  const session = { mode: 'api',status: 'authenticated',user: { id },reportUnauthorized: vi.fn() } as unknown as SessionContextValue
  render(<SessionContext.Provider value={session}><NotificationPreferencesEditor /></SessionContext.Provider>)
  for (const label of ['Bildirim pencerelerini göster','Bildirim sesini aç','Touch bildirim tepkilerini göster']) fireEvent.click(await screen.findByLabelText(label))
  fireEvent.click(screen.getByRole('button',{ name: 'Bildirim tercihlerini kaydet' }))
  expect(await screen.findByText('Bildirim tercihleriniz kaydedildi.')).toBeInTheDocument()
  expect(JSON.parse(fetchImpl.mock.calls[1]![1].body)).toEqual({ expectedUserId: id,expectedVersion: 0,preferences: { showPopups: false,playSound: false,assistantReaction: false } })
  fireEvent.click(screen.getByRole('button',{ name: 'Bildirim tercihlerini kaydet' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('başka oturumda değişti'))
  expect(screen.getByLabelText('Bildirim pencerelerini göster')).not.toBeChecked()
})
