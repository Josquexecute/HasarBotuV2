import { expect, it } from 'vitest'
import { mockCases } from '../mocks/cases'
import { resolveCaseReferenceNames } from './caseReferenceNames'
import type { CaseReferenceWorkspace } from './ports'
import type { CaseRecord } from '../types/case'

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

it('shows a renamed linked expert ahead of the imported display text while retaining unlinked source names', () => {
  const linked = { ...item, eksist: { expertName: 'Kaynakta kalan eski isim' } as CaseRecord['eksist'] }
  expect(resolveCaseReferenceNames(linked, references).expert).toBe('Güncel Eksper')
  expect(resolveCaseReferenceNames({ ...linked, expertUserId: null }, references).expert).toBe('Kaynakta kalan eski isim')
  expect(linked.eksist?.expertName).toBe('Kaynakta kalan eski isim')
})
