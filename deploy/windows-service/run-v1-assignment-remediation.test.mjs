import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
const script = fileURLToPath(new URL('./run-v1-assignment-remediation.mjs', import.meta.url))
const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true })
test('apply rejects non-interactive stdin before reading a manifest or database', () => {
  const result = run(['--apply', '--manifest', 'does-not-exist.json', '--organization-id', '11111111-1111-4111-8111-111111111111',
    '--actor-user-id', '22222222-2222-4222-8222-222222222222', '--expected-plan-hash', 'a'.repeat(64)])
  assert.equal(result.status, 1)
  assert.equal(JSON.parse(result.stderr).code, 'ASSIGNMENT_INTERACTIVE_ACTOR_AND_PLAN_REQUIRED')
})
test('unknown and repeated flags fail instead of changing interpretation', () => {
  for (const args of [['--yes'], ['--manifest','one.json','--manifest','two.json']]) {
    const result = run(args)
    assert.equal(result.status, 1)
    assert.equal(JSON.parse(result.stderr).code, 'ASSIGNMENT_ARGUMENT_INVALID')
  }
})
test('preview requires an explicit manifest and organization', () => {
  const result = run([])
  assert.equal(result.status, 1)
  assert.equal(JSON.parse(result.stderr).code, 'ASSIGNMENT_MANIFEST_AND_ORGANIZATION_REQUIRED')
})
