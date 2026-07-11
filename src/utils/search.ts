const COMBINING_MARKS = /\p{Diacritic}/gu
const SEARCH_SEPARATORS = /[^a-z0-9]+/g

export function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(SEARCH_SEPARATORS, '')
}

export function getSearchTokens(query: string): readonly string[] {
  return query
    .trim()
    .split(/\s+/)
    .map(normalizeSearchText)
    .filter(Boolean)
}

export function matchesSearchQuery(query: string, values: readonly string[]): boolean {
  const tokens = getSearchTokens(query)
  if (tokens.length === 0) return true

  const normalizedValues = values.map(normalizeSearchText)
  return tokens.every((token) => normalizedValues.some((value) => value.includes(token)))
}
