import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isTemporaryTrackedFile } from '@hasarbotu/domain'
import { AGENT_ID_HEADER, AGENT_SECRET_HEADER, trackingLocationsSchema, type TrackingFile } from '@hasarbotu/contracts'
import type { AgentConfig } from './config.js'
import { assertRealPathUnderRoot, resolveUnderRoot } from './path-resolver.js'

const execFileAsync = promisify(execFile)
// Windows sharing rules prevent reading a copy whose writer still holds the file open.
const WINDOWS_HASH = `$ErrorActionPreference='Stop'; $s=$null; $h=$null; try { $s=[IO.File]::Open($env:HB_TRACKED_FILE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); $h=[Security.Cryptography.SHA256]::Create(); $bytes=$h.ComputeHash($s); @{hash=([BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant());size=$s.Length}|ConvertTo-Json -Compress } catch [IO.IOException] { exit 3 } finally { if($h){$h.Dispose()}; if($s){$s.Dispose()} }`

export async function hashClosedFile(path: string): Promise<{ hash: string; size: number } | undefined> {
  if (process.platform === 'win32') {
    try {
      const result = await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(WINDOWS_HASH,'utf16le').toString('base64')],{
        windowsHide: true,env: { ...process.env,HB_TRACKED_FILE: path },timeout: 120_000,maxBuffer: 4096,
      })
      const parsed = JSON.parse(result.stdout.replace(/^\uFEFF/,'')) as { hash: string;size: number }
      if (!/^[a-f0-9]{64}$/.test(parsed.hash) || !Number.isSafeInteger(parsed.size)) throw new Error('Invalid file hash response')
      return parsed
    } catch (error) {
      if ((error as { code?: number }).code === 3) return undefined
      throw new Error('File could not be verified',{ cause: error })
    }
  }
  const handle = await open(path,'r')
  try {
    const hash = createHash('sha256')
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk)
    return { hash: hash.digest('hex'),size: (await handle.stat()).size }
  } finally { await handle.close() }
}

