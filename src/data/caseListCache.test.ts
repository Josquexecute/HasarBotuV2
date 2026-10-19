import { expect, it } from 'vitest'
import { createCaseListCache } from './caseListCache'

it('retains measured row geometry through selection and view updates for the same list', () => {
  const cache = createCaseListCache()
  const value = { scope: 'org:user', port: undefined, queryKey: 'traffic' }
  cache.write(value)
  const heights = new Map([['case-1', 96]])
  cache.saveRowHeights(value.scope, value.queryKey, heights)
  cache.write({ ...value })
  expect(cache.read()?.rowHeights).toBe(heights)
})

it('discards measured rows when the query or authenticated scope changes', () => {
  const cache = createCaseListCache()
  cache.write({ scope: 'org:user', port: undefined, queryKey: 'traffic' })
  cache.saveRowHeights('org:user', 'traffic', new Map([['case-1', 96]]))
  cache.write({ scope: 'org:user', port: undefined, queryKey: 'casco' })
  expect(cache.read()?.rowHeights).toBeUndefined()
  cache.saveRowHeights('org:user', 'casco', new Map([['case-2', 96]]))
  cache.write({ scope: 'other:user', port: undefined, queryKey: 'casco' })
  expect(cache.read()?.rowHeights).toBeUndefined()
})

it('ignores geometry callbacks from a previous query or user', () => {
  const cache = createCaseListCache()
  cache.write({ scope: 'org:user', port: undefined, queryKey: 'current' })
  cache.saveRowHeights('org:user', 'previous', new Map([['case-1', 96]]))
  cache.saveRowHeights('other:user', 'current', new Map([['case-2', 96]]))
  expect(cache.read()?.rowHeights).toBeUndefined()
})
