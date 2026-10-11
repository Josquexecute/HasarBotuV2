import { afterEach,describe,expect,it,vi } from 'vitest'
import { mkdtemp,mkdir,writeFile,rm,rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createDocumentTracker,hashClosedFile,type TrackingClient } from '../src/document-tracker.js'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root,{ recursive: true,force: true }) })
async function setup() {
  const root = await mkdtemp(join(tmpdir(),'hb-tracking-'));roots.push(root)
  await mkdir(join(root,'case'))
  let time = 0
  const report = vi.fn<TrackingClient['report']>().mockResolvedValue(undefined)
  const client: TrackingClient = { locations: async () => ({ locations: [{ caseId: 'case',storageRootKey: 'root',relativePath: 'case',version: 1 }],nextCursor: null }),report }
  const create = () => createDocumentTracker(client,{ root },{ settleMs: 100,now: () => time })
  return { root,report,client,create,advance: () => { time += 150 } }
}
describe('central document discovery with isolated real files',() => {
  it('reports progress throughout paginated scans and propagates heartbeat failures',async () => {
    const s = await setup()
    const progress = vi.fn(async () => {})
    const locations = vi.fn(async (cursor?: string) => ({ locations: [{ caseId: cursor ?? 'first',storageRootKey: 'root',relativePath: 'case',version: 1 }],nextCursor: cursor ? null : 'second' }))
    const tracker = createDocumentTracker({ ...s.client,locations },{ root: s.root },{ onProgress: progress })
    await tracker.scan()
    expect(locations.mock.calls).toEqual([[undefined],['second']])
    expect(progress).toHaveBeenCalledTimes(2)
    progress.mockRejectedValueOnce(new Error('heartbeat unavailable'))
    await expect(tracker.scan()).rejects.toThrow('heartbeat unavailable')
  })

  it.skipIf(process.platform !== 'win32')('does not read a paused Windows copy even after the stability window',async () => {
    const s = await setup(),path = join(s.root,'case','copy.txt')
    const script = "$s=[IO.File]::Open($env:HB_COPY_TEST,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite); try { $s.WriteByte(65);$s.Flush();[Console]::WriteLine('ready');[Console]::ReadLine()|Out-Null } finally {$s.Dispose()}"
    const writer = spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{ windowsHide: true,env: { ...process.env,HB_COPY_TEST: path },stdio: ['pipe','pipe','pipe'] })
    try {
      await once(writer.stdout,'data')
      expect(await hashClosedFile(path)).toBeUndefined()
      const exit = once(writer,'exit');writer.stdin.write('\n');await exit
      expect(await hashClosedFile(path)).toMatchObject({ size: 1,hash: expect.any(String) })
    } finally { if (writer.exitCode === null) writer.kill() }
  })
  it('ignores temporary files, waits for stability and reports final rename',async () => {
    const s = await setup(), tracker = s.create()
    await writeFile(join(s.root,'case','policy.pdf.part'),'partial')
    await tracker.scan();s.advance();await tracker.scan()
    expect(s.report).not.toHaveBeenCalled()
    await rename(join(s.root,'case','policy.pdf.part'),join(s.root,'case','policy.pdf'))
    await tracker.scan();expect(s.report).not.toHaveBeenCalled()
    s.advance();await tracker.scan()
    expect(s.report).toHaveBeenCalledTimes(1)
    expect(s.report.mock.calls[0]![0].relativePath).toBe('case/policy.pdf')
  })
  it('excludes application tracking records from document notifications and reconciliation',async () => {
    const s = await setup(),tracker = s.create()
    for (const directory of ['_HASARBOTU','_hasarbotu_office']) {
      await mkdir(join(s.root,'case',directory))
      await writeFile(join(s.root,'case',directory,'takip.json'),'internal record')
    }
    await writeFile(join(s.root,'case','_HASARBOTU.pdf'),'real document')
    const reconcile = vi.fn<NonNullable<TrackingClient['reconcile']>>().mockResolvedValue(undefined)
    const client = { ...s.client,locations: async () => ({ locations: [{ caseId: 'case',storageRootKey: 'root',relativePath: 'case',version: 1,scanStartedAt: new Date().toISOString() }],nextCursor: null }),reconcile }
    const withReconciliation = createDocumentTracker(client,{ root: s.root },{ settleMs: 1,now: () => 0 })
    await withReconciliation.scan()
    expect(reconcile.mock.calls[0]?.[0]).toMatchObject({paths:['case/_HASARBOTU.pdf']})
    await tracker.scan();s.advance();await tracker.scan()
    expect(s.report).toHaveBeenCalledTimes(1)
    expect(s.report.mock.calls[0]![0].relativePath).toBe('case/_HASARBOTU.pdf')
  })
  it('restarts settle time for a partial copy; changes become a new observation',async () => {
    const s = await setup(),tracker = s.create(),path = join(s.root,'case','report.txt')
    await writeFile(path,'first');await tracker.scan();s.advance()
    await writeFile(path,'first then second');await tracker.scan()
    expect(s.report).not.toHaveBeenCalled()
    s.advance();await tracker.scan();expect(s.report).toHaveBeenCalledTimes(1)
    await tracker.scan();expect(s.report).toHaveBeenCalledTimes(1)
    await writeFile(path,'third revision with more data');await tracker.scan();s.advance();await tracker.scan()
    expect(s.report).toHaveBeenCalledTimes(2)
    expect(s.report.mock.calls[0]![0].contentHash).not.toBe(s.report.mock.calls[1]![0].contentHash)
  })
  it('retries unacknowledged events and re-discovers files after process restart',async () => {
    const s = await setup(),tracker = s.create()
    await writeFile(join(s.root,'case','a.txt'),'complete file')
    s.report.mockRejectedValueOnce(new Error('API offline'))
    await tracker.scan();s.advance();await tracker.scan();await tracker.scan()
    expect(s.report).toHaveBeenCalledTimes(2)
    const restarted = s.create();await restarted.scan();s.advance();await restarted.scan()
    expect(s.report).toHaveBeenCalledTimes(3)
    expect(s.report.mock.calls[0]![0]).toEqual(s.report.mock.calls[2]![0])
  })
  it('does not notify when the file changes while hashing',async () => {
    const s = await setup(),path = join(s.root,'case','a.txt')
    await writeFile(path,'first')
    let time = 0
    const tracker = createDocumentTracker(s.client,{ root: s.root },{ now: () => time,settleMs: 1,hashFile: async (file) => { const hashed = await hashClosedFile(file);await writeFile(file,'changed during read');return hashed } })
    await tracker.scan();time = 2;await tracker.scan()
    expect(s.report).not.toHaveBeenCalled()
  })
})
