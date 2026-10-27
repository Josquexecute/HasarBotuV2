import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

// Deny writers while hashing, but allow workspace renames during concurrent tracking scans.
const WORKER = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); while(($line=[Console]::In.ReadLine()) -ne $null) { $request=ConvertFrom-Json -InputObject $line; $s=$null; $h=$null; try { $s=[IO.File]::Open($request.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::Read -bor [IO.FileShare]::Delete)); $h=[Security.Cryptography.SHA256]::Create(); $bytes=$h.ComputeHash($s); $result=@{id=$request.id;hash=([BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant());size=$s.Length} } catch [IO.IOException] { $result=@{id=$request.id;busy=$true} } catch { $result=@{id=$request.id;failed=$true} } finally { if($h){$h.Dispose()}; if($s){$s.Dispose()} }; [Console]::Out.WriteLine(($result|ConvertTo-Json -Compress)) }`

type Hash = { hash: string; size: number }
interface Pending {
  resolve: (result: Hash | undefined) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function createWindowsFileHasher() {
  let worker: ChildProcessWithoutNullStreams | undefined
  let closed = false
  let nextId = 0
  const pending = new Map<number, Pending>()

  function fail(child: ChildProcessWithoutNullStreams) {
    if (worker !== child) return
    worker = undefined
    child.kill()
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('Windows file hash worker failed'))
    }
    pending.clear()
  }

  function start() {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WORKER, 'utf16le').toString('base64')], { windowsHide: true })
    worker = child
    child.on('error', () => fail(child))
    child.on('exit', () => fail(child))
    child.stdin.on('error', () => fail(child))
    child.stderr.on('data', () => fail(child))
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      if (worker !== child) return
      try {
        const result = JSON.parse(line.replace(/^\uFEFF/, '')) as { id: number; hash?: string; size?: number; busy?: boolean; failed?: boolean }
        const request = pending.get(result.id)
        if (!request) throw new Error('Unexpected hash response')
        if (result.busy !== true && result.failed !== true && (!/^[a-f0-9]{64}$/.test(result.hash ?? '') || !Number.isSafeInteger(result.size) || result.size! < 0)) {
          throw new Error('Invalid hash response')
        }
        clearTimeout(request.timer)
        pending.delete(result.id)
        if (result.failed) request.reject(new Error('File could not be verified'))
        else request.resolve(result.busy ? undefined : { hash: result.hash!, size: result.size! })
      } catch { fail(child) }
    })
    child.on('exit', () => lines.close())
    return child
  }

  return {
    async hashFile(path: string): Promise<Hash | undefined> {
      if (closed) throw new Error('Windows file hash worker is closed')
      const child = worker ?? start()
      const id = ++nextId
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(child), 120_000)
        pending.set(id, { resolve, reject, timer })
        child.stdin.write(`${JSON.stringify({ id, path })}\n`, (error) => { if (error) fail(child) })
      })
    },
    async close(): Promise<void> {
      closed = true
      const child = worker
      if (!child) return
      const exit = new Promise<void>((resolve) => child.once('exit', () => resolve()))
      if (pending.size) fail(child)
      else child.stdin.end()
      await exit
    },
  }
}
