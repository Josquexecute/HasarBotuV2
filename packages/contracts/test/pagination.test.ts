import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  pageInfoSchema,
  pageSchema,
  pageSizeSchema,
  sortDirectionSchema,
  sortFieldSchema,
} from '../src/index.js'

describe('pagination ve sorting', () => {
  it('varsayilan sabitleri sozlesme geneliyle uyumludur', () => {
    expect(DEFAULT_PAGE).toBe(1)
    expect(DEFAULT_PAGE_SIZE).toBe(25)
    expect(MAX_PAGE_SIZE).toBe(100)
  })

  it('page 1+ tam sayidir', () => {
    expect(pageSchema.safeParse(1).success).toBe(true)
    expect(pageSchema.safeParse(0).success).toBe(false)
    expect(pageSchema.safeParse(2.5).success).toBe(false)
    expect(pageSchema.safeParse('1').success).toBe(false)
  })

  it('pageSize 1..100 araligini uygular', () => {
    expect(pageSizeSchema.safeParse(1).success).toBe(true)
    expect(pageSizeSchema.safeParse(100).success).toBe(true)
    expect(pageSizeSchema.safeParse(101).success).toBe(false)
    expect(pageSizeSchema.safeParse(0).success).toBe(false)
  })

  it('sort alani ve yonu yalniz desteklenen degerleri kabul eder', () => {
    expect(sortFieldSchema.safeParse('updatedAt').success).toBe(true)
    expect(sortFieldSchema.safeParse('followUpDate').success).toBe(true)
    expect(sortFieldSchema.safeParse('officeCaseNumber').success).toBe(true)
    expect(sortFieldSchema.safeParse('plate').success).toBe(true)
    expect(sortFieldSchema.safeParse('createdAt').success).toBe(false)
    expect(sortDirectionSchema.safeParse('asc').success).toBe(true)
    expect(sortDirectionSchema.safeParse('desc').success).toBe(true)
    expect(sortDirectionSchema.safeParse('up').success).toBe(false)
  })

  it('pageInfo strict ve tutarlidir', () => {
    const valid = { page: 1, pageSize: 25, totalItems: 3, totalPages: 1 }
    expect(pageInfoSchema.safeParse(valid).success).toBe(true)
    expect(pageInfoSchema.safeParse({ ...valid, totalItems: -1 }).success).toBe(false)
    expect(pageInfoSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false)
  })
})