type Location = { caseId: string;storageRootKey: string;relativePath: string;version: number;scanStartedAt?: string }
interface Candidate { fingerprint: string; stableSince: number; acknowledgedAt: number | null }
export interface TrackingClient {
  locations(cursor?: string): Promise<{ locations: Location[];nextCursor: string | null }>
  report(input: TrackingFile): Promise<void>
  reconcile?(input: { caseId: string;locationVersion: number;scanStartedAt: string;paths: string[] }): Promise<void>
}
export function createTrackingClient(config: AgentConfig): TrackingClient {
  const headers = { [AGENT_ID_HEADER]: config.agentId,[AGENT_SECRET_HEADER]: config.agentSecret,'content-type': 'application/json' }
  return {
    async reconcile(input) {
      const result = await fetch(`${config.apiBaseUrl}/api/v1/tracking/agent/reconcile`,{ method: 'POST',headers,body: JSON.stringify(input),signal: AbortSignal.timeout(20_000) })
      if (!result.ok) throw new Error('Tracking reconciliation not acknowledged')
    },
    async locations(cursor) {
      const result = await fetch(`${config.apiBaseUrl}/api/v1/tracking/agent/locations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,{ headers,signal: AbortSignal.timeout(20_000) })
      if (!result.ok) throw new Error('Tracking locations unavailable')
      return trackingLocationsSchema.parse(await result.json())
    },
    async report(input) {
      const result = await fetch(`${config.apiBaseUrl}/api/v1/tracking/agent/observations`,{ method: 'POST',headers,body: JSON.stringify(input),signal: AbortSignal.timeout(20_000) })
      if (!result.ok) throw new Error('Tracking observation not acknowledged')
    },
  }
}

export function createDocumentTracker(client: TrackingClient, roots: Readonly<Record<string,string>>, options: { settleMs?: number;now?: () => number;hashFile?: typeof hashClosedFile;onError?: (code: string) => void } = {}) {
  const candidates = new Map<string,Candidate>()
  const now = options.now ?? Date.now
  const settleMs = options.settleMs ?? 30_000
  const hashFile = options.hashFile ?? hashClosedFile
  async function scanLocation(location: Location, seen: Set<string>, signal?: AbortSignal) {
    const paths: string[] = []
    let complete = true
    const root = roots[location.storageRootKey]
    if (!root) { options.onError?.('tracking_root_unmapped'); return }
    const directory = resolveUnderRoot(root,location.relativePath)
    await assertRealPathUnderRoot(root,directory)
    async function walk(path: string,relative: string): Promise<void> {
      if (signal?.aborted) return
      const stat = await lstat(path)
      if (stat.isSymbolicLink()) return
      if (stat.isDirectory()) {
        for (const entry of await readdir(path,{ withFileTypes: true })) {
          if (isTemporaryTrackedFile(entry.name) || entry.isSymbolicLink()) continue
          try { await walk(join(path,entry.name),`${relative}/${entry.name}`) }
          catch { complete = false;options.onError?.('tracking_file_unavailable') }
        }
        return
      }
      if (!stat.isFile() || stat.size === 0) return
      paths.push(relative)
      await assertRealPathUnderRoot(root,path)
      const key = `${location.caseId}:${location.version}:${relative}`
      seen.add(key)
      const fingerprint = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
      let candidate = candidates.get(key)
      if (!candidate || candidate.fingerprint !== fingerprint) {
        candidate = { fingerprint,stableSince: now(),acknowledgedAt: null }
        candidates.set(key,candidate)
        return
      }
      if (now()-candidate.stableSince < settleMs || (candidate.acknowledgedAt !== null && now()-candidate.acknowledgedAt < 3_600_000)) return
      const hashed = await hashFile(path)
      if (!hashed) return
      const after = await lstat(path)
      if (after.isSymbolicLink() || `${after.size}:${after.mtimeMs}:${after.ctimeMs}` !== fingerprint || hashed.size !== stat.size) {
        candidates.delete(key)
        return
      }
      await assertRealPathUnderRoot(root,path)
      await client.report({ caseId: location.caseId,storageRootKey: location.storageRootKey,locationVersion: location.version,relativePath: relative,contentHash: hashed.hash,byteSize: hashed.size })
      candidate.acknowledgedAt = now()
    }
    await walk(directory,location.relativePath)
    if (complete && !signal?.aborted && location.scanStartedAt) await client.reconcile?.({ caseId: location.caseId,locationVersion: location.version,scanStartedAt: location.scanStartedAt,paths })
  }
  return {
    async scan(signal?: AbortSignal) {
      const seen = new Set<string>()
      let cursor: string | undefined
      do {
        if (signal?.aborted) return
        const page = await client.locations(cursor)
        for (const location of page.locations) {
          try { await scanLocation(location,seen,signal) }
          catch { options.onError?.('tracking_location_unavailable') }
        }
        if (page.nextCursor === cursor) throw new Error('Tracking cursor did not advance')
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      for (const key of candidates.keys()) if (!seen.has(key)) candidates.delete(key)
    },
  }
}

export function startDocumentTracker(config: AgentConfig, signal?: AbortSignal, onError?: (code: string) => void) {
  let healthy = true
  const tracker = createDocumentTracker(createTrackingClient(config),config.roots,{ onError: (code) => { healthy = false;onError?.(code) } })
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let running: Promise<void> = Promise.resolve()
  async function reportHealth(ok: boolean, phase: 'scanning' | 'complete' = 'complete') {
    const response = await fetch(`${config.apiBaseUrl}/api/v1/tracking/agent/health`,{ method: 'POST',headers: { [AGENT_ID_HEADER]: config.agentId,[AGENT_SECRET_HEADER]: config.agentSecret,'content-type': 'application/json' },body: JSON.stringify({ ok,phase }),signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new Error('Tracking health was not acknowledged')
  }
  const cycle = () => {
    healthy = true
    // Register the review gate before the first scan; physical verification cannot bypass it.
    running = reportHealth(false,'scanning').then(() => tracker.scan(signal)).then(async () => {
      if (signal?.aborted) return
      await reportHealth(healthy)
    }).catch(() => onError?.('tracking_api_unavailable')).finally(() => {
      if (!stopped && !signal?.aborted) timer = setTimeout(cycle,15_000)
    })
  }
  cycle()
  return async () => { stopped = true; if (timer) clearTimeout(timer); await running }
}
