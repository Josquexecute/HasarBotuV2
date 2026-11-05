import { getTestDisplay, omitDisplayScenario, testDisplayIndex, useExplicitTestWindowPlacement } from './test-display.mjs'
import { app, BrowserWindow, screen } from 'electron'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { guardAssistantTopmost } from '../../dist/main/assistant-topmost.js'

const checks = []
useExplicitTestWindowPlacement()
const observations = []
let lastNativeFacts
let taskbarClass = 'Shell_TrayWnd'
let nativeContext = () => ({})
const check = (name, pass, facts) => { checks.push({ name, pass: Boolean(pass) }); if (!pass) throw new Error(facts ? `${name}: ${JSON.stringify(facts)}` : name) }
const nativeExpectations = {
  observe: '$true',
  fullscreen: '-not $facts.topmost -and $facts.foreground -eq $other.ToInt64().ToString()',
  topmost: '$facts.topmost -and $facts.foreground -eq $other.ToInt64().ToString()',
  normal: '$facts.topmost -and $facts.target -ge 0 -and $facts.target -lt $facts.other -and $facts.foreground -eq $other.ToInt64().ToString()',
  taskbar: '$facts.topmost -and $facts.target -ge 0 -and $facts.target -lt $facts.taskbar -and $facts.foreground -eq $other.ToInt64().ToString()',
  shell: '$facts.topmost -and $facts.target -ge 0 -and $facts.target -lt $facts.taskbar -and $facts.foreground -eq $bar.ToInt64().ToString()',
  hidden: '-not [InspectTouch]::IsWindowVisible($target) -and $facts.foreground -eq $other.ToInt64().ToString()',
}
let observer, nativeLines, nativeMessages, observerExit
let observerErrors = ''
async function readNativeMessage() {
  let timer
  try {
    const response = await Promise.race([
      nativeMessages.next(),
      observerExit,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native observer did not respond')), 15_000) }),
    ])
    if (response instanceof Error) throw response
    if (response.done) throw new Error(`Native observer closed its output: ${observerErrors}`)
    const message = JSON.parse(response.value)
    if (message.error) throw new Error(message.error)
    return message
  } finally { clearTimeout(timer) }
}
async function startNativeObserver() {
  const source = `using System; using System.Runtime.InteropServices; public static class InspectTouch {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L,T,R,B; }
    [StructLayout(LayoutKind.Sequential)] public struct Monitor { public int Size; public Rect Bounds,Work; public uint Flags; }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h,uint cmd);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls,string title);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,System.Text.StringBuilder name,int max);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
    [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr h,uint message,UIntPtr wParam,IntPtr lParam,uint flags,uint timeout,out UIntPtr result);
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
  const script = `[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'\n${source}\n'@
$conditions=@{
${Object.entries(nativeExpectations).map(([name, condition]) => `  ${name} = { ${condition} }`).join('\n')}
}
function Read-NativeFacts {
$order=@(); $h=[InspectTouch]::GetTopWindow([IntPtr]::Zero)
while($h -ne [IntPtr]::Zero -and $order.Count -lt 500) { $order+= $h.ToInt64().ToString(); $h=[InspectTouch]::GetWindow($h,2) }
$rect=New-Object InspectTouch+Rect; [void][InspectTouch]::GetWindowRect($other,[ref]$rect)
$monitor=New-Object InspectTouch+Monitor; $monitor.Size=[Runtime.InteropServices.Marshal]::SizeOf($monitor); [void][InspectTouch]::GetMonitorInfo([InspectTouch]::MonitorFromWindow($other,2),[ref]$monitor)
$foreground=[InspectTouch]::GetForegroundWindow(); $foregroundClass=[Text.StringBuilder]::new(128); [void][InspectTouch]::GetClassName($foreground,$foregroundClass,$foregroundClass.Capacity)
return @{ topmost=([InspectTouch]::GetWindowLongPtr($target,-20).ToInt64() -band 8) -ne 0; foreground=$foreground.ToInt64().ToString(); foregroundClass=$foregroundClass.ToString(); taskbarHandle=$bar.ToInt64().ToString(); target=$order.IndexOf($target.ToInt64().ToString()); other=$order.IndexOf($other.ToInt64().ToString()); taskbar=$order.IndexOf($bar.ToInt64().ToString()); hasTaskbar=$bar -ne [IntPtr]::Zero; nativeRect=$rect; monitorBounds=$monitor.Bounds; observerDpiAwareness=[InspectTouch]::GetAwarenessFromDpiAwarenessContext([InspectTouch]::GetThreadDpiAwarenessContext()); sameNativeMonitor=[InspectTouch]::MonitorFromWindow($other,2) -eq [InspectTouch]::MonitorFromWindow($target,2); frameStyle=[InspectTouch]::GetWindowLongPtr($other,-16).ToInt64() -band 0x00C00000 }
}
[Console]::WriteLine('{"ready":true}')
while($null -ne ($line=[Console]::ReadLine())) {
  try {
    $request=ConvertFrom-Json -InputObject $line
    $target=[IntPtr]([long]$request.target); $other=[IntPtr]([long]$request.competitor); $bar=[InspectTouch]::FindWindow($request.taskbarClass,$null)
    $expected=$conditions[$request.expectation]
    if($null -eq $expected){throw 'Unknown native observation expectation'}
    if($request.taskbar -eq 'foreground' -and $bar -ne [IntPtr]::Zero) { [void][InspectTouch]::SetWindowPos($bar,[IntPtr](-1),0,0,0,0,0x13) }
    $focus=if($request.taskbar -eq 'foreground'){$bar}else{$other}
    [InspectTouch]::keybd_event(0x12,0,0,[UIntPtr]::Zero); [InspectTouch]::keybd_event(0x12,0,2,[UIntPtr]::Zero)
    if(-not [InspectTouch]::SetForegroundWindow($focus)){throw 'Cannot activate the native test surface'}
    # Cross-thread activation is asynchronous; acknowledge its queue before observing z-order.
    $reply=[UIntPtr]::Zero
    if([InspectTouch]::SendMessageTimeout($focus,0,[UIntPtr]::Zero,[IntPtr]::Zero,2,5000,[ref]$reply) -eq [IntPtr]::Zero){throw 'Native test surface did not process foreground activation'}
    if($request.taskbar -eq 'show' -and $bar -ne [IntPtr]::Zero) { [void][InspectTouch]::ShowWindow($bar,0); [void][InspectTouch]::SetWindowPos($bar,[IntPtr](-1),0,0,0,0,0x13); [void][InspectTouch]::ShowWindow($bar,4) }
    $watch=[Diagnostics.Stopwatch]::StartNew(); $facts=Read-NativeFacts; $first=$facts.Clone()
    while(-not (& $expected) -and $watch.ElapsedMilliseconds -lt 10000) { Start-Sleep -Milliseconds 20; $facts=Read-NativeFacts }
    $facts.settled=[bool](& $expected); $facts.elapsedMs=$watch.ElapsedMilliseconds; $facts.first=$first
    [Console]::WriteLine(($facts | ConvertTo-Json -Compress -Depth 6))
  } catch { [Console]::WriteLine((@{error=$_.Exception.Message} | ConvertTo-Json -Compress)) }
}`
  // A new console observer can restore the shell foreground. Start it once and
  // acknowledge readiness before activating any of the fixture's test surfaces.
  observer = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  nativeLines = createInterface({ input: observer.stdout, crlfDelay: Infinity })
  nativeMessages = nativeLines[Symbol.asyncIterator]()
  observer.stderr.on('data', chunk => { observerErrors = (observerErrors + String(chunk)).slice(-8192) })
  observerExit = new Promise(resolve => {
    observer.once('error', resolve)
    observer.stdin.once('error', resolve)
    observer.once('exit', code => resolve(new Error(`Native observer exited (${code}): ${observerErrors}`)))
  })
  if ((await readNativeMessage()).ready !== true) throw new Error('Native observer did not acknowledge readiness')
}
async function native(target, competitor, taskbar = false, expectation = 'observe') {
  if (!Object.hasOwn(nativeExpectations, expectation)) throw new Error('Unknown native observation expectation')
  observer.stdin.write(JSON.stringify({ target, competitor, taskbar: taskbar || '', expectation, taskbarClass }) + '\n')
  lastNativeFacts = { expectation, taskbarClass, ...await readNativeMessage(), targetHandle: target, competitorHandle: competitor, fixture: nativeContext() }
  observations.push({ expectation, taskbarClass, ...lastNativeFacts })
  if (!lastNativeFacts.settled) throw new Error(`Native Touch ordering did not settle: ${JSON.stringify(lastNativeFacts)}`)
  return lastNativeFacts
}
app.on('window-all-closed', () => {})
void app.whenReady().then(async () => {
let target, competitor, stop
try {
  await startNativeObserver()
  const selectedDisplay = getTestDisplay(), area = selectedDisplay.workArea
  taskbarClass = selectedDisplay.id === screen.getPrimaryDisplay().id ? 'Shell_TrayWnd' : 'Shell_SecondaryTrayWnd'
  target = new BrowserWindow({ x: area.x + 30, y: area.y + 30, width: 120, height: 120, frame: false, alwaysOnTop: true, show: false, webPreferences: { sandbox: true, nodeIntegration: false } })
  stop = guardAssistantTopmost(target)
  await Promise.all([once(target, 'ready-to-show'), target.loadURL('data:text/html,<main>Native Touch test</main>')])
  target.showInactive()
  const targetId = target.getNativeWindowHandle().readBigUInt64LE().toString()
  competitor = new BrowserWindow({ x: area.x + 20, y: area.y + 20, width: 640, height: 480, frame: false, show: false, webPreferences: { sandbox: true, nodeIntegration: false } })
  nativeContext = () => ({ target: target.getBounds(), competitor: competitor.getBounds(), competitorFullScreen: competitor.isFullScreen(), competitorVisible: competitor.isVisible(), competitorDisplay: screen.getDisplayMatching(competitor.getBounds()).id, expectedDisplay: selectedDisplay.id })
  const competitorId = competitor.getNativeWindowHandle().readBigUInt64LE().toString()
  await Promise.all([once(competitor, 'ready-to-show'), competitor.loadURL('data:text/html,<main>Native foreground test</main>')])
  competitor.show(); competitor.focus()
  // A forced foreground switch from the shell can update GetForegroundWindow
  // without emitting EVENT_SYSTEM_FOREGROUND. Establish the normal foreground
  // before requesting fullscreen so its real bounds event exercises the guard.
  await native(targetId, competitorId, false, 'normal')
  check('normal foreground is established before the fullscreen transition', true)
  competitor.setFullScreen(true)
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
  observer?.kill(); nativeLines?.close()
  stop?.(); competitor?.destroy(); target?.destroy()
  await writeFile(process.env.HB_ASSISTANT_RESULT, JSON.stringify(checks))
  if (process.env.HB_TEST_DISPLAY_EVIDENCE) await writeFile(join(process.env.HB_TEST_DISPLAY_EVIDENCE, `native-observations-${process.pid}.json`), JSON.stringify({ checks, observations }, null, 2))
  app.exit(checks.every(value => value.pass) ? 0 : 1)
}
})
