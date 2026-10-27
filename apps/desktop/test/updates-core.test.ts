import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadVerifiedInstaller, isNewerVersion, writeUpdateHelper } from '../src/main/updates-core.js'
import type { DesktopRelease } from '@hasarbotu/contracts'

const directories: string[] = []
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }) })
const bytes = Buffer.from('MZsynthetic-installer-fixture')
const release: DesktopRelease = { version: '0.1.8', platform: 'win32', arch: 'x64', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), publishedAt: '2026-10-14T00:00:00Z', notes: 'Synthetic' }
async function directory() { const path = await mkdtemp(join(tmpdir(), 'hb-update-test-')); directories.push(path); return path }
function fetchResponse(body: Uint8Array, status = 200, length = String(body.length)): typeof fetch {
  return async () => new Response(body as BodyInit, { status, headers: { 'content-length': length } })
}
describe('verified desktop update', () => {
  it('compares numeric releases and prevents downgrades and malformed versions', () => {
    expect(isNewerVersion('0.1.10', '0.1.9')).toBe(true)
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true)
    expect(isNewerVersion('0.1.8', '0.1.8')).toBe(false)
    expect(isNewerVersion('0.1.7', '0.1.8')).toBe(false)
    expect(() => isNewerVersion('1.0.0-beta', '1.0.0')).toThrow()
  })
  it('downloads actual streamed bytes and publishes only after hash verification', async () => {
    const path = await directory(), progress: number[] = [], requests: string[] = []
    const result = await downloadVerifiedInstaller({ release, origin: 'http://127.0.0.1:1234', directory: path,
      fetch: async (url, init) => { requests.push(String(url)); expect(init?.redirect).toBe('error'); expect(init?.credentials).toBe('include'); return fetchResponse(bytes)(url, init) }, progress: value => progress.push(value) })
    expect(await readFile(result)).toEqual(bytes)
    expect(await readdir(path)).toEqual([release.sha256 + '.exe'])
    expect(progress.at(-1)).toBe(bytes.length)
    expect(requests).toEqual(['http://127.0.0.1:1234/api/v1/desktop-updates/artifacts/' + release.sha256])
  })
  it.each(['hash', 'short', 'oversize', 'header', 'signature', 'auth'] as const)('rejects %s failures and leaves no executable or partial file', async kind => {
    const path = await directory()
    const altered = Buffer.from(bytes)
    altered[2] = 0
    const body = kind === 'hash' ? altered : kind === 'short' ? bytes.subarray(0, 3) : kind === 'oversize' ? Buffer.concat([bytes, bytes]) : kind === 'signature' ? Buffer.from('XXsynthetic-installer-fixture') : bytes
    const metadata = kind === 'signature' ? { ...release, sha256: createHash('sha256').update(body).digest('hex') } : release
    await expect(downloadVerifiedInstaller({ release: metadata, origin: 'http://127.0.0.1:1234', directory: path,
      fetch: fetchResponse(body, kind === 'auth' ? 401 : 200, kind === 'header' ? '12345' : String(release.size)), progress: () => {} })).rejects.toThrow()
    expect(await readdir(path)).toEqual([])
  })
  it.each(['auth', 'header'] as const)('cancels the response stream when %s rejects a download before reading', async kind => {
    const path = await directory()
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes) },
      cancel() { cancelled = true },
    })
    await expect(downloadVerifiedInstaller({ release, origin: 'http://127.0.0.1:1234', directory: path,
      fetch: async () => new Response(body, { status: kind === 'auth' ? 401 : 200, headers: { 'content-length': '1' } }),
      progress: () => {},
    })).rejects.toThrow()
    expect(cancelled).toBe(true)
    expect(body.locked).toBe(false)
    expect(await readdir(path)).toEqual([])
  })
  it('produces a shutdown/install/restart helper with literal paths and exit-code gating', async () => {
    const path = await directory()
    const helper = await writeUpdateHelper({ directory: path, installer: "C:\\Users\\O'Neil\\setup.exe", executable: 'C:\\Program Files\\HasarBotu\\HasarBotu.exe', installDirectory: 'C:\\Program Files\\HasarBotu', pid: 1234, taskName: 'HasarBotu-Update-fixture', apiOrigin: 'https://api.example.test', userDataPath: "C:\\Users\\O'Neil\\Profile" })
    const script = await readFile(helper, 'utf8')
    expect(script.charCodeAt(0)).toBe(0xfeff)
    expect(script).toContain('Wait-Process -Id 1234 -Timeout 60')
    expect(script).toContain("'C:\\Users\\O''Neil\\setup.exe'")
    expect(script).toContain('@("/S", ("/D=" + $installTarget))')
    expect(script.indexOf('if ($result.ExitCode -ne 0)')).toBeLessThan(script.indexOf('$desktopShell.ShellExecute('))
    expect(script).toContain("'https://api.example.test'")
    expect(script).toContain('$result.WaitForExit()')
    expect(script).not.toContain('-Wait -PassThru')
    expect(script).toContain('New-Object -ComObject Shell.Application')
    expect(script).toContain('Unregister-ScheduledTask')
    expect(script).toContain('$completion.taskCleanupError = $_.Exception.Message')
    expect(script.indexOf('Unregister-ScheduledTask')).toBeLessThan(script.indexOf('$completion.finishedAt'))
  })
})
