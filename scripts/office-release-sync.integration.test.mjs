import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

test('real Windows publisher receives only verified downloads and preserves the office manifest on failure', { skip: process.platform !== 'win32', timeout: 90_000 }, async () => {
  const workspace = process.cwd(), desktop = JSON.parse(await readFile('apps/desktop/package.json', 'utf8'))
  const installer = resolve(process.env.HASARBOTU_SYNC_TEST_INSTALLER ?? `apps/desktop/release/HasarBotu-Setup-${desktop.version}.exe`)
  const version = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Item -LiteralPath $env:HB_TEST_INSTALLER).VersionInfo.ProductVersion'], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, HB_TEST_INSTALLER: installer },
  }).trim().replace(/^(\d+\.\d+\.\d+)\.0$/, '$1')
  const bytes = await readFile(installer), sha256 = createHash('sha256').update(bytes).digest('hex'), sourceSha = 'a'.repeat(40)
  const checksum = sha256 + '  HasarBotu-Kurulum.exe\n'
  const root = await mkdtemp(join(tmpdir(), 'hasarbotu-office-sync-test-')), store = join(root, 'releases')
  await mkdir(store)
  try {
    const state = join(root, 'state'); await mkdir(state)
    const release = { id: 1, tag_name: 'v' + version, draft: false, prerelease: false,
      body: `https://github.com/Josquexecute/HasarBotuV2/actions/runs/123\n<!-- hasarbotu-source:${sourceSha} -->\n<!-- hasarbotu-artifact:${sha256}:${bytes.length} -->`,
      assets: [{ id: 11, name: 'HasarBotu-Kurulum.exe', size: bytes.length, digest: 'sha256:' + sha256 },
        { id: 12, name: 'SHA256SUMS.txt', size: Buffer.byteLength(checksum), digest: 'sha256:' + createHash('sha256').update(checksum).digest('hex') }] }
    const fixture = { release, installer, sourceSha, checksum }
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'commonjs' }))
    await writeFile(join(root, 'fixture.json'), JSON.stringify(fixture))
    // A local CLI fixture implements the GitHub API responses; the production publisher and filesystem are real.
    await writeFile(join(root, 'api'), `const fs=require('node:fs'),f=JSON.parse(fs.readFileSync('fixture.json')),r=process.argv[4];
if(process.argv[2]!=='--hostname'||process.argv[3]!=='github.com')process.exit(1);
fs.appendFileSync('requests.log',r+'\\n');
if(r==='repos/Josquexecute/HasarBotuV2')process.stdout.write(JSON.stringify({full_name:'Josquexecute/HasarBotuV2',private:true}));
else if(r.endsWith('/releases/latest')||r.endsWith('/releases/1'))process.stdout.write(JSON.stringify(f.release));
else if(r.includes('/commits/'))process.stdout.write(JSON.stringify({sha:f.sourceSha}));
else if(r.endsWith('/actions/runs/123'))process.stdout.write(JSON.stringify({head_sha:f.sourceSha,head_branch:'main',path:'.github/workflows/desktop-release.yml',conclusion:'success'}));
else if(r.endsWith('/releases/assets/11'))process.stdout.write(fs.readFileSync(f.installer));
else if(r.endsWith('/releases/assets/12'))process.stdout.write(f.checksum);
else process.exit(1);
`)
    const configuration = join(state, 'config.json')
    await writeFile(configuration, JSON.stringify({ githubExecutable: process.execPath, publisherScript: join(workspace, 'scripts/publish-desktop-release.mjs'), releaseDirectory: store, stateDirectory: state }))
    const invoke = () => spawnSync(process.execPath, [join(workspace, 'scripts/sync-office-github-release.mjs'), configuration], {
      cwd: root, windowsHide: true, timeout: 30_000, encoding: 'utf8', env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' },
    })
    const first = invoke(); assert.equal(first.status, 0, first.stdout + first.stderr)
    const before = await readFile(join(store, 'latest.json'), 'utf8'), manifest = JSON.parse(before)
    assert.equal(manifest.version, version); assert.equal(manifest.sha256, sha256)
    assert.equal(createHash('sha256').update(await readFile(join(store, sha256 + '.exe'))).digest('hex'), sha256)
    assert.equal(JSON.parse(await readFile(join(state, 'status.json'), 'utf8')).action, 'UPDATE')
    const lockFile = join(store, '.publish.lock'), notesFile = join(root, 'notes.txt')
    await writeFile(notesFile, release.body)
    await writeFile(lockFile, JSON.stringify({ pid: process.pid }))
    const competing = spawnSync(process.execPath, [join(workspace, 'scripts/publish-desktop-release.mjs'), installer, store, version, notesFile], { windowsHide: true, encoding: 'utf8', timeout: 30_000 })
    assert.equal(competing.status, 1)
    assert.ok(competing.stderr.includes('EEXIST'))
    assert.equal(await readFile(join(store, 'latest.json'), 'utf8'), before)
    await unlink(lockFile)
    const second = invoke(); assert.equal(second.status, 0, second.stdout + second.stderr)
    assert.equal(JSON.parse(await readFile(join(state, 'status.json'), 'utf8')).action, 'CURRENT')
    assert.equal((await readFile(join(root, 'requests.log'), 'utf8')).split('\n').filter(line => line.endsWith('/releases/assets/11')).length, 1)
    fixture.release.assets[1].digest = 'sha256:' + 'f'.repeat(64)
    await writeFile(join(root, 'fixture.json'), JSON.stringify(fixture))
    assert.equal(invoke().status, 1)
    assert.equal(await readFile(join(store, 'latest.json'), 'utf8'), before)
    assert.equal(JSON.parse(await readFile(join(state, 'status.json'), 'utf8')).status, 'BLOCKED')
  } finally {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('hasarbotu-office-sync-test-')) throw new Error('Unexpected release sync test directory.')
    await rm(root, { recursive: true, force: true })
  }
})
