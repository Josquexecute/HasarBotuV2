import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { mockCases } from '../../mocks/cases'
import { CaseCommandError, type CaseCommandPort } from '../../data/commandPort'
import { CaseTypeAssignment } from './CaseTypeAssignment'

describe('CaseTypeAssignment', () => {
  it('requires an explicit choice and saves a closed folder with optimistic locking', async () => {
    const item = { ...mockCases[0]!, type: 'Seçiniz' as const, lifecycleStatus: 'closed' as const, version: 7 }
    const updated = { ...item, type: 'Kasko' as const, version: 8 }
    const updateCase = vi.fn().mockResolvedValue(updated), onUpdated = vi.fn()
    render(<CaseTypeAssignment item={item} canEdit onUpdated={onUpdated} onUnauthorized={vi.fn()} commandPort={{ updateCase } as unknown as CaseCommandPort} />)
    expect(screen.getByRole('button', { name: 'Türü Kaydet' })).toBeDisabled()
    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox'), 'casco')
    await user.click(screen.getByRole('button', { name: 'Türü Kaydet' }))
    expect(updateCase).toHaveBeenCalledExactlyOnceWith(item.caseId, { expectedVersion: 7, caseType: 'casco' })
    expect(onUpdated).toHaveBeenCalledWith(updated)
  })
  it('keeps failed changes pending and prevents edits without permission', async () => {
    const item = { ...mockCases[0]!, type: 'Seçiniz' as const, version: 1 }
    const updateCase = vi.fn().mockRejectedValue(new CaseCommandError('version_conflict', 'stale')), onUpdated = vi.fn()
    const view = render(<CaseTypeAssignment item={item} canEdit onUpdated={onUpdated} onUnauthorized={vi.fn()} commandPort={{ updateCase } as unknown as CaseCommandPort} />)
    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox'), 'traffic')
    await user.click(screen.getByRole('button', { name: 'Türü Kaydet' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(onUpdated).not.toHaveBeenCalled()
    view.rerender(<CaseTypeAssignment item={item} canEdit={false} onUpdated={onUpdated} onUnauthorized={vi.fn()} />)
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Türü Kaydet' })).toBeDisabled()
  })
})
