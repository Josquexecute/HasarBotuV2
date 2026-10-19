import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, copyFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scheduleUpdateHelper, writeUpdateHelper } from '../src/main/updates-core.js'

const exec = promisify(execFile)
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`
const powershell = (script: string, env?: NodeJS.ProcessEnv) => exec('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ProgressPreference='SilentlyContinue';try {\n" + script + "\nexit 0\n} catch { [Console]::Error.WriteLine($_.Exception.ToString()); exit 1 }", 'utf16le').toString('base64'),
], { windowsHide: true, timeout: 30_000, env: { ...process.env, ...env } })

describe.skipIf(process.platform !== 'win32')('Windows update helper cleanup failures', () => {
  let directory: string, installer: string, executable: string
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "hb-update Çığ Şöför İĞÜ ıöşçü O'Neil-"))
    installer = join(directory, 'installer.exe'); executable = join(directory, 'application.exe')
    await powershell(String.raw`$ErrorActionPreference='Stop'; Add-Type -OutputAssembly ${literal(installer)} -OutputType WindowsApplication -TypeDefinition @'
using System;
using System.IO;
public class UpdateFixture {
  public static int Main(string[] args) {
    string marker = Environment.GetEnvironmentVariable("HB_UPDATE_TEST_MARKER") ?? Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"result-0");
    if (Path.GetFileNameWithoutExtension(Environment.GetCommandLineArgs()[0]) == "installer") {
      File.WriteAllText(marker + ".install", string.Join("\n", args));
      File.WriteAllText(marker + ".commandline", Environment.CommandLine);
      return int.Parse(Environment.GetEnvironmentVariable("HB_UPDATE_TEST_EXIT_CODE") ?? "0");
    }
    File.WriteAllText(marker + ".restart", string.Join("\n", args));
    File.WriteAllText(marker + ".pid", System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
    System.Threading.Thread.Sleep(60000);
    return 0;
  }
}
'@`)
    await copyFile(installer, executable)
  }, 30_000)
  afterAll(async () => {
    if (!directory) return
    await powershell(`Get-CimInstance Win32_Process -Filter "Name='application.exe'" | Where-Object { $_.ExecutablePath -eq ${literal(executable)} } | ForEach-Object { $process=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if($process){$process.Kill(); $process.WaitForExit()} }`)
    await rm(directory, { recursive: true, force: true })
  })

  async function run(exitCode: number) {
    const marker = join(directory, `result-${exitCode}`)
    const helper = await writeUpdateHelper({ directory, installer, executable, installDirectory: directory,
      pid: 2147483646, taskName: 'HasarBotu-Update-synthetic', apiOrigin: 'https://api.example.test', userDataPath: join(directory, 'saved profile') })
    const { stderr } = await powershell(`$ErrorActionPreference='Stop'
function Unregister-ScheduledTask {
  [CmdletBinding()] param([string]$TaskName,[switch]$Confirm)
  throw [UnauthorizedAccessException]::new('Synthetic task deletion denied')
}
& ${literal(helper)}
$succeeded=$?
$result=Get-Content -LiteralPath ${literal(join(directory, 'install-result.json'))} -Raw | ConvertFrom-Json
if (-not $succeeded) { throw 'Helper failed on task cleanup' }
`, { HB_UPDATE_TEST_MARKER: marker, HB_UPDATE_TEST_EXIT_CODE: String(exitCode) })
    const result = JSON.parse((await readFile(join(directory, 'install-result.json'), 'utf8')).replace(/^\uFEFF/u, ''))
    return { marker, result, stderr }
  }

  async function assertIndependentRestart(marker: string, helperPid: number) {
    const deadline = Date.now() + 10_000
    let pid = 0
    while (!pid) {
      try { pid = Number(await readFile(marker + '.pid', 'utf8')) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || Date.now() > deadline) throw error; await new Promise(resolve => setTimeout(resolve, 80)) }
    }
    try {
      const { stdout } = await powershell(`$process=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if(-not $process){throw 'Restarted app died with helper'}; $process.ParentProcessId`)
      expect(Number(stdout.trim())).not.toBe(helperPid)
      expect(await readFile(marker + '.restart', 'utf8')).toBe(`--user-data-dir=${join(directory, 'saved profile')}\n--hasarbotu-api-origin=https://api.example.test`)
    } finally {
      await powershell(`$process=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($process -and $process.Path -eq ${literal(executable)}) {Stop-Process -Id $process.Id -Force}`)
    }
  }

  it('completes installation and actual restart when task deletion is denied', async () => {
    const { marker, result, stderr } = await run(0)
    expect(result).toMatchObject({ installerExitCode: 0, error: null, taskCleanupError: 'Synthetic task deletion denied', restartRequested: true })
    expect(stderr).toBe('')
    await assertIndependentRestart(marker, result.helperProcessId)
    const arguments_ = (await readFile(marker + '.install', 'utf8')).split('\n')
    expect(arguments_[0]).toBe('/S')
    // NSIS consumes the unquoted /D= tail, including its spaces, as the directory.
    expect(arguments_.slice(1).join(' ')).toBe(`/D=${directory}`)
    const commandLine = await readFile(marker + '.commandline', 'utf8')
    // Windows PowerShell 5.1 appends a separator after the final argument.
    expect(commandLine.slice(commandLine.indexOf('/S')).trimEnd()).toBe(`/S /D=${directory}`)
  }, 30_000)

  it('preserves an installer failure and never restarts when task deletion also fails', async () => {
    const { marker, result, stderr } = await run(42)
    expect(result).toMatchObject({ installerExitCode: 42, error: 'Installer failed: 42', taskCleanupError: 'Synthetic task deletion denied' })
    expect(result.restartedProcessId).toBeUndefined()
    expect(stderr).toBe('')
    await expect(readFile(marker + '.restart')).rejects.toMatchObject({ code: 'ENOENT' })
  }, 30_000)

  it.skipIf(!process.env.HASARBOTU_TEST_MAKENSIS)('runs a real NSIS package into the exact Unicode directory with spaces', async () => {
    const target = join(directory, "NSIS Çığ O'Neil")
    const nsis = join(directory, 'nsis-fixture.exe')
    const input = join(directory, 'fixture.nsi')
    await writeFile(input, '\uFEFF' + [
      'Unicode true', 'RequestExecutionLevel user', 'SilentInstall silent', 'Name "HasarBotu synthetic test"',
      `OutFile "${nsis}"`, 'Section', 'SetOutPath "$INSTDIR"',
      'FileOpen $0 "$INSTDIR\\nsis-marker.txt" w', 'FileWriteUTF16LE $0 "$INSTDIR"', 'FileClose $0', 'SectionEnd',
    ].join('\r\n'), 'utf8')
    await exec(process.env.HASARBOTU_TEST_MAKENSIS!, ['/V2', input], { windowsHide: true, timeout: 15_000 })
    // Explorer intentionally does not inherit the helper's environment.
    const marker = join(directory, 'result-0')
    await rm(marker + '.pid', { force: true })
    await rm(marker + '.restart', { force: true })
    const helper = await writeUpdateHelper({ directory, installer: nsis, executable, installDirectory: target,
      pid: 2147483646, taskName: 'HasarBotu-Update-synthetic', apiOrigin: 'https://api.example.test', userDataPath: join(directory, 'saved profile') })
    await powershell(`function Unregister-ScheduledTask { param([string]$TaskName,[switch]$Confirm) }; & ${literal(helper)}`, { HB_UPDATE_TEST_MARKER: marker })
    const result = JSON.parse((await readFile(join(directory, 'install-result.json'), 'utf8')).replace(/^\uFEFF/u, ''))
    expect(result).toMatchObject({ installerExitCode: 0, error: null, restartRequested: true })
    expect((await readFile(join(target, 'nsis-marker.txt'))).toString('utf16le').replace(/^\uFEFF/u, '')).toBe(target)
    await assertIndependentRestart(marker, result.helperProcessId)
  }, 30_000)

  it('finishes the actual Windows scheduled task while the restarted GUI remains alive', async () => {
    await rm(join(directory, 'result-0.pid'), { force: true })
    const taskName = `HasarBotu-Update-Test-${process.pid}-${Date.now()}`
    const helper = await writeUpdateHelper({ directory, installer, executable, installDirectory: directory,
      pid: 2147483646, taskName, apiOrigin: 'https://api.example.test', userDataPath: join(directory, 'saved profile') })
    await rm(join(directory, 'install-result.json'), { force: true })
    try {
      await scheduleUpdateHelper(helper, taskName)
      const deadline = Date.now() + 20_000
      let result
      while (!result) {
        try { result = JSON.parse((await readFile(join(directory, 'install-result.json'), 'utf8')).replace(/^\uFEFF/u, '')) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || Date.now() > deadline) throw error; await new Promise(resolve => setTimeout(resolve, 100)) }
      }
      expect(result).toMatchObject({ installerExitCode: 0, error: null, restartRequested: true })
      await powershell(`$process=Get-Process -Id ${result.helperProcessId} -ErrorAction SilentlyContinue; if($process -and -not $process.WaitForExit(10000)){throw 'Update helper did not exit'}`)
      await assertIndependentRestart(join(directory, 'result-0'), result.helperProcessId)
    } finally { await powershell(`$task=Get-ScheduledTask -TaskName ${literal(taskName)} -ErrorAction SilentlyContinue; if($task){Unregister-ScheduledTask -TaskName $task.TaskName -Confirm:$false}`) }
  }, 40_000)
})
