import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseOfficeConnection } from '../apps/desktop/dist/main/office-connection.js'

const profile = process.env.HASARBOTU_DISTRIBUTION_PROFILE
if (!profile || !path.isAbsolute(profile)) throw new Error('HASARBOTU_DISTRIBUTION_PROFILE must identify the private office distribution configuration.')
const source = fs.readFileSync(profile)
if (source.length > 4096) throw new Error('Distribution profile exceeds size limit.')
const configuration = parseOfficeConnection(JSON.parse(source.toString('utf8')))
const directory = fileURLToPath(new URL('../apps/desktop/build-resources/', import.meta.url))
fs.mkdirSync(directory, { recursive: true })
fs.writeFileSync(path.join(directory, 'office-connection.json'), JSON.stringify(configuration, null, 2))
console.log('Validated office connection included in Windows distribution.')
