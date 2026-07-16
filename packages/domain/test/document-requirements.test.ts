import { describe, expect, it } from 'vitest'
import { defaultDocumentRequirementRuleSet, evaluateDocumentRequirements, type CanonicalDocumentType, type DocumentRequirementFact, type DocumentRequirementInputDocument } from '../src/index.js'
const now = '2026-07-14T09:00:00.000Z'
const rules = (caseType: 'traffic' | 'casco') => defaultDocumentRequirementRuleSet(caseType)
const ready = (id: string, canonicalDocumentType: CanonicalDocumentType) => ({ id, canonicalDocumentType, status: 'ready' as const, hashVerified: true, sizeVerified: true, verifiedAt: now })
const base = (caseType: 'traffic' | 'casco', documents: readonly DocumentRequirementInputDocument[] = []): DocumentRequirementFact => ({ caseType, documents })
const evaluate = (input: DocumentRequirementFact) => evaluateDocumentRequirements(input, now, rules(input.caseType))
const find = (v: ReturnType<typeof evaluateDocumentRequirements>, code: string) => v.requirements.find((x) => x.requirementCode === code)!
describe('document requirements', () => {
  it('ready belgenin doğrulanmış olmasını zorunlu tutar ve deterministiktir', () => { const input = base('traffic',[ready('a','victim_traffic_policy')]); expect(evaluate(input)).toEqual(evaluate(input)); expect(find(evaluate(input),'traffic_victim_policy').status).toBe('present') })
  it.each([['pending','control_required'],['failed','control_required'],['missing','missing']] as const)('%s mevcut sayılmaz', (status, expected) => expect(find(evaluate(base('traffic',[{...ready('a','victim_traffic_policy'),status}])),'traffic_victim_policy').status).toBe(expected))
  it('zabıt KTT/Beyan ve Trameri uygulanamaz yapar', () => { const v=evaluate(base('traffic',[ready('z','accident_report')])); expect(find(v,'ktt').status).toBe('not_applicable'); expect(find(v,'tramer_result').status).toBe('not_applicable') })
  it.each([['ktt','statement'],['statement','ktt']] as const)('zabıt yokken %s olay grubunu tek başına karşılar', (type, alternative) => { const v=evaluate(base('traffic',[ready('x',type)])); expect(find(v,'accident_report').status).toBe('not_applicable'); expect(find(v,alternative).status).toBe('not_applicable'); expect(v.alternativeGroups[0]?.status).toBe('present') })
  it.each(['pending','failed'] as const)('zabıt %s olsa da ready KTT olay grubunu karşılar ve gereksiz kontrol üretmez', (status) => {
    const v=evaluate(base('traffic',[
      {...ready('z','accident_report'),status},
      ready('k','ktt'),
    ]))
    expect(find(v,'accident_report')).toMatchObject({
      status:'not_applicable',
      requiresHumanReview:false,
      relatedDocumentStatuses:[{documentId:'z',status}],
    })
    expect(v.alternativeGroups[0]).toMatchObject({status:'present',requiresHumanReview:false})
  })
  it('rücu belirsizse kontrol ister, kesinleşirse zorunlu değerlendirir', () => { expect(find(evaluate({...base('casco'),recourseStatus:'unknown'}),'recourse_tramer_result').status).toBe('control_required'); expect(find(evaluate({...base('casco'),recourseStatus:'confirmed'}),'recourse_tramer_result').status).toBe('missing') })
  it('enjekte edilen farklı kural sürümlerini açıkça ayırır', () => { const input=base('traffic'); const first=evaluateDocumentRequirements(input,now,rules('traffic')); const second=evaluateDocumentRequirements(input,now,{...rules('traffic'),version:'2026.07.14.2'}); expect(first.ruleSet.version).not.toBe(second.ruleSet.version); expect(first.requirements[0]?.ruleVersion).not.toBe(second.requirements[0]?.ruleVersion) })
  it('aynı kanonik türde birden çok adayı kimliğe göre deterministik değerlendirir', () => { const input=base('traffic',[ready('b','victim_traffic_policy'),ready('a','victim_traffic_policy')]); expect(find(evaluate(input),'traffic_victim_policy').matchedDocumentIds).toEqual(['a','b']) })
  it('ready etiketi doğrulama damgaları olmadan present sayılmaz', () => { const candidate={...ready('a','victim_traffic_policy'),hashVerified:false}; expect(find(evaluate(base('traffic',[candidate])),'traffic_victim_policy').status).toBe('control_required') })
})
