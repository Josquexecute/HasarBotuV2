import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { resolve, join, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { unzipSync } from 'fflate'
import assert from 'node:assert/strict'

const archive = resolve(process.argv[2])
const bytes = await readFile(archive)
const files = Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name,data])=>[name.replaceAll('\\','/'),data]))
const prefix = 'transition-manager/'
const manifest = JSON.parse(Buffer.from(files[prefix+'manager-manifest.json']).toString('utf8'))
assert.equal(manifest.productionChanged,false)
assert.equal(manifest.productionAcceptance,'PENDING')
assert.equal(manifest.revision,'independent-restore-evidence-v6')
assert.equal(manifest.defaultMode,'preflight')
assert.equal(manifest.explicitApplyRequired,true)
const expected = new Set([prefix+'manager-manifest.json',...manifest.files.map(entry=>prefix+entry.path)])
for (const [name,data] of Object.entries(files)) {
  if (name.endsWith('/')) continue
  assert.ok(expected.has(name), 'Unexpected ZIP file')
  const entry = manifest.files.find(entry => prefix+entry.path === name)
  if (entry) {
    assert.equal(data.length,entry.size)
    assert.equal(createHash('sha256').update(data).digest('hex'),entry.sha256)
  }
}
assert.ok([...expected].every(name=>files[name]))
const scratch = resolve('.local','manager-package-smoke-'+Date.now())
await mkdir(scratch)
try {
  for (const [name,data] of Object.entries(files)) {
    if (name.endsWith('/')) continue
    const target = resolve(scratch,name)
    assert.ok(target.startsWith(scratch+sep))
    await mkdir(resolve(target,'..'),{recursive:true})
    await writeFile(target,data)
  }
  const root = join(scratch,'transition-manager')
  const executable = 'powershell.exe'
  const host = execFileSync(executable,['-NoProfile','-Command','[Environment]::MachineName'],{encoding:'utf8',windowsHide:true}).trim()
  assert.notEqual(host.toUpperCase(),'DESKTOP-EFN2G33','Do not smoke-run this harness on production')
  const args = ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'start-api-transition.ps1')]
  const stopped = spawnSync(executable,args,{encoding:'utf8',windowsHide:true,timeout:15000})
  assert.equal(stopped.status,1)
  assert.ok(stopped.stdout.includes('code=OFFICE_SERVER_REQUIRED'))
  const inspectionArgs=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'inspect-local-postgres.ps1')]
  const inspectionStopped=spawnSync(executable,inspectionArgs,{encoding:'utf8',windowsHide:true,timeout:15000})
  assert.equal(inspectionStopped.status,1)
  assert.ok(inspectionStopped.stdout.includes('code=OFFICE_SERVER_REQUIRED'))
  await writeFile(join(root,'api-transition-manager.psm1'),"throw 'UNVERIFIED_MODULE_EXECUTED'\n")
  const tampered = spawnSync(executable,args,{encoding:'utf8',windowsHide:true,timeout:15000})
  assert.equal(tampered.status,1)
  assert.ok(tampered.stdout.includes('code=MANAGER_PACKAGE_HASH_MISMATCH'))
  assert.ok(!tampered.stdout.includes('UNVERIFIED_MODULE_EXECUTED') && !tampered.stderr.includes('UNVERIFIED_MODULE_EXECUTED'))
  const inspectionTampered=spawnSync(executable,inspectionArgs,{encoding:'utf8',windowsHide:true,timeout:15000})
  assert.equal(inspectionTampered.status,1)
  assert.ok(inspectionTampered.stdout.includes('code=MANAGER_PACKAGE_HASH_MISMATCH'))
  assert.ok(!inspectionTampered.stdout.includes('UNVERIFIED_MODULE_EXECUTED') && !inspectionTampered.stderr.includes('UNVERIFIED_MODULE_EXECUTED'))
  const launcher = resolve(archive,'..','Baslat-HasarBotu-0191.ps1')
  const bundle = await readFile(launcher,'utf8')
  const sums = await readFile(resolve(archive,'..','SHA256SUMS.txt'),'utf8')
  assert.ok(sums.includes(createHash('sha256').update(bytes).digest('hex')+'  HasarBotu-0.1.91-transition-manager.zip'))
  assert.ok(sums.includes(createHash('sha256').update(bundle).digest('hex')+'  Baslat-HasarBotu-0191.ps1'))
  const embedded = bundle.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)
  assert.ok(embedded)
  assert.ok(Buffer.from(embedded[1],'base64').equals(bytes))
  const launched = spawnSync(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',launcher],{encoding:'utf8',windowsHide:true,timeout:15000})
  assert.equal(launched.status,1)
  assert.ok(launched.stdout.includes('code=OFFICE_SERVER_REQUIRED'))
  const corruptBundle = join(scratch,'corrupt-launcher.ps1')
  await writeFile(corruptBundle,bundle.replace(embedded[1],Buffer.from('tampered').toString('base64')))
  const rejected = spawnSync(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',corruptBundle],{encoding:'utf8',windowsHide:true,timeout:15000})
  assert.equal(rejected.status,1)
  assert.ok(rejected.stdout.includes('code=BUNDLE_HASH_MISMATCH'))
  // Exercise the real extraction code in a throwaway copy. Only this test copy
  // bypasses the OFFICE host guard and redirects the extraction root. The
  // extracted manager retains its own real host guard, before any service I/O.
  const extractionRoot = join(scratch,'extraction')
  const extractionScript = join(scratch,'extract-fixture.ps1')
  const fixture = bundle.replace("if ([Environment]::MachineName -ine 'DESKTOP-EFN2G33') { throw 'OFFICE_SERVER_REQUIRED' }",'# isolated extraction fixture')
    .replace(/C:\\HB0191\\manager-[a-f0-9]{16}/,extractionRoot.replaceAll("'","''"))
  await writeFile(extractionScript,fixture)
  const extracted = spawnSync(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',extractionScript],{encoding:'utf8',windowsHide:true,timeout:15000})
  assert.equal(extracted.status,1)
  assert.ok(extracted.stdout.includes('code=OFFICE_SERVER_REQUIRED'),extracted.stdout)
  for (const entry of manifest.files) {
    const actual = await readFile(join(extractionRoot,'transition-manager',entry.path))
    assert.equal(createHash('sha256').update(actual).digest('hex'),entry.sha256)
  }
  // Replace only the child launch boundary, keeping real parameter binding,
  // extraction and argument construction. The delivered host guard is retained.
  const launchLine = '& "$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" @managerArguments'
  assert.ok(fixture.includes(launchLine))
  const forwarding = join(scratch,'forwarding-fixture.ps1')
  await writeFile(forwarding,fixture.replace(launchLine,'Write-Output (ConvertTo-Json -InputObject $managerArguments -Compress); exit 0'))
  for (const mode of [[],['-Apply'],['-Rollback'],['-RestoreAdmin'],['-RestoreAdmin','-Apply'],['-RestoreEvidencePath','C:\\fixture space\\restore-evidence.json','-RestoreEvidenceSha256','a'.repeat(64)],['-RestoreEvidencePath','C:\\fixture space\\restore-evidence.json','-RestoreEvidenceSha256','a'.repeat(64),'-Apply']]) {
    const result = spawnSync(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',forwarding,
      '-RuntimeDirectory','C:\\fixture space\\runtime','-CandidateDirectory','C:\\fixture space\\candidate','-WinSwXml','C:\\ProgramData\\HasarBotu\\runtime-20261011\\wrappers\\api\\hasarbotu-api.xml',...mode],{encoding:'utf8',windowsHide:true,timeout:15000})
    assert.equal(result.status,0,result.stderr)
    const args = JSON.parse(result.stdout.trim())
    assert.equal(args[args.indexOf('-RuntimeDirectory')+1],'C:\\fixture space\\runtime')
    assert.equal(args[args.indexOf('-CandidateDirectory')+1],'C:\\fixture space\\candidate')
    assert.equal(args[args.indexOf('-WinSwXml')+1],'C:\\ProgramData\\HasarBotu\\runtime-20261011\\wrappers\\api\\hasarbotu-api.xml')
    assert.equal(args.includes('-Apply'),mode.includes('-Apply'))
    assert.equal(args.includes('-Rollback'),mode.includes('-Rollback'))
    assert.equal(args.includes('-RestoreAdmin'),mode.includes('-RestoreAdmin'))
    assert.equal(args.includes('-RestoreEvidencePath'),mode.includes('-RestoreEvidencePath'))
    if(mode.includes('-RestoreEvidencePath')) {
      assert.equal(args[args.indexOf('-RestoreEvidencePath')+1],'C:\\fixture space\\restore-evidence.json')
      assert.equal(args[args.indexOf('-RestoreEvidenceSha256')+1],'a'.repeat(64))
    }
  }
  for(const mode of [['-RestoreEvidencePath','C:\\fixture.json'],['-RestoreEvidenceSha256','a'.repeat(64)],['-RestoreAdmin','-RestoreEvidencePath','C:\\fixture.json','-RestoreEvidenceSha256','a'.repeat(64)]]) {
    const result=spawnSync(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',forwarding,...mode],{encoding:'utf8',windowsHide:true,timeout:15000})
    assert.equal(result.status,1)
    assert.ok(result.stdout.includes('code=RESTORE_MODE_CONFLICT'))
  }
  for(const mode of [['-InspectPostgres'],['-InspectPostgres','-Rehearse']]){
    const result=spawnSync(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',forwarding,...mode],{encoding:'utf8',windowsHide:true,timeout:15000})
    assert.equal(result.status,0,result.stderr)
    const args=JSON.parse(result.stdout.trim())
    assert.ok(args[args.indexOf('-File')+1].endsWith('inspect-local-postgres.ps1'))
    assert.equal(args.includes('-Apply'),false)
    assert.equal(args.includes('-Rehearse'),mode.includes('-Rehearse'))
  }
  for(const mode of [['-Rehearse'],['-InspectPostgres','-Apply'],['-InspectPostgres','-Rollback'],['-InspectPostgres','-RestoreAdmin']]){
    const result=spawnSync(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',forwarding,...mode],{encoding:'utf8',windowsHide:true,timeout:15000})
    assert.equal(result.status,1)
    assert.ok(result.stdout.includes('INSPECTION_MODE_CONFLICT'))
  }
  console.log(JSON.stringify({status:'PASS',archiveFiles:expected.size,archiveSha256:createHash('sha256').update(bytes).digest('hex'),offServerRefusal:'PASS',tamperedModuleRejectedBeforeImport:'PASS',selfExtractingBundleIntegrity:'PASS',explicitModeForwarding:'PASS',checksumList:'PASS',officeAcceptance:'PENDING'}))
} finally {
  assert.ok(scratch.startsWith(resolve('.local')+sep+'manager-package-smoke-'))
  await rm(scratch,{recursive:true,force:true})
}
