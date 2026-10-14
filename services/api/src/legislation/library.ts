import { z } from 'zod'
import { legislationSourceSchema, type LegislationQuestion, type LegislationSource } from '@hasarbotu/contracts'
import { legislationCatalogData } from './catalog.generated.js'

const pageSchema = z.strictObject({ id: z.string(), page: z.number().int().positive(), text: z.string().min(1) })
const sourceSchema = legislationSourceSchema.omit({ pageCount: true }).extend({ pages: z.array(pageSchema).min(1) })
type CatalogSource = Omit<LegislationSource, 'pageCount'> & { pages: { id: string; page: number; text: string }[] }
export const catalog: { version: string; sources: CatalogSource[] } = z.strictObject({ version: z.string(), sources: z.array(sourceSchema).min(1) }).parse(legislationCatalogData)
export const sourceSummary = (source: CatalogSource): LegislationSource => {
  const { pages, ...summary } = source
  return { ...summary, pageCount: pages.length }
}
export const normalizeLegalText = (value: string) => value.toLocaleLowerCase('tr').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const stop = new Set('hangi nasil nedir neden icin ile ve veya bir bu su mi mu ne kadar olarak hakkinda bilgi gereken gerekir'.split(' '))
export function retrieveLegislation(input: LegislationQuestion, now = new Date()) {
  const terms = [...new Set(normalizeLegalText(input.question).split(' ').filter(t => t.length > 2 && !stop.has(t)))].slice(0, 20)
  if (!terms.length) return []
  const pages = catalog.sources.filter(s => (!input.sourceIds.length || input.sourceIds.includes(s.id))
    && now.getTime() - Date.parse(s.verifiedAt) <= 14 * 86_400_000
    && (!input.eventDate || !s.effectiveFrom || input.eventDate >= s.effectiveFrom))
    .flatMap(source => source.pages.map(page => ({ source, page, normalized: normalizeLegalText(page.text) })))
  const frequencies = terms.map(term => pages.filter(p => p.normalized.includes(term)).length)
  return pages.map(item => ({ ...item, score: terms.reduce((score, term, index) => score + (item.normalized.includes(term) ? Math.log(1 + pages.length / (1 + frequencies[index]!)) : 0), 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.page.id.localeCompare(b.page.id)).slice(0, 6)
    .map(({ source, page }) => ({ id: page.id, sourceId: source.id, title: source.title, url: source.url + (source.format === 'pdf' ? '#page=' + page.page : ''), page: page.page, locatorKind: source.format === 'pdf' ? 'page' as const : 'annex' as const, contentHash: source.contentHash, excerpt: page.text }))
}
