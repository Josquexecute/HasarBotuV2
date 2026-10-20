import { z } from 'zod'
import { idSchema } from '../common/primitives.js'

export const DEFAULT_NOTIFICATION_PREFERENCES = { showPopups: true, playSound: true, assistantReaction: true } as const
export const notificationPreferencesSchema = z.strictObject({
  showPopups: z.boolean(), playSound: z.boolean(), assistantReaction: z.boolean(),
})
export const notificationPreferencesResponseSchema = z.strictObject({
  userId: idSchema, version: z.number().int().nonnegative(), preferences: notificationPreferencesSchema,
})
export const notificationPreferencesUpdateSchema = z.strictObject({
  expectedUserId: idSchema, expectedVersion: z.number().int().nonnegative(), preferences: notificationPreferencesSchema,
})
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>
export type NotificationPreferencesResponse = z.infer<typeof notificationPreferencesResponseSchema>
