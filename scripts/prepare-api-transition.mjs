import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, lstat, readFile, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { computeClosure, verifyOnDiskVersions, findExtraDataReferences } from '../deploy/windows-service/resolve-runtime-dependency-closure.mjs'

const base = '2a4f6009b12a9470ac50d3802a33f92cafd47875'
const repo = resolve('.'), output = resolve(process.argv[2] ?? '.local/api-transition-0.1.91')
// An already verified runtime ZIP may be retained when only operator tools change.
const reuseRuntime = process.argv[3] ? resolve(process.argv[3]) : null
if (process.platform !== 'win32' || process.arch !== 'x64' || !process.version.startsWith('v24.')) throw Error('WINDOWS_X64_NODE24_REQUIRED')
if (execFileSync('git',['rev-parse','HEAD'],{ encoding:'utf8',windowsHide:true }).trim() !== base) throw Error('SOURCE_COMMIT_MISMATCH')
if (execFileSync('git',['diff',base,'--','services/api','packages','package-lock.json'],{ encoding:'utf8',windowsHide:true }).length) throw Error('API_SOURCE_DIFFERS_FROM_BASE')
await mkdir(output) // Refuse to overwrite an earlier verified delivery.
const runtime = join(output,'api-runtime'), tools = join(output,'api-operator-tools')
await mkdir(runtime); await mkdir(tools)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function copy(source,target,skipNodeModules=false) {
  const info = await lstat(source)
  if (info.isSymbolicLink()) throw Error('SOURCE_LINK_REJECTED')
  if (info.isDirectory()) {
    await mkdir(target,{ recursive:true })
    for (const name of (await readdir(source)).sort()) {
      if (skipNodeModules && name === 'node_modules') continue
      await copy(join(source,name),join(target,name),skipNodeModules)
    }
  } else if (info.isFile()) { await mkdir(dirname(target),{recursive:true}); await copyFile(source,target) }
  else throw Error('SOURCE_FILE_TYPE_REJECTED')
}
const lockBytes = await readFile('package-lock.json'), lock = JSON.parse(lockBytes)
const closure = computeClosure(lock.packages,'services/api','win32','x64')
const verification = await verifyOnDiskVersions(repo,closure)
if (!verification.allOk) throw Error('DEPENDENCY_VERSION_MISMATCH')
if (reuseRuntime) {
  await copy(join(reuseRuntime,'api-runtime'),runtime)
} else {
for (const workspace of [...closure.workspaceInternal,'services/api']) {
  await copy(join(repo,workspace,'package.json'),join(runtime,workspace,'package.json'))
  execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p',join(workspace,'tsconfig.build.json'),'--outDir',join(runtime,workspace,'dist')],{ windowsHide:true,stdio:'pipe' })
  if (workspace === 'packages/database') await copy(join(repo,workspace,'migrations'),join(runtime,workspace,'migrations'))
}
for (const entry of verification.external) await copy(join(repo,entry.lockKey),join(runtime,entry.lockKey),true)
const refs = await findExtraDataReferences(repo,'services/api')
for (const ref of refs) await copy(join(repo,dirname(ref.resolvedRepoRelativePath)),join(runtime,dirname(ref.resolvedRepoRelativePath)))
await copy('LICENSE',join(runtime,'LICENSE'))
await copy('package-lock.json',join(runtime,'package-lock.json'))
await copy(process.execPath,join(runtime,'node/node.exe'))
await copy(join(dirname(process.execPath),'LICENSE'),join(runtime,'node/LICENSE'))
const deployedClosure = { SchemaVersion:'hasarbotu-runtime-dependency-closure/1.0.0',Status:'ok',Workspace:'services/api',Platform:'win32',Arch:'x64',
  WorkspaceInternal:closure.workspaceInternal,External:verification.external,SkippedIncompatibleOptional:closure.skippedIncompatibleOptional,ExtraDataReferences:refs }
await writeFile(join(runtime,'dependency-closure.json'),JSON.stringify(deployedClosure,null,2)+'\n')
}
const toolNames = ['README.md','deploy-service-artifacts.ps1','resolve-runtime-dependency-closure.mjs','provision-extra-data-references.ps1',
  'verify-value-loss-reference-data-identity.mjs','smoke-test-deployed-service.mjs','api-transition-secrets.psm1','set-api-desktop-oauth.ps1',
  'api-transition-database.mjs','api-transition-manager.psm1','invoke-api-database-maintenance.ps1','backup-api-transition.ps1','verify-api-transition-package.ps1','test-office-network-readiness.ps1']
