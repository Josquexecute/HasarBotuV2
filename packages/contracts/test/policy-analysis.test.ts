import { describe, expect, it } from 'vitest'
import {
  policyAnalysisCreateRequestSchema,
  policyAnalysisResponseSchema,
  policyScenarioEvaluateRequestSchema,
  policySourceReferenceSchema,
} from '../src/index.js'

const id=(last:string)=>`00000000-0000-4000-8000-${last.padStart(12,'0')}`
const source={sourceKey:'S1',documentId:id('1'),documentVersionId:id('2'),pageNumber:3,sectionHeading:'Özel Şartlar',clauseIdentifier:'K-3',rawExcerpt:'Sentetik ve sınırlı poliçe alıntısı.',locator:'p3:c1-35',sourceType:'special_conditions' as const,confidence:.95}

function payload(){return{sourceDocumentId:id('1'),sourceDocumentVersionId:id('2'),insurerId:null,policyNumber:null,endorsementNumber:null,productName:null,productType:null,insurerFormat:null,policyStartDate:'2026-01-01',policyEndDate:'2026-12-31',issueDate:'2026-01-01',insuredVehicleReference:null,sourceCompleteness:'complete' as const,initialStatus:'draft' as const,sourceReferences:[source],coverages:[{code:'COLLISION',canonicalType:'collision' as const,originalHeading:'Çarpışma',originalWording:'Sentetik teminat metni.',inclusion:'included' as const,limit:null,conditions:[],exceptions:[],requiredDocuments:[],sourceKeys:['S1'],confidence:1}],deductibles:[],serviceRules:[],partRules:[],replacementVehicleRules:[],exclusions:[],requiredDocuments:[],scenarioRules:[],conflicts:[]}}

describe('Kasko police analiz contracts',()=>{
  it('kontrollu import payloadini strict ve LocalDate olarak kabul eder',()=>{
    const parsed=policyAnalysisCreateRequestSchema.parse(payload())
    expect(parsed.policyStartDate).toBe('2026-01-01')
    expect(policyAnalysisCreateRequestSchema.safeParse({...payload(),unexpected:true}).success).toBe(false)
  })
  it('bilinmeyen evidence key, gecersiz tarih ve uzun excerpti reddeder',()=>{
    const unknown=payload();unknown.coverages[0]!.sourceKeys=['BILINMEYEN']
    expect(policyAnalysisCreateRequestSchema.safeParse(unknown).success).toBe(false)
    expect(policyAnalysisCreateRequestSchema.safeParse({...payload(),policyEndDate:'2025-01-01'}).success).toBe(false)
    expect(policyAnalysisCreateRequestSchema.safeParse({...payload(),sourceReferences:[{...source,rawExcerpt:'x'.repeat(1001)}]}).success).toBe(false)
  })
  it('response kaynak referansinda sayfa, madde, hash ve sinirli excerpt zorunludur',()=>{
    const responseSource={id:id('3'),documentId:id('1'),documentVersionId:id('2'),pageNumber:3,sectionHeading:'Özel Şartlar',clauseIdentifier:'K-3',rawExcerpt:'Sentetik alıntı.',excerptHash:'a'.repeat(64),locator:null,sourceType:'policy',confidence:1}
    expect(policySourceReferenceSchema.safeParse(responseSource).success).toBe(true)
    expect(policySourceReferenceSchema.safeParse({...responseSource,pageNumber:0}).success).toBe(false)
    expect(policyAnalysisResponseSchema.safeParse({analysis:{}}).success).toBe(false)
  })
  it('senaryo girdisini kanonik enum ve zorunlu operation ile dogrular',()=>{
    expect(policyScenarioEvaluateRequestSchema.safeParse({analysisId:id('9'),policyAnalysisVersion:1,scenarioType:'glass_service',damageCategory:null,repairMethod:null,requestedOperation:'glass_repair',documentState:'verified'}).success).toBe(true)
    expect(policyScenarioEvaluateRequestSchema.safeParse({analysisId:id('9'),policyAnalysisVersion:1,scenarioType:'guess',requestedOperation:'x',documentState:'verified'}).success).toBe(false)
  })
})
