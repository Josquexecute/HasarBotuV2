import { getTestDisplay, omitDisplayScenario, testDisplayIndex, useExplicitTestWindowPlacement } from './test-display.mjs'
import { app, BrowserWindow, screen } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { guardAssistantTopmost } from '../../dist/main/assistant-topmost.js'

const run = promisify(execFile), checks = []
useExplicitTestWindowPlacement()
const observations = []
let lastNativeFacts
let taskbarClass = 'Shell_TrayWnd'
let nativeContext = () => ({})
const check = (name, pass, facts) => { checks.push({ name, pass: Boolean(pass) }); if (!pass) throw new Error(facts ? `${name}: ${JSON.stringify(facts)}` : name) }
async function native(target, competitor, taskbar = false, expectation = 'observe') {
  const expected = {
    observe: '$true',
    fullscreen: '-not $facts.topmost -and $facts.foreground -eq $other.ToInt64().ToString()',
    topmost: '$facts.topmost -and $facts.foreground -eq $other.ToInt64().ToString()',
    normal: '$facts.topmost -and $facts.target -ge 0 -and $facts.target -lt $facts.other -and $facts.foreground -eq $other.ToInt64().ToString()',
    taskbar: '$facts.topmost -and $facts.target -ge 0 -and $facts.target -lt $facts.taskbar -and $facts.foreground -eq $other.ToInt64().ToString()',
    shell: '$facts.topmost -and $facts.target -ge 0 -and $facts.target -lt $facts.taskbar -and $facts.foreground -eq $bar.ToInt64().ToString()',
    hidden: '-not [InspectTouch]::IsWindowVisible($target) -and $facts.foreground -eq $other.ToInt64().ToString()',
  }[expectation]
  if (!expected) throw new Error('Unknown native observation expectation')
  const source = `using System; using System.Runtime.InteropServices; public static class InspectTouch {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L,T,R,B; }
    [StructLayout(LayoutKind.Sequential)] public struct Monitor { public int Size; public Rect Bounds,Work; public uint Flags; }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h,uint cmd);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls,string title);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool attach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int command);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr order,int x,int y,int w,int height,uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h,uint flags);
    [DllImport("user32.dll",CharSet=CharSet.Auto)] public static extern bool GetMonitorInfo(IntPtr h,ref Monitor info);
    [DllImport("user32.dll")] public static extern IntPtr GetThreadDpiAwarenessContext();
    [DllImport("user32.dll")] public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h,int i);
  }`
  const script = `Add-Type -TypeDefinition @'\n${source}\n'@
$target=[IntPtr]${target}; $other=[IntPtr]${competitor}; $bar=[InspectTouch]::FindWindow('${taskbarClass}',$null)
${taskbar === 'foreground' ? 'if($bar -ne [IntPtr]::Zero) { [void][InspectTouch]::SetWindowPos($bar,[IntPtr](-1),0,0,0,0,0x13) }' : ''}
$focus=${taskbar === 'foreground' ? '$bar' : '$other'}
[InspectTouch]::keybd_event(0x12,0,0,[UIntPtr]::Zero); [InspectTouch]::keybd_event(0x12,0,2,[UIntPtr]::Zero)
$owner=[uint32]0; $foregroundThread=[InspectTouch]::GetWindowThreadProcessId([InspectTouch]::GetForegroundWindow(),[ref]$owner); $observerThread=[InspectTouch]::GetCurrentThreadId()
$attached=[InspectTouch]::AttachThreadInput($observerThread,$foregroundThread,$true)
try { if(-not [InspectTouch]::SetForegroundWindow($focus)){throw 'Cannot activate the native test surface'} }
finally { if($attached){[void][InspectTouch]::AttachThreadInput($observerThread,$foregroundThread,$false)} }
${taskbar === 'show' ? 'if($bar -ne [IntPtr]::Zero) { [void][InspectTouch]::ShowWindow($bar,0); [void][InspectTouch]::SetWindowPos($bar,[IntPtr](-1),0,0,0,0,0x13); [void][InspectTouch]::ShowWindow($bar,4) }' : ''}
function Read-NativeFacts {
$order=@(); $h=[InspectTouch]::GetTopWindow([IntPtr]::Zero)
while($h -ne [IntPtr]::Zero -and $order.Count -lt 500) { $order+= $h.ToInt64().ToString(); $h=[InspectTouch]::GetWindow($h,2) }
$rect=New-Object InspectTouch+Rect; [void][InspectTouch]::GetWindowRect($other,[ref]$rect)
$monitor=New-Object InspectTouch+Monitor; $monitor.Size=[Runtime.InteropServices.Marshal]::SizeOf($monitor); [void][InspectTouch]::GetMonitorInfo([InspectTouch]::MonitorFromWindow($other,2),[ref]$monitor)
return @{ topmost=([InspectTouch]::GetWindowLongPtr($target,-20).ToInt64() -band 8) -ne 0; foreground=[InspectTouch]::GetForegroundWindow().ToInt64().ToString(); target=$order.IndexOf($target.ToInt64().ToString()); other=$order.IndexOf($other.ToInt64().ToString()); taskbar=$order.IndexOf($bar.ToInt64().ToString()); hasTaskbar=$bar -ne [IntPtr]::Zero; nativeRect=$rect; monitorBounds=$monitor.Bounds; observerDpiAwareness=[InspectTouch]::GetAwarenessFromDpiAwarenessContext([InspectTouch]::GetThreadDpiAwarenessContext()); sameNativeMonitor=[InspectTouch]::MonitorFromWindow($other,2) -eq [InspectTouch]::MonitorFromWindow($target,2); frameStyle=[InspectTouch]::GetWindowLongPtr($other,-16).ToInt64() -band 0x00C00000 }
}
$watch=[Diagnostics.Stopwatch]::StartNew(); $facts=Read-NativeFacts; $first=$facts.Clone()
while(-not (${expected}) -and $watch.ElapsedMilliseconds -lt 10000) { Start-Sleep -Milliseconds 20; $facts=Read-NativeFacts }
$facts.settled=[bool](${expected}); $facts.elapsedMs=$watch.ElapsedMilliseconds; $facts.first=$first
$facts | ConvertTo-Json -Compress -Depth 6`
  const result = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15_000 })
  lastNativeFacts = { ...JSON.parse(result.stdout.trim()), targetHandle: target, competitorHandle: competitor, fixture: nativeContext() }
  observations.push({ expectation, taskbarClass, ...lastNativeFacts })
  if (!lastNativeFacts.settled) throw new Error(`Native Touch ordering did not settle: ${JSON.stringify(lastNativeFacts)}`)
  return lastNativeFacts
}
app.on('window-all-closed', () => {})
void app.whenReady().then(async () => {
let target, competitor, stop
try {
  const selectedDisplay = getTestDisplay(), area = selectedDisplay.workArea
  taskbarClass = selectedDisplay.id === screen.getPrimaryDisplay().id ? 'Shell_TrayWnd' : 'Shell_SecondaryTrayWnd'
  target = new BrowserWindow({ x: area.x + 30, y: area.y + 30, width: 120, height: 120, frame: false, alwaysOnTop: true, show: false, webPreferences: { sandbox: true, nodeIntegration: false } })
  stop = guardAssistantTopmost(target)
  target.showInactive()
  const targetId = target.getNativeWindowHandle().readBigUInt64LE().toString()
  competitor = new BrowserWindow({ x: area.x + 20, y: area.y + 20, width: 640, height: 480, frame: false, show: false, webPreferences: { sandbox: true, nodeIntegration: false } })
  nativeContext = () => ({ target: target.getBounds(), competitor: competitor.getBounds(), competitorFullScreen: competitor.isFullScreen(), competitorVisible: competitor.isVisible(), competitorDisplay: screen.getDisplayMatching(competitor.getBounds()).id, expectedDisplay: selectedDisplay.id })
  const competitorId = competitor.getNativeWindowHandle().readBigUInt64LE().toString()
  await competitor.loadURL('data:text/html,<main>Native foreground test</main>')
  competitor.setFullScreen(true); competitor.show(); competitor.focus()
  // Keep one observer alive through each asynchronous WinEvent. Repeatedly
  // creating observers can restore another foreground window between samples.
  await native(targetId, competitorId, false, 'fullscreen')
  check('real Windows foreground fullscreen yields the topmost band on that monitor', true)
  const secondary = screen.getAllDisplays().find(display => display.id !== screen.getPrimaryDisplay().id)
  if (secondary && testDisplayIndex === null) {
    target.setPosition(secondary.workArea.x + 30, secondary.workArea.y + 30)
    await native(targetId, competitorId, false, 'topmost')
    check('a full-screen app on the first physical monitor does not demote Touch on the second', true)
    target.setPosition(area.x + 30, area.y + 30)
    await native(targetId, competitorId, false, 'fullscreen')
    check('moving back to the full-screen monitor safely yields without activation', true)
  } else if (testDisplayIndex !== null) {
    omitDisplayScenario('cross-monitor fullscreen exclusion', 'HB_TEST_DISPLAY_INDEX confines all visible test windows to the selected physical display; no cross-monitor movement was performed.')
    omitDisplayScenario('move back to the fullscreen monitor', 'HB_TEST_DISPLAY_INDEX confines all visible test windows to the selected physical display; no cross-monitor movement was performed.')
  }
  competitor.setFullScreen(false)
  competitor.setBounds({ x: area.x + 20, y: area.y + 20, width: 640, height: 480 })
  competitor.focus()
  let facts
  facts = await native(targetId, competitorId, false, 'normal')
  check('returning to a normal window restores actual native z-order without stealing focus', facts.foreground === competitorId, facts)
  if (facts.hasTaskbar) {
    facts = await native(targetId, competitorId, 'show', 'taskbar')
    check('taskbar appearing without foreground activation restores Touch order and preserves the focused app', facts.target >= 0 && facts.taskbar > facts.target && facts.foreground === competitorId, facts)
    facts = await native(targetId, competitorId, 'foreground', 'shell')
    check('Touch stays above the actual Windows taskbar after shell activation', facts.taskbar >= 0 && facts.target >= 0 && facts.target < facts.taskbar)
  } else {
    omitDisplayScenario('native taskbar appearance and foreground activation', 'The selected display has no native Windows taskbar. Other displays are outside the permitted test surface.')
  }
  target.hide(); competitor.focus()
  await native(targetId, competitorId, false, 'hidden')
  check('native foreground hook never resurrects a deliberately hidden assistant', !target.isVisible())
  checks.push({ name: `physical monitors available: ${screen.getAllDisplays().length}`, pass: true })
} catch (error) { checks.push({ name: error.message, pass: false }) }
finally {
  stop?.(); competitor?.destroy(); target?.destroy()
  await writeFile(process.env.HB_ASSISTANT_RESULT, JSON.stringify(checks))
  if (process.env.HB_TEST_DISPLAY_EVIDENCE) await writeFile(join(process.env.HB_TEST_DISPLAY_EVIDENCE, `native-observations-${process.pid}.json`), JSON.stringify({ checks, observations }, null, 2))
  app.exit(checks.every(value => value.pass) ? 0 : 1)
}
})
