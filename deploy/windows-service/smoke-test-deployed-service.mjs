import { pathToFileURL } from 'node:url'
import path from 'node:path'

// D9 B7 fix (HB-2026-144): proves a self-contained deploy artifact
// (produced by `deploy-service-artifacts.ps1 -DependencyClosureManifestPath
// ...`) can actually be module-resolved and its native addons loaded
// WITHOUT any access to the monorepo root, its hoisted root `node_modules`,
// or a `NODE_PATH` override -- exactly the runtime condition a real
// deployed Windows service is in.
//
// Import (not `require`/execute-as-entry) is deliberate: both
// `services/api/src/index.ts` and `services/file-agent/src/index.ts`
// guard their real startup side effects (`startServer()` / `main()`)
// behind `process.argv[1] === fileURLToPath(import.meta.url)`. Since this
// wrapper's own path is argv[1], not the target's `dist/index.js`, that
// guard evaluates false and the service is never actually started/bound
// -- only its full module graph (which transitively pulls in every
// runtime dependency, including native addons like argon2/@napi-rs/canvas
// for API and tesseract.js/@napi-rs/canvas for File Agent) is loaded.
//
// Exit 0 + `"status":"ok"` means: every `import`/`require` in the deployed
// module graph resolved and every native `.node` binary loaded, using
// ONLY the deployed `-TargetDir`'s own `node_modules`.

async function main() {
  const targetDir = process.argv[2]
  if (typeof targetDir !== 'string' || targetDir.length === 0) {
    console.log(JSON.stringify({ status: 'error', errorCode: 'TARGET_DIR_REQUIRED' }))
    process.exitCode = 2
    return
  }
  const entryPath = path.join(targetDir, 'dist', 'index.js')
  const entryUrl = pathToFileURL(entryPath).href
  const startedAtMs = Date.now()
  try {
    const loadedModule = await import(entryUrl)
    console.log(JSON.stringify({
      status: 'ok',
      targetDir,
      entryPath,
      exportCount: Object.keys(loadedModule).length,
      durationMs: Date.now() - startedAtMs,
      nodePathSet: typeof process.env.NODE_PATH === 'string' && process.env.NODE_PATH.length > 0,
      cwd: process.cwd(),
    }))
  } catch (error) {
    console.log(JSON.stringify({
      status: 'error',
      targetDir,
      entryPath,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCode: error instanceof Error && 'code' in error ? String(error.code) : null,
    }))
    process.exitCode = 1
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) await main()
