import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DesktopRelease } from '@hasarbotu/contracts'

export function isNewerVersion(candidate: string, current: string): boolean {
  const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
  if (!pattern.test(candidate) || !pattern.test(current)) throw new Error('Geçersiz sürüm.')
  const a = candidate.split('.').map(BigInt), b = current.split('.').map(BigInt)
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i]! > b[i]! }
  return false
}

export async function downloadVerifiedInstaller(options: {
  release: DesktopRelease; origin: string; directory: string; fetch: typeof fetch
  progress(bytes: number): void
}): Promise<string> {
  const { release } = options
  await mkdir(options.directory, { recursive: true })
  const target = join(options.directory, `${release.sha256}.exe`), temporary = target + '.partial'
  // Never reuse an executable merely because its filename matches a digest.
  await rm(temporary, { force: true })
  let handle
  try {
    const response = await options.fetch(`${options.origin}/api/v1/desktop-updates/artifacts/${release.sha256}`, {
      redirect: 'error', credentials: 'include', signal: AbortSignal.timeout(300_000), cache: 'no-store',
    })
    if (!response.ok || !response.body) throw new Error(response.status === 401 ? 'Güncelleme için hesabınıza giriş yapın.' : 'Güncelleme dosyası indirilemedi.')
    const length = response.headers.get('content-length')
    if (length !== null && length !== String(release.size)) throw new Error('Güncelleme dosyası boyutu uyuşmuyor.')
    handle = await open(temporary, 'wx')
    const digest = createHash('sha256')
    let bytes = 0, lastReported = 0, signature = Buffer.alloc(0)
    const reader = response.body.getReader()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      bytes += chunk.length
      if (bytes > release.size) { await reader.cancel(); throw new Error('Güncelleme dosyası beklenen boyutu aşıyor.') }
      if (signature.length < 2) signature = Buffer.concat([signature, chunk]).subarray(0, 2)
      digest.update(chunk)
      await handle.writeFile(chunk)
      if (bytes - lastReported >= 256 * 1024) { options.progress(bytes); lastReported = bytes }
    }
    if (bytes !== release.size || digest.digest('hex') !== release.sha256 || signature.toString('ascii') !== 'MZ') throw new Error('Güncelleme dosyası bütünlük kontrolünden geçemedi.')
    await handle.sync(); await handle.close(); handle = undefined
    await rename(temporary, target)
    options.progress(bytes)
    return target
  } catch (error) {
    await handle?.close()
    await rm(temporary, { force: true })
    throw error
  }
}

function psLiteral(value: string): string { return "'" + value.replaceAll("'", "''") + "'" }

export async function verifyInstallerVersion(installer: string, expectedVersion: string): Promise<void> {
  const actual = await new Promise<string>((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Item -LiteralPath $env:HB_UPDATE_INSTALLER_PATH).VersionInfo.ProductVersion'],
      { windowsHide: true, timeout: 15_000, env: { ...process.env, HB_UPDATE_INSTALLER_PATH: installer } },
      (error, stdout) => error ? reject(new Error('Kurulum paketinin sürümü okunamadı.')) : resolve(stdout.trim()))
  })
  if (actual !== expectedVersion && actual !== expectedVersion + '.0') throw new Error('Kurulum paketinin sürümü yayımlanan sürümle uyuşmuyor.')
}

