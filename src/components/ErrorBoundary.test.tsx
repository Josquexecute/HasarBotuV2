import { lazy, Suspense } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'
import { LoadingState } from './StateViews'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ErrorBoundary lazy modül güvenliği', () => {
  it('dinamik modül yükleme hatasını mevcut güvenli hata görünümüne taşır', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const BrokenLazyModule = lazy(async () => {
      throw new Error('synthetic lazy chunk failure')
    })

    render(
      <ErrorBoundary>
        <Suspense fallback={<LoadingState label="Modül hazırlanıyor" />}>
          <BrokenLazyModule />
        </Suspense>
      </ErrorBoundary>,
    )

    expect(await screen.findByRole('heading', { name: 'Bu görünüm yüklenemedi' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Uygulamayı yenile' })).toBeInTheDocument()
  })
})
