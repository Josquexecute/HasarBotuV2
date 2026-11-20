import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { noticeSheetFixture } from '../../test/fixtures/notice-sheet'
import { NoticeSheet } from './NoticeSheet'

const fields = {
  ...noticeSheetFixture.defaults.fields,
  insuredName: 'Sigortalı kişi', insuredPlate: '34 SIG 001', insuredRegistrationDate: '2020-02-29',
  insuredMileage: '125.000', insuredHeavyDamage: 'Sigortalı ağır hasar', insuredPreviousClaims: '3',
  insuredDamageHistory: 'Sigortalı geçmiş onarım', victimName: 'Mağdur kişi', victimPlate: '06 MAG 002',
  victimRegistrationDate: '2021-10-17', victimMileage: '80.000', victimHeavyDamage: 'Mağdur ağır hasar',
  victimPreviousClaims: '2', victimDamageHistory: 'Mağdur geçmiş onarım',
  iban: 'TR00 KORUNACAK IBAN', missingDocuments: 'Gizli eksik evrak', inspectionNotes: 'Gizli eski not',
}

describe('İhbar föyü türüne göre içerik', () => {
  it('keeps traffic vehicle identities and victim history while omitting insured risk fields', () => {
    render(<NoticeSheet sheet={noticeSheetFixture} fields={fields} documents={noticeSheetFixture.defaults.documents} />)
    const insured = within(screen.getByRole('heading', { name: 'Sigortalı araç' }).closest('section')!)
    expect(insured.getByText('Sigortalı kişi')).toBeInTheDocument()
    expect(insured.getByText('34 SIG 001')).toBeInTheDocument()
    expect(insured.getByText('29.02.2020')).toBeInTheDocument()
    for (const label of ['Kilometre', 'Ağır hasar kaydı', 'Geçmiş hasar sayısı']) expect(insured.queryByText(label)).not.toBeInTheDocument()
    const victim = within(screen.getByRole('heading', { name: 'Mağdur araç' }).closest('section')!)
    for (const value of ['Mağdur kişi', '06 MAG 002', '17.10.2021', '80.000', 'Mağdur ağır hasar', '2']) expect(victim.getByText(value)).toBeInTheDocument()
    expect(screen.getByText('Mağdur geçmiş onarım')).toBeInTheDocument()
    expect(screen.queryByText('Sigortalı geçmiş onarım')).not.toBeInTheDocument()
  })

  it('keeps every insured casco field and removes the entire victim section', () => {
    render(<NoticeSheet sheet={{ ...noticeSheetFixture, caseType: 'casco' }} fields={fields} documents={noticeSheetFixture.defaults.documents} />)
    expect(screen.getByRole('article')).toHaveAccessibleName('Kasko ihbar föyü A4')
    for (const value of ['Sigortalı kişi', '34 SIG 001', '29.02.2020', '125.000', 'Sigortalı ağır hasar', '3', 'Sigortalı geçmiş onarım']) expect(screen.getByText(value)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Mağdur|Karşı araç/ })).not.toBeInTheDocument()
    for (const value of ['Mağdur kişi', '06 MAG 002', '80.000', 'Mağdur ağır hasar', 'Mağdur geçmiş onarım']) expect(screen.getByRole('article')).not.toHaveTextContent(value)
  })

  it.each(['traffic', 'casco'] as const)('omits documents, missing notes and IBAN from the %s output', caseType => {
    render(<NoticeSheet sheet={{ ...noticeSheetFixture, caseType }} fields={fields} documents={noticeSheetFixture.defaults.documents} />)
    const article = screen.getByRole('article')
    for (const value of ['IBAN', 'Evrak kontrolü', 'Eksikler', 'Gizli eksik evrak', 'Gizli eski not']) expect(article).not.toHaveTextContent(value)
    expect(screen.queryByLabelText('Var')).not.toBeInTheDocument()
    expect(article).toHaveTextContent('Servis bilgileri')
    expect(article).toHaveTextContent('Örnek Servis')
  })

  it('does not render an unclassified case as casco', () => {
    render(<NoticeSheet sheet={{ ...noticeSheetFixture, caseType: null }} fields={fields} documents={noticeSheetFixture.defaults.documents} />)
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })
})
