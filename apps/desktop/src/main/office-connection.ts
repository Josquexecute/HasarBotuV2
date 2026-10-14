import { readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DesktopConfigError, parseDesktopConfig } from './config.js'

export interface OfficeConnection {
  readonly schemaVersion: 1
  readonly apiOrigin: string
  readonly lanIpv4: string
  readonly lanHostname: string
}

export function parseOfficeConnection(input: unknown): OfficeConnection {
  const fail = (): never => { throw new DesktopConfigError('office-connection', 'expected a valid packaged office connection.') }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail()
  const value = input as Record<string, unknown>
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
  if (bytes.length > 4096) throw new DesktopConfigError('office-connection', 'packaged configuration exceeds its size limit.')
  let input: unknown
  try { input = JSON.parse(bytes.toString('utf8')) } catch { throw new DesktopConfigError('office-connection', 'packaged configuration must contain valid JSON.') }
  return parseOfficeConnection(input)
}

export async function initializeOfficeConnection(script: string): Promise<{ status: string }> {
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', script], {
    windowsHide: true, timeout: 120_000, maxBuffer: 4096,
  })
  const result: unknown = JSON.parse(stdout.trim())
  if (!result || typeof result !== 'object' || !('status' in result) || typeof result.status !== 'string'
    || !['configured', 'remote_required', 'approval_declined', 'existing_dns_conflict'].includes(result.status)) {
    throw new DesktopConfigError('office-connection', 'unexpected connection setup result.')
  }
  return { status: result.status }
}
