import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, copyFile, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

test('SCM and WinSW recovery migration preserves start modes, verifies native actions and rolls back exact XML/policies', {
  skip: process.platform !== 'win32' || !process.env.TEST_WINSW_EXE,
  timeout: 90_000,
}, async () => {
  const root = resolve(process.env.RUNNER_TEMP ?? tmpdir()), directory = await mkdtemp(join(root, 'hb-recovery-migration-'))
  const names = ['hasarbotu-recovery-test-' + process.pid, 'postgresql-recovery-test-' + process.pid]
  const literal = value => "'" + value.replaceAll("'", "''") + "'"
  const ps = source => execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from("$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';"+source,'utf16le').toString('base64')], {windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30_000}).trim()
  const tool = literal(resolve('deploy/windows-service/set-office-service-recovery.ps1'))
  const native = literal(resolve('deploy/windows-service/office-service-recovery.cs'))
  const policies = () => JSON.parse(ps(`Add-Type -Path ${native};$items=@(${names.map(name=>`[OfficeServiceRecovery]::Read(${literal(name)})`).join(';')});ConvertTo-Json -InputObject $items -Depth 8 -Compress`))
  const originals = []
  try {
    ps(`$acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'));foreach($sid in @('S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))};Set-Acl -LiteralPath ${literal(directory)} -AclObject $acl`)
    for (const name of names) {
      const exe = join(directory,name+'.exe'), xml = join(directory,name+'.xml')
      await copyFile(process.env.TEST_WINSW_EXE,exe)
      await writeFile(xml, `<service><id>${name}</id><name>${name}</name><description>Disposable recovery fixture</description><executable>${process.execPath.replaceAll('&','&amp;')}</executable><arguments>--version</arguments><startmode>Manual</startmode><onfailure action="restart" delay="2 sec"/><resetfailure>2 hours</resetfailure></service>`)
      originals.push(await readFile(xml))
      execFileSync(exe,['install'],{windowsHide:true,encoding:'utf8',timeout:30_000})
    }
    const before = policies(), args = `-Services @(${names.map(literal).join(',')}) -Directory ${literal(directory)}`
    assert.equal(JSON.parse(ps(`& ${tool} ${args}`)).status,'PREVIEW')
    assert.deepEqual(policies(),before)
    const applied = JSON.parse(ps(`& ${tool} ${args} -Apply`))
    assert.equal(applied.status,'APPLIED'); assert.equal(applied.servicesRestarted,false); assert.equal(applied.startModesChanged,false)
    for (const policy of policies()) {
      assert.equal(policy.ResetSeconds,3600)
      assert.deepEqual(policy.Actions,[{Type:1,Delay:10000},{Type:1,Delay:30000},{Type:1,Delay:60000},{Type:0,Delay:0}])
    }
    assert.match(await readFile(join(directory,names[0]+'.xml'),'utf8'),/action="none"/)
    assert.deepEqual(await readFile(join(directory,names[1]+'.xml')), originals[1], 'native service configuration is changed only through SCM')
    assert.equal(ps(`@(${names.map(name=>`(Get-CimInstance Win32_Service -Filter "Name='${name}'").StartMode`).join(';')}) -join ','`),'Manual,Manual')
    assert.equal(JSON.parse(ps(`& ${tool} -RollbackReceipt ${literal(applied.rollbackReceipt)}`)).status,'ROLLBACK_PREVIEW')
    ps(`Add-Type -Path ${native};$p=[OfficeServiceRecovery]::Read(${literal(names[0])});$p.Command='synthetic-inactive-operator-command';[OfficeServiceRecovery]::Write(${literal(names[0])},$p)`)
    assert.throws(()=>ps(`& ${tool} -RollbackReceipt ${literal(applied.rollbackReceipt)} -Apply`), error => error.status === 1 && error.stderr.includes('SERVICE_RECOVERY_POLICY_CHANGED_SINCE_APPLY'))
    ps(`Add-Type -Path ${native};$p=[OfficeServiceRecovery]::Read(${literal(names[0])});$p.Command=$null;[OfficeServiceRecovery]::Write(${literal(names[0])},$p)`)
    const managedXml = join(directory,names[0]+'.xml'), planned = await readFile(managedXml)
    await writeFile(managedXml,Buffer.concat([planned,Buffer.from('<!-- later operator change -->')]))
    assert.throws(()=>ps(`& ${tool} -RollbackReceipt ${literal(applied.rollbackReceipt)} -Apply`), error => error.status === 1 && error.stderr.replace(/_x([a-f0-9]{4})_/gi, (_match,hex)=>String.fromCharCode(parseInt(hex,16))).includes('SERVICE_XML_CHANGED_SINCE_APPLY'))
    await writeFile(managedXml,planned)
    assert.equal(JSON.parse(ps(`& ${tool} -RollbackReceipt ${literal(applied.rollbackReceipt)} -Apply`)).status,'RESTORED')
    assert.deepEqual(policies(),before)
    for(let i=0;i<names.length;i++) assert.deepEqual(await readFile(join(directory,names[i]+'.xml')),originals[i])
  } finally {
    for(const name of names) {
      const exists = ps(`if(Get-Service -Name ${literal(name)} -ErrorAction SilentlyContinue){'exists'}`)
      if(exists) execFileSync(join(directory,name+'.exe'),['uninstall'],{windowsHide:true,stdio:'ignore',timeout:30_000})
    }
    if(!resolve(directory).startsWith(root+sep)) throw Error('UNSAFE_FIXTURE_CLEANUP')
    await rm(directory,{recursive:true,force:true})
  }
})
