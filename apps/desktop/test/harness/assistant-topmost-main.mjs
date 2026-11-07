import { getTestDisplay, omitDisplayScenario, testDisplayIndex, useExplicitTestWindowPlacement } from './test-display.mjs'
import { app, BrowserWindow, screen } from 'electron'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
const { guardAssistantTopmost } = await import(process.env.HB_TOPMOST_MODULE ?? '../../dist/main/assistant-topmost.js')

const checks = []
useExplicitTestWindowPlacement()
const observations = []
let lastNativeFacts
let taskbarClass = 'Shell_TrayWnd'
let nativeContext = () => ({})
const check = (name, pass, facts) => { checks.push({ name, pass: Boolean(pass) }); if (!pass) throw new Error(facts ? `${name}: ${JSON.stringify(facts)}` : name) }
const nativeExpectations = {
  observe: '$true',
  fullscreen: '$facts.visible -and $facts.noActivate -and $facts.toolWindow -and $facts.topmost -and $facts.target -ge 0 -and $facts.target -lt $facts.other -and $facts.foreground -eq $other.ToInt64().ToString() -and $facts.sameNativeMonitor -and $facts.frameStyle -eq 0 -and $facts.nativeRect.L -le $facts.monitorBounds.L -and $facts.nativeRect.T -le $facts.monitorBounds.T -and $facts.nativeRect.R -ge $facts.monitorBounds.R -and $facts.nativeRect.B -ge $facts.monitorBounds.B -and (-not $facts.hasTaskbar -or $facts.taskbar -gt $facts.other)',
  topmost: '$facts.topmost -and $facts.foreground -eq $other.ToInt64().ToString()',
  normal: '$facts.visible -and $facts.noActivate -and $facts.toolWindow -and $facts.topmost -and $facts.target -ge 0 -and $facts.target -lt $facts.other -and $facts.foreground -eq $other.ToInt64().ToString()',
  hidden: '-not [InspectTouch]::IsWindowVisible($target) -and $facts.foreground -eq $other.ToInt64().ToString()',
}
let observer, nativeLines, nativeMessages, observerExit, foregroundProcess, foregroundLines, foregroundMessages, foregroundState, foregroundConnection, foregroundServer
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
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
    delegate bool VisitWindow(IntPtr h,IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(VisitWindow visit,IntPtr data);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,System.Text.StringBuilder text,int count);
    public static IntPtr FindTitle(string fragment) {
      IntPtr found=IntPtr.Zero; int count=0;
      EnumWindows((h,data) => { var text=new System.Text.StringBuilder(512); GetWindowText(h,text,text.Capacity); if(IsWindowVisible(h) && text.ToString().Contains(fragment)){found=h;count++;} return true; },IntPtr.Zero);
      if(count!=1) throw new Exception("Expected one visible native browser fixture, found " + count);
      return found;
    }
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls,string title);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,System.Text.StringBuilder name,int max);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
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
$foregroundPid=[uint32]0; [void][InspectTouch]::GetWindowThreadProcessId($foreground,[ref]$foregroundPid)
return @{ visible=[InspectTouch]::IsWindowVisible($target); noActivate=([InspectTouch]::GetWindowLongPtr($target,-20).ToInt64() -band 0x08000000) -ne 0; toolWindow=([InspectTouch]::GetWindowLongPtr($target,-20).ToInt64() -band 0x80) -ne 0; topmost=([InspectTouch]::GetWindowLongPtr($target,-20).ToInt64() -band 8) -ne 0; foreground=$foreground.ToInt64().ToString(); foregroundPid=$foregroundPid; expectedPid=$request.competitorPid; foregroundClass=$foregroundClass.ToString(); taskbarHandle=$bar.ToInt64().ToString(); target=$order.IndexOf($target.ToInt64().ToString()); other=$order.IndexOf($other.ToInt64().ToString()); taskbar=$order.IndexOf($bar.ToInt64().ToString()); hasTaskbar=$bar -ne [IntPtr]::Zero; nativeRect=$rect; monitorBounds=$monitor.Bounds; observerDpiAwareness=[InspectTouch]::GetAwarenessFromDpiAwarenessContext([InspectTouch]::GetThreadDpiAwarenessContext()); sameNativeMonitor=[InspectTouch]::MonitorFromWindow($other,2) -eq [InspectTouch]::MonitorFromWindow($target,2); frameStyle=[InspectTouch]::GetWindowLongPtr($other,-16).ToInt64() -band 0x00C00000 }
}
[Console]::WriteLine('{"ready":true}')
while($null -ne ($line=[Console]::ReadLine())) {
  try {
    $request=ConvertFrom-Json -InputObject $line
    $target=[IntPtr]([long]$request.target)
    $other=if($request.competitor.StartsWith('title:')){[InspectTouch]::FindTitle($request.competitor.Substring(6))}else{[IntPtr]([long]$request.competitor)}
    $bar=[InspectTouch]::FindWindow($request.taskbarClass,$null)
    $expected=$conditions[$request.expectation]
    if($null -eq $expected){throw 'Unknown native observation expectation'}
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
  observer.stdin.write(JSON.stringify({ target, competitor, competitorPid: foregroundProcess?.pid, taskbar: taskbar || '', expectation, taskbarClass }) + '\n')
  lastNativeFacts = { expectation, taskbarClass, ...await readNativeMessage(), targetHandle: target, competitorHandle: competitor, fixture: nativeContext() }
  observations.push({ expectation, taskbarClass, ...lastNativeFacts })
  if (!lastNativeFacts.settled) throw new Error(`Native Touch ordering did not settle: ${JSON.stringify(lastNativeFacts)}`)
  return lastNativeFacts
}
async function foregroundCommand(type, value) {
  if (type) foregroundConnection.write(JSON.stringify({ type, value }) + '\n')
  let timer
  try {
    const message = async () => {
      for (;;) {
        const response = await foregroundMessages.next()
        if (response.done || response.value.trim()) return response
      }
    }
    const response = await Promise.race([message(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('External foreground fixture did not respond')), 10000) })])
    if (response.done) throw new Error('External foreground fixture exited')
    foregroundState = JSON.parse(response.value)
    if (foregroundState.error) throw new Error(foregroundState.error)
  } finally { clearTimeout(timer) }
}
app.on('window-all-closed', () => {})
void app.whenReady().then(async () => {
let target, stop
try {
  await startNativeObserver()
  const selectedDisplay = getTestDisplay(), area = selectedDisplay.workArea
  taskbarClass = selectedDisplay.id === screen.getPrimaryDisplay().id ? 'Shell_TrayWnd' : 'Shell_SecondaryTrayWnd'
  target = new BrowserWindow({ x: area.x + 30, y: area.y + 30, width: 120, height: 120, frame: false, type: 'toolbar', focusable: false, alwaysOnTop: true, show: false, webPreferences: { sandbox: true, nodeIntegration: false } })
  stop = guardAssistantTopmost(target)
  await Promise.all([once(target, 'ready-to-show'), target.loadURL('data:text/html,<main>Native Touch test</main>')])
  target.showInactive()
  const targetId = target.getNativeWindowHandle().readBigUInt64LE().toString()
  foregroundServer = createServer()
  foregroundServer.listen(0, '127.0.0.1')
  await once(foregroundServer, 'listening')
  const connected = once(foregroundServer, 'connection', { signal: AbortSignal.timeout(10000) })
  const brave = Boolean(process.env.HB_TOUCH_BRAVE_PATH)
  foregroundProcess = spawn(brave ? process.env.HB_TOUCH_NODE_PATH : process.execPath, [fileURLToPath(new URL(brave ? './assistant-brave-main.mjs' : './assistant-foreground-main.mjs', import.meta.url)), '--user-data-dir=' + join(app.getPath('userData'), 'competitor')], { env: { ...process.env, HB_FOREGROUND_PORT: String(foregroundServer.address().port), HB_FOREGROUND_BOUNDS: JSON.stringify({ x: area.x + 20, y: area.y + 20, width: 640, height: 480 }) }, stdio: 'ignore' })
  const [connection] = await connected
  foregroundConnection = connection
  foregroundLines = createInterface({ input: foregroundConnection, crlfDelay: Infinity })
  foregroundMessages = foregroundLines[Symbol.asyncIterator]()
  await foregroundCommand()
  nativeContext = () => ({ target: target.getBounds(), competitor: foregroundState, expectedDisplay: selectedDisplay.id })
  const competitorId = foregroundState.handle
  // Observation never activates or reorders Explorer, the taskbar, or the fixture.
  await native(targetId, competitorId, false, 'normal')
  check('normal foreground is established before the fullscreen transition', true)
  if (!brave) {
    await foregroundCommand('cover', true)
    await native(targetId, competitorId, false, 'normal')
    check('an external topmost foreground surface cannot cover Touch or lose foreground', true)
    await foregroundCommand('cover', false)
  }
  await foregroundCommand('video')
  // Keep one observer alive through each asynchronous WinEvent. Repeatedly
  // creating observers can restore another foreground window between samples.
  await native(targetId, competitorId, false, 'fullscreen')
  check('real Windows foreground fullscreen keeps Touch above the video surface without activation', true)
  target.setPosition(area.x + 60, area.y + 60)
  await native(targetId, competitorId, false, 'fullscreen')
  check('moving passive Touch during fullscreen preserves video foreground and taskbar order', true)
  const secondary = screen.getAllDisplays().find(display => display.id !== screen.getPrimaryDisplay().id)
  if (secondary && testDisplayIndex === null) {
    target.setPosition(secondary.workArea.x + 30, secondary.workArea.y + 30)
    await native(targetId, competitorId, false, 'topmost')
    check('a full-screen app on the first physical monitor does not demote Touch on the second', true)
    target.setPosition(area.x + 30, area.y + 30)
    await native(targetId, competitorId, false, 'fullscreen')
    check('moving back to the full-screen monitor preserves visibility without activation', true)
  } else if (testDisplayIndex !== null) {
    omitDisplayScenario('cross-monitor fullscreen exclusion', 'HB_TEST_DISPLAY_INDEX confines all visible test windows to the selected physical display; no cross-monitor movement was performed.')
    omitDisplayScenario('move back to the fullscreen monitor', 'HB_TEST_DISPLAY_INDEX confines all visible test windows to the selected physical display; no cross-monitor movement was performed.')
  }
  target.hide()
  await native(targetId, competitorId, false, 'hidden')
  check('Touch disabled leaves the real fullscreen foreground intact', true)
  target.showInactive()
  await native(targetId, competitorId, false, 'fullscreen')
  check('showing Touch during fullscreen preserves the hidden taskbar and video foreground', true)
  await foregroundCommand('fullscreen', false)
  await foregroundCommand('bounds', { x: area.x + 20, y: area.y + 20, width: 640, height: 480 })
  let facts
  facts = await native(targetId, competitorId, false, 'normal')
  check('returning to a normal window restores actual native z-order without stealing focus', facts.settled, facts)
  if (facts.hasTaskbar) {
    check('normal Windows taskbar remains present; no test mutates its visibility or order', facts.hasTaskbar)
  } else {
    omitDisplayScenario('native taskbar appearance and foreground activation', 'The selected display has no native Windows taskbar. Other displays are outside the permitted test surface.')
  }
  target.hide()
  await native(targetId, competitorId, false, 'hidden')
  check('native foreground hook never resurrects a deliberately hidden assistant', !target.isVisible())
  checks.push({ name: `physical monitors available: ${screen.getAllDisplays().length}`, pass: true })
} catch (error) { checks.push({ name: error.message, pass: false }) }
finally {
  observer?.kill(); nativeLines?.close()
  foregroundConnection?.end(); foregroundLines?.close()
  if (foregroundProcess && foregroundProcess.exitCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => { foregroundProcess.kill(); resolve() }, 2000)
      foregroundProcess.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }
  foregroundConnection?.destroy(); foregroundServer?.close()
  stop?.(); target?.destroy()
  await writeFile(process.env.HB_ASSISTANT_RESULT, JSON.stringify(checks))
  if (process.env.HB_TEST_DISPLAY_EVIDENCE) await writeFile(join(process.env.HB_TEST_DISPLAY_EVIDENCE, `native-observations-${process.pid}.json`), JSON.stringify({ checks, observations }, null, 2))
  app.exit(checks.every(value => value.pass) ? 0 : 1)
}
})
