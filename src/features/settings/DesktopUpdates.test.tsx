import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopUpdateState, DesktopUpdatesSurface } from '@hasarbotu/contracts/desktop-update-state'
import { DesktopUpdates } from './DesktopUpdates'

describe('desktop update controls', () => {
  it('checks published version, shows release notes and invokes real installation command', async () => {
    const available: DesktopUpdateState = { currentVersion: '0.1.7', supported: true, phase: 'available', downloadedBytes: 0,
      release: { version: '0.1.8', platform: 'win32', arch: 'x64', sha256: 'a'.repeat(64), size: 100, publishedAt: '2026-10-14T00:00:00Z', notes: 'Kişisel Touch renkleri' } }
    let listener: ((state: DesktopUpdateState) => void) | undefined
    const unsubscribe = vi.fn()
    const surface: DesktopUpdatesSurface = { check: vi.fn(async () => available), install: vi.fn(async () => ({ ...available, phase: 'installing' as const })), onState: cb => { listener = cb; return unsubscribe } }
    const view = render(<DesktopUpdates suppliedSurface={surface} />)
    fireEvent.click(screen.getByText('Güncellemeleri kontrol et'))
    expect(await screen.findByText('0.1.8 sürümü hazır.')).toBeInTheDocument()
    expect(screen.getByText('Kişisel Touch renkleri')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Güncelle ve yeniden başlat'))
    expect(await screen.findByText('Güncelleme kuruluyor. Uygulama yeniden açılacak.')).toBeInTheDocument()
    expect(surface.install).toHaveBeenCalledOnce()
    act(() => listener?.({ ...available, phase: 'downloading', downloadedBytes: 50 }))
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '50')
    expect(screen.getByText('Güncellemeleri kontrol et')).toBeDisabled()
    view.unmount(); expect(unsubscribe).toHaveBeenCalledOnce()
  })
  it('shows server failures without presenting an install action', async () => {
    render(<DesktopUpdates suppliedSurface={{ check: async () => ({ currentVersion: '0.1.8', supported: true, phase: 'error', downloadedBytes: 0, message: 'Sunucuya ulaşılamadı.' }), install: vi.fn(), onState: () => () => {} }} />)
    fireEvent.click(screen.getByText('Güncellemeleri kontrol et'))
    expect(await screen.findByText('Sunucuya ulaşılamadı.')).toBeInTheDocument()
    expect(screen.queryByText('Güncelle ve yeniden başlat')).not.toBeInTheDocument()
  })
})
