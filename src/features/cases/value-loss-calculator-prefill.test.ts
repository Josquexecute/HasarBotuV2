import { describe, expect, it } from 'vitest'
import type { CaseRecord } from '../../types/case'
import { initialCalculatorDraft } from './value-loss-calculator-form'
import { calculatorCaseDefaults, mergeCalculatorCaseDefaults } from './value-loss-calculator-prefill'
import type { CalculatorSavedInput } from '../../data/valueLossCalculatorPort'

function item(fields: Record<string, string>): CaseRecord {
  return { lossDate: '2026-10-01', eksist: { vehicleFields: fields } } as CaseRecord
}

describe('SBM / Eksist calculator defaults', () => {
  it('never treats mileage as working hours for machinery', () => {
    expect(initialCalculatorDraft(item({ 'Araç Tarife Grubu': 'İŞ MAKİNESİ', 'Araç Km': '50000' })).usageValue).toBe('')
    expect(initialCalculatorDraft(item({ 'Araç Tarife Grubu': 'İŞ MAKİNESİ', 'Araç Km': '50000', 'Çalışma Saati': '2.500' })).usageValue).toBe('2500')
  })
  it('restores legacy parts, but only trusts their undamaged state with verified, consistent history evidence', () => {
    const saved: CalculatorSavedInput = { lossDate: '2026-10-01', notificationDate: null, evaluatedOn: '2026-10-01', heavyOrTotalDamage: false, vehicle: { make: 'FORD', model: 'FOCUS', modelYear: 2021, variant: null, mileage: 50000, usageType: null }, faultRateBasisPoints: 10000, preAccidentMarketValueMinor: 100_000_000, postRepairMarketValueMinor: null, damageParts: [{ partCode: 'old-part', partName: 'MOTOR KAPUTU', repairAction: 'repair_paint', priorDamage: 'no' }] }
    expect(initialCalculatorDraft(item({}), saved).parts[0]).toMatchObject({ label: 'MOTOR KAPUTU', operation: 'repair_paint', priorPartState: 'unknown' })
    const evidence = { id: 'history', createdAt: '2026-10-01T00:00:00Z', evidenceKey: 'history-1', sourceType: 'sbm_history' as const, documentId: null, documentVersionId: null, externalReference: 'ref:sbm/history-1', sourceHash: 'a'.repeat(64), observedAt: '2026-10-01', supports: ['prior_damage' as const], verificationStatus: 'verified' as const, conflict: false, notes: null }
    expect(initialCalculatorDraft(item({}), { ...saved, historyEvidence: [evidence] }).parts[0]).toMatchObject({ priorPartState: 'none', priorEvidence: 'Kayıtlı geçmiş: history-1' })
    expect(initialCalculatorDraft(item({}), { ...saved, historyEvidence: [{ ...evidence, conflict: true }] }).parts[0]?.priorPartState).toBe('unknown')
    expect(initialCalculatorDraft(item({}), { ...saved, historyEvidence: [{ ...evidence, verificationStatus: 'control_required' }] }).parts[0]?.priorPartState).toBe('unknown')
  })
  it('clears automatic usage and history when the source removes those values', () => {
    const before = item({ Kilometre: '50000', 'Önceki Hasar Sayısı': '2' })
    expect(mergeCalculatorCaseDefaults(initialCalculatorDraft(before), calculatorCaseDefaults(item({})), calculatorCaseDefaults(before))).toMatchObject({ usageValue: '', previousDamageCount: '' })
  })
  it('imports explicit usage, history and commercial fields and never invents a zero history count', () => {
    expect(initialCalculatorDraft(item({ Kilometre: '51.001', 'Önceki Hasar Sayısı': '2', 'Kullanım Amacı': 'Ticari' }))).toMatchObject({ usageValue: '51001', previousDamageCount: '2', commercialOrRental: true })
    expect(initialCalculatorDraft(item({})).previousDamageCount).toBe('')
    expect(initialCalculatorDraft(item({ Kilometre: 'bilinmiyor', 'Önceki Hasar Sayısı': 'yok / 2' }))).toMatchObject({ usageValue: '', previousDamageCount: '' })
  })
  it('uses the tariff group for vehicle type and Araç Tipi for the complete model description', () => {
    expect(initialCalculatorDraft(item({ Marka: 'FORD', 'Araç Tipi': 'TRANSIT 350 L VAN', 'Araç Tarife Grubu': 'KAMYONET', 'Model Yılı': '2021', 'Kasa Tipi': 'Panelvan' }))).toMatchObject({ accidentDate: '2026-10-01', manufacturer: 'FORD', model: 'TRANSIT 350 L VAN', vehicleType: 'KAMYONET', bodyType: 'panel_van', modelYear: '2021' })
  })
  it('prefers current case identity over an older saved calculation without losing its monetary inputs', () => {
    const saved: NonNullable<Parameters<typeof initialCalculatorDraft>[1]> = { lossDate: '2026-10-01', notificationDate: null, evaluatedOn: '2026-10-01', heavyOrTotalDamage: false, vehicle: { make: 'Eski Marka', model: 'Eski Model', modelYear: 2014, variant: null, mileage: null, usageType: null }, faultRateBasisPoints: 10000, preAccidentMarketValueMinor: 100_000_000, postRepairMarketValueMinor: null, damageParts: [] }
    expect(initialCalculatorDraft(item({ Marka: 'FORD', 'Araç Tipi': 'TRANSIT', 'Model Yılı': '2021', 'Araç Tarife Grubu': 'KAMYONET', 'Kasa Tipi': 'Panelvan' }), saved)).toMatchObject({ manufacturer: 'FORD', model: 'TRANSIT', modelYear: '2021', vehicleType: 'KAMYONET', bodyType: 'panel_van', marketValue: '1000000' })
  })
  it.each([
    ['Otomobil', 'OTOMOBİL'], ['Taksi', 'TAKSİ'], ['Minibüs', 'MİNİBÜS'], ['Otobüs', 'OTOBÜS'], ['Kamyonet', 'KAMYONET'], ['Kamyon', 'KAMYON'], ['Çekici', 'ÇEKİCİ'], ['İş Makinesi', 'İŞ MAKİNESİ'], ['Traktör', 'TRAKTÖR'], ['Tarım Makinesi', 'TARIM MAKİNESİ'], ['Özel Amaçlı Araç', 'ÖZEL AMAÇLI ARAÇ'], ['Römork', 'RÖMORK'], ['Motosiklet', 'MOTORSİKLET'], ['Tanker', 'TANKER'], ['1 - OTOMOBİL', 'OTOMOBİL'],
  ])('maps the explicit source category %s without replacing it with automobile', (source, expected) => {
    expect(initialCalculatorDraft(item({ 'Araç Tarife Grubu': source })).vehicleType).toBe(expected)
  })
  it('reads an explicit body description from the source model without guessing a model catalogue', () => {
    expect(initialCalculatorDraft(item({ 'Araç Tarife Grubu': 'OTOMOBİL', 'Araç Tipi': 'MEGANE SEDAN 1.5 DCI' })).bodyType).toBe('sedan')
    expect(initialCalculatorDraft(item({ 'Araç Tarife Grubu': 'OTOMOBİL', 'Araç Tipi': 'PASSAT 1.6 TDI' })).bodyType).toBe('unspecified')
    expect(initialCalculatorDraft(item({ 'Araç Tarife Grubu': 'MOTOSİKLET', 'Kasa Tipi': 'Scooter' })).bodyType).toBe('scooter')
  })
  it('does not invent missing values, strip several years into one, or accept an incompatible body', () => {
    expect(calculatorCaseDefaults(item({ 'Model Yılı': '2020 / 2021', 'Araç Tarife Grubu': 'Bilinmeyen' }))).toEqual({ accidentDate: '2026-10-01' })
    expect(initialCalculatorDraft(item({ 'Araç Tarife Grubu': 'MOTOSİKLET', 'Kasa Tipi': 'Sedan' })).bodyType).toBe('unspecified')
    expect(initialCalculatorDraft(item({ 'Kasa Tipi': 'Sedan', 'Gövde Tipi': 'SUV', 'Araç Tipi': 'MODEL SEDAN' })).bodyType).toBe('unspecified')
  })
  it('keeps manual edits while updating fields that still follow the source', () => {
    const before = item({ Marka: 'Önceki', 'Araç Tipi': 'Eski Model', 'Model Yılı': '2020' })
    const draft = { ...initialCalculatorDraft(before), manufacturer: 'Kullanıcı düzeltmesi', marketValue: '1.000.000' }
    const next = mergeCalculatorCaseDefaults(draft, calculatorCaseDefaults(item({ Marka: 'Güncel', 'Araç Tipi': 'Yeni Model', 'Model Yılı': '2021' })), calculatorCaseDefaults(before))
    expect(next).toMatchObject({ manufacturer: 'Kullanıcı düzeltmesi', model: 'Yeni Model', modelYear: '2021', marketValue: '1.000.000' })
  })
  it('preserves fields deliberately cleared by the user rather than refilling them on navigation', () => {
    const source = item({ Marka: 'FORD', 'Araç Tipi': 'TRANSIT', 'Araç Tarife Grubu': 'KAMYONET', 'Kasa Tipi': 'Panelvan' })
    const draft = { ...initialCalculatorDraft(source), manufacturer: '', model: '', bodyType: 'unspecified' as const }
    expect(mergeCalculatorCaseDefaults(draft, calculatorCaseDefaults(source), calculatorCaseDefaults(source))).toMatchObject({ manufacturer: '', model: '', bodyType: 'unspecified' })
  })
  it('clears an automatic accident date when that date is removed from the case', () => {
    const source = item({})
    const draft = initialCalculatorDraft(source)
    expect(mergeCalculatorCaseDefaults(draft, calculatorCaseDefaults({ ...source, lossDate: null }), calculatorCaseDefaults(source)).accidentDate).toBe('')
  })
  it('preserves physical observations and clears incompatible rule IDs and usage units after a source type change', () => {
    const draft = initialCalculatorDraft(item({ 'Araç Tarife Grubu': 'OTOMOBİL' }))
    draft.usageValue = '50000'
    draft.parts = [{ id: 'physical', stableRuleId: 'car-rule', label: 'Kapak', operation: 'replacement', paintMode: 'full', price: '', labor: '', priceUnknown: true, priorPartState: 'none', treatment: 'standard', position: 'sol', quantity: '2', material: 'steel' }]
    const next = mergeCalculatorCaseDefaults(draft, { vehicleType: 'İŞ MAKİNESİ', bodyType: 'excavator' }, { vehicleType: 'OTOMOBİL', bodyType: 'unspecified' })
    expect(next).toMatchObject({ vehicleType: 'İŞ MAKİNESİ', bodyType: 'excavator', usageValue: '', parts: [{ stableRuleId: '', label: 'Kapak', position: 'sol', quantity: '2' }] })
  })
})
