import { z } from 'zod'

/** Sayfa tabanli pagination varsayilanlari ve ust sinirlari. */
export const DEFAULT_PAGE = 1
export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE = 10_000
export const MAX_PAGE_SIZE = 100

/**
 * Ham (varsayilansiz) sayfa ve sayfa boyutu semalari. Coercion kullanilmaz;
 * string/boolean/NaN/Infinity ve ondalik degerler reddedilir. `page` ust siniri
 * derin sayfalama kotuye kullanimina karsi 10.000 ile sinirlidir.
 */
export const pageSchema = z.number().int().min(1).max(MAX_PAGE)
export const pageSizeSchema = z.number().int().min(1).max(MAX_PAGE_SIZE)

/** Sorgu icinde kullanilan, varsayilan uygulanmis sayfa alanlari. */
export const pageWithDefaultSchema = pageSchema.default(DEFAULT_PAGE)
export const pageSizeWithDefaultSchema = pageSizeSchema.default(DEFAULT_PAGE_SIZE)

/** Desteklenen siralama alanlari ve yonleri. */
export const SORT_FIELDS = ['updatedAt', 'followUpDate', 'officeCaseNumber', 'plate'] as const
export type SortField = (typeof SORT_FIELDS)[number]
export const sortFieldSchema = z.enum(SORT_FIELDS)

export const SORT_DIRECTIONS = ['asc', 'desc'] as const
export type SortDirection = (typeof SORT_DIRECTIONS)[number]
export const sortDirectionSchema = z.enum(SORT_DIRECTIONS)

/** Liste yaniti sayfa bilgisi. */
export const pageInfoSchema = z.strictObject({
  page: z.number().int().min(1).max(MAX_PAGE),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
  totalItems: z.number().int().min(0),
  totalPages: z.number().int().min(0),
})

export type PageInfo = z.infer<typeof pageInfoSchema>
