import { describe, expect, it } from 'vitest'
import {
  CASE_FILE_OPERATION_APPROVE_ROUTE,
  CASE_FILE_OPERATION_CANCEL_ROUTE,
  CASE_FILE_OPERATION_PLAN_ROUTE,
  CASE_FILE_OPERATION_ROUTE,
  fileOperationApproveRequestSchema,
  fileOperationCancelRequestSchema,
  fileOperationPlanRequestSchema,
  fileOperationResponseSchema,
  jobPayloadSchema,
  jobResultRequestSchema,
} from '../src/index.js'

const SOURCE = {
  storageRootKey: 'primary-root',
  relativePath: '2026/Temmuz 2026/34ABC123',
}

const DESTINATION = {
  storageRootKey: 'archive-root',
  relativePath: '2026/Temmuz 2026/34ABC123',
}

describe('file operation contracts', () => {
  it('tenant kapsamli plan, oku, onay ve iptal route sabitlerini korur', () => {
    expect(CASE_FILE_OPERATION_PLAN_ROUTE).toBe('/api/v1/cases/:caseId/file-operations/plan')
    expect(CASE_FILE_OPERATION_ROUTE).toContain(':operationId')
    expect(CASE_FILE_OPERATION_APPROVE_ROUTE.endsWith('/:operationId/approve')).toBe(true)
    expect(CASE_FILE_OPERATION_CANCEL_ROUTE.endsWith('/:operationId/cancel')).toBe(true)
  })

  it('plan komutu yalniz mantiksal depolama referansi kabul eder', () => {
    expect(
      fileOperationPlanRequestSchema.parse({
        operationType: 'move_case_workspace',
        destinationStorageRootKey: 'archive-root',
        destinationRelativePath: DESTINATION.relativePath,
        expectedLocationVersion: 4,
      }),
    ).toMatchObject({ expectedLocationVersion: 4 })

    for (const unsafePath of ['../disari', 'P:/musteri', String.raw`\\sunucu\paylasim`, String.raw`2026\dosya`]) {
      expect(
        fileOperationPlanRequestSchema.safeParse({
          operationType: 'move_case_workspace',
          destinationStorageRootKey: 'archive-root',
          destinationRelativePath: unsafePath,
          expectedLocationVersion: 4,
        }).success,
      ).toBe(false)
    }
  })

  it('onay ve iptal acik kullanici niyeti gerektirir', () => {
    expect(fileOperationApproveRequestSchema.parse({ approved: true })).toEqual({ approved: true })
    expect(fileOperationApproveRequestSchema.safeParse({ approved: false }).success).toBe(false)
    expect(fileOperationCancelRequestSchema.parse({ cancelled: true })).toEqual({ cancelled: true })
    expect(fileOperationCancelRequestSchema.safeParse({}).success).toBe(false)
  })

  it('apply ve cleanup job payloadlari mutlak yol tasimaz', () => {
    const applyPayload = jobPayloadSchema.parse({
      kind: 'file_operation',
      operationId: 'operation-1',
      operationVersion: 2,
      operationType: 'move_case_workspace',
      source: SOURCE,
      destination: DESTINATION,
      strategy: 'staged_copy',
      plannedAt: '2026-07-14T09:00:00.000Z',
      stagingRelativePath: '.hasarbotu-staging/operation-1',
      temporaryRelativePath: '.hasarbotu-tmp/operation-1',
    })
    const cleanupPayload = jobPayloadSchema.parse({
      kind: 'file_operation_cleanup',
      operationId: 'operation-1',
      operationVersion: 3,
      source: SOURCE,
      destination: DESTINATION,
      manifestHash: 'a'.repeat(64),
      fileCount: 2,
      directoryCount: 1,
      totalBytes: 42,
    })

    expect(JSON.stringify({ applyPayload, cleanupPayload })).not.toMatch(/[A-Za-z]:[\\/]/)
  })

  it('agent sonucunda yalniz guvenli manifest ozeti kabul eder', () => {
    const value = jobResultRequestSchema.parse({
      outcome: 'verified',
      fileOperation: {
        phase: 'destination_verified',
        strategy: 'staged_copy',
        manifestHash: 'b'.repeat(64),
        fileCount: 5,
        directoryCount: 3,
        totalBytes: 1024,
        safeOutcomeCode: 'destination_verified',
      },
    })
    expect(value.fileOperation?.fileCount).toBe(5)
    expect(
      jobResultRequestSchema.safeParse({
        outcome: 'failed',
        errorCode: String.raw`EPERM C:\musteri`,
      }).success,
    ).toBe(false)
  })

  it('response optimistic version ve recovery/cleanup durumlarini acik tasir', () => {
    const value = fileOperationResponseSchema.parse({
      operation: {
        id: 'operation-1',
        caseId: 'case-1',
        operationType: 'move_case_workspace',
        source: SOURCE,
        destination: DESTINATION,
        expectedLocationVersion: 4,
        status: 'cleanup_pending',
        strategy: 'staged_copy',
        manifestHash: 'c'.repeat(64),
        fileCount: 5,
        directoryCount: 3,
        totalBytes: 1024,
        cleanupState: 'pending',
        failureReasonCode: null,
        version: 3,
        canApprove: false,
        canCancel: false,
        approvedAt: '2026-07-14T09:01:00.000Z',
        finalizedAt: null,
        createdAt: '2026-07-14T09:00:00.000Z',
        updatedAt: '2026-07-14T09:02:00.000Z',
      },
    })
    expect(value.operation.status).toBe('cleanup_pending')
    expect(JSON.stringify(value)).not.toMatch(/[A-Za-z]:[\\/]/)
  })
})
