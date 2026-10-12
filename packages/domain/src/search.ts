export function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase('tr-TR').replaceAll('ı','i').normalize('NFD')
    .replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,'')
}

export function getSearchTokens(query: string): readonly string[] {
  return query.trim().split(/\s+/).map(normalizeSearchText).filter(Boolean)
}

export function matchesSearchQuery(query: string,values: readonly string[]): boolean {
  const normalized = values.map(normalizeSearchText)
  return getSearchTokens(query).every((token) => normalized.some((value) => value.includes(token)))
}
