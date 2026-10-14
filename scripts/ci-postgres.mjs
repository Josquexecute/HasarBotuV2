import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import net from 'node:net'
import pg from 'pg'

if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'win32' || !isAbsolute(process.env.RUNNER_TEMP ?? '')) throw new Error('This PostgreSQL helper is restricted to an isolated Windows GitHub runner.')
const directory = resolve(process.env.RUNNER_TEMP, 'hasarbotu-ci-postgres'), data = join(directory, 'data')
const mode = process.argv[2], bin = process.env.PGBIN ?? 'C:/Program Files/PostgreSQL/17/bin'
function run(tool, args, env = process.env) {
  // A Windows postmaster inherits pipe handles; pg_ctl can exit while a pipe reader never sees EOF.
  const log = openSync(join(directory, tool + '.log'), 'a')
  try { return execFileSync(join(bin, tool + '.exe'), args, { env, windowsHide: true, timeout: 60_000, stdio: ['ignore', log, log] }) }
  finally { closeSync(log) }
}
if (mode === 'stop') {
  let state
  try { state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (state) {
    if (resolve(state.dataDirectory) !== data) throw new Error('CI PostgreSQL data directory mismatch.')
    run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
  }
} else if (mode === 'start') {
  if (!process.env.GITHUB_ENV) throw new Error('GitHub environment output is missing.')
  await mkdir(directory)
  const password = randomBytes(24).toString('hex'), passwordFile = join(directory, 'password.txt')
  await writeFile(passwordFile, password, { mode: 0o600, flag: 'wx' })
  try { run('initdb', ['-D', data, '-U', 'hasarbotu_ci', '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C', '--pwfile=' + passwordFile]) }
  finally { await unlink(passwordFile) }
  const server = net.createServer()
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const port = server.address().port
  await new Promise(done => server.close(done))
  await writeFile(join(directory, 'state.json'), JSON.stringify({ dataDirectory: data, port }))
  run('pg_ctl', ['-D', data, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'])
  const database = new pg.Client({ host: '127.0.0.1', port, user: 'hasarbotu_ci', password, database: 'postgres' })
  try { await database.connect(); await database.query('CREATE DATABASE hasarbotu_ci_test') }
  finally { await database.end() }
  const url = `postgres://hasarbotu_ci:${password}@127.0.0.1:${port}/hasarbotu_ci_test`
  // GitHub intercepts mask commands before logging the generated, runner-only credential.
  console.log('::add-mask::' + password)
  console.log('::add-mask::' + url)
  await appendFile(process.env.GITHUB_ENV, 'TEST_DATABASE_URL=' + url + '\n')
} else throw new Error('Use start or stop.')
