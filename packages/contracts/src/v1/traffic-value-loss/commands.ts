import { z } from 'zod'
import {
  REAL_MARKET_VALUE_LOSS_PART_OPERATIONS,
  REAL_MARKET_VALUE_LOSS_RULE_VERSION,
  REAL_MARKET_VALUE_LOSS_VEHICLE_TYPES,
  TRAFFIC_VALUE_LOSS_EVIDENCE_FIELDS,
  TRAFFIC_VALUE_LOSS_EVIDENCE_SOURCE_TYPES,
} from '@hasarbotu/domain'
import { idSchema, localDateSchema } from '../../common/primitives.js'

export const trafficValueLossCodeSchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/)
export const trafficValueLossMoneyMinorSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const trafficValueLossBasisPointsSchema = z.number().int().min(0).max(10_000)
const trafficValueLossHttpsReferenceSchema = z.string().min(1).max(500)
  .regex(/^https:\/\/(?![^/?#]*@)[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:[/?#][^\s\\]*)?$/)
const trafficValueLossControlledReferenceSchema = z.string().min(5).max(500)
  .regex(/^ref:(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*$/)
export const trafficValueLossExternalReferenceSchema = z.union([
  trafficValueLossHttpsReferenceSchema,
  trafficValueLossControlledReferenceSchema,
])

export const trafficValueLossEvidenceInputSchema = z.strictObject({
  evidenceKey: trafficValueLossCodeSchema,
  sourceType: z.enum(TRAFFIC_VALUE_LOSS_EVIDENCE_SOURCE_TYPES),
  documentId: idSchema.nullable().default(null),
  documentVersionId: idSchema.nullable().default(null),
  externalReference: trafficValueLossExternalReferenceSchema.nullable().default(null),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: localDateSchema.nullable().default(null),
  supports: z.array(z.enum(TRAFFIC_VALUE_LOSS_EVIDENCE_FIELDS)).min(1).max(20),
  verificationStatus: z.enum(['verified', 'control_required']),
  conflict: z.boolean().default(false),
  notes: z.string().trim().min(1).max(500).nullable().default(null),
}).superRefine((value, context) => {
  if (value.sourceType === 'document_version') {
    if (value.documentId === null || value.documentVersionId === null || value.externalReference !== null) {
      context.addIssue({ code: 'custom', path: ['documentVersionId'], message: 'document_evidence_invalid' })
    }
  } else {
    if (value.documentId !== null || value.documentVersionId !== null || value.externalReference === null) {
      context.addIssue({ code: 'custom', path: ['externalReference'], message: 'external_evidence_invalid' })
    }
  }
  if (value.sourceType === 'market_comparable' && value.observedAt === null) {
    context.addIssue({ code: 'custom', path: ['observedAt'], message: 'comparable_date_required' })
  }
})

export const trafficValueLossComparableInputSchema = z.strictObject({
  comparableKey: trafficValueLossCodeSchema,
  side: z.enum(['pre_accident', 'post_repair']),
  amountMinor: trafficValueLossMoneyMinorSchema,
  mileage: z.number().int().min(0).max(10_000_000).nullable().default(null),
  observedAt: localDateSchema,
  evidenceKey: trafficValueLossCodeSchema,
  excluded: z.boolean().default(false),
  exclusionReason: z.string().trim().min(1).max(500).nullable().default(null),
}).superRefine((value, context) => {
  if (value.excluded && value.exclusionReason === null) context.addIssue({ code: 'custom', path: ['exclusionReason'], message: 'exclusion_reason_required' })
  if (!value.excluded && value.exclusionReason !== null) context.addIssue({ code: 'custom', path: ['exclusionReason'], message: 'unexpected_exclusion_reason' })
})

export const trafficValueLossDamagePartInputSchema = z.strictObject({
  partCode: trafficValueLossCodeSchema,
  partName: z.string().trim().min(1).max(200),
  repairAction: z.enum(['repair_paint', 'replace_paint', 'paint', 'replace', 'paintless_repair']),
  priorDamage: z.enum(['yes', 'no', 'unknown']),
})

export const trafficValueLossRealMarketPartInputSchema = z.strictObject({
  stableRuleId: z.string().min(1).max(500),
  operation: z.enum(REAL_MARKET_VALUE_LOSS_PART_OPERATIONS),
  paintMode: z.enum(['full', 'local']).nullable(),
  newPartPriceMinor: trafficValueLossMoneyMinorSchema.nullable(),
  repairLaborMinor: trafficValueLossMoneyMinorSchema.nullable(),
  partPriceAvailability: z.enum(['available', 'unavailable']),
  priorPartState: z.enum([
    'none',
    'previously_damaged',
    'previously_repaired_detachable',
    'previously_repaired_welded',
  ]),
  treatment: z.enum([
    'standard',
    'accessory',
    'paintless_repair',
    'plastic_or_unpainted',
    'superstructure',
  ]),
})

export const trafficValueLossPrefillProvenanceInputSchema = z.strictObject({
  field: z.enum([
    'accidentDate',
    'vehicleType',
    'vehicleGroupCode',
    'modelYear',
    'usageValue',
    'commercialOrRental',
    'marketValueMinor',
    'damageAmountMinor',
    'parts',
    'previousDamageCount',
  ]),
  source: z.enum([
    'case',
    'approved_market_value',
    'approved_damage',
    'finalized_parts',
    'finalized_paint',
    'sbm_evidence',
    'other_evidence',
    'user_input',
  ]),
  sourceRevisionId: idSchema.nullable(),
  originalValue: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  newValue: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  overrideReason: z.string().trim().min(1).max(500).nullable(),
}).superRefine((value, context) => {
  if (value.source !== 'user_input' && value.overrideReason !== null) {
    context.addIssue({ code: 'custom', path: ['overrideReason'], message: 'override_reason_unexpected' })
  }
  if (value.source === 'user_input' && value.originalValue !== value.newValue
    && value.overrideReason === null) {
    context.addIssue({ code: 'custom', path: ['overrideReason'], message: 'override_reason_required' })
  }
})

export const trafficValueLossRealMarketInputSchema = z.strictObject({
  vehicleType: z.enum(REAL_MARKET_VALUE_LOSS_VEHICLE_TYPES).nullable(),
  vehicleGroupCode: z.enum(['A', 'B', 'C', 'Ç', 'D', 'E', 'F']).nullable(),
  usageMetric: z.enum(['mileage', 'working_hours']).nullable(),
  usageValue: z.number().int().min(0).max(10_000_000).nullable(),
  commercialOrRental: z.boolean(),
  previousDamageCount: z.number().int().min(0).max(100).nullable(),
  marketValueMinor: trafficValueLossMoneyMinorSchema.nullable(),
  damageAmountMinor: trafficValueLossMoneyMinorSchema.nullable(),
  parts: z.array(trafficValueLossRealMarketPartInputSchema).max(500),
  eligibilityFacts: z.strictObject({
    antiqueOrCollector: z.boolean().nullable(),
    priorHeavyDamage: z.boolean().nullable(),
    currentHeavyOrTotalDamage: z.boolean().nullable(),
    foreignPlate: z.boolean(),
    foreignMarketEvidenceVerified: z.boolean(),
  }),
  prefillProvenance: z.array(trafficValueLossPrefillProvenanceInputSchema).max(100),
})

export const trafficValueLossRuleOverrideSchema = z.strictObject({
  ruleIdentity: z.enum([
    REAL_MARKET_VALUE_LOSS_RULE_VERSION,
    'traffic-value-loss-market-difference/2026.07.01.1',
  ]),
  reason: z.string().trim().min(1).max(500),
})

export const trafficValueLossVersionCreateRequestSchema = z.strictObject({
  expectedVersion: z.number().int().min(0),
  evaluatedOn: localDateSchema,
  heavyOrTotalDamage: z.boolean().nullable(),
  vehicle: z.strictObject({
    make: z.string().trim().min(1).max(100).nullable(),
    model: z.string().trim().min(1).max(100).nullable(),
    variant: z.string().trim().min(1).max(150).nullable(),
    modelYear: z.number().int().min(1900).max(2200).nullable(),
    mileage: z.number().int().min(0).max(10_000_000).nullable(),
    usageType: z.string().trim().min(1).max(100).nullable(),
  }),
  faultRateBasisPoints: trafficValueLossBasisPointsSchema.nullable(),
  preAccidentMarketValueMinor: trafficValueLossMoneyMinorSchema.nullable(),
  postRepairMarketValueMinor: trafficValueLossMoneyMinorSchema.nullable(),
  damageParts: z.array(trafficValueLossDamagePartInputSchema).max(500),
  comparables: z.array(trafficValueLossComparableInputSchema).max(100),
  evidence: z.array(trafficValueLossEvidenceInputSchema).min(1).max(200),
  realMarket: trafficValueLossRealMarketInputSchema.nullable().default(null),
  ruleOverride: trafficValueLossRuleOverrideSchema.nullable().default(null),
  confirmedPreviewHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
}).superRefine((value, context) => {
  const evidenceKeys = new Set<string>()
  value.evidence.forEach((item, index) => {
    if (evidenceKeys.has(item.evidenceKey)) context.addIssue({ code: 'custom', path: ['evidence', index, 'evidenceKey'], message: 'duplicate_evidence_key' })
    evidenceKeys.add(item.evidenceKey)
  })
  const comparableKeys = new Set<string>()
  value.comparables.forEach((item, index) => {
    if (comparableKeys.has(item.comparableKey)) context.addIssue({ code: 'custom', path: ['comparables', index, 'comparableKey'], message: 'duplicate_comparable_key' })
    comparableKeys.add(item.comparableKey)
    if (!evidenceKeys.has(item.evidenceKey)) context.addIssue({ code: 'custom', path: ['comparables', index, 'evidenceKey'], message: 'unknown_evidence_key' })
  })
})

export const trafficValueLossSubmitRequestSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
})
export const trafficValueLossApproveRequestSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500).nullable().default(null),
})
export const trafficValueLossRejectRequestSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500),
})

export const trafficValueLossPreviewRequestSchema = trafficValueLossVersionCreateRequestSchema

export type TrafficValueLossVersionCreateRequest = z.infer<typeof trafficValueLossVersionCreateRequestSchema>
export type TrafficValueLossPreviewRequest = z.infer<typeof trafficValueLossPreviewRequestSchema>
export type TrafficValueLossRealMarketInput = z.infer<typeof trafficValueLossRealMarketInputSchema>
export type TrafficValueLossSubmitRequest = z.infer<typeof trafficValueLossSubmitRequestSchema>
export type TrafficValueLossApproveRequest = z.infer<typeof trafficValueLossApproveRequestSchema>
export type TrafficValueLossRejectRequest = z.infer<typeof trafficValueLossRejectRequestSchema>
