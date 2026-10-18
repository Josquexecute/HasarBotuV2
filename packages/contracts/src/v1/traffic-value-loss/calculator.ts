import { z } from 'zod'
import { REAL_MARKET_VALUE_LOSS_VEHICLE_TYPES } from '@hasarbotu/domain'
import { localDateSchema } from '../../common/primitives.js'
import { trafficValueLossBasisPointsSchema, trafficValueLossMoneyMinorSchema, trafficValueLossRealMarketPartInputSchema } from './commands.js'

export const valueLossCalculatorRequestSchema = z.strictObject({
  accidentDate: localDateSchema,
  vehicleType: z.enum(REAL_MARKET_VALUE_LOSS_VEHICLE_TYPES),
  modelYear: z.number().int().min(1900).max(2200).nullable(),
  usageValue: z.number().int().min(0).max(10_000_000).nullable(),
  marketValueMinor: trafficValueLossMoneyMinorSchema.min(1),
  damageAmountMinor: trafficValueLossMoneyMinorSchema,
  previousDamageCount: z.number().int().min(0).max(100),
  commercialOrRental: z.boolean(),
  vehicleCondition: z.enum(['normal', 'prior_heavy_damage', 'current_heavy_damage', 'antique', 'foreign_plate']),
  parts: z.array(trafficValueLossRealMarketPartInputSchema).max(100),
  postRepairMarketValueMinor: trafficValueLossMoneyMinorSchema.nullable(),
  faultRateBasisPoints: trafficValueLossBasisPointsSchema,
}).superRefine((value, context) => {
  if (value.modelYear !== null && value.modelYear > Number(value.accidentDate.slice(0, 4))) context.addIssue({ code: 'custom', path: ['modelYear'], message: 'model_year_after_accident' })
  if (value.accidentDate >= '2026-07-01' && value.modelYear === null) context.addIssue({ code: 'custom', path: ['modelYear'], message: 'model_year_required' })
  if (value.accidentDate >= '2026-07-01' && value.usageValue === null) context.addIssue({ code: 'custom', path: ['usageValue'], message: 'usage_value_required' })
  if (value.accidentDate >= '2026-07-01' && value.parts.length === 0) context.addIssue({ code: 'custom', path: ['parts'], message: 'parts_required' })
  if (value.accidentDate < '2026-07-01' && value.postRepairMarketValueMinor === null) context.addIssue({ code: 'custom', path: ['postRepairMarketValueMinor'], message: 'post_repair_value_required' })
})

export const valueLossCalculatorResponseSchema = z.strictObject({
  amountMinor: trafficValueLossMoneyMinorSchema.nullable(),
  ruleVersion: z.string().min(1),
  calculationMethod: z.enum(['real_market_analysis', 'market_value_difference']),
  issues: z.array(z.strictObject({ field: z.string(), message: z.string() })),
})

export type ValueLossCalculatorRequest = z.infer<typeof valueLossCalculatorRequestSchema>
export type ValueLossCalculatorResponse = z.infer<typeof valueLossCalculatorResponseSchema>