for (const name of toolNames) await copy(join(repo,'deploy/windows-service',name),join(tools,name))
await copy('LICENSE',join(tools,'LICENSE'))
// Keep a reviewable copy of local deployment changes alongside the base provenance.
await writeFile(join(tools,'deployment-tool-changes.patch'),execFileSync('git',['diff',base,'--','deploy/windows-service/deploy-service-artifacts.ps1'],{windowsHide:true}))
async function inventory(root,prefix='') {
  const entries = []
  for (const name of (await readdir(join(root,prefix))).sort()) {
    const rel = join(prefix,name), info = await lstat(join(root,rel))
    if (info.isSymbolicLink()) throw Error('PACKAGE_LINK_REJECTED')
    if (info.isDirectory()) entries.push(...await inventory(root,rel))
    else { const bytes = await readFile(join(root,rel)); entries.push({path:rel.replaceAll('\\','/'),size:bytes.length,sha256:digest(bytes)}) }
  }
  return entries
}
const archives=[]
for (const [directory,name] of [[runtime,'HasarBotu-0.1.91-api-runtime-win-x64.zip'],[tools,'HasarBotu-0.1.91-api-operator-tools.zip']]) {
  if (directory === runtime && reuseRuntime) {
    const prior=JSON.parse(await readFile(join(reuseRuntime,'delivery.json'),'utf8'))
    if (prior.sourceCommit !== base) throw Error('REUSED_RUNTIME_SOURCE_MISMATCH')
    const recorded=prior.archives.find(entry=>entry.path.endsWith(name))
    const bytes=await readFile(join(reuseRuntime,name))
    if (!recorded || bytes.length !== recorded.size || digest(bytes) !== recorded.sha256) throw Error('REUSED_RUNTIME_HASH_MISMATCH')
    execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(repo,'deploy/windows-service/verify-api-transition-package.ps1'),'-Directory',directory],{windowsHide:true,stdio:'pipe'})
    const archive=join(output,name)
    await copyFile(join(reuseRuntime,name),archive)
    archives.push({...recorded,path:archive})
    continue
  }
  const entries = await inventory(directory)
  const manifest = { version:'0.1.91',sourceCommit:base,nodeVersion:process.version,platform:'win32',arch:'x64',lockSha256:digest(lockBytes),
    containsCredentials:false,productionChanged:false,feedChanged:false,apiSourceUnmodified:true,deploymentToolMigrationFix:true,files:entries }
  const json = JSON.stringify(manifest,null,2)+'\n'
  await writeFile(join(directory,'package-manifest.json'),json)
  await writeFile(join(directory,'SHA256SUMS.txt'),[...entries.map(entry=>`${entry.sha256}  ${entry.path}`),`${digest(Buffer.from(json))}  package-manifest.json`].join('\n')+'\n')
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(repo,'deploy/windows-service/verify-api-transition-package.ps1'),'-Directory',directory],{windowsHide:true,stdio:'pipe'})
  const archive=join(output,name)
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command', 'Compress-Archive -LiteralPath $env:HB_PACKAGE_DIRECTORY -DestinationPath $env:HB_PACKAGE_ARCHIVE -CompressionLevel Optimal'],{
    windowsHide:true,stdio:'pipe',timeout:600000,env:{...process.env,HB_PACKAGE_DIRECTORY:directory,HB_PACKAGE_ARCHIVE:archive} })
  const bytes=await readFile(archive)
  archives.push({path:archive,size:bytes.length,sha256:digest(bytes),files:entries.length})
}
await writeFile(join(output,'SHA256SUMS.txt'),archives.map(file=>`${file.sha256}  ${relative(output,file.path)}`).join('\n')+'\n')
await writeFile(join(output,'delivery.json'),JSON.stringify({version:'0.1.91',sourceCommit:base,archives,externalPackages:closure.external.length,workspacePackages:closure.workspaceInternal,
  productionChanged:false,feedChanged:false,productionDatabaseAccessed:false,productionAcceptance:'PENDING'},null,2)+'\n')
console.log(JSON.stringify({status:'PACKAGED',archives,externalPackages:closure.external.length,workspacePackages:closure.workspaceInternal}))