/** The helper outlives Electron, waits for its normal shutdown, then restarts only after successful installation. */
export async function writeUpdateHelper(options: { directory: string; installer: string; executable: string; installDirectory: string; pid: number; taskName: string; apiOrigin: string; userDataPath: string }): Promise<string> {
  const path = join(options.directory, 'install-and-restart.ps1')
  const script = [
    '$ErrorActionPreference = \'Stop\'',
    '$completion = @{ installerExitCode = -1; error = $null; taskCleanupError = $null; helperProcessId = $PID }',
    'try {',
    `try { Wait-Process -Id ${options.pid} -Timeout 60 -ErrorAction Stop } catch { if (Get-Process -Id ${options.pid} -ErrorAction SilentlyContinue) { throw 'Application did not close normally' } }`,
    `$installerPath = ${psLiteral(options.installer)}`,
    `$installTarget = ${psLiteral(options.installDirectory)}`,
    `$installedExecutable = ${psLiteral(options.executable)}`,
    // Wait only for NSIS, not its descendant processes or a restarted application.
    // PowerShell joins these with spaces; NSIS requires the final /D= tail unquoted.
    '$result = Start-Process -FilePath $installerPath -ArgumentList @("/S", ("/D=" + $installTarget)) -WindowStyle Hidden -PassThru',
    '$result.WaitForExit()',
    '$completion.installerExitCode = $result.ExitCode',
    'if ($result.ExitCode -ne 0) { throw "Installer failed: $($result.ExitCode)" }',
    `$savedProfile = ${psLiteral(options.userDataPath)}`,
    `$restartArguments = '--user-data-dir="' + $savedProfile + '" --hasarbotu-api-origin=' + ${psLiteral(options.apiOrigin)}`,
    // Explorer owns the restarted GUI: closing the update console/task cannot kill it.
    // Forward the non-secret connection explicitly; Explorer does not inherit our environment.
    '$shellWindows = (New-Object -ComObject Shell.Application).Windows()',
    '$desktopHandle = 0; $desktop = $shellWindows.FindWindowSW(0, 0, 8, [ref]$desktopHandle, 1)',
    'if (-not $desktop) { throw "Windows desktop shell is unavailable for restart" }',
    '$desktopShell = $desktop.Document.Application',
    '$desktopShell.ShellExecute($installedExecutable, $restartArguments, $installTarget, "open", 1)',
    '$completion.restartRequested = $true',
    '} catch { $completion.error = $_.Exception.Message } finally {',
    // A task registered by an elevated app can deny deletion to its Limited principal.
    // Cleanup diagnostics must not replace a successful install or the original error.
    `try { Unregister-ScheduledTask -TaskName ${psLiteral(options.taskName)} -Confirm:$false -ErrorAction Stop } catch { $completion.taskCleanupError = $_.Exception.Message }`,
    `$completion.finishedAt = [DateTime]::UtcNow.ToString('o'); $completion | ConvertTo-Json | Set-Content -LiteralPath ${psLiteral(join(options.directory, 'install-result.json'))} -Encoding UTF8`,
    '}',
  ].join('\r\n')
  // Windows PowerShell 5.1 reads a BOM-less script as ANSI, corrupting Unicode paths.
  await writeFile(path, '\uFEFF' + script, 'utf8')
  return path
}

/** Task Scheduler owns the installer lifetime; a detached Electron child died at app shutdown in the real Windows test. */
export async function scheduleUpdateHelper(helper: string, taskName: string): Promise<void> {
  const command = [
    "$ErrorActionPreference='Stop'",
    "$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value) -LogonType Interactive -RunLevel Limited",
    `$arguments='-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $env:HB_UPDATE_HELPER_PATH + '"'`,
    "$action=New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument $arguments",
    'Register-ScheduledTask -TaskName $env:HB_UPDATE_TASK_NAME -Action $action -Principal $principal -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10)) | Out-Null',
    'try { Start-ScheduledTask -TaskName $env:HB_UPDATE_TASK_NAME } catch { $startError = $_; try { Unregister-ScheduledTask -TaskName $env:HB_UPDATE_TASK_NAME -Confirm:$false -ErrorAction Stop } catch { Write-Warning ("Update task cleanup failed: " + $_.Exception.Message) }; throw $startError }',
  ].join('; ')
  await new Promise<void>((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command],
      { windowsHide: true, timeout: 30_000, env: { ...process.env, HB_UPDATE_HELPER_PATH: helper, HB_UPDATE_TASK_NAME: taskName } },
      error => error ? reject(new Error('Windows güncelleme görevi başlatılamadı. Uygulama açık bırakıldı.')) : resolve())
  })
}
