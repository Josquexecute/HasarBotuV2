import { expect, it } from 'vitest'
import { mockCases } from '../mocks/cases'
import { resolveCaseReferenceNames } from './caseReferenceNames'
import type { CaseReferenceWorkspace } from './ports'

const references: CaseReferenceWorkspace = { insurers: [{ id: 'insurer', name: 'Güncel Sigorta' }], users: [{ id: 'owner', displayName: 'Güncel Sorumlu' }], experts: [{ id: 'expert', displayName: 'Güncel Eksper' }], services: [] }
const item = { ...mockCases[0]!, responsibleUserId: 'owner', insurerId: 'insurer', expertUserId: 'expert', company: '—', assignee: '—', expert: '—' }

it('resolves list and quick-detail names by their authoritative IDs without changing stored data', () => {
  expect(resolveCaseReferenceNames(item, references)).toMatchObject({ company: 'Güncel Sigorta', assignee: 'Güncel Sorumlu', expert: 'Güncel Eksper' })
  expect(item.assignee).toBe('—')
})

it('keeps historical names when the current ID is unavailable and retains the original record while loading', () => {
  expect(resolveCaseReferenceNames(item, null)).toBe(item)
  expect(resolveCaseReferenceNames({ ...item, responsibleUserId: 'inactive', assignee: 'Geçmiş sorumlu' }, references).assignee).toBe('Geçmiş sorumlu')
})
