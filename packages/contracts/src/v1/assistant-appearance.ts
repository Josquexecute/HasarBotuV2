import { z } from 'zod'
import { idSchema } from '../common/primitives.js'

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const assistantAppearanceSchema = z.strictObject({
  scheme: z.enum(['system', 'light', 'dark']), accentColor: color, characterColor: color,
  textSize: z.enum(['normal', 'large']), reduceMotion: z.boolean(),
})
export { DEFAULT_ASSISTANT_APPEARANCE, type AssistantAppearance } from './assistant-appearance-values.js'
export const assistantAppearanceResponseSchema = z.strictObject({ userId: idSchema, version: z.number().int().min(0), appearance: assistantAppearanceSchema })
export const assistantAppearanceUpdateSchema = z.strictObject({ expectedUserId: idSchema, expectedVersion: z.number().int().min(0), appearance: assistantAppearanceSchema })
