import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm, mkdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const { loadSourceRefreshConfig } = createRequire(import.meta.url)('./office-source-refresh-config.cjs')

test('the refresh runner uses the configured runtime, database and parameterized organization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hb-refresh-runner-'))
  try {
    await mkdir(join(directory, 'services/api/node_modules/pg'), { recursive: true })
    await mkdir(join(directory, 'tools'))
    await mkdir(join(directory, 'source'))
    await writeFile(join(directory, 'services/api/package.json'), '{}')
    await writeFile(join(directory, 'services/api/node_modules/pg/index.js'), `exports.Client=class {async connect(){} async end(){} async query(sql,parameters){require('node:fs').writeFileSync(${JSON.stringify(join(directory, 'query.json'))},JSON.stringify({sql,parameters}));return {rows:[]}}}`)
    await writeFile(join(directory, 'tools/pcloud-source-attestation.mjs'), 'export const findCasesNeedingAttestation=()=>{throw Error("Unexpected scan")};export const buildAttestationRecordsBatch=()=>[];export const writeAttestationRecord=()=>{}')
    await writeFile(join(directory, 'configuration.json'), JSON.stringify({ expectedComputerName: 'SYNTHETIC-OFFICE', runtimeRoot: directory, sourceRoot: join(directory, 'source'), organizationId: '00000000-0000-4000-8000-000000000001', databaseName: 'synthetic_office', storageRootKey: 'synthetic-root' }))
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./office-source-refresh.cjs', import.meta.url))], { encoding: 'utf8', windowsHide: true, env: { ...process.env, COMPUTERNAME: 'SYNTHETIC-OFFICE', HASARBOTU_SOURCE_REFRESH_DIRECTORY: directory, HASARBOTU_AGENT_ROOTS: JSON.stringify({ 'synthetic-root': directory }), DATABASE_URL: 'postgres://localhost/synthetic_office' } })
    assert.equal(child.status, 0, child.stderr)
    const query = JSON.parse(await readFile(join(directory, 'query.json'), 'utf8'))
    assert.match(query.sql, /organization_id=\$3/)
    assert.deepEqual(query.parameters, [false, 'synthetic-root', '00000000-0000-4000-8000-000000000001'])
    const status = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'))
    assert.equal(status.status, 'PASS')
    assert.equal(status.gateBypassed, false)
    assert.equal(status.sourceReadOnly, true)
    assert.equal(status.targetReadOnly, true)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('launcher migration previews, verifies both actions, is idempotent and rolls back partial task updates', { skip: process.platform !== 'win32' }, async () => {
  for (const failure of [false, true]) {
    const directory = await mkdtemp(join(tmpdir(), 'hb-refresh-migrate-'))
    try {
      await copyFile(new URL('./office-source-refresh-launcher.cs', import.meta.url), join(directory, 'office-source-refresh-launcher.cs'))
      await writeFile(join(directory, 'run-office-source-refresh.ps1'), 'exit 0')
      const literal = value => `'${value.replaceAll("'", "''")}'`
      const script = String.raw`
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$directory=${literal(directory)};$setup=${literal(fileURLToPath(new URL('./set-office-source-refresh-launcher.ps1', import.meta.url)))}
$global:hbLauncherTasks=@{};$global:hbLauncherOriginal=@{};$global:hbLauncherChanges=0
foreach($name in @('HasarBotu-Office-Pending-Source-Attestations','HasarBotu-Office-Source-Attestations')){
  $value=[pscustomobject]@{Actions=@([pscustomobject]@{Execute='wscript.exe';Arguments='run-office-source-refresh.vbs all'})}
  $global:hbLauncherTasks[$name]=$value;$global:hbLauncherOriginal[$name]=$value
}
function Get-ScheduledTask {param($TaskName,$ErrorAction);$global:hbLauncherTasks[$TaskName]}
function Export-ScheduledTask {param($TaskName);'<Task />'}
function New-ScheduledTaskAction {param($Execute,$Argument);[pscustomobject]@{Execute=$Execute;Arguments=$Argument}}
function Set-ScheduledTask {param($TaskName,$Action);$global:hbLauncherChanges++;if(${failure ? '$true' : '$false'} -and $global:hbLauncherChanges -eq 2){throw 'SYNTHETIC_TASK_FAILURE'};$global:hbLauncherTasks[$TaskName]=[pscustomobject]@{Actions=@($Action)}}
function Register-ScheduledTask {param($TaskName,$Xml,[switch]$Force);$global:hbLauncherTasks[$TaskName]=$global:hbLauncherOriginal[$TaskName]}
$preview=& $setup -SourceRefreshDirectory $directory -BackupDirectory "$directory/backup"|ConvertFrom-Json
if($preview.status -ne 'preview' -or $global:hbLauncherChanges -ne 0 -or (Test-Path "$directory/run-office-source-refresh.exe")){throw 'PREVIEW_MUTATED_STATE'}
${failure ? String.raw`try{& $setup -SourceRefreshDirectory $directory -BackupDirectory "$directory/backup" -Apply;throw 'EXPECTED_FAILURE'}catch{if($_.Exception.Message -ne 'SYNTHETIC_TASK_FAILURE'){throw}}
foreach($task in $global:hbLauncherTasks.Values){if($task.Actions[0].Execute -ne 'wscript.exe'){throw 'TASK_NOT_ROLLED_BACK'}}
if(Test-Path "$directory/run-office-source-refresh.exe"){throw 'BINARY_NOT_ROLLED_BACK'}` : String.raw`$result=& $setup -SourceRefreshDirectory $directory -BackupDirectory "$directory/backup" -Apply|ConvertFrom-Json
if($result.status -ne 'configured' -or $global:hbLauncherChanges -ne 2){throw 'MIGRATION_FAILED'}
foreach($task in $global:hbLauncherTasks.Values){if($task.Actions[0].Execute -ne "$directory\run-office-source-refresh.exe" -or $task.Actions[0].Arguments -notin @('all','pending')){throw 'INVALID_ACTION'}}
$again=& $setup -SourceRefreshDirectory $directory -BackupDirectory "$directory/backup" -Apply|ConvertFrom-Json
if($again.status -ne 'already_configured' -or $global:hbLauncherChanges -ne 2){throw 'NOT_IDEMPOTENT'}`}
Write-Output 'PASS'
`
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /PASS/)
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
})

test('configuration pins the target, organization and database without a hardcoded machine or runtime', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hb-refresh-config-'))
  const config = { expectedComputerName: 'SYNTHETIC-OFFICE', runtimeRoot: 'C:\\runtime with spaces', sourceRoot: 'Q:\\Synthetic', organizationId: '00000000-0000-4000-8000-000000000001', databaseName: 'synthetic_office' }
  const save = value => writeFile(join(directory, 'configuration.json'), JSON.stringify(value))
  try {
    await save(config)
    assert.deepEqual(loadSourceRefreshConfig(directory, { COMPUTERNAME: 'synthetic-office' }), config)
    assert.throws(() => loadSourceRefreshConfig(directory, { COMPUTERNAME: 'OTHER-OFFICE' }), /TARGET_MISMATCH/)
    for (const [key, value, expected] of [['runtimeRoot', 'relative/path', /PATH_CONFIGURATION_INVALID/], ['organizationId', 'invalid', /ORGANIZATION_REQUIRED/], ['databaseName', '', /DATABASE_REQUIRED/]]) {
      await save({ ...config, [key]: value })
      assert.throws(() => loadSourceRefreshConfig(directory, { COMPUTERNAME: 'SYNTHETIC-OFFICE' }), expected)
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('native Windows launcher starts a hidden child, validates modes and propagates its exit code', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "hb-refresh Çığ O'Neil-"))
  const executable = join(directory, 'launcher.exe')
  const source = await readFile(new URL('./office-source-refresh-launcher.cs', import.meta.url), 'utf8')
  const literal = value => `'${value.replaceAll("'", "''")}'`
  try {
    await writeFile(join(directory, 'launcher.cs'), source)
    await writeFile(join(directory, 'run-office-source-refresh.ps1'), "param([string]$Mode)\nif($Mode -eq 'pending'){exit 7};if($Mode -eq 'preview'){exit 9};exit 0")
    const command = `$ProgressPreference='SilentlyContinue';Add-Type -TypeDefinition ([IO.File]::ReadAllText(${literal(join(directory, 'launcher.cs'))})) -OutputAssembly ${literal(executable)} -OutputType WindowsApplication`
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true })
    for (const [mode, expected] of [['invalid', 2], ['all', 0], ['pending', 7], ['preview', 9]]) {
      const child = spawnSync(executable, [mode], { windowsHide: true, timeout: 10_000 })
      assert.equal(child.status, expected, child.stderr?.toString())
    }
    const bytes = await readFile(executable)
    const peOffset = bytes.readUInt32LE(0x3c)
    assert.equal(bytes.readUInt16LE(peOffset + 24 + 68), 2, 'PE Windows GUI subsystem prevents the initial console flash')
    await rm(join(directory, 'run-office-source-refresh.ps1'))
    assert.equal(spawnSync(executable, ['all'], { windowsHide: true }).status, 3)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
