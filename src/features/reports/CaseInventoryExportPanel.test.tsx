import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CaseInventoryDataPort } from '../../data/caseInventoryPort'
import { CaseInventoryClientError } from '../../data/caseInventoryPort'
import { CaseInventoryExportPanel } from './CaseInventoryExportPanel'

function makePort(overrides: Partial<CaseInventoryDataPort> = {}): CaseInventoryDataPort {
  return {
    preview: vi.fn().mockResolvedValue({ totalCount: 12, maxRows: 5_000, truncated: false, includesPhones: true }),
    exportWorkbook: vi.fn().mockResolvedValue({ blob: new Blob(['PK'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename: 'Dosya_Envanteri_20260718_eksper.xlsx' }),
    ...overrides,
  }
}

describe('CaseInventoryExportPanel', () => {
  it('sayımı gösterir ve filtre değişince yeni sorguyla yeniden yükler', async () => {
    const port = makePort()
    render(<CaseInventoryExportPanel port={port} />)
    const user = userEvent.setup()

    expect(await screen.findByText(/12/)).toBeInTheDocument()
    expect(screen.getByText(/dahil edilir/)).toBeInTheDocument()
    await waitFor(() => expect(port.preview).toHaveBeenCalledWith({}))

    await user.selectOptions(screen.getByLabelText('Envanter dosya türü'), 'casco')
    await waitFor(() => expect(port.preview).toHaveBeenCalledWith({ caseType: 'casco' }))
  })

  it('telefon yetkisi olmayan oturumda uyarı gösterir', async () => {
    const port = makePort({ preview: vi.fn().mockResolvedValue({ totalCount: 3, maxRows: 5_000, truncated: false, includesPhones: false }) })
    render(<CaseInventoryExportPanel port={port} />)
    expect(await screen.findByText(/bu oturumda üretilmez/)).toBeInTheDocument()
  })

  it('İndir butonuna basınca gerçek dosyayı indirir', async () => {
    const port = makePort()
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    render(<CaseInventoryExportPanel port={port} />)
    const user = userEvent.setup()

    const button = await screen.findByRole('button', { name: 'Excel İndir' })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)

    await waitFor(() => expect(port.exportWorkbook).toHaveBeenCalledWith({}))
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    vi.unstubAllGlobals()
  })

  it('sayım hatasında sahte veri göstermez ve indirmeyi devre dışı bırakır', async () => {
    const port = makePort({ preview: vi.fn().mockRejectedValue(new CaseInventoryClientError('unavailable', 'down')) })
    render(<CaseInventoryExportPanel port={port} />)
    expect(await screen.findByText(/Sayım alınamadı/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Excel İndir' })).toBeDisabled()
  })
})
