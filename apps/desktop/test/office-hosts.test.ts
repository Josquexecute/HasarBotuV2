import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe.skipIf(process.platform !== 'win32')('Windows office DNS configuration', () => {
  it('preserves unrelated hosts bytes, handles relocation and rejects conflicting records', () => {
    const script = fileURLToPath(new URL('./harness/office-hosts.test.ps1', import.meta.url))
    const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, encoding: 'utf8' })
    expect(JSON.parse(result.trim())).toEqual({ status: 'PASS', systemHostsModified: false, checks: 11 })
  })
})
