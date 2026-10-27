import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { screen } from 'electron'

const run = promisify(execFile)

/** Physical test input, with the real desktop gaze sampler left intact. */
export async function positionNativeTestCursor(point) {
  if (process.platform !== 'win32') return null
  const physical = screen.dipToScreenPoint(point)
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class TestPointer { [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; } [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p); }'
if(-not [TestPointer]::SetCursorPos(${physical.x},${physical.y})){throw 'Cannot position the native test pointer'}
$p=New-Object TestPointer+Point
if(-not [TestPointer]::GetCursorPos([ref]$p)){throw 'Cannot observe the native test pointer'}
@{x=$p.X;y=$p.Y} | ConvertTo-Json -Compress`
  const result = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000 })
  const observed = JSON.parse(result.stdout.trim())
  if (observed.x !== physical.x || observed.y !== physical.y) throw new Error('Native test pointer did not reach its requested position')
  return { requestedDip: point, physical, observed }
}
