import { createRequire } from 'node:module'

/**
 * Paket kimligi: health yaniti `service` sabitini ve `version` icin gercek
 * package.json surumunu tasir. `createRequire`, hem `src` (tsx dev) hem `dist`
 * (build) yerlesiminde ayni goreli derinlikte calisir.
 */
const packageJson = createRequire(import.meta.url)('../package.json') as {
  readonly name: string
  readonly version: string
}

export const API_SERVICE_NAME = 'hasarbotu-api'
export const API_VERSION: string = packageJson.version
