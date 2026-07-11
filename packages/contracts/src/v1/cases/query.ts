import { z } from 'zod'
import {
  caseStageSchema,
  caseStatusSchema,
  caseTypeSchema,
  localDateSchema,
  serviceIdSchema,
  userIdSchema,
} from '../../common/primitives.js'
import {
  pageSizeWithDefaultSchema,
  pageWithDefaultSchema,
  sortDirectionSchema,
  sortFieldSchema,
} from '../../common/pagination.js'

/** Serbest metin arama ust uzunlugu. */
export const MAX_SEARCH_LENGTH = 120

/**
 * Arama alani davranisi acik tutulur:
 * - Alan yoksa arama filtresi uygulanmaz (tum uygun kayitlar).
 * - Varsa 1..120 karakter olmalidir; yalnizca bosluktan olusan deger reddedilir.
 */
export const searchSchema = z
  .string()
  .min(1)
  .max(MAX_SEARCH_LENGTH)
  .refine((value) => value.trim().length > 0, { error: 'search_must_not_be_blank' })

const casesQueryObject = z.strictObject({
  search: searchSchema.optional(),
  caseType: caseTypeSchema.optional(),
  status: caseStatusSchema.optional(),
  stage: caseStageSchema.optional(),
  responsibleUserId: userIdSchema.optional(),
  serviceId: serviceIdSchema.optional(),
  followUpFrom: localDateSchema.optional(),
  followUpTo: localDateSchema.optional(),
  sortBy: sortFieldSchema.default('updatedAt'),
  sortDirection: sortDirectionSchema.default('desc'),
  page: pageWithDefaultSchema,
  pageSize: pageSizeWithDefaultSchema,
})

/**
 * `GET /api/v1/cases` sorgu sozlesmesi.
 * Strict: bilinmeyen sorgu alani reddedilir. Coercion kullanilmaz.
 * `followUpFrom > followUpTo` gecersizdir. Karsilastirma `YYYY-MM-DD` icin
 * leksikografiktir; Date/timezone donusumu bilincli olarak yapilmaz.
 */
export const casesQuerySchema = casesQueryObject.refine(
  (value) => {
    if (value.followUpFrom === undefined || value.followUpTo === undefined) return true
    return value.followUpFrom <= value.followUpTo
  },
  { error: 'follow_up_range_invalid', path: ['followUpTo'] },
)

export type CasesQuery = z.infer<typeof casesQuerySchema>
export type CasesQueryInput = z.input<typeof casesQuerySchema>
