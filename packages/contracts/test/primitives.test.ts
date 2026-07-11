import { describe, expect, it } from 'vitest'
import {
  caseIdSchema,
  caseStageSchema,
  caseStatusSchema,
  caseTypeSchema,
  entityVersionSchema,
  idSchema,
  insurerIdSchema,
  localDateSchema,
  officeCaseNumberSchema,
  plateNumberSchema,
  serviceIdSchema,
  userIdSchema,
  utcDateTimeSchema,
} from '../src/index.js'

describe('primitive semalari', () => {
  it('kimlik bos olmayan string kabul eder, bos/bosluk reddeder', () => {
    expect(idSchema.safeParse('usr-2').success).toBe(true)
    expect(idSchema.safeParse('').success).toBe(false)
    expect(idSchema.safeParse('   ').success).toBe(false)
    expect(idSchema.safeParse(5).success).toBe(false)
  })

  it('adlandirilmis kimlik semalari (case/user/service/insurer) bos olmayan string ister', () => {
    for (const schema of [caseIdSchema, userIdSchema, serviceIdSchema, insurerIdSchema]) {
      expect(schema.safeParse('id-1').success).toBe(true)
      expect(schema.safeParse('').success).toBe(false)
      expect(schema.safeParse('  ').success).toBe(false)
    }
  })

  it('CaseType yalniz traffic/casco kabul eder', () => {
    expect(caseTypeSchema.safeParse('traffic').success).toBe(true)
    expect(caseTypeSchema.safeParse('casco').success).toBe(true)
    expect(caseTypeSchema.safeParse('Trafik').success).toBe(false)
    expect(caseTypeSchema.safeParse('kasko').success).toBe(false)
  })

  it('CaseStatus ve CaseStage kararli kodlari dogrular', () => {
    expect(caseStatusSchema.safeParse('open').success).toBe(true)
    expect(caseStatusSchema.safeParse('closed').success).toBe(true)
    expect(caseStatusSchema.safeParse('Beklemede').success).toBe(false)
    expect(caseStageSchema.safeParse('inspection_pending').success).toBe(true)
    expect(caseStageSchema.safeParse('unknown_stage').success).toBe(false)
  })

  it('OfficeCaseNumber kanonik YYYY/N ve yil sinirini uygular', () => {
    expect(officeCaseNumberSchema.safeParse('2026/184').success).toBe(true)
    expect(officeCaseNumberSchema.safeParse('2026/0').success).toBe(false)
    expect(officeCaseNumberSchema.safeParse('26/184').success).toBe(false)
    expect(officeCaseNumberSchema.safeParse('1999/1').success).toBe(false)
    expect(officeCaseNumberSchema.safeParse('2026-184').success).toBe(false)
  })

  it('PlateNumber domain plaka sinirini kullanir', () => {
    expect(plateNumberSchema.safeParse('34 MPA 764').success).toBe(true)
    expect(plateNumberSchema.safeParse('').success).toBe(false)
    expect(plateNumberSchema.safeParse('***').success).toBe(false)
  })

  it('UtcDateTime yalniz Z sonekli ISO tarih-saat kabul eder', () => {
    expect(utcDateTimeSchema.safeParse('2026-07-11T09:00:00Z').success).toBe(true)
    expect(utcDateTimeSchema.safeParse('2026-07-11T09:00:00.123Z').success).toBe(true)
    expect(utcDateTimeSchema.safeParse('2026-07-11T09:00:00+03:00').success).toBe(false)
    expect(utcDateTimeSchema.safeParse('2026-07-11').success).toBe(false)
    expect(utcDateTimeSchema.safeParse('2026-02-30T09:00:00Z').success).toBe(false)
  })

  it('LocalDate takvim gecerliligiyle YYYY-MM-DD kabul eder', () => {
    expect(localDateSchema.safeParse('2026-07-11').success).toBe(true)
    expect(localDateSchema.safeParse('2026-13-01').success).toBe(false)
    expect(localDateSchema.safeParse('2026-07-11T00:00:00Z').success).toBe(false)
  })

  it('EntityVersion 1+ tam sayidir; coercion yoktur', () => {
    expect(entityVersionSchema.safeParse(1).success).toBe(true)
    expect(entityVersionSchema.safeParse(0).success).toBe(false)
    expect(entityVersionSchema.safeParse(1.5).success).toBe(false)
    expect(entityVersionSchema.safeParse('1').success).toBe(false)
  })
})
