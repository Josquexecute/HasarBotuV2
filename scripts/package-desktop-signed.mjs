import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

if (process.platform !== 'win32' || Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Windows and Node.js 24.x required')
if (process.argv.length > 2) throw new Error('Signed packaging does not accept command-line overrides')
const root = fileURLToPath(new URL('../', import.meta.url))
const desktop = join(root, 'apps/desktop')
function run(executable, args, cwd = root) {
  const result = spawnSync(executable, args, { cwd, windowsHide: true, stdio: 'inherit' })
  if (result.error || result.status !== 0) throw new Error('Signed packaging stopped: ' + (result.error?.code ?? result.status))
}
const check = join(root, 'scripts/check-desktop-signing.ps1')
run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', check])
// Loading the config before preparing resources rejects conflicting signing settings.
createRequire(import.meta.url)(join(desktop, 'electron-builder.signed.cjs'))
if (existsSync(join(desktop, 'release/signed'))) throw new Error('Preserve or move the previous signed candidate before packaging another one')
run(process.execPath, [join(root, 'scripts/prepare-desktop-distribution.mjs')])
run(process.execPath, [join(root, 'node_modules/electron-builder/cli.js'), '--win', 'nsis', '--x64', '--config', 'electron-builder.signed.cjs', '--publish', 'never'], desktop)
const { version } = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'))
run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', check, '-Mode', 'Verify',
  '-Application', join(desktop, 'release/signed/win-unpacked/HasarBotu.exe'), '-Installer', join(desktop, `release/signed/HasarBotu-Setup-${version}.exe`)])
