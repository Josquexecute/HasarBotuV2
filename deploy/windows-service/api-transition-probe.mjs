import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

// Import and config validation only. Never startServer(), listen(), OAuth login,
// mail workers or a background scheduler against the production database.
let stage = 'candidate_import'
const safeCodes = new Set(['28P01','28000','3D000','42501','ECONNREFUSED','ENOTFOUND','ETIMEDOUT',
  'CANDIDATE_HEALTH_FAILED','CANDIDATE_GOOGLE_STATUS_FAILED'])
try {
  const root = resolve(process.argv[2])
  const { parseConfig, buildApp } = await import(pathToFileURL(join(root,'dist/index.js')).href)
  stage = 'candidate_configuration'
  const config = parseConfig(process.env)
  stage = 'candidate_database'
  const { Pool } = createRequire(join(root,'package.json'))('pg')
  const pool = new Pool({ connectionString:config.databaseUrl, max:1, connectionTimeoutMillis:5000, statement_timeout:10000, options:'-c default_transaction_read_only=on' })
  const app = buildApp({ loggerEnabled:false, auth:{ pool, cookieSecure:config.cookieSecure },
    healthDependencyCheck:async () => (await pool.query('SELECT 1')).rowCount === 1,
    ...(config.google ? { google:config.google } : {}), trustLoopbackProxy:config.trustLoopbackProxy })
  try {
    stage = 'candidate_health'
    const health = await app.inject({ method:'GET', url:'/health' })
    if (health.statusCode !== 200 || health.json().status !== 'ok') throw Error('CANDIDATE_HEALTH_FAILED')
    stage = 'candidate_google_status'
    const google = await app.inject({ method:'GET', url:'/api/v1/google/status' })
    if (google.statusCode !== 200 || !google.json().enabled) throw Error('CANDIDATE_GOOGLE_STATUS_FAILED')
    console.log(JSON.stringify({ status:'PASS', moduleImport:true, configurationValid:true, webOAuthConfigured:true, desktopOAuthConfigured:google.json().desktopEnabled, proxyAwareRateLimit:google.json().proxyAwareRateLimit, readOnlyDatabaseHealth:'PASS', interactiveGoogleAndGmail:'PENDING' }))
  } finally { await app.close(); await pool.end() }
} catch (error) {
  const fallback = stage === 'candidate_import' ? 'CANDIDATE_IMPORT_FAILED' : stage === 'candidate_configuration' ? 'CANDIDATE_CONFIGURATION_INVALID' : 'CANDIDATE_PROBE_OPERATION_FAILED'
  const code = safeCodes.has(error?.code) ? error.code : safeCodes.has(error?.message) ? error.message : fallback
  console.log(JSON.stringify({ status:'FAIL', stage, code }))
  process.exitCode = 1
}
