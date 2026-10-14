import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseOfficeConnection } from '../apps/desktop/dist/main/office-connection.js'
if (!process.env.RUNNER_TEMP || !process.env.GITHUB_ENV) throw new Error('GitHub runner configuration is missing.')
const configuration = parseOfficeConnection({ schemaVersion: 1,
  apiOrigin: process.env.HASARBOTU_OFFICE_API_ORIGIN, lanIpv4: process.env.HASARBOTU_OFFICE_LAN_IPV4,
  lanHostname: process.env.HASARBOTU_OFFICE_LAN_HOSTNAME })
const path = join(process.env.RUNNER_TEMP, 'hasarbotu-office-connection.json')
await writeFile(path, JSON.stringify(configuration))
await writeFile(process.env.GITHUB_ENV, 'HASARBOTU_DISTRIBUTION_PROFILE=' + path + '\n', { flag: 'a' })
