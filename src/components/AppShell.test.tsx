import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

const width = window.innerWidth
afterEach(() => { Object.defineProperty(window, 'innerWidth', { value: width, configurable: true }); vi.restoreAllMocks() })

it('keeps mobile navigation modal, closes on Escape and restores focus to its opener', async () => {
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
  const user = userEvent.setup()
  render(<MemoryRouter><AppShell collapsed={false} theme="light" onMenuToggle={vi.fn()} onThemeToggle={vi.fn()}><main>Çalışma alanı</main></AppShell></MemoryRouter>)
  const opener = screen.getByRole('button', { name: 'Sol menüyü aç veya kapat' })
  expect(opener).toHaveAttribute('aria-expanded', 'false')
  await user.click(opener)
  const dialog = screen.getByRole('dialog', { name: 'Ana menü' })
  expect(dialog).toHaveFocus()
  expect(screen.getByText('Çalışma alanı').closest('.app-shell__main')).toHaveAttribute('inert')
  await user.tab({ shift: true })
  expect(screen.getByRole('button', { name: 'Menüyü kapat' })).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(opener).toHaveFocus()
})

it('resets a mobile drawer when returning to desktop width', async () => {
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
  render(<MemoryRouter><AppShell collapsed={false} theme="light" onMenuToggle={vi.fn()} onThemeToggle={vi.fn()}>İçerik</AppShell></MemoryRouter>)
  await userEvent.click(screen.getByRole('button', { name: 'Sol menüyü aç veya kapat' }))
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
  fireEvent(window, new Event('resize'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
  fireEvent(window, new Event('resize'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
