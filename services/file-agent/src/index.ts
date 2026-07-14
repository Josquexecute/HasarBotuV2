import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAgentApiClient } from './api-client.js'
import { loadAgentConfigFromEnv } from './config.js'
import { runLoop } from './agent.js'

export { loadAgentConfigFromEnv, AgentConfigError, type AgentConfig } from './config.js'
export {
  assertRealPathUnderRoot,
  isUnderRoot,
  PathSafetyError,
  resolveUnderRoot,
} from './path-resolver.js'
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

/**
 * Import edildiğinde döngü BAŞLAMAZ. Yalnız gerçek entrypoint doğrudan
 * çalıştırıldığında (node dist/index.js) yerel config'ten yüklenip başlar.
 */
async function main(): Promise<void> {
  const config = loadAgentConfigFromEnv()
  const client = createAgentApiClient({ baseUrl: config.apiBaseUrl, agentId: config.agentId, secret: config.agentSecret })
  await runLoop(client, config, {
    onCycleError: (code) => console.error(`File Agent cycle failed: ${code}`),
  })
}

const entryScript = process.argv[1]
if (entryScript !== undefined && resolve(entryScript) === fileURLToPath(import.meta.url)) {
  void main()
}
