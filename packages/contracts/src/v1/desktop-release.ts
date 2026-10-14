import { z } from 'zod'

export const desktopReleaseSchema = z.strictObject({
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/).max(32),
  platform: z.literal('win32'),
  arch: z.literal('x64'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().min(2).max(250 * 1024 * 1024),
  publishedAt: z.iso.datetime(),
  notes: z.string().max(4000),
})
export type DesktopRelease = z.infer<typeof desktopReleaseSchema>

export const desktopReleaseResponseSchema = z.strictObject({ release: desktopReleaseSchema.nullable() })
