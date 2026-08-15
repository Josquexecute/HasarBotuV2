import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CaseRecord } from '../../types/case'
import type { CaseReferenceWorkspace } from '../../data/ports'
import { CaseLegacyReferenceFields } from './CaseLegacyReferenceFields'

const base = {
  caseId: 'case-1', plate: '34 TEST 1', officeNumber: '2026/1', noticeNumber: '—', claimNumber: '—', company: '—',
  type: 'Trafik', status: 'Açık', stage: 'Raporlama', missingDocuments: 0, assignee: '—', expert: '—', service: '—',
  followUp: '—', followUpTone: 'normal', lastAction: '—', vehicle: '—', insured: '—', estimatedDamage: 0, notes: [],
} satisfies CaseRecord

const references: CaseReferenceWorkspace = {
  insurers: [], services: [],
  users: [{ id: 'user-1', displayName: 'Ömer Faruk İşleyen' }, { id: 'user-2', displayName: 'Başka V2 Kullanıcı' }],
  experts: [],
}

describe('Case legacy reference alanlari', () => {
  it('first-class NULL iken legacy responsible/expert/service adlarini tarihsel diye gosterir', () => {
    render(<dl><CaseLegacyReferenceFields item={{ ...base, responsibleUserId: null, expertUserId: null, serviceId: null, legacyReferences: {
      responsibleNames: ['Enes Özmen'], expertNames: ['Baran Gürbüz'], serviceNames: ['BABİL - VEDAT'],
    } }} references={references} /></dl>)
    expect(screen.getByText('V1 geçmiş: Enes Özmen')).toBeInTheDocument()
    expect(screen.getByText('V1 geçmiş: Baran Gürbüz')).toBeInTheDocument()
    expect(screen.getByText('V1 geçmiş: BABİL - VEDAT')).toBeInTheDocument()
  })

  it('first-class ile ayni legacy degeri tekrar etmez', () => {
    render(<dl><CaseLegacyReferenceFields item={{ ...base, responsibleUserId: 'user-1', legacyReferences: {
      responsibleNames: ['Ömer Faruk İşleyen'], expertNames: [], serviceNames: [],
    } }} references={references} /></dl>)
    expect(screen.getByText('Ömer Faruk İşleyen')).toBeInTheDocument()
    expect(screen.queryByText(/V1 geçmiş/)).not.toBeInTheDocument()
  })

  it('first-class ve legacy farkliysa ikisini de ayirarak korur', () => {
    render(<dl><CaseLegacyReferenceFields item={{ ...base, responsibleUserId: 'user-2', legacyReferences: {
      responsibleNames: ['Enes Özmen'], expertNames: [], serviceNames: [],
    } }} references={references} /></dl>)
    expect(screen.getByText('Başka V2 Kullanıcı')).toBeInTheDocument()
    expect(screen.getByText('V1 geçmiş (güncel kayıttan farklı): Enes Özmen')).toBeInTheDocument()
  })
})
