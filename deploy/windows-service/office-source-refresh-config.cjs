const fs = require('node:fs')
const path = require('node:path')

function reject(code) { throw Object.assign(new Error(code), { safeCode: code }) }

function loadSourceRefreshConfig(directory, env = process.env) {
  const config = JSON.parse(fs.readFileSync(path.join(directory, 'configuration.json'), 'utf8').replace(/^\uFEFF/, ''))
  if (!config || typeof config !== 'object' || Array.isArray(config)) reject('SOURCE_REFRESH_CONFIGURATION_INVALID')
  if (typeof config.expectedComputerName !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(config.expectedComputerName)
    || config.expectedComputerName.toUpperCase() !== env.COMPUTERNAME?.toUpperCase()) reject('SOURCE_REFRESH_TARGET_MISMATCH')
  for (const key of ['runtimeRoot', 'sourceRoot']) {
    if (typeof config[key] !== 'string' || !path.win32.isAbsolute(config[key]) || /["\x00-\x1f]/.test(config[key])) reject('SOURCE_REFRESH_PATH_CONFIGURATION_INVALID')
  }
  if (typeof config.organizationId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(config.organizationId)) reject('SOURCE_REFRESH_ORGANIZATION_REQUIRED')
  if (typeof config.databaseName !== 'string' || !/^[a-z0-9_]+$/i.test(config.databaseName)) reject('SOURCE_REFRESH_DATABASE_REQUIRED')
  if (config.statusFile !== undefined && (typeof config.statusFile !== 'string' || !path.win32.isAbsolute(config.statusFile))) reject('SOURCE_REFRESH_STATUS_PATH_INVALID')
  return config
}

module.exports = { loadSourceRefreshConfig }
