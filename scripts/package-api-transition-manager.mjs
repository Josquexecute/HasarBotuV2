import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const output = resolve(process.argv[2] ?? '.local/transition-manager-0191')
if (process.platform !== 'win32' || process.arch !== 'x64' || !process.version.startsWith('v24.')) throw Error('WINDOWS_X64_NODE24_REQUIRED')
await mkdir(output) // Never overwrite a previously delivered package.
const root = join(output,'transition-manager')
await mkdir(root)
const names = ['start-api-transition.ps1','api-transition-manager.psm1','api-transition-secrets.psm1','api-transition-database.mjs','api-transition-restore-evidence.mjs',
  'api-transition-probe.mjs','invoke-api-database-maintenance.ps1','backup-api-transition.ps1','verify-api-transition-package.ps1',
  'deploy-service-artifacts.ps1','resolve-runtime-dependency-closure.mjs','provision-extra-data-references.ps1','verify-value-loss-reference-data-identity.mjs',
  'inspect-local-postgres.ps1','inspect-local-postgres.mjs']
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const files = []
for (const name of names) {
  const bytes = await readFile(join('deploy/windows-service',name))
  await copyFile(join('deploy/windows-service',name),join(root,name))
  files.push({ path:name, size:bytes.length, sha256:digest(bytes) })
}
await copyFile('LICENSE',join(root,'LICENSE'))
const license = await readFile('LICENSE')
files.push({ path:'LICENSE', size:license.length, sha256:digest(license) })
await writeFile(join(root,'manager-manifest.json'),JSON.stringify({ version:'0.1.91',revision:'independent-restore-evidence-v6',kind:'operator-manager',defaultMode:'preflight',explicitApplyRequired:true, files, productionAcceptance:'PENDING', productionChanged:false },null,2)+'\n')
const archive = join(output,'HasarBotu-0.1.91-transition-manager.zip')
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Compress-Archive -LiteralPath $env:HB_MANAGER_ROOT -DestinationPath $env:HB_MANAGER_ZIP -CompressionLevel Optimal'],{ windowsHide:true,stdio:'pipe',env:{...process.env,HB_MANAGER_ROOT:root,HB_MANAGER_ZIP:archive} })
const bytes = await readFile(archive)
const template = await readFile('deploy/windows-service/start-api-transition-bundle.ps1','utf8')
const bundle = template.replace('__ARCHIVE_BASE64__',bytes.toString('base64')).replace('__ARCHIVE_SHA256__',digest(bytes)).replace('__PACKAGE_FOLDER__',digest(bytes).slice(0,16))
const launcher = join(output,'Baslat-HasarBotu-0191.ps1')
await writeFile(launcher,bundle)
await writeFile(join(output,'SHA256SUMS.txt'),digest(bytes)+'  HasarBotu-0.1.91-transition-manager.zip\n'+digest(Buffer.from(bundle))+'  Baslat-HasarBotu-0191.ps1\n')
console.log(JSON.stringify({ archive, launcher, bytes:bytes.length, sha256:digest(bytes), launcherSha256:digest(Buffer.from(bundle)), productionChanged:false, productionAcceptance:'PENDING' }))
