import { readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { X509Certificate } from 'node:crypto'
import { DesktopConfigError, parseDesktopConfig } from './config.js'

export interface OfficeConnection {
  readonly schemaVersion: 1 | 2
  readonly apiOrigin: string
  readonly lanIpv4?: string
  readonly lanHostname: string
  readonly httpsPort?: number
  readonly discoveryPort?: number
  readonly caCertificate?: string
  readonly remoteOrigin?: string
}

export function parseOfficeConnection(input: unknown): OfficeConnection {
  const fail = (): never => { throw new DesktopConfigError('office-connection', 'expected a valid packaged office connection.') }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail()
  const value = input as Record<string, unknown>
  if (value.schemaVersion === 2) {
    const allowed = ['schemaVersion', 'apiOrigin', 'lanHostname', 'httpsPort', 'discoveryPort', 'caCertificate', 'remoteOrigin']
    if (Object.keys(value).some(key => !allowed.includes(key)) || typeof value.apiOrigin !== 'string'
      || typeof value.lanHostname !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(value.lanHostname)
      || typeof value.caCertificate !== 'string' || value.caCertificate.length > 8192
      || ![value.httpsPort, value.discoveryPort].every(port => typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535)) return fail()
    const apiOrigin = parseDesktopConfig({}, { assetRoot: '.', apiOrigin: value.apiOrigin }).apiOrigin
    const url = new URL(apiOrigin)
    if (url.protocol !== 'https:' || url.port || !/^[a-z0-9.-]+$/i.test(url.hostname) || /^\d+[.\d]*$/.test(url.hostname)) return fail()
    if (!/^(?:-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----\s*)+$/.test(value.caCertificate)) return fail()
    try { if (!new X509Certificate(value.caCertificate).ca) return fail() } catch { return fail() }
    if (value.remoteOrigin !== undefined && typeof value.remoteOrigin !== 'string') return fail()
    const remoteOrigin = value.remoteOrigin === undefined ? undefined : parseDesktopConfig({}, { assetRoot: '.', apiOrigin: value.remoteOrigin as string }).apiOrigin
    if (remoteOrigin && (new URL(remoteOrigin).protocol !== 'https:' || /^\d+[.\d]*$/.test(new URL(remoteOrigin).hostname) || !/^[a-z0-9.-]+$/i.test(new URL(remoteOrigin).hostname))) return fail()
    return { schemaVersion: 2, apiOrigin, lanHostname: value.lanHostname, httpsPort: value.httpsPort as number,
      discoveryPort: value.discoveryPort as number, caCertificate: value.caCertificate, ...(remoteOrigin ? { remoteOrigin } : {}) }
  }
  if (Object.keys(value).sort().join(',') !== 'apiOrigin,lanHostname,lanIpv4,schemaVersion' || value.schemaVersion !== 1
    || typeof value.apiOrigin !== 'string' || typeof value.lanIpv4 !== 'string' || typeof value.lanHostname !== 'string') return fail()
  const apiOrigin = parseDesktopConfig({}, { assetRoot: '.', apiOrigin: value.apiOrigin }).apiOrigin
  const url = new URL(apiOrigin)
  if (url.protocol !== 'https:' || url.port || !/^[a-z0-9.-]+$/i.test(url.hostname)) return fail()
  const octets = value.lanIpv4.split('.').map(Number)
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value.lanIpv4) || octets.some(n => n > 255) || octets.join('.') !== value.lanIpv4
    || !(octets[0] === 10 || octets[0] === 192 && octets[1] === 168 || octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
    || !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(value.lanHostname)) return fail()
  return { schemaVersion: 1, apiOrigin, lanIpv4: value.lanIpv4, lanHostname: value.lanHostname }
}

export function readOfficeConnection(file: string): OfficeConnection {
  const bytes = readFileSync(file)
  if (bytes.length > 16384) throw new DesktopConfigError('office-connection', 'packaged configuration exceeds its size limit.')
  let input: unknown
  try { input = JSON.parse(bytes.toString('utf8')) } catch { throw new DesktopConfigError('office-connection', 'packaged configuration must contain valid JSON.') }
  return parseOfficeConnection(input)
}

export class OfficeConnectionSetupError extends Error {
  constructor(readonly reason: 'timeout' | 'failed', cause?: unknown) {
    super(`Office connection setup ${reason}`, { cause })
    this.name = 'OfficeConnectionSetupError'
  }
}

export async function initializeOfficeConnection(script: string, timeoutMs = 120_000): Promise<{ status: string }> {
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true, timeout: timeoutMs, maxBuffer: 4096,
    })
    const result: unknown = JSON.parse(stdout.trim())
    if (!result || typeof result !== 'object' || !('status' in result) || typeof result.status !== 'string'
      || !['configured', 'remote_required', 'approval_declined', 'existing_dns_conflict'].includes(result.status)) {
      throw new OfficeConnectionSetupError('failed')
    }
    return { status: result.status }
  } catch (error) {
    if (error instanceof OfficeConnectionSetupError) throw error
    const failure = error as { killed?: boolean; code?: string }
    throw new OfficeConnectionSetupError(failure.killed || failure.code === 'ETIMEDOUT' ? 'timeout' : 'failed', error)
  }
}
