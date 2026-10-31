import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Bell } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { NotificationCard } from './NotificationCard'

describe('NotificationCard', () => {
  it('expands long content without triggering navigation or the read action', async () => {
    const onOpen = vi.fn(), markRead = vi.fn()
    const title = 'Uzun bildirim içeriği ve kontrol edilecek evrak. '.repeat(30)
    const { container } = render(<NotificationCard icon={Bell} label="Evrak" plate="34 TEST 1" officeNumber="2026/1" title={title} onOpen={onOpen} action={<button onClick={markRead}>Okundu</button>} />)
    const detail = container.querySelector('details')!
    expect(detail.open).toBe(false)
    await userEvent.click(screen.getByText('Bildirimin tamamı'))
    expect(detail.open).toBe(true)
    expect(detail.querySelector('p')).toHaveTextContent(title.trim())
    expect(onOpen).not.toHaveBeenCalled()
    expect(markRead).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Okundu' }))
    expect(markRead).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '34 TEST 1 dosyasına git' }))
    expect(onOpen).toHaveBeenCalledOnce()
  })
  it('omits disclosure for short content and preserves disabled navigation', () => {
    const { container } = render(<NotificationCard icon={Bell} label="Evrak" plate="34 TEST 1" officeNumber="2026/1" title="Kısa bildirim" disabled onOpen={vi.fn()} />)
    expect(container.querySelector('details')).toBeNull()
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
