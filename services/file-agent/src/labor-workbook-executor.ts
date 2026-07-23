import type {
  LaborWorkbookApplyJobPayload,
  LaborWorkbookPreviewJobPayload,
  LaborWorkbookResultSummary,
} from '@hasarbotu/contracts'
import {
  laborWorkbookAuditEventRequestSchema,
  laborWorkbookApplyResultSummarySchema,
  laborWorkbookPreviewResultSummarySchema,
} from '@hasarbotu/contracts'
import type { AgentApiClient } from './api-client.js'
import {
  applyLaborWorkbookWrite,
  previewLaborWorkbookWrite,
} from './labor-workbook-writer.js'

export type LaborWorkbookExecutionResult =
  | {
    readonly outcome: 'verified'
    readonly laborWorkbook: LaborWorkbookResultSummary
  }
  | {
    readonly outcome: 'failed'
    readonly errorCode: string
  }

function safeErrorCode(code: string): string {
  return code.toLocaleLowerCase('en-US').slice(0, 64)
}

export async function executeLaborWorkbookPreview(
  rootAbsolute: string,
  payload: LaborWorkbookPreviewJobPayload,
): Promise<LaborWorkbookExecutionResult> {
  const preview = await previewLaborWorkbookWrite({
    rootAbsolute,
    relativeWorkbookPath: payload.relativePath,
    ...(payload.expectedSourceSha256 === null
      ? {}
      : { expectedSha256: payload.expectedSourceSha256 }),
    signature: payload.signature,
    changes: payload.changes,
  })
  if (!preview.ok) {
    return { outcome: 'failed', errorCode: safeErrorCode(preview.code) }
  }
  return {
    outcome: 'verified',
    laborWorkbook: laborWorkbookPreviewResultSummarySchema.parse({
      kind: 'preview',
      operationId: payload.operationId,
      version: preview.version,
      planHash: preview.planHash,
      createdAt: preview.createdAt,
      relativeWorkbookPath: preview.relativeWorkbookPath,
      sourceSha256: preview.sourceSha256,
      sourceSize: preview.sourceSize,
      sourceModifiedIso: preview.sourceModifiedIso,
      targetSheetName: preview.targetSheetName,
      targetWorksheetPart: preview.targetWorksheetPart,
      observations: preview.observations,
      changes: preview.changes,
    }),
  }
}

export async function executeLaborWorkbookApply(
  rootAbsolute: string,
  payload: LaborWorkbookApplyJobPayload,
  agentId: string,
  client: AgentApiClient,
  jobId: string,
): Promise<LaborWorkbookExecutionResult> {
  const result = await applyLaborWorkbookWrite({
    rootAbsolute,
    relativeWorkbookPath: payload.relativePath,
    expectedSha256: payload.expectedSourceSha256,
    signature: payload.signature,
    changes: payload.changes,
    preview: { ok: true, ...payload.preview },
    approval: payload.approval,
    lockMetadata: {
      jobId,
      agentId,
      createdAt: new Date().toISOString(),
    },
    hooks: {
      recordAudit: async (event) => {
        await client.reportLaborWorkbookAudit(
          jobId,
          laborWorkbookAuditEventRequestSchema.parse(event),
        )
      },
    },
  })
  if (!result.ok) {
    return { outcome: 'failed', errorCode: safeErrorCode(result.code) }
  }
  return {
    outcome: 'verified',
    laborWorkbook: laborWorkbookApplyResultSummarySchema.parse({
      kind: 'apply',
      operationId: payload.operationId,
      version: result.version,
      planHash: result.planHash,
      relativeWorkbookPath: result.relativeWorkbookPath,
      targetSheetName: result.targetSheetName,
      cells: result.cells,
      startSha256: result.startSha256,
      resultSha256: result.resultSha256,
      backupFileName: result.backupFileName,
    }),
  }
}
