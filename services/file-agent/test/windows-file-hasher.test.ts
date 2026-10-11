import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWindowsFileHasher } from '../src/windows-file-hasher.js'

describe.skipIf(process.platform !== 'win32')('persistent Windows file hashing', () => {
  it('hashes consecutive and concurrent Unicode paths, releases handles and closes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hb-hash-'))
    const hasher = createWindowsFileHasher()
    try {
      const paths = [join(root, "İstanbul evrakı '1'.txt"), join(root, 'ikinci.txt')]
      const contents = ['Türkçe veri', 'second file']
      await Promise.all(paths.map((path, i) => writeFile(path, contents[i]!)))
      const expected = contents.map((content) => ({ hash: createHash('sha256').update(content).digest('hex'), size: Buffer.byteLength(content) }))
      expect(await Promise.all(paths.map(hasher.hashFile))).toEqual(expected)
      expect(await hasher.hashFile(paths[0]!)).toEqual(expected[0])
      await writeFile(paths[0]!, 'updated')
      expect(await hasher.hashFile(paths[0]!)).toEqual({ hash: createHash('sha256').update('updated').digest('hex'), size: 7 })
      await hasher.close()
      await expect(hasher.hashFile(paths[0]!)).rejects.toThrow('closed')
      await hasher.close()
    } finally { await hasher.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('blocks an open writer and handles the next request without restarting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hb-hash-writer-'))
    const path = join(root, 'copy.txt')
    const hasher = createWindowsFileHasher()
    const script = "$s=[IO.File]::Open($env:HB_COPY_TEST,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite); try { $s.WriteByte(65);$s.Flush();[Console]::WriteLine('ready');[Console]::ReadLine()|Out-Null } finally {$s.Dispose()}"
    const writer = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, HB_COPY_TEST: path } })
    try {
      await once(writer.stdout, 'data')
      expect(await hasher.hashFile(path)).toBeUndefined()
      const exit = once(writer, 'exit')
      writer.stdin.write('\n')
      await exit
      expect(await hasher.hashFile(path)).toEqual({ hash: createHash('sha256').update('A').digest('hex'), size: 1 })
      expect(await hasher.hashFile(join(root, 'missing.txt'))).toBeUndefined()
      expect(await hasher.hashFile(path)).toMatchObject({ size: 1 })
    } finally {
      if (writer.exitCode === null) {
        const exit = once(writer, 'exit')
        writer.kill()
        await exit
      }
      await hasher.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
