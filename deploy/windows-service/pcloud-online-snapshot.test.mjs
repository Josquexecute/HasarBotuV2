import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { utimesSync } from 'node:fs'
import { setImmediate as immediate } from 'node:timers/promises'
import test from 'node:test'
import { withConsistentPcloudDatabase } from './pcloud-maintenance-window-gate.mjs'

test('online snapshot stays consistent while a separate WAL connection keeps writing', async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hb-pcloud-online-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'data.db')
  const writer = new DatabaseSync(file)
  let timer
  try {
    writer.exec('PRAGMA journal_mode=WAL; CREATE TABLE revisions(id INTEGER PRIMARY KEY,generation INTEGER,payload TEXT); BEGIN')
    const insert = writer.prepare('INSERT INTO revisions VALUES(?,1,?)')
    for (let i = 0; i < 6000; i++) insert.run(i, 'x'.repeat(1000))
    writer.exec('COMMIT')
    let generation = 1
    const update = writer.prepare('UPDATE revisions SET generation=?')
    timer = setInterval(() => { update.run(++generation) }, 1)
    await withConsistentPcloudDatabase(file, async snapshot => {
      const before = snapshot.prepare('SELECT min(generation) lo,max(generation) hi FROM revisions').get()
      assert.equal(before.lo, before.hi)
      assert.throws(() => snapshot.exec('DELETE FROM revisions'), /readonly|read-only/i)
      update.run(++generation)
      await immediate()
      const after = snapshot.prepare('SELECT min(generation) lo,max(generation) hi FROM revisions').get()
      assert.deepEqual(after, before)
      assert.ok(generation > before.hi)
    })
    assert.ok(generation > 2, 'writer continued during the capture')
  } finally { clearInterval(timer); writer.close() }
})

test('exclusive pCloud lock uses a verified DB/WAL copy without copying volatile SHM reader state', async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hb-pcloud-exclusive-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'data.db')
  const writer = new DatabaseSync(file)
  let timer
  try {
    writer.exec('PRAGMA journal_mode=WAL; CREATE TABLE file(id INTEGER PRIMARY KEY); INSERT INTO file VALUES(1); PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; INSERT INTO file VALUES(2); COMMIT')
    let changes = 0
    timer = setInterval(() => { const time = new Date(Date.now() + ++changes * 1000); utimesSync(file + '-shm', time, time) }, 1)
    await withConsistentPcloudDatabase(file, async (snapshot, details) => {
      assert.equal(details.strategy, 'verified-copy')
      await immediate()
      assert.equal(snapshot.prepare('SELECT count(*) AS n FROM file').get().n, 2)
      assert.throws(() => snapshot.exec('DELETE FROM file'), /readonly|read-only/i)
    })
    assert.ok(changes > 0)
  } finally { clearInterval(timer); writer.close() }
})

test('invalid or absent databases fail closed and reader failures retain their real cause', async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hb-pcloud-invalid-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'data.db')
  await assert.rejects(withConsistentPcloudDatabase(file, () => undefined), { safeCode: 'PCLOUD_LOCAL_DATABASE_NOT_FOUND' })
  await writeFile(file, 'corrupt database')
  await assert.rejects(withConsistentPcloudDatabase(file, () => undefined), { safeCode: 'PCLOUD_DATABASE_SNAPSHOT_INVALID' })
  const database = new DatabaseSync(path.join(directory, 'valid.db'))
  database.exec('CREATE TABLE sample(id INTEGER)'); database.close()
  const failure = new Error('reader failed')
  await assert.rejects(withConsistentPcloudDatabase(path.join(directory, 'valid.db'), () => { throw failure }), error => error === failure)
})
