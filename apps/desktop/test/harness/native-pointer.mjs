import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { screen } from 'electron'

const run = promisify(execFile)

/** Physical test input, with the real desktop gaze sampler left intact. */
export async function positionNativeTestCursor(point) {
  if (process.platform !== 'win32') return null
  const physical = screen.dipToScreenPoint(point)
  // Capture the result in the same native call sequence. PowerShell object
  // creation between Set/Get lets unrelated desktop input overwrite the sample.
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class TestPointer { [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; } [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; } [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p); [DllImport("user32.dll")] public static extern bool GetClipCursor(out Rect r); public static Point Position(int x,int y) { if(!SetCursorPos(x,y)) throw new InvalidOperationException("Cannot position the native test pointer"); Point p; if(!GetCursorPos(out p)) throw new InvalidOperationException("Cannot observe the native test pointer"); return p; } }'
$p=[TestPointer]::Position(${physical.x},${physical.y})
$clip=New-Object TestPointer+Rect
if(-not [TestPointer]::GetClipCursor([ref]$clip)){throw 'Cannot observe native pointer clipping'}
@{x=$p.X;y=$p.Y;clip=$clip} | ConvertTo-Json -Compress`
  const result = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000 })
  const observed = JSON.parse(result.stdout.trim())
  if (observed.x !== physical.x || observed.y !== physical.y) throw new Error(`Native test pointer did not reach its requested position: ${JSON.stringify({ requestedDip: point, physical, observed })}`)
  return { requestedDip: point, physical, observed }
}
