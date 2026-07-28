import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAgentApiClient } from './api-client.js'
import { loadAgentConfigFromEnv } from './config.js'
import { runLoop } from './agent.js'

export { loadAgentConfigFromEnv, AgentConfigError, type AgentConfig } from './config.js'
export {
  assertRealPathUnderRoot,
  DEFAULT_MAX_ABSOLUTE_PATH_LENGTH,
  isUnderRoot,
  PathSafetyError,
  resolveUnderRoot,
} from './path-resolver.js'
export {
  nodeRootHealthFileSystem,
  probeRootHealth,
  ROOT_HEALTH_PROBE_FILENAME,
  STORAGE_UNAVAILABLE_ERROR_CODE,
  type RootHealthCode,
  type RootHealthFileSystem,
  type RootHealthOptions,
  type RootHealthResult,
  type RootHealthStats,
} from './root-health.js'
export { streamSha256, verifyTarget, type VerifyResult } from './verifier.js'
export { AgentApiError, createAgentApiClient, type AgentApiClient, type AgentApiClientOptions } from './api-client.js'
export { runLoop, runOnce, type RunOnceResult } from './agent.js'
export {
  provisionCaseWorkspace,
  type WorkspaceProvisionHooks,
  type WorkspaceProvisionResult,
} from './workspace-provisioner.js'
export {
  buildWorkspaceManifest,
  executeFileOperation,
  nodeFileSystemAdapter,
  type FileOperationExecutionResult,
  type FileSystemAdapter,
  type WorkspaceManifest,
  type WorkspaceManifestEntry,
} from './file-operation-executor.js'
export { extractPdfText, type PdfTextExtractionResult, type PdfTextExtractorHooks } from './pdf-text-extractor.js'
export { extractPolicyOcr, type PolicyOcrExtractionResult, type PolicyOcrExtractorHooks } from './policy-ocr-extractor.js'
export {
  OOXML_READONLY_EXTRACTOR_VERSION,
  OoxmlExtractorError,
  assertWorkbookHashUnchanged,
  assertWorkbookSha256,
  extractOoxmlWorkbook,
  getOoxmlCell,
  getOoxmlSheet,
  resolveOoxmlRelationshipTarget,
  sha256WorkbookBytes,
  type OoxmlCell,
  type OoxmlDataValidation,
  type OoxmlHiddenColumn,
  type OoxmlWorkbook,
  type OoxmlWorksheet,
} from './ooxml-readonly-extractor.js'
export {
  LABOR_WORKBOOK_AGENT_PREFLIGHT_CODES,
  LABOR_WORKBOOK_AGENT_PREFLIGHT_VERSION,
  preflightLaborWorkbook,
  readZipCentralDirectory,
  type LaborWorkbookAgentPreflightCode,
  type LaborWorkbookAgentPreflightInput,
  type LaborWorkbookAgentPreflightResult,
} from './labor-workbook-preflight.js'
export {
  LABOR_WORKBOOK_ALLOWED_WRITE_COLUMN,
  LABOR_WORKBOOK_WRITE_CODES,
  LABOR_WORKBOOK_WRITE_PLAN_VERSION,
  LABOR_WORKBOOK_WRITE_VERSION,
  applyLaborWorkbookWrite,
  previewLaborWorkbookWrite,
  type LaborWorkbookPreviewChange,
  type LaborWorkbookRequestedChange,
  type LaborWorkbookWriteApplyInput,
  type LaborWorkbookWriteApplyResult,
  type LaborWorkbookWriteApproval,
  type LaborWorkbookWriteAuditEvent,
  type LaborWorkbookWriteCode,
  type LaborWorkbookLockMetadata,
  type LaborWorkbookWritePreviewInput,
  type LaborWorkbookWritePreviewResult,
  type LaborWorkbookWriterHooks,
} from './labor-workbook-writer.js'
export {
  executeLaborWorkbookApply,
  executeLaborWorkbookPreview,
  type LaborWorkbookExecutionResult,
} from './labor-workbook-executor.js'

/**
 * Import edildiğinde döngü BAŞLAMAZ. Yalnız gerçek entrypoint doğrudan
 * çalıştırıldığında (node dist/index.js) yerel config'ten yüklenip başlar.
 */
async function main(): Promise<void> {
  const config = loadAgentConfigFromEnv()
  const client = createAgentApiClient({ baseUrl: config.apiBaseUrl, agentId: config.agentId, secret: config.agentSecret })
  await runLoop(client, config, {
    onCycleError: (code) => console.error(
      code === 'storage_unavailable'
        ? 'File Agent: storage root unreachable, not claiming new jobs (PENDING_STORAGE)'
        : `File Agent cycle failed: ${code}`,
    ),
  })
}

const entryScript = process.argv[1]
if (entryScript !== undefined && resolve(entryScript) === fileURLToPath(import.meta.url)) {
  void main()
}
