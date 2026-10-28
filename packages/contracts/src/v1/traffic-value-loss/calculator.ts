import { z } from 'zod'
import { REAL_MARKET_VALUE_LOSS_VEHICLE_TYPES, VALUE_LOSS_BODY_TYPES, VALUE_LOSS_CALCULATOR_OPERATIONS, VALUE_LOSS_PART_MATERIALS, valueLossBodyOptions } from '@hasarbotu/domain'
import { localDateSchema } from '../../common/primitives.js'
import { trafficValueLossBasisPointsSchema, trafficValueLossMoneyMinorSchema, trafficValueLossRealMarketPartInputSchema } from './commands.js'

export { VALUE_LOSS_BODY_LABELS, VALUE_LOSS_BODY_TYPES, VALUE_LOSS_CALCULATOR_OPERATIONS, VALUE_LOSS_PART_MATERIALS, VALUE_LOSS_VEHICLE_GROUPS, VALUE_LOSS_PART_COVERAGE_LABELS, buildValueLossPartSuggestions, resolveValueLossCalculatorParts, valueLossBaseOnlyPrinciple, valueLossBodyOptions, valueLossCalculatorSourceParts, valueLossCalculatorVehicleContext } from '@hasarbotu/domain'
export type { ValueLossBodyType, ValueLossCalculatorPartSelection, ValueLossPartMaterial, ValueLossPartSuggestion, ValueLossPartCoverage } from '@hasarbotu/domain'

export const valueLossCalculatorPartSelectionSchema = trafficValueLossRealMarketPartInputSchema.extend({
  entryId: z.string().min(1).max(100),
  stableRuleId: z.string().min(1).max(500).nullable(),
  partName: z.string().trim().min(1).max(200),
  position: z.string().trim().max(120),
  quantity: z.number().int().min(1).max(20),
  material: z.enum(VALUE_LOSS_PART_MATERIALS),
  operation: z.enum(VALUE_LOSS_CALCULATOR_OPERATIONS),
  priorPartState: z.enum(['unknown', 'none', 'previously_damaged', 'previously_repaired_detachable', 'previously_repaired_welded']),
}).superRefine((value, context) => {
  if (['paint', 'repair_paint', 'replacement_paint'].includes(value.operation) && value.paintMode === null) context.addIssue({ code: 'custom', path: ['paintMode'], message: 'paint_mode_required' })
  if (value.quantity > 1 && !value.position) context.addIssue({ code: 'custom', path: ['position'], message: 'multiple_part_positions_required' })
})

export const valueLossCalculatorRequestSchema = z.strictObject({
  accidentDate: localDateSchema,
  vehicleType: z.enum(REAL_MARKET_VALUE_LOSS_VEHICLE_TYPES),
  vehicleIdentity: z.strictObject({ manufacturer: z.string().trim().min(1).max(120), model: z.string().trim().min(1).max(160) }).optional(),
  bodyType: z.enum(VALUE_LOSS_BODY_TYPES).optional(),
  calculationBasis: z.enum(['reference', 'market_difference']).optional(),
  modelYear: z.number().int().min(1900).max(2200).nullable(),
  usageValue: z.number().int().min(0).max(10_000_000).nullable(),
  marketValueMinor: trafficValueLossMoneyMinorSchema.min(1),
  damageAmountMinor: trafficValueLossMoneyMinorSchema,
  previousDamageCount: z.number().int().min(0).max(100).nullable(),
  commercialOrRental: z.boolean(),
  vehicleCondition: z.enum(['normal', 'prior_heavy_damage', 'current_heavy_damage', 'antique', 'foreign_plate']),
  parts: z.array(trafficValueLossRealMarketPartInputSchema).max(100),
  partSelections: z.array(valueLossCalculatorPartSelectionSchema).max(100).optional(),
  postRepairMarketValueMinor: trafficValueLossMoneyMinorSchema.nullable(),
  faultRateBasisPoints: trafficValueLossBasisPointsSchema,
}).superRefine((value, context) => {
  const market = value.calculationBasis === 'market_difference' || value.accidentDate < '2026-07-01'
  if (value.bodyType !== undefined && !valueLossBodyOptions(value.vehicleType).includes(value.bodyType)) context.addIssue({ code: 'custom', path: ['bodyType'], message: 'body_type_mismatch' })
  if (value.partSelections !== undefined && value.parts.length > 0) context.addIssue({ code: 'custom', path: ['parts'], message: 'mixed_part_representations' })
  if (value.vehicleIdentity !== undefined && value.partSelections === undefined) context.addIssue({ code: 'custom', path: ['partSelections'], message: 'physical_parts_required_for_manufacturer_matching' })
  if (value.partSelections !== undefined && new Set(value.partSelections.map(part => part.entryId)).size !== value.partSelections.length) context.addIssue({ code: 'custom', path: ['partSelections'], message: 'duplicate_entry_id' })
  if (value.modelYear !== null && value.modelYear > Number(value.accidentDate.slice(0, 4))) context.addIssue({ code: 'custom', path: ['modelYear'], message: 'model_year_after_accident' })
  if (!market && value.modelYear === null) context.addIssue({ code: 'custom', path: ['modelYear'], message: 'model_year_required' })
  if (!market && value.usageValue === null) context.addIssue({ code: 'custom', path: ['usageValue'], message: 'usage_value_required' })
  if (value.accidentDate >= '2026-07-01' && (value.partSelections ?? value.parts).length === 0) context.addIssue({ code: 'custom', path: ['parts'], message: 'parts_required' })
  if (market && value.postRepairMarketValueMinor === null) context.addIssue({ code: 'custom', path: ['postRepairMarketValueMinor'], message: 'post_repair_value_required' })
  if (market && value.calculationBasis !== undefined && value.postRepairMarketValueMinor !== null && value.postRepairMarketValueMinor > value.marketValueMinor) context.addIssue({ code: 'custom', path: ['postRepairMarketValueMinor'], message: 'post_repair_value_above_pre_accident' })
})

export const valueLossCalculatorResponseSchema = z.strictObject({
  amountMinor: trafficValueLossMoneyMinorSchema.nullable(),
  ruleVersion: z.string().min(1),
  calculationMethod: z.enum(['real_market_analysis', 'market_value_difference']),
  issues: z.array(z.strictObject({ field: z.string(), message: z.string() })),
})

export type ValueLossCalculatorRequest = z.infer<typeof valueLossCalculatorRequestSchema>
export type ValueLossCalculatorResponse = z.infer<typeof valueLossCalculatorResponseSchema>
