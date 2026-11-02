import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseOfficeConnection } from '../apps/desktop/dist/main/office-connection.js'
if (!process.env.RUNNER_TEMP || !process.env.GITHUB_ENV) throw new Error('GitHub runner configuration is missing.')
const configuration = parseOfficeConnection({ schemaVersion: 2,
  apiOrigin: process.env.HASARBOTU_OFFICE_API_ORIGIN, lanHostname: process.env.HASARBOTU_OFFICE_LAN_HOSTNAME,
  httpsPort: Number(process.env.HASARBOTU_OFFICE_HTTPS_PORT || 8443), discoveryPort: Number(process.env.HASARBOTU_OFFICE_DISCOVERY_PORT || 43110),
  caCertificate: process.env.HASARBOTU_OFFICE_CA_CERTIFICATE,
  ...(process.env.HASARBOTU_OFFICE_REMOTE_ORIGIN ? { remoteOrigin: process.env.HASARBOTU_OFFICE_REMOTE_ORIGIN } : {}) })
const path = join(process.env.RUNNER_TEMP, 'hasarbotu-office-connection.json')
await writeFile(path, JSON.stringify(configuration))
await writeFile(process.env.GITHUB_ENV, 'HASARBOTU_DISTRIBUTION_PROFILE=' + path + '\n', { flag: 'a' })
